import { setContentState } from "../ContentState";
import { checkRecording } from "./checkRecording";

const CURSOR_EFFECTS = ["target", "highlight", "spotlight"];

const normalizeCursorEffects = (effects) => {
  if (!Array.isArray(effects)) return [];
  return effects.filter((effect) => CURSOR_EFFECTS.includes(effect));
};

const deriveCursorMode = (effects, fallbackMode) => {
  if (effects.length === 0) return "none";
  if (effects.length === 1) return effects[0];
  if (fallbackMode && effects.includes(fallbackMode)) return fallbackMode;
  return effects[0] || "none";
};

export const updateFromStorage = (check = true, id = null) => {
  chrome.storage.local.get(
    [
      "audioInput",
      "defaultAudioInput",
      "defaultAudioInputLabel",
      "micActive",
      "recording",
      "paused",
      "toolbarPosition",
      "countdown",
      "recordingType",
      "captureMode",
      "hideToolbar",
      "pendingRecording",
      "askForPermissions",
      "cursorMode",
      "cursorEffects",
      "askMicrophone",
      "zoomEnabled",
      "setDevices",
      "popupPosition",
      "surface",
      "hideUI",
      "bigTab",
      "askDismiss",
      "swatch",
      "color",
      "strokeWidth",
      "quality",
      "systemAudio",
      "qualityValue",
      "fpsValue",
      "useWebCodecsRecorder",
      "multiMode",
      "multiSceneCount",
    ],
    (result) => {
      const storedEffects = normalizeCursorEffects(result.cursorEffects);
      const hasStoredEffects = Array.isArray(result.cursorEffects);
      const legacyMode =
        result.cursorMode !== undefined && result.cursorMode !== null
          ? result.cursorMode
          : "none";
      const cursorEffects = hasStoredEffects
        ? storedEffects
        : legacyMode !== "none"
        ? [legacyMode]
        : [];
      const cursorMode = deriveCursorMode(cursorEffects, legacyMode);

      setContentState((prevContentState) => ({
        ...prevContentState,
        audioInput:
          result.audioInput !== undefined && result.audioInput !== null
            ? result.audioInput
            : prevContentState.audioInput,
        defaultAudioInput:
          result.defaultAudioInput !== undefined &&
          result.defaultAudioInput !== null
            ? result.defaultAudioInput
            : prevContentState.defaultAudioInput,
        defaultAudioInputLabel:
          result.defaultAudioInputLabel !== undefined &&
          result.defaultAudioInputLabel !== null
            ? result.defaultAudioInputLabel
            : prevContentState.defaultAudioInputLabel,
        micActive:
          result.micActive !== undefined && result.micActive !== null
            ? result.micActive
            : prevContentState.micActive,
        toolbarPosition:
          result.toolbarPosition !== undefined &&
          result.toolbarPosition !== null
            ? result.toolbarPosition
            : prevContentState.toolbarPosition,
        countdown:
          result.countdown !== undefined && result.countdown !== null
            ? result.countdown
            : prevContentState.countdown,
        recording:
          result.recording !== undefined && result.recording !== null
            ? result.recording
            : prevContentState.recording,
        paused:
          result.paused !== undefined && result.paused !== null
            ? result.paused
            : prevContentState.paused,
        recordingType:
          result.recordingType !== undefined && result.recordingType !== null
            ? result.recordingType
            : prevContentState.recordingType,
        captureMode:
          result.captureMode !== undefined && result.captureMode !== null
            ? result.captureMode
            : prevContentState.captureMode,
        hideToolbar:
          result.hideToolbar !== undefined && result.hideToolbar !== null
            ? result.hideToolbar
            : prevContentState.hideToolbar,
        pendingRecording:
          result.pendingRecording !== undefined &&
          result.pendingRecording !== null
            ? result.pendingRecording
            : prevContentState.pendingRecording,
        askForPermissions:
          result.askForPermissions !== undefined &&
          result.askForPermissions !== null
            ? result.askForPermissions
            : prevContentState.askForPermissions,
        cursorMode: cursorMode || prevContentState.cursorMode,
        cursorEffects:
          cursorEffects.length > 0 || hasStoredEffects
            ? cursorEffects
            : prevContentState.cursorEffects,
        zoomEnabled:
          result.zoomEnabled !== undefined && result.zoomEnabled !== null
            ? result.zoomEnabled
            : prevContentState.zoomEnabled,
        askMicrophone:
          result.askMicrophone !== undefined && result.askMicrophone !== null
            ? result.askMicrophone
            : prevContentState.askMicrophone,
        setDevices:
          result.setDevices !== undefined && result.setDevices !== null
            ? result.setDevices
            : prevContentState.setDevices,
        popupPosition:
          result.popupPosition !== undefined && result.popupPosition !== null
            ? result.popupPosition
            : prevContentState.popupPosition,
        surface:
          result.surface !== undefined && result.surface !== null
            ? result.surface
            : prevContentState.surface,
        hideUI:
          result.hideUI !== undefined && result.hideUI !== null
            ? result.hideUI
            : prevContentState.hideUI,
        bigTab:
          result.bigTab !== undefined && result.bigTab !== null
            ? result.bigTab
            : prevContentState.bigTab,
        askDismiss:
          result.askDismiss !== undefined && result.askDismiss !== null
            ? result.askDismiss
            : prevContentState.askDismiss,
        swatch:
          result.swatch !== undefined && result.swatch !== null
            ? result.swatch
            : prevContentState.swatch,
        color:
          result.color !== undefined && result.color !== null
            ? result.color
            : prevContentState.color,
        strokeWidth:
          result.strokeWidth !== undefined && result.strokeWidth !== null
            ? result.strokeWidth
            : prevContentState.strokeWidth,
        quality:
          result.quality !== undefined && result.quality !== null
            ? result.quality
            : prevContentState.quality,
        systemAudio:
          result.systemAudio !== undefined && result.systemAudio !== null
            ? result.systemAudio
            : prevContentState.systemAudio,
        qualityValue:
          result.qualityValue !== undefined && result.qualityValue !== null
            ? result.qualityValue
            : prevContentState.qualityValue,
        fpsValue:
          result.fpsValue !== undefined && result.fpsValue !== null
            ? result.fpsValue
            : prevContentState.fpsValue,
        useWebCodecsRecorder:
          result.useWebCodecsRecorder !== undefined &&
          result.useWebCodecsRecorder !== null
            ? result.useWebCodecsRecorder
            : prevContentState.useWebCodecsRecorder,
        multiMode: result.multiMode || false,
        multiSceneCount: result.multiSceneCount || 0,
      }));

      if (result.systemAudio === undefined || result.systemAudio === null) {
        chrome.storage.local.set({ systemAudio: true });
      }

      if (result.countdown === undefined || result.countdown === null) {
        chrome.storage.local.set({ countdown: true });
      }

      if (!hasStoredEffects && legacyMode) {
        chrome.storage.local.set({
          cursorEffects: cursorEffects,
          cursorMode: cursorMode,
        });
      }

      if (check) {
        checkRecording(id);
      }

      if (!result.recording) {
        setContentState((prevContentState) => ({
          ...prevContentState,
          time: 0,
          timer: 0,
        }));
      }
    }
  );
};
