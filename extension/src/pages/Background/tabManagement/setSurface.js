import { sendMessageTab } from "../tabManagement";

export const setSurface = async (request) => {
  await chrome.storage.local.set({ surface: request.surface });

  const { activeTab } = await chrome.storage.local.get(["activeTab"]);

  sendMessageTab(activeTab, {
    type: "set-surface",
    surface: request.surface,
    subscribed: false,
    instantMode: false,
  });
};
