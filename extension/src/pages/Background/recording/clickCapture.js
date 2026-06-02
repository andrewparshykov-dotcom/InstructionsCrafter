// Background orchestration for Click-capture mode.
//
// This is the lightweight counterpart to the video recorder: no recorder tab,
// no desktopCapture, no MediaRecorder video, no OPFS. It only:
//   - sets the session flags ClickLogger keys off (recording + recordingStartTime
//     + captureMode), so each click is logged with a timestamp,
//   - captures one screenshot of the clicked tab per click (captureVisibleTab),
//     storing it with the click's label + coordinates in IndexedDB,
//   - records optional mic narration via the offscreen audio document.
//
// Screenshots + narration live in IndexedDB (clickCaptureStores) so the Generate
// page can read them; the per-click metadata travels WITH each screenshot, so a
// failed/late capture just yields one fewer step (never a misaligned doc).

import {
  ensureAudioOffscreen,
  closeAudioOffscreen,
  sendToAudioOffscreen,
} from "../offscreen/ensureAudioOffscreen";
import {
  clickShotsStore,
  clearClickCaptureStores,
} from "../../utils/clickCaptureStores";

// captureVisibleTab is capped at ~2 calls/sec by Chrome; we capture immediately
// and, only if we hit that quota, wait and retry once.
const RATE_LIMIT_BACKOFF_MS = 600;
const SHOT_JPEG_QUALITY = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- toolbar badge indicator ----------------------------------------------
// The recording indicator lives on the extension icon (browser chrome), NOT in
// the page -- captureVisibleTab would otherwise bake any in-page overlay into
// every screenshot. The badge shows the live capture count; the icon click
// (handled in onActionButtonClickedListener) stops the session.
const setBadge = (count) => {
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#E11D2E" });
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setTitle({
      title: `Recording clicks (${count} captured) — click this icon to stop`,
    });
  } catch {}
};

const clearBadge = () => {
  try {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "" });
  } catch {}
};

// --- session lifecycle -----------------------------------------------------

export const startClickCapture = async () => {
  await clearClickCaptureStores();

  const startTime = Date.now();
  await chrome.storage.local.set({
    captureMode: "clicks",
    recording: true,
    recordingStartTime: startTime,
    paused: false,
    pausedAt: null,
    totalPausedMs: 0,
    pendingRecording: false,
    clickShotCount: 0,
    // Click-capture writes its own click log keyed to this start time; clear
    // any prior video-mode log so nothing stale lingers.
    clickLog: [],
    clickLogSession: startTime,
    lastRecordingMode: null,
  });

  await startAudioNarration();

  try {
    chrome.action.setIcon({ path: "assets/recording-logo.png" });
  } catch {}
  setBadge(0);
  console.log("[clickCapture] session started", { startTime });
};

export const stopClickCapture = async () => {
  // Stop + persist narration. The offscreen doc writes the blob to IndexedDB
  // itself, so we just need it to finish before we close the doc.
  try {
    await sendToAudioOffscreen({ type: "clickaudio-stop" });
  } catch (err) {
    console.warn("[clickCapture] clickaudio-stop unreachable", err);
  }
  await closeAudioOffscreen();

  const { clickShotCount } = await chrome.storage.local.get(["clickShotCount"]);
  await chrome.storage.local.set({
    recording: false,
    recordingStartTime: 0,
    paused: false,
    pendingRecording: false,
    lastRecordingMode: "clicks",
  });
  try {
    chrome.action.setIcon({ path: "assets/icon-34.png" });
  } catch {}
  clearBadge();
  console.log(`[clickCapture] session stopped: ${clickShotCount || 0} shots`);

  // Open the Generate page -- same destination as the video stop flow.
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("generate.html"),
      active: true,
    });
  } catch (err) {
    console.warn("[clickCapture] failed to open generate page", err);
  }
};

const startAudioNarration = async () => {
  const { defaultAudioInput, micActive } = await chrome.storage.local.get([
    "defaultAudioInput",
    "micActive",
  ]);
  // Narration is optional: if the mic is off/none, record silently.
  if (micActive === false || defaultAudioInput === "none") {
    console.log("[clickCapture] mic off -> recording silently");
    return;
  }
  try {
    await ensureAudioOffscreen();
  } catch (err) {
    console.warn("[clickCapture] offscreen unavailable; silent", err);
    return;
  }
  // The doc's message listener may attach a tick after createDocument resolves;
  // retry a couple of times on "receiving end does not exist".
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await sendToAudioOffscreen({
        type: "clickaudio-start",
        deviceId: defaultAudioInput || null,
      });
      if (res && res.ok) {
        console.log("[clickCapture] mic narration recording");
      } else {
        console.warn("[clickCapture] mic start failed; silent", res);
      }
      return;
    } catch (err) {
      await sleep(150);
    }
  }
  console.warn("[clickCapture] mic offscreen unreachable; silent");
};

// --- per-click screenshot capture ------------------------------------------

// Called (serialized) for each click while captureMode === "clicks". Captures
// the clicked tab and stores the screenshot + the click metadata together.
export const captureClickShot = async (message, sender) => {
  // Only screenshot clicks on a real interactive control; clicking empty page
  // space (no semantic control and not cursor:pointer) must not add a step or
  // bump the badge count. ClickLogger computes `actionable`.
  if (!message.actionable) {
    return { ok: false, reason: "non-actionable" };
  }

  const tab = sender && sender.tab;
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, reason: "no-sender-tab" };
  }

  let dataUrl;
  try {
    dataUrl = await captureWithRetry(tab.windowId);
  } catch (err) {
    // Navigation race, throttle, or a restricted page (chrome://, web store).
    console.warn("[clickCapture] captureVisibleTab failed", err);
    return { ok: false, reason: "capture-failed" };
  }

  let blob;
  try {
    blob = await (await fetch(dataUrl)).blob();
  } catch (err) {
    console.warn("[clickCapture] dataURL->blob failed", err);
    return { ok: false, reason: "decode-failed" };
  }

  // Serial execution (the log-click chain) makes keys().length a safe next index.
  const order = (await clickShotsStore.keys()).length;
  await clickShotsStore.setItem(String(order).padStart(4, "0"), {
    blob,
    order,
    label: typeof message.label === "string" ? message.label : "",
    x: typeof message.x === "number" ? message.x : 0,
    y: typeof message.y === "number" ? message.y : 0,
    dpr: typeof message.dpr === "number" ? message.dpr : 1,
    t: typeof message.t === "number" ? message.t : 0,
    marker: "ring", // a real click -> hollow ring on the click point
  });
  await chrome.storage.local.set({ clickShotCount: order + 1 });
  setBadge(order + 1);
  return { ok: true, order };
};

// Ask a tab's top frame for the last pointer position (best-effort, for the
// manual-capture cursor marker). Resolves null if unavailable.
const getLastMouse = (tabId) =>
  new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: "get-last-mouse" },
        { frameId: 0 },
        (resp) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(resp || null);
        }
      );
    } catch {
      resolve(null);
    }
  });

// Manual "capture the current screen now" -- triggered by the keyboard command
// (see onCommandListener). Unlike a click capture, there is no click point, so
// the screenshot gets NO ring (stored with x/y = -1, which clicks_annotate
// skips). Lets the user grab a result/confirmation/keyboard-driven screen that
// isn't tied to an actionable click. Only active during a click-capture session.
export const captureManualShot = async () => {
  const { captureMode, recording } = await chrome.storage.local.get([
    "captureMode",
    "recording",
  ]);
  if (captureMode !== "clicks" || !recording) {
    return { ok: false, reason: "not-click-recording" };
  }

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {}
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, reason: "no-active-tab" };
  }

  // Where the pointer last was, to place the cursor-arrow marker (best-effort).
  const pos = await getLastMouse(tab.id);

  let dataUrl;
  try {
    dataUrl = await captureWithRetry(tab.windowId);
  } catch (err) {
    // Restricted page (chrome://, web store, PDF viewer): cannot be captured.
    console.warn("[clickCapture] manual capture failed", err);
    return { ok: false, reason: "capture-failed" };
  }

  let blob;
  try {
    blob = await (await fetch(dataUrl)).blob();
  } catch (err) {
    console.warn("[clickCapture] manual dataURL->blob failed", err);
    return { ok: false, reason: "decode-failed" };
  }

  const order = (await clickShotsStore.keys()).length;
  await clickShotsStore.setItem(String(order).padStart(4, "0"), {
    blob,
    order,
    label: "",
    // Cursor-arrow at the last pointer position; if unknown, x/y = -1 so the
    // backend draws nothing (a clean full-screen shot).
    x: pos && typeof pos.x === "number" ? pos.x : -1,
    y: pos && typeof pos.y === "number" ? pos.y : -1,
    dpr: pos && typeof pos.dpr === "number" ? pos.dpr : 1,
    t: 0,
    manual: true,
    marker: "pointer",
  });
  await chrome.storage.local.set({ clickShotCount: order + 1 });
  setBadge(order + 1);
  console.log(`[clickCapture] manual shot stored (order ${order}, pos=${pos ? "yes" : "no"})`);
  return { ok: true, order };
};

const captureWithRetry = async (windowId) => {
  try {
    return await captureVisibleTab(windowId);
  } catch (err) {
    if (String((err && err.message) || err).includes("MAX_CAPTURE")) {
      await sleep(RATE_LIMIT_BACKOFF_MS);
      return await captureVisibleTab(windowId);
    }
    throw err;
  }
};

const captureVisibleTab = (windowId) =>
  new Promise((resolve, reject) => {
    const cb = (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!dataUrl) {
        reject(new Error("empty capture"));
        return;
      }
      resolve(dataUrl);
    };
    const opts = { format: "jpeg", quality: SHOT_JPEG_QUALITY };
    if (typeof windowId === "number") {
      chrome.tabs.captureVisibleTab(windowId, opts, cb);
    } else {
      chrome.tabs.captureVisibleTab(opts, cb);
    }
  });
