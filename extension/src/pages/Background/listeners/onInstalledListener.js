import { executeScripts } from "../utils/executeScripts";

export const onInstalledListener = () => {
  chrome.runtime.onInstalled.addListener(async (details) => {
    // Toolbar tooltip: just the program name. Set explicitly so it also
    // overrides the old "voice narration is required" title for users
    // updating from a previous version.
    chrome.action.setTitle({ title: "InstructionsCrafter" });

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

    // 2026-09 domain move: instructionscrafter.com -> instrcrafter.safeshieldins.com.
    // The Options page's Save always persists backendUrl, so an install that ever saved
    // its settings has the OLD hostname pinned in storage and would ignore the new
    // default. Rewrite it once (install and update). Other custom URLs are left alone.
    chrome.storage.local.get("backendUrl", ({ backendUrl }) => {
      if (
        typeof backendUrl === "string" &&
        /^https?:\/\/(www\.)?instructionscrafter\.com\/?$/i.test(backendUrl)
      ) {
        chrome.storage.local.set({
          backendUrl: "https://instrcrafter.safeshieldins.com",
        });
      }
    });

    // update only; manifest auto-injects on page load. install would double-mount React on dev.
    if (details.reason === "update") {
      executeScripts();
    }

  });
};
