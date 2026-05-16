import React from "react";
import { createRoot } from "react-dom/client";
import Welcome from "./Welcome";

const container = window.document.querySelector("#app-container");

if (container) {
  const root = createRoot(container);
  root.render(<Welcome />);
}

if (module.hot) {
  module.hot.accept();
}
