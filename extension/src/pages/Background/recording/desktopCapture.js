import { startRecorderSession } from "./openRecorderTab";
import { perfMark } from "../../utils/perfMarks";

export const desktopCapture = async (request) => {
  perfMark("BG.desktopCapture.enter", {
    region: Boolean(request?.region),
    camera: Boolean(request?.camera),
    customRegion: Boolean(request?.customRegion),
  });
  console.log("[InstructionsCrafter][desktopCapture] entered", request);

  chrome.storage.local.set({ sendingChunks: false });

  // getCurrentTab uses lastFocusedWindow which races with editor-open focus pulls;
  // prefer the explicit sender tab id
  const initiatingTabId =
    typeof request?.initiatingTabId === "number"
      ? request.initiatingTabId
      : null;

  startRecorderSession(request, initiatingTabId);
};
