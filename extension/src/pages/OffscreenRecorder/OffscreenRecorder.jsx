import React, { useEffect } from "react";
import Recorder from "../Recorder/Recorder";

const OffscreenRecorder = () => {
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "offscreen-ready" }).catch((err) => {
      console.warn("[OffscreenRecorder] offscreen-ready send failed", err);
    });
  }, []);

  return <Recorder />;
};

export default OffscreenRecorder;
