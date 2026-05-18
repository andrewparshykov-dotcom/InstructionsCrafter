import { removeTab } from "../tabManagement";
import { executeScripts } from "../utils/executeScripts";
import { tryResumePendingUploads } from "../recording/resumePendingUploads";

const cloudFeaturesEnabled =
  process.env.SCREENITY_ENABLE_CLOUD_FEATURES === "true";

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

      chrome.storage.local.set({
        firstTime: true,
        onboarding: cloudFeaturesEnabled,
        bannerSupport: true,
        firstTimePro: cloudFeaturesEnabled,
      });

      chrome.storage.managed.get("skipSetup", (managedConfig) => {
        const skipSetup = managedConfig.skipSetup ?? false;
        if (!skipSetup) {
          chrome.tabs.create({ url: "welcome.html" });
        }
      });
    } else if (details.reason === "update") {
      if (details.previousVersion === "2.8.6") {
        chrome.storage.local.set({ updatingFromOld: true });
      } else {
        chrome.storage.local.set({ updatingFromOld: false });

        if (details.previousVersion === "3.1.16" && cloudFeaturesEnabled) {
          chrome.storage.local.set({
            showProSplash: cloudFeaturesEnabled,
            bannerSupport: true,
            onboarding: cloudFeaturesEnabled,
          });
        }
      }
    }

    // Backup mode is deprecated: hidden from the settings dropdown and
    // forced off for all users on install/update. OPFS-backed recording
    // covers the same crash-resilience without the picker UX.
    chrome.storage.local.set({ backup: false, backupSetup: false });

    if (details.reason === "install") {
      chrome.storage.local.set({ systemAudio: true });
    }
    chrome.storage.local.set({ offscreenRecording: false });

    const { backupTab } = await chrome.storage.local.get(["backupTab"]);
    if (backupTab) {
      removeTab(backupTab);
    }

    // update only; manifest auto-injects on page load. install would double-mount React on dev.
    if (details.reason === "update") {
      executeScripts();
    }

    setTimeout(() => {
      tryResumePendingUploads({ trigger: `onInstalled:${details.reason}` }).catch(
        () => {},
      );
    }, 5000);
  });
};
