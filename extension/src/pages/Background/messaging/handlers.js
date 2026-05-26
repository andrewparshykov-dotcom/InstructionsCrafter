import { registerMessage } from "../../../messaging/messageRouter";
import { perfMark, perfSpan } from "../../utils/perfMarks";
import {
  focusTab,
  createTab,
  resetActiveTab,
  resetActiveTabRestart,
  setSurface,
} from "../tabManagement";

import { startAfterCountdown, startRecording } from "../recording/startRecording";
import { noteCountdownStarted } from "../recording/countdownFallback";
import { handleStopRecordingTab } from "../recording/stopRecording";
import { sendChunks } from "../recording/sendChunks";
import { chunksStore } from "../recording/chunkHandler";
import { addAlarmListener } from "../alarms/addAlarmListener";
import { cancelRecording, handleDismiss } from "../recording/cancelRecording";
import { handleDismissRecordingTab } from "../recording/discardRecording";
import { sendMessageRecord } from "../recording/sendMessageRecord";
import { startRecorderSession } from "../recording/openRecorderTab";
import { acquireStreamForOffscreen } from "../offscreen/acquireStream";
import { registerProxyStorageHandlers } from "../offscreen/proxyStorageHandlers";
import { ensureRemuxOffscreen } from "../offscreen/ensureRemuxOffscreen";
import {
  restartActiveTab,
  getCurrentTab,
  sendMessageTab,
  getValidatedEditorTab,
  setEditorTabReference,
} from "../tabManagement";
import {
  handleRestart,
} from "../recording/restartRecording";
import { checkRecording } from "../recording/checkRecording";
import {
  isPinned,
  getPlatformInfo,
  checkAvailableMemory,
} from "../utils/browserHelpers";
import { requestDownload, downloadIndexedDB } from "../utils/downloadHelpers";
import { checkRestore } from "../recording/restoreRecording";
import { FIRST_CHUNK_WATCHDOG_ALARM, RECORDER_KEEPALIVE_ALARM } from "../alarms/alarmConstants";
import { desktopCapture } from "../recording/desktopCapture";
import {
  writeFile,
  videoReady,
  handleGetStreamingData,
  handleRecordingError,
  handleRecordingComplete,
  handleOnGetPermissions,
  handlePip,
  checkCapturePermissions,
} from "../recording/recordingHelpers";
import { newChunk, clearAllRecordings } from "../recording/chunkHandler";
import {
  getDiagnosticLog,
  getErrorSnapshot,
  getStorageFlags,
  diagEvent,
} from "../../utils/diagnosticLog";

const DEBUG_POSTSTOP = false;
const STOP_RECORDING_TAB_DEBOUNCE_MS = 1200;
let stopRecordingTabInFlight = false;
let stopRecordingTabLastAt = 0;

const ensureAudioOffscreen = async () => {
  if (!chrome.offscreen) return false;
  try {
    const contexts = await chrome.runtime.getContexts({});
    const hasAnyOffscreen = contexts.some(
      (context) => context.contextType === "OFFSCREEN_DOCUMENT",
    );
    // reuse existing offscreen doc if any; Chrome only allows one per extension
    if (hasAnyOffscreen) return true;
    await chrome.offscreen.createDocument({
      url: "audiooffscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play short UI beep sounds.",
    });
    return true;
  } catch (error) {
    console.warn("Failed to ensure audio offscreen document", error);
    return false;
  }
};

const logStopRecordingTabEvent = (message, sender) => {
  try {
    const reason = message?.reason || "unknown";
    const senderTabId = message?.tabId || sender?.tab?.id || null;
    const senderUrl = sender?.url || null;
    const stack = new Error().stack;
    console.warn("[InstructionsCrafter][BG] stop-recording-tab received", {
      reason,
      senderTabId,
      senderUrl,
    });
    chrome.storage.local.set({
      lastStopRecordingEvent: {
        reason,
        senderTabId,
        senderUrl,
        stack,
        ts: Date.now(),
      },
    });
  } catch (err) {
    console.warn("[InstructionsCrafter][BG] stop-recording-tab logging failed", err);
  }
};

const setTabAutoDiscardableSafe = async (message, sender) => {
  try {
    const tabId = sender?.tab?.id;
    const discardable = message?.discardable;

    if (!tabId || typeof discardable !== "boolean") return;

    await chrome.tabs.update(tabId, { autoDiscardable: discardable });
  } catch (err) {
    console.warn("Failed to set tab autoDiscardable:", err);
  }
};

let activeRecordingSession = null;
let recordingTabListener = null;
let desktopCaptureInFlight = false;
let lastDesktopCaptureAt = 0;

const clearRecordingSession = () => {
  activeRecordingSession = null;
  if (recordingTabListener) {
    chrome.tabs.onRemoved.removeListener(recordingTabListener);
    recordingTabListener = null;
  }
};

const clearRecordingSessionSafe = async (reason = "unknown", details = {}) => {
  const prev = activeRecordingSession;
  clearRecordingSession();
  try {
    await chrome.storage.local.set({
      lastRecordingSessionClear: {
        ts: Date.now(),
        reason,
        previousSessionId: prev?.id || null,
        previousRecorderTabId: prev?.recorderTabId || prev?.tabId || null,
        ...details,
      },
    });
  } catch {}
};

const registerRecordingTabListener = (ownerTabId) => {
  if (!ownerTabId) return;
  if (recordingTabListener) {
    chrome.tabs.onRemoved.removeListener(recordingTabListener);
    recordingTabListener = null;
  }
  recordingTabListener = (closedTabId) => {
    if (closedTabId === ownerTabId) {
      // chrome.runtime.sendMessage from the SW doesn't fire BG's own listeners,
      // so call the stop handler directly
      Promise.resolve(
        handleStopRecordingTab({
          reason: "recorder-owner-tab-closed",
          tabId: closedTabId,
        }),
      ).catch((err) => {
        console.error(
          "[InstructionsCrafter][BG] handleStopRecordingTab failed in tab-removed",
          err,
        );
      });
      clearRecordingSessionSafe("owner-tab-removed", { closedTabId });
    }
  };
  chrome.tabs.onRemoved.addListener(recordingTabListener);
};

const isSessionRecording = (session) => session?.status === "recording";

const doesTabExist = async (tabId) => {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
};

const normalizeIncomingSession = (incoming = {}, sender) => {
  const ownerTabId = incoming.recorderTabId || sender?.tab?.id || null;
  const capturedTabId = incoming.capturedTabId || incoming.tabId || null;
  return {
    ...incoming,
    recorderTabId: ownerTabId,
    capturedTabId,
    tabId: capturedTabId,
  };
};

const isActiveSessionAlive = async (session) => {
  if (!session?.id) return false;
  const ownerTabId = session.recorderTabId || session.tabId || null;
  const ownerTabAlive = await doesTabExist(ownerTabId);
  const {
    recording,
    pendingRecording,
    restarting,
    recorderSession: storedSession,
  } = await chrome.storage.local.get([
    "recording",
    "pendingRecording",
    "restarting",
    "recorderSession",
  ]);
  const flagsActive = Boolean(recording || pendingRecording || restarting);
  const storedMatches =
    storedSession?.id === session.id && isSessionRecording(storedSession);
  return ownerTabAlive && (storedMatches || flagsActive);
};

const resolveActiveSessionConflict = async (incomingSession) => {
  if (!incomingSession?.id) {
    return { allow: true, staleRecovered: false };
  }

  if (!activeRecordingSession?.id) {
    const { recorderSession: storedSession } = await chrome.storage.local.get([
      "recorderSession",
    ]);
    if (storedSession?.id && isSessionRecording(storedSession)) {
      activeRecordingSession = {
        ...storedSession,
        recorderTabId: storedSession.recorderTabId || storedSession.tabId || null,
        capturedTabId:
          storedSession.capturedTabId || storedSession.tabId || null,
        tabId: storedSession.capturedTabId || storedSession.tabId || null,
      };
    }
  }

  if (!activeRecordingSession?.id) return { allow: true, staleRecovered: false };
  if (activeRecordingSession.id === incomingSession.id) {
    return { allow: true, staleRecovered: false };
  }

  if (!isSessionRecording(activeRecordingSession)) {
    await clearRecordingSessionSafe("non-recording-session-conflict");
    return { allow: true, staleRecovered: true };
  }

  const alive = await isActiveSessionAlive(activeRecordingSession);
  if (alive) {
    console.warn("[InstructionsCrafter][BG] session_conflict_rejected", {
      activeId: activeRecordingSession.id,
      incomingId: incomingSession.id,
      activeRecorderTabId:
        activeRecordingSession.recorderTabId || activeRecordingSession.tabId,
    });
    return { allow: false, staleRecovered: false };
  }

  await clearRecordingSessionSafe("stale-conflict-recovered", {
    incomingId: incomingSession.id,
  });
  console.warn("[InstructionsCrafter][BG] session_conflict_stale_recovered", {
    incomingId: incomingSession.id,
  });
  return { allow: true, staleRecovered: true };
};

export const setupHandlers = () => {
  registerProxyStorageHandlers();
  registerMessage("desktop-capture", async (message, sender) => {
    const now = Date.now();
    if (desktopCaptureInFlight || now - lastDesktopCaptureAt < 1200) {
      return { ok: true, deduped: true };
    }

    desktopCaptureInFlight = true;
    lastDesktopCaptureAt = now;

    try {
      await desktopCapture({
        ...message,
        ...(sender?.tab?.id != null ? { initiatingTabId: sender.tab.id } : {}),
      });
      return { ok: true };
    } finally {
      setTimeout(() => {
        desktopCaptureInFlight = false;
      }, 1000);
    }
  });
  registerMessage("start-recorder-keepalive-alarm", async () => {
    try {
      await chrome.alarms.create(RECORDER_KEEPALIVE_ALARM, {
        periodInMinutes: 0.5, // fires every 30s
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  registerMessage("stop-recorder-keepalive-alarm", async () => {
    try {
      await chrome.alarms.clear(RECORDER_KEEPALIVE_ALARM);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  // Forward a scene-create payload to the editor tab, which does the
  // POST itself (same-origin cookie auth). Sidesteps the MV3 SW-fetch
  // hang we hit when the cloud recorder tab tears down right after
  // dispatching the request. The editor confirms via reply message.
  registerMessage("forward-create-scene", async (message) => {
    const { projectId, payload } = message || {};
    if (!projectId || !payload) {
      return { ok: false, error: "missing-projectId-or-payload" };
    }
    let validated = await getValidatedEditorTab({
      expectedProjectId: projectId,
      expectedKind: "editor",
      reason: "forward-create-scene",
    });
    let openedTabId = null;
    if (!validated.ok || !validated.tab?.id) {
      // No editor tab; happens in multi-mode between scenes. Open one
      // in the background as a same-origin proxy: same-origin POST is
      // immune to the MV3 SW-fetch lifecycle hang we hit when posting
      // bearer-auth from the SW alone. The tab stays open to serve
      // subsequent scenes; finish-multi-recording will reuse/focus it.
      const targetUrl = `${process.env.SCREENITY_APP_BASE}/editor/${projectId}/edit?load=true`;
      try {
        const tab = await chrome.tabs.create({
          url: targetUrl,
          active: false,
        });
        if (tab?.id) {
          openedTabId = tab.id;
          await setEditorTabReference({
            tabId: tab.id,
            tabUrl: targetUrl,
            source: "forward-create-scene:auto-open",
            expectedProjectId: projectId,
          });
          validated = { ok: true, tab: { id: tab.id }, reason: null };
        }
      } catch (err) {
        return {
          ok: false,
          error: `failed-to-open-editor-tab:${err?.message || err}`,
        };
      }
      if (!validated.tab?.id) {
        return { ok: false, error: "no-editor-tab" };
      }
    }
    const requestId =
      (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
      `scene-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    // Editor tab was just opened by prepare-open-editor; the content
    // script may not have mounted yet. Retry with backoff until it can
    // receive messages, capped at ~10s total.
    const backoffsMs = [0, 200, 400, 800, 1200, 1600, 2000, 2400, 2800];
    let lastErr = null;
    for (const wait of backoffsMs) {
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      try {
        const reply = await chrome.tabs.sendMessage(
          validated.tab.id,
          {
            type: "proxy-create-scene",
            projectId,
            requestId,
            payload,
          },
          // Target top frame only: content script also runs in any
          // sub-iframes (manifest matches <all_urls>), and a postMessage
          // from a sub-iframe doesn't bubble to the editor's top window.
          { frameId: 0 },
        );
        return reply || { ok: false, error: "no-reply-from-editor" };
      } catch (err) {
        lastErr = err?.message || String(err);
        if (!/Receiving end does not exist|Could not establish/i.test(lastErr)) {
          // Different error; don't keep retrying.
          break;
        }
      }
    }
    return { ok: false, error: lastErr || "tabs-sendMessage-failed" };
  });

  registerMessage("offscreen-diag", async (message) => {
    console.warn("[InstructionsCrafter][OffscreenDiag]", message.source, message.payload);
    return { ok: true };
  });
  registerMessage("offscreen-ready", async () => {
    const { pendingOffscreenLoad } = await chrome.storage.local.get([
      "pendingOffscreenLoad",
    ]);
    if (!pendingOffscreenLoad) return { ok: true, delivered: false };
    await chrome.storage.local.set({ pendingOffscreenLoad: null });
    chrome.runtime.sendMessage(pendingOffscreenLoad).catch(() => {});
    return { ok: true, delivered: true };
  });
  // Offscreen recorder can't call chrome.scripting; SW proxies the viewport
  // probe so the recorder can size tab-capture constraints to the tab's
  // actual aspect ratio (avoiding the default 1920x1080 pillarbox).
  registerMessage("get-tab-viewport", async (message) => {
    const tabId = Number(message?.tabId);
    if (!Number.isFinite(tabId) || tabId < 0) {
      return { ok: false, error: "invalid-tab-id" };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          w: Math.round(window.innerWidth * (window.devicePixelRatio || 1)),
          h: Math.round(window.innerHeight * (window.devicePixelRatio || 1)),
        }),
      });
      const r = results?.[0]?.result;
      if (r && r.w > 0 && r.h > 0) {
        return { ok: true, width: r.w, height: r.h };
      }
      return { ok: false, error: "no-result" };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  registerMessage("offscreen-request-stream", async (message, sender) => {
    try {
      // anchor picker to user's tab, not the offscreen doc
      let initiatingTabId = message.initiatingTabId || null;
      if (!initiatingTabId) {
        const { recordingUiTabId } = await chrome.storage.local.get([
          "recordingUiTabId",
        ]);
        initiatingTabId = recordingUiTabId || null;
      }
      const result = await acquireStreamForOffscreen({
        mode: message.mode,
        sources: message.sources,
        initiatingTabId,
        targetTabId: message.targetTabId,
      });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  registerMessage("write-file", (message) => writeFile(message));
  registerMessage("handle-restart", (message, sender) =>
    handleRestart(message, sender),
  );
  registerMessage("handle-dismiss", (message) => handleDismiss(message));
  registerMessage("reset-active-tab", () => resetActiveTab(false));
  registerMessage("reset-active-tab-restart", (message) =>
    resetActiveTabRestart(message),
  );
  registerMessage("video-ready", async (message) => {
    perfMark("BG.handlers video-ready.received");
    await videoReady(message);
    await clearRecordingSessionSafe("video-ready");
  });

  // download-path remux request from sandbox; falls back to in-sandbox BufferTarget on failure
  registerMessage("remux-request", async (message) => {
    if (
      !message?.requestId ||
      !message?.inputFileName ||
      !message?.outputFileName
    ) {
      return { ok: false, error: "invalid-remux-request-payload" };
    }
    try {
      await ensureRemuxOffscreen();
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || err || "ensure-offscreen-failed"),
      };
    }
    try {
      // deterministic timeout so a wedged offscreen can't hang the caller forever
      const REMUX_TIMEOUT_MS = 60_000;
      let timeoutId = null;
      try {
        const response = await Promise.race([
          chrome.runtime.sendMessage({
            type: "remux-start",
            requestId: message.requestId,
            inputFileName: message.inputFileName,
            outputFileName: message.outputFileName,
          }),
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("remux-offscreen-timeout")),
              REMUX_TIMEOUT_MS,
            );
          }),
        ]);
        return response || { ok: false, error: "no-offscreen-response" };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || err || "forward-to-offscreen-failed"),
      };
    }
  });

  registerMessage("start-recording", (message) => startRecording("start-recording-message"));
  registerMessage("countdown-finished", async (message) => {
    const { recording, restarting, pendingRecording } =
      await chrome.storage.local.get([
      "recording",
      "restarting",
      "pendingRecording",
    ]);
    // restart leaves `recording: true` briefly from the previous session, so block
    // only when recording is active AND not restarting
    if (recording && !restarting) {
      diagEvent("countdown-finished", { skipped: true, reason: "already-recording" });
      const decisionAt = Date.now();
      await chrome.storage.local.set({
        lastCountdownFinishedDecision: {
          ts: decisionAt,
          startedAt: null,
          endedAt: message?.endedAt || null,
          acceptedCountdownFinishedAt: false,
          recording: Boolean(recording),
          restarting: Boolean(restarting),
          pendingRecording: Boolean(pendingRecording),
          started: false,
          reason: "already-recording",
        },
      });
      return { ok: true, skipped: true };
    }
    diagEvent("countdown-finished", { skipped: false });
    const decisionAt = Date.now();
    await chrome.storage.local.set({
      countdownFinishedAt: message?.endedAt || decisionAt,
      lastCountdownFinishedDecision: {
        ts: decisionAt,
        startedAt: decisionAt,
        endedAt: message?.endedAt || null,
        acceptedCountdownFinishedAt: true,
        recording: Boolean(recording),
        restarting: Boolean(restarting),
        pendingRecording: Boolean(pendingRecording),
        started: true,
      },
    });
    startAfterCountdown("countdown-finished");
    return { ok: true };
  });
  registerMessage("restarted", (message) => restartActiveTab(message));
  const sendChunksToSandbox = async (sender) => {
    perfMark("BG.handlers sendChunksToSandbox.enter", {
      senderTab: sender?.tab?.id || null,
    });
    if (DEBUG_POSTSTOP)
      console.debug("[InstructionsCrafter][BG] sendChunksToSandbox invoked", {
        senderTab: sender?.tab?.id,
      });

    const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
    const targetTab = sandboxTab || sender?.tab?.id || null;
    if (!targetTab) {
      if (DEBUG_POSTSTOP)
        console.warn("[InstructionsCrafter][BG] no targetTab for sendChunksToSandbox");
      throw new Error("no-sandbox-tab");
    }

    // sandboxed iframes don't receive runtime.sendMessage; chunk delivery uses
    // tabs.sendMessage with frameId which does reach them, so no ping needed

    const maxAttempts = 6;
    const delayMs = 250;
    let chunkCount = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      chunkCount = 0;
      await chunksStore.iterate(() => {
        chunkCount += 1;
      });
      if (DEBUG_POSTSTOP)
        console.debug("[InstructionsCrafter][BG] checking chunks in IndexedDB", {
          attempt,
          chunkCount,
        });
      if (chunkCount > 0) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }

    let result = null;
    const maxDeliveryAttempts = 6;
    for (
      let deliveryAttempt = 1;
      deliveryAttempt <= maxDeliveryAttempts;
      deliveryAttempt += 1
    ) {
      if (DEBUG_POSTSTOP)
        console.debug("[InstructionsCrafter][BG] calling sendChunks() to deliver", {
          targetTab,
          chunkCount,
          deliveryAttempt,
        });
      // eslint-disable-next-line no-await-in-loop
      result = await sendChunks(false, {
        tabId: targetTab,
        frameId: sender?.frameId,
      });
      if (result?.status === "ok") {
        if (DEBUG_POSTSTOP)
          console.debug("[InstructionsCrafter][BG] sendChunks() completed", result);
        return { status: "ok", chunkCount: result.chunkCount };
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (DEBUG_POSTSTOP)
      console.warn("[InstructionsCrafter][BG] sendChunks() did not find chunks", {
        targetTab,
        result,
      });
    return { status: "empty", chunkCount: 0 };
  };

  registerMessage("send-chunks-to-sandbox", (message, sender) =>
    sendChunksToSandbox(sender),
  );

  registerMessage("new-chunk", (message, sender, sendResponse) => {
    newChunk(message, sendResponse);
    return true;
  });

  registerMessage(
    "get-streaming-data",
    async (message, sender) => await handleGetStreamingData(message, sender),
  );
  registerMessage("cancel-recording", (message) => cancelRecording(message));
  registerMessage("stop-recording-tab", (message, sender, sendResponse) => {
    perfMark("BG.handlers stop-recording-tab.received", {
      reason: message?.reason || null,
      senderTabId: sender?.tab?.id || null,
    });
    logStopRecordingTabEvent(message, sender);
    const now = Date.now();
    if (
      stopRecordingTabInFlight ||
      now - stopRecordingTabLastAt < STOP_RECORDING_TAB_DEBOUNCE_MS
    ) {
      if (DEBUG_POSTSTOP) {
        console.warn(
          "[InstructionsCrafter][BG] Suppressed duplicate stop-recording-tab message",
          {
            inFlight: stopRecordingTabInFlight,
            deltaMs: now - stopRecordingTabLastAt,
            reason: message?.reason || null,
          },
        );
      }
      sendResponse({ ok: true, deduped: true });
      return true;
    }

    stopRecordingTabInFlight = true;
    stopRecordingTabLastAt = now;
    Promise.resolve(handleStopRecordingTab(message))
      .catch((err) => {
        console.error("Failed to handle stop-recording-tab", err);
      })
      .finally(() => {
        stopRecordingTabInFlight = false;
        stopRecordingTabLastAt = Date.now();
      });
    sendResponse({ ok: true });
    return true;
  });
  registerMessage("dismiss-recording-tab", (message) =>
    handleDismissRecordingTab(message),
  );
  registerMessage("pause-recording-tab", () => {
    diagEvent("pause");
    return sendMessageRecord({ type: "pause-recording-tab" });
  });
  registerMessage("resume-recording-tab", () => {
    diagEvent("resume");
    return sendMessageRecord({ type: "resume-recording-tab" });
  });

  registerMessage("diag-countdown-started", () => {
    diagEvent("countdown-started");
    // countdown started means stream setup is done; extend the fallback window
    // so it doesn't fire during countdown (and start the recording too early)
    noteCountdownStarted();
  });
  registerMessage("diag-countdown-cancelled", () => diagEvent("countdown-cancelled"));
  registerMessage("diag-editor-ready", (message) =>
    diagEvent("editor-load-ready", { path: message?.path || null }),
  );
  // prefix allowlist so a compromised context can't spoof lifecycle events
  registerMessage("diag-forward", (message) => {
    const ev = typeof message?.event === "string" ? message.event : null;
    if (!ev) return;
    const allowedPrefixes = ["sandbox-", "sw-", "opfs-", "recorder-"];
    if (!allowedPrefixes.some((p) => ev.startsWith(p))) return;
    diagEvent(ev, message?.data ?? null);
  });
  registerMessage("open-editor-recovery", async () => {
    const { editorRecoveryUrl } = await chrome.storage.local.get(["editorRecoveryUrl"]);
    if (!editorRecoveryUrl) return;
    chrome.storage.local.remove(["editorRecoveryUrl", "editorRecoveryAt"]);
    chrome.tabs.create({ url: editorRecoveryUrl, active: true });
  });
  registerMessage("recording-error", async (message) => {
    await handleRecordingError(message);
    await clearRecordingSessionSafe("recording-error", {
      error: message?.error || null,
    });
  });
  // camera bubble failed but recording is live; surface as toast, never tear down
  registerMessage("camera-bubble-unavailable", async (message) => {
    try {
      const { tabRecordedID, recordingUiTabId } = await chrome.storage.local.get([
        "tabRecordedID",
        "recordingUiTabId",
      ]);
      const target = tabRecordedID || recordingUiTabId;
      if (target) {
        sendMessageTab(target, {
          type: "show-toast",
          message:
            chrome.i18n.getMessage("cameraUnavailableToast") ||
            "Camera disconnected. Still recording your screen.",
          timeout: 6000,
        }).catch((err) => {
          diagEvent("warning", {
            note: "camera-unavailable-toast undelivered",
            err: String(err).slice(0, 80),
          });
        });
      }
    } catch {}
  });
  registerMessage("on-get-permissions", (message) =>
    handleOnGetPermissions(message),
  );
  registerMessage(
    "recording-complete",
    async (message, sender) => {
      perfMark("BG.handlers recording-complete.received");
      return await handleRecordingComplete(message, sender);
    },
  );
  registerMessage("check-recording", (message) => checkRecording(message));
  registerMessage("open-download-mp4", async () => {
    const tab = await createTab("download.html", true, true);
    if (!tab?.id) return;
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (info.status === "complete" && tabId === tab.id) {
        chrome.tabs.onUpdated.removeListener(listener);
        sendMessageTab(tab.id, { type: "recover-indexed-db-mp4" });
      }
    });
  });

  registerMessage("set-surface", (message) => setSurface(message));
  registerMessage("pip-ended", () => handlePip(false));
  registerMessage("pip-started", () => handlePip(true));
  registerMessage("clear-recordings", () => clearAllRecordings());
  registerMessage("focus-this-tab", (message, sender) =>
    focusTab(sender.tab.id),
  );
  registerMessage("indexed-db-download", (message) =>
    downloadIndexedDB(message),
  );
  registerMessage("get-platform-info", async () => await getPlatformInfo());
  registerMessage(
    "get-diagnostic-log",
    async (_message, _sender, sendResponse) => {
      const log = await getDiagnosticLog();
      const errors = await getErrorSnapshot();
      const flags = await getStorageFlags();
      sendResponse({ log, errors, flags });
      return true;
    },
  );
  registerMessage("check-restore", async (message, sender, sendResponse) => {
    const response = await checkRestore();
    sendResponse(response);
    return true;
  });
  registerMessage(
    "check-capture-permissions",
    async (message, sender, sendResponse) => {
      const response = await checkCapturePermissions();
      sendResponse(response);
      return true;
    },
  );
  registerMessage("is-pinned", async () => await isPinned());

  // prevent Chrome from discarding the CloudRecorder tab while recording
  registerMessage("set-tab-auto-discardable", (message, sender) =>
    setTabAutoDiscardableSafe(message, sender),
  );

  registerMessage("request-download", (message) =>
    requestDownload(message.base64, message.title),
  );
  registerMessage("available-memory", async () => {
    return await checkAvailableMemory();
  });
  registerMessage("extension-media-permissions", () =>
    createTab(
      `chrome://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}`,
      false,
      true,
    ),
  );
  registerMessage("add-alarm-listener", (payload) => addAlarmListener(payload));
  registerMessage(
    "create-video-project",
    async (message, sender, sendResponse) => {
      sendResponse({ success: false, message: "Cloud features disabled" });
      return true;
    },
  );
  registerMessage("handle-login", async () => {
    console.warn("Cloud features disabled, cannot handle login");
  });
  registerMessage("handle-logout", async (message, sender, sendResponse) => {
    sendResponse({ success: false, message: "Cloud features disabled" });
    return true;
  });

  function getMonitorForWindow(message, sender, sendResponse) {
    chrome.system.display.getInfo((displays) => {
      chrome.windows.getCurrent((win) => {
        if (!win || chrome.runtime.lastError) {
          console.warn(
            "[get-monitor-for-window] No window found",
            chrome.runtime.lastError,
          );
          sendResponse({ error: "No window found" });
          return;
        }

        const monitor = displays.find(
          (d) =>
            win.left >= d.bounds.left &&
            win.left < d.bounds.left + d.bounds.width &&
            win.top >= d.bounds.top &&
            win.top < d.bounds.top + d.bounds.height,
        );

        if (!monitor) {
          console.warn("[get-monitor-for-window] No matching monitor");
          sendResponse({ error: "No matching monitor" });
        } else {
          chrome.storage.local.set(
            {
              displays,
              recordedMonitorId: monitor.id,
              monitorBounds: monitor.bounds,
            },
            () => {
              sendResponse({
                monitorId: monitor.id,
                monitorBounds: monitor.bounds,
                displays,
              });
            },
          );
        }
      });
    });

    return true;
  }

  registerMessage("get-monitor-for-window", getMonitorForWindow);

  registerMessage("fetch-videos", async (message, sender, sendResponse) => {
    sendResponse({ success: false, message: "Cloud features disabled" });
    return true;
  });
  registerMessage(
    "check-storage-quota",
    async (message, sender, sendResponse) => {
      sendResponse({ success: false, error: "Cloud features disabled" });
      return true;
    },
  );
  registerMessage("time-warning", async (message) => {
    const tab = await getCurrentTab();
    if (tab?.id) {
      await sendMessageTab(tab.id, {
        type: "time-warning",
      }).catch((e) => console.warn("Failed to send time-warning to tab:", e));
    }
  });
  registerMessage("time-stopped", async (message) => {
    const tab = await getCurrentTab();
    if (tab?.id) {
      await sendMessageTab(tab.id, {
        type: "time-stopped",
      }).catch((e) => console.warn("Failed to send time-stopped to tab:", e));
    }
  });
  registerMessage("prepare-open-editor", async (message) => {
    console.warn("Cloud features disabled");
  });
  registerMessage("prepare-editor-existing", async (message) => {
    console.warn("Cloud features disabled");
  });
  registerMessage("preparing-recording", async () => {
    // getCurrentTab can return the pinned recorder tab; prefer stored activeTab
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);
    const tabId = activeTab || (await getCurrentTab())?.id;
    if (tabId) {
      await sendMessageTab(tabId, {
        type: "preparing-recording",
      }).catch((e) =>
        console.warn("Failed to send preparing-recording to tab:", e),
      );
    }
  });
  registerMessage("editor-ready", async (message) => {
    console.warn("Cloud features disabled");
  });
  registerMessage("finish-multi-recording", async () => {
    console.warn("Cloud features disabled");
  });
  registerMessage("handle-reactivate", async () => {
    console.warn("Cloud features disabled");
  });
  registerMessage("handle-upgrade", async () => {
    console.warn("Cloud features disabled");
  });
  registerMessage("open-account-settings", async () => {
    console.warn("Cloud features disabled");
  });
  registerMessage("open-support", async () => {
    console.warn("Cloud features disabled");
  });
  registerMessage("check-banner-support", async (message, sendResponse) => {
    const { bannerSupport } = await chrome.storage.local.get(["bannerSupport"]);
    sendResponse({ bannerSupport: Boolean(bannerSupport) });
    return true;
  });
  registerMessage("hide-banner", async () => {
    await chrome.storage.local.set({ bannerSupport: false });
    chrome.runtime.sendMessage({ type: "hide-banner" });
  });
  registerMessage("clear-recording-alarm", async () => {
    await chrome.alarms.clear("recording-alarm");
  });
  // extension pages can't message content scripts directly
  registerMessage("show-toast", async (message) => {
    try {
      const { activeTab } = await chrome.storage.local.get(["activeTab"]);
      if (activeTab) {
        sendMessageTab(activeTab, {
          type: "show-toast",
          message: message.message,
          timeout: message.timeout,
        }).catch(() => {});
      }
    } catch {}
  });
  registerMessage("get-tab-id", (message, sender, sendResponse) => {
    sendResponse({ tabId: sender?.tab?.id ?? null });
    return true;
  });
  registerMessage("play-beep", async (message, sender, sendResponse) => {
    const ok = await ensureAudioOffscreen();
    if (ok) {
      chrome.runtime.sendMessage({ type: "play-beep-offscreen" });
    }
    if (sendResponse) sendResponse({ ok });
    return true;
  });
  registerMessage("refresh-auth", async () => ({
    success: false,
    message: "Cloud features disabled",
  }));
  registerMessage("sync-recording-state", async (message, sendResponse) => {
    const {
      recording,
      paused,
      recordingStartTime,
      pausedAt,
      totalPausedMs,
      pendingRecording,
    } = await chrome.storage.local.get([
      "recording",
      "paused",
      "recordingStartTime",
      "pausedAt",
      "totalPausedMs",
      "pendingRecording",
    ]);
    sendResponse({
      recording: Boolean(recording),
      paused: Boolean(paused),
      recordingStartTime: recordingStartTime || null,
      pausedAt: pausedAt || null,
      totalPausedMs: totalPausedMs || 0,
      pendingRecording: Boolean(pendingRecording),
    });
    return true;
  });
  registerMessage(
    "register-recording-session",
    async (message, sender, sendResponse) => {
      const incoming = normalizeIncomingSession(message.session || {}, sender);
      const resolution = await resolveActiveSessionConflict(incoming);
      if (!resolution.allow) {
        sendResponse({
          ok: false,
          error: "Another recording session is already active",
          activeRecordingSession,
        });
        return true;
      }

      activeRecordingSession = incoming;
      registerRecordingTabListener(incoming.recorderTabId);
      sendResponse({
        ok: true,
        session: activeRecordingSession,
        staleRecovered: resolution.staleRecovered,
      });
      return true;
    },
  );

  registerMessage(
    "clear-recording-session",
    async (message, sender, sendResponse) => {
      await clearRecordingSessionSafe(
        message?.reason || "clear-recording-session",
      );
      sendResponse({ ok: true });
      return true;
    },
  );

  registerMessage(
    "clear-recording-session-safe",
    async (message, sender, sendResponse) => {
      await clearRecordingSessionSafe(
        message?.reason || "clear-recording-session-safe",
        {
          sourceTabId: sender?.tab?.id || null,
        },
      );
      sendResponse({ ok: true });
      return true;
    },
  );

  registerMessage(
    "restore-recording-session",
    async (message, sender, sendResponse) => {
      const { recorderSession } = await chrome.storage.local.get([
        "recorderSession",
      ]);
      sendResponse({ recorderSession: recorderSession || null });
      return true;
    },
  );

  registerMessage("activate-recorder-tab", async (message, sender) => {
    const tabId = sender?.tab?.id;
    if (tabId) {
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch (err) {
        console.warn("[InstructionsCrafter] activate-recorder-tab failed:", String(err));
      }
    }
  });

  registerMessage("start-first-chunk-watchdog", async () => {
    await chrome.alarms.clear(FIRST_CHUNK_WATCHDOG_ALARM).catch(() => {});
    await chrome.alarms.create(FIRST_CHUNK_WATCHDOG_ALARM, {
      delayInMinutes: 8 / 60,
    });
  });

  registerMessage("cancel-first-chunk-watchdog", async () => {
    await chrome.alarms.clear(FIRST_CHUNK_WATCHDOG_ALARM).catch(() => {});
  });
};
