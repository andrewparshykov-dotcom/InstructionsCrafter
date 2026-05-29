// DECISION: Adding a minimal options page in Phase 8 (architecture lists it under Phase 9 polish)
// so BACKEND_URL is configurable when we switch from localhost during dev to the deployed
// domain after Phase 7 — without having to edit code at that transition.

// DECISION: default to the production backend so fresh installs work with no
// setup. Localhost was only for local dev — point it back here via Options when
// developing against a local server.
const DEFAULT_BACKEND_URL = "https://instructionscrafter.com";

const backendInput = document.getElementById("backendUrl");
const titleInput = document.getElementById("defaultTitle");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");

chrome.storage.local.get(["backendUrl", "defaultTitle"], (data) => {
  backendInput.value = data.backendUrl || DEFAULT_BACKEND_URL;
  titleInput.value = data.defaultTitle || "";
});

saveButton.addEventListener("click", () => {
  const backendUrl = backendInput.value.trim() || DEFAULT_BACKEND_URL;
  const defaultTitle = titleInput.value.trim();
  chrome.storage.local.set({ backendUrl, defaultTitle }, () => {
    status.classList.add("visible");
    setTimeout(() => { status.classList.remove("visible"); }, 2000);
  });
});

const versionEl = document.getElementById("version");
if (versionEl) {
  versionEl.textContent = chrome.runtime.getManifest().version;
}
