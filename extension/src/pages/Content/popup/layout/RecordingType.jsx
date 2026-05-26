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
      chrome.runtime.getURL("assets/helper/permissions.webp"),
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
        <button
          className="permission-button"
          onClick={openPermissionsModal}
        >
          <img src={MicOffBlue} />
          <span>{chrome.i18n.getMessage("allowMicrophoneAccessButton")}</span>
        </button>
      )}
      {contentState.microphonePermission && (
        <Dropdown type="mic" shadowRef={props.shadowRef} />
      )}
      {!contentState.isLoggedIn &&
        contentState.microphonePermission &&
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
      <Settings />
    </div>
  );
};

export default RecordingType;
