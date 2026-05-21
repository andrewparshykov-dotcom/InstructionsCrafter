// Install chrome.* shims before any recorder module loads.
import { installChromeShims } from "./chromeShim";
installChromeShims();

const relayErrorToSW = (source, payload) => {
  chrome.runtime
    .sendMessage({ type: "offscreen-diag", source, payload })
    .catch(() => {});
};

window.addEventListener("error", (e) => {
  relayErrorToSW("window.error", {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error?.stack || null,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  relayErrorToSW("unhandledrejection", {
    reason: String(e.reason),
    stack: e.reason?.stack || null,
  });
});

import React from "react";
import { createRoot } from "react-dom/client";
import OffscreenRecorder from "./OffscreenRecorder";

const container = window.document.querySelector("#app-container");

if (container) {
  try {
    const root = createRoot(container);
    root.render(<OffscreenRecorder />);
  } catch (err) {
    console.error("[InstructionsCrafter][OffscreenRecorder] render error:", err);
  }
}

if (module.hot) {
  module.hot.accept();
}
