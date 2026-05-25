export function startClickTracking(contentStateRef = null) {
  // Refreshed on storage change: a restart can swap recordingType
  // (camera ↔ screen) and we'd otherwise dispatch against the prior mode.
  let cachedSurface = "unknown";
  let cachedRecordingWindowId = null;
  let cachedRecordingType = null;
  chrome.storage.local
    .get(["surface", "recordingWindowId", "recordingType"])
    .then((vals) => {
      cachedSurface = vals.surface || "unknown";
      cachedRecordingWindowId = vals.recordingWindowId ?? null;
      cachedRecordingType = vals.recordingType ?? null;
    })
    .catch(() => {});

  const onStorageChanged = (changes, area) => {
    if (area !== "local") return;
    if (changes.surface) cachedSurface = changes.surface.newValue || "unknown";
    if (changes.recordingWindowId)
      cachedRecordingWindowId = changes.recordingWindowId.newValue ?? null;
    if (changes.recordingType)
      cachedRecordingType = changes.recordingType.newValue ?? null;
  };
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch {}

  const handleClick = (e) => {
    if (contentStateRef?.current?.blurMode) return;

    if (
      e.target.closest(".ToolbarRoot") ||
      e.target.closest(".ToolbarRecordingControls") ||
      e.target.closest(".ToolbarToggleWrap") ||
      e.target.closest(".ToolbarPaused") ||
      e.target.closest(".Toast") ||
      e.target.closest("#instructionscrafter-root-container")
    ) {
      return;
    }

    const canvasWrapper = document.getElementById("canvas-wrapper-instructionscrafter");
    if (canvasWrapper && canvasWrapper.contains(e.target)) {
      return;
    }

    if (cachedRecordingType === "camera") {
      return;
    }

    chrome.runtime.sendMessage({
      type: "click-event",
      payload: {
        x: e.clientX,
        y: e.clientY,
        surface: cachedSurface,
        recordingWindowId: cachedRecordingWindowId,
        timestamp: Date.now(),
      },
    });
  };

  window.addEventListener("mousedown", handleClick, true);
  return () => {
    window.removeEventListener("mousedown", handleClick, true);
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {}
  };
}
