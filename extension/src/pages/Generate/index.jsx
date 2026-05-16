import React from "react";
import { createRoot } from "react-dom/client";
import Generate from "./Generate";

const container = window.document.querySelector("#app-container");

if (container) {
  const root = createRoot(container);
  root.render(<Generate />);
}

if (module.hot) {
  module.hot.accept();
}
