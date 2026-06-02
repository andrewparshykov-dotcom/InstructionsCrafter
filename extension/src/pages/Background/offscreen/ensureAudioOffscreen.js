/*
 * Creates/reuses the Click-capture mic recorder offscreen document and relays
 * messages to it. Chrome permits only ONE offscreen document per extension, so
 * if a different offscreen (the video remux/recorder) is open we close it first.
 *
 * Uses the USER_MEDIA reason so the document may call getUserMedia for the mic.
 */
const AUDIO_OFFSCREEN_URL = "offscreenaudio.html";

const isAudioOffscreen = (ctx) =>
  ctx &&
  ctx.contextType === "OFFSCREEN_DOCUMENT" &&
  typeof ctx.documentUrl === "string" &&
  ctx.documentUrl.endsWith(AUDIO_OFFSCREEN_URL);

export const ensureAudioOffscreen = async () => {
  if (
    !chrome.offscreen ||
    typeof chrome.offscreen.createDocument !== "function"
  ) {
    throw new Error("offscreen-api-unavailable");
  }

  const contexts = await chrome.runtime.getContexts({});
  const existing = contexts.find(
    (c) => c.contextType === "OFFSCREEN_DOCUMENT"
  );
  if (existing) {
    if (isAudioOffscreen(existing)) return; // already ours
    try {
      await chrome.offscreen.closeDocument();
    } catch (err) {
      console.warn("ensureAudioOffscreen: closeDocument failed", err);
    }
  }

  await chrome.offscreen.createDocument({
    url: AUDIO_OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification:
      "Record optional microphone narration for Click-capture mode (no video).",
  });
};

export const closeAudioOffscreen = async () => {
  try {
    const contexts = await chrome.runtime.getContexts({});
    const existing = contexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );
    if (isAudioOffscreen(existing)) {
      await chrome.offscreen.closeDocument();
    }
  } catch (err) {
    console.warn("closeAudioOffscreen failed", err);
  }
};

// Fire a namespaced message at the audio offscreen doc and await its reply.
// The offscreen listener ignores anything without target:"offscreen-audio".
export const sendToAudioOffscreen = (message) =>
  chrome.runtime.sendMessage({ ...message, target: "offscreen-audio" });
