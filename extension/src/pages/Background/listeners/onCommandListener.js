import { captureManualShot } from "../recording/clickCapture";

// Keyboard-command listener. The "capture-click-screenshot" command (a
// rebindable hotkey, default Alt+Shift+S) lets the user grab the current screen
// on demand during Click-capture mode -- the equivalent of video mode's spoken
// "screenshot" cue, for moments that aren't tied to an actionable click.
export const onCommandListener = () => {
  if (!chrome.commands || !chrome.commands.onCommand) return;
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "capture-click-screenshot") return;
    try {
      const res = await captureManualShot();
      console.log("[InstructionsCrafter][Command] manual capture:", res);
    } catch (err) {
      console.warn("[InstructionsCrafter][Command] manual capture failed", err);
    }
  });
};
