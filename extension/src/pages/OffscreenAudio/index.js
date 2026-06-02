// Offscreen mic recorder for Click-capture mode.
//
// Click-capture takes no video, but narration is optional, and browser flows
// navigate between pages -- which tears down content scripts. An offscreen
// document persists across those navigations, so it is where we record one
// continuous mic-only track for the whole session.
//
// Lifecycle (driven by the background service worker):
//   - "clickaudio-start": getUserMedia(audio) + MediaRecorder(opus), start.
//   - "clickaudio-stop":  stop, write the assembled Blob to IndexedDB
//     (clickAudioStore) so the Generate page can read it, then report back.
//
// All messages are namespaced with target:"offscreen-audio" so this listener
// ignores the rest of the extension's traffic. Everything is best-effort: if
// the mic is denied/unavailable the session simply records nothing (the doc
// reports ok:false and the background continues silently).

import { clickAudioStore, CLICK_AUDIO_KEY } from "../utils/clickCaptureStores";

let recorder = null;
let chunks = [];
let stream = null;

// Prefer Opus in a WebM container (Chrome's reliable MediaRecorder audio path).
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

const pickMimeType = () => {
  for (const m of MIME_CANDIDATES) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported &&
      MediaRecorder.isTypeSupported(m)
    ) {
      return m;
    }
  }
  return "";
};

const startAudio = async (deviceId) => {
  // Clean up any leftover from a prior session in this doc.
  await teardownStream();
  const audio =
    deviceId && deviceId !== "default" && deviceId !== "none"
      ? { deviceId: { exact: deviceId } }
      : true;
  stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });

  const mimeType = pickMimeType();
  recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(1000); // 1s timeslices so a crash still leaves usable audio
};

const stopAudio = async () => {
  if (!recorder) return { ok: true, empty: true };

  const mimeType = recorder.mimeType || "audio/webm";
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  try {
    recorder.stop();
  } catch (err) {
    console.warn("[OffscreenAudio] recorder.stop failed", err);
  }
  await stopped;
  await teardownStream();

  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];
  recorder = null;
  if (!blob.size) return { ok: true, empty: true };

  // Write to IndexedDB so the Generate page (a separate context) can read it.
  await clickAudioStore.setItem(CLICK_AUDIO_KEY, {
    blob,
    mimeType,
    size: blob.size,
  });
  return { ok: true, size: blob.size, mimeType };
};

const teardownStream = async () => {
  if (stream) {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {}
    stream = null;
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen-audio") return; // not for us

  if (message.type === "clickaudio-start") {
    startAudio(message.deviceId).then(
      () => sendResponse({ ok: true }),
      (err) => {
        console.warn("[OffscreenAudio] start failed", err);
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    );
    return true; // async response
  }

  if (message.type === "clickaudio-stop") {
    stopAudio().then(
      (res) => sendResponse(res),
      (err) => {
        console.warn("[OffscreenAudio] stop failed", err);
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    );
    return true; // async response
  }
});
