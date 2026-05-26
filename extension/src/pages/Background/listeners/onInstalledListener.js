import { removeTab } from "../tabManagement";
import { executeScripts } from "../utils/executeScripts";

export const onInstalledListener = () => {
  chrome.runtime.onInstalled.addListener(async (details) => {
    // Permanent toolbar tooltip reminder of the narration requirement.
    chrome.action.setTitle({
      title:
        "InstructionsCrafter — voice narration is required while recording",
    });

    // Clear any stale uninstall URL left over from earlier Screenity-branded
    // installs (the old code set chrome.runtime.setUninstallURL to a tally.so
    // survey). Chrome retains that value across reloads until something
    // explicitly overwrites it, so installs that predate the rebrand still
    // open the Screenity survey on uninstall. Setting to "" unsets it.
    chrome.runtime.setUninstallURL("");

    if (details.reason === "install") {
      chrome.storage.local.clear();

      chrome.storage.managed.get("skipSetup", (managedConfig) => {
        const skipSetup = managedConfig.skipSetup ?? false;
        if (!skipSetup) {
          chrome.tabs.create({ url: "welcome.html" });
        }
      });
    }

    // F31: force-write on install AND update. The cog menu that let users
    // override systemAudio was removed; it bleeds into the Whisper transcript
    // (background music, browser notifications, etc.) so we keep it off for
    // everyone, including users who had the Screenity-era `true` in storage.
    chrome.storage.local.set({ systemAudio: false });
    chrome.storage.local.set({ offscreenRecording: false });

    const { backupTab } = await chrome.storage.local.get(["backupTab"]);
    if (backupTab) {
      removeTab(backupTab);
    }

    // update only; manifest auto-injects on page load. install would double-mount React on dev.
    if (details.reason === "update") {
      executeScripts();
    }

  });
};
