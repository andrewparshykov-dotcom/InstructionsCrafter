import React, { useEffect, useContext, useState, useRef } from "react";

import Dropdown from "../components/Dropdown";
import Switch from "../components/Switch";
import Settings from "./Settings";
import { contentStateContext } from "../../context/ContentState";
import { MicOffBlue } from "../../images/popup/images";

import { AlertIcon } from "../../toolbar/components/SVG";

const RecordingType = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);

  const buttonRef = useRef(null);
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // Opens the right permissions modal based on why access is blocked.
  // When the hosting page's Permissions-Policy header disallows camera or
  // microphone, the usual "click the camera icon in the address bar" advice
  // is wrong (the site is the blocker, not the browser). Route to a
  // site-specific modal in that case.
  const openPermissionsModal = () => {
    if (typeof contentState.openModal !== "function") return;
    if (contentState.sitePermissionsBlocked) {
      contentState.openModal(
        chrome.i18n.getMessage("sitePermissionsBlockedTitle"),
        chrome.i18n.getMessage("sitePermissionsBlockedDescription"),
        null,
        chrome.i18n.getMessage("permissionsModalDismiss"),
        () => {},
        () => {},
        null,
        chrome.i18n.getMessage("learnMoreDot"),
        "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy",
        true,
        false
      );
      return;
    }
    contentState.openModal(
      chrome.i18n.getMessage("permissionsModalTitle"),
      chrome.i18n.getMessage("permissionsModalDescription"),
      chrome.i18n.getMessage("permissionsModalReview"),
      chrome.i18n.getMessage("permissionsModalDismiss"),
      () => {
        chrome.runtime.sendMessage({
          type: "extension-media-permissions",
        });
      },
      () => {},
      null,
      null,
      null,
      true,
      false
    );
  };

  // Start recording
  const startStreaming = () => {
    contentState.startStreaming();
  };

  // Opens the "Which mode should I use?" guide in a standalone window. The
  // background handles it -- content scripts cannot open windows themselves.
  const openGuide = () => {
    try {
      chrome.runtime.sendMessage({ type: "open-guide" }).catch(() => {});
    } catch (e) {}
  };

  // Capture mode: "video" (narrated screen recording) | "clicks" (Click-capture:
  // a screenshot per click, narration optional, browser tab only).
  const captureMode = contentState.captureMode || "video";
  const setCaptureMode = (mode) => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      captureMode: mode,
    }));
    chrome.storage.local.set({ captureMode: mode });
  };

  useEffect(() => {
    if (contentState.recording) {
      setContentState((prevContentState) => ({
        ...prevContentState,
        pendingRecording: false,
      }));
    }
  }, [contentState.recording]);

  return (
    <div>
      <div style={modeStyles.wrap} role="group" aria-label="Capture mode">
        <button
          type="button"
          style={{
            ...modeStyles.btn,
            ...(captureMode === "video" ? modeStyles.btnActive : {}),
          }}
          onClick={() => setCaptureMode("video")}
        >
          Video
        </button>
        <button
          type="button"
          style={{
            ...modeStyles.btn,
            ...(captureMode === "clicks" ? modeStyles.btnActive : {}),
          }}
          onClick={() => setCaptureMode("clicks")}
        >
          Click capture
        </button>
      </div>
      <button type="button" style={modeStyles.guideLink} onClick={openGuide}>
        Which mode should I use? →
      </button>
      {contentState.updateChrome && (
        <div className="popup-warning">
          <div className="popup-warning-left">
            <AlertIcon />
          </div>
          <div className="popup-warning-middle">
            <div className="popup-warning-title">
              {chrome.i18n.getMessage("customAreaRecordingDisabledTitle")}
            </div>
            <div className="popup-warning-description">
              {chrome.i18n.getMessage("customAreaRecordingDisabledDescription")}
            </div>
          </div>
        </div>
      )}
      {!contentState.microphonePermission && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            padding: "8px 10px",
            background: "rgba(0,0,0,0.05)",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.45,
            color: "#5B5F66",
          }}
        >
          <img
            src={MicOffBlue}
            style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.6 }}
          />
          <span>{chrome.i18n.getMessage("allowMicrophoneAccessButton")}</span>
        </div>
      )}
      {contentState.microphonePermission && (
        <Dropdown type="mic" shadowRef={props.shadowRef} />
      )}
      {contentState.microphonePermission &&
        contentState.defaultAudioInput != "none" &&
        contentState.micActive && (
        <div>
          <iframe
            className="instructionscrafter-iframe"
            style={{
              width: "100%",
              height: "30px",
              zIndex: 999999,
              position: "relative",
            }}
            allow="camera; microphone"
            src={chrome.runtime.getURL("waveform.html")}
          ></iframe>
        </div>
      )}
      <button
        role="button"
        className="main-button recording-button"
        ref={buttonRef}
        tabIndex="0"
        onClick={startStreaming}
        disabled={contentState.pendingRecording}
      >
        <span className="main-button-label">
          {contentState.pendingRecording
            ? chrome.i18n.getMessage("recordButtonInProgressLabel")
            : contentState.multiMode && contentState.multiSceneCount > 0
            ? chrome.i18n.getMessage("recordButtonMultiLabel")
            : chrome.i18n.getMessage("recordButtonLabel")}
        </span>
      </button>
      {captureMode !== "clicks" && <Settings />}
    </div>
  );
};

// Inline styles for the Video / Click-capture segmented toggle. Inline (rather
// than the popup CSS) keeps this self-contained and immune to shadow-DOM class
// collisions.
const modeStyles = {
  wrap: {
    display: "flex",
    gap: 4,
    padding: 4,
    marginBottom: 12,
    background: "rgba(0,0,0,0.05)",
    borderRadius: 10,
  },
  btn: {
    flex: 1,
    appearance: "none",
    border: "none",
    cursor: "pointer",
    background: "transparent",
    color: "#15171C",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 10px",
    borderRadius: 8,
    transition: "background 0.15s ease, color 0.15s ease",
  },
  btnActive: {
    background: "#fff",
    color: "#3080F8",
    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
  },
  guideLink: {
    display: "block",
    width: "100%",
    appearance: "none",
    border: "none",
    background: "transparent",
    color: "#3080F8",
    fontFamily: "inherit",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
    margin: "-4px 0 12px",
    textAlign: "center",
  },
};

export default RecordingType;
