import React, { useContext, useRef, useEffect } from "react";

import PopupContainer from "./popup/PopupContainer";
import Toolbar from "./toolbar/Toolbar";
import Canvas from "./canvas/Canvas";
import Countdown from "./countdown/Countdown";
import Modal from "./modal/Modal";
import Warning from "./warning/Warning";


// Using ShadowDOM
import root from "react-shadow";

// Import styles raw to add into the ShadowDOM
import styles from "!raw-loader!./styles/app.css";

import ZoomContainer from "./utils/ZoomContainer";
import BlurTool from "./utils/BlurTool";
import CursorModes from "./utils/CursorModes";

import { contentStateContext } from "./context/ContentState";

import { startClickTracking } from "./cursor/trackClicks";

const RecordingLoader = () => {
  const label = chrome.i18n.getMessage("preparingLabel") || "Preparing...";
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999999999,
      }}
      aria-label="Loading overlay"
      role="alert"
    >
      <div
        style={{
          background: "rgba(255, 255, 255, 0.15)",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          borderRadius: 20,
          padding: 40,
          width: 160,
          height: 160,
          boxShadow: `
        0 8px 32px 0 rgba(0, 0, 0, 0.1),
        0 0 0 1px rgba(255, 255, 255, 0.05),
        inset 0 1px 0 rgba(255, 255, 255, 0.1)
      `,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
          userSelect: "none",
          animation: "fadeIn 0.3s ease-out",
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            border: "3px solid rgba(255, 255, 255, 0.2)",
            borderTop: "3px solid rgba(255, 255, 255, 0.8)",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
        <div
          style={{
            marginTop: 20,
            fontSize: 15,
            fontWeight: 500,
            color: "#FFFFFF",
            textAlign: "center",
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </div>
        <style>
          {`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          0% { opacity: 0; transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
      `}
        </style>
      </div>
    </div>
  );
};

const Wrapper = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const shadowRef = useRef(null);
  const parentRef = useRef(null);
  const permissionsRef = useRef(null);
  const contentStateRef = useRef(contentState);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  useEffect(() => {
    if (!parentRef.current) return;

    setContentState((prevContentState) => ({
      ...prevContentState,
      parentRef: parentRef.current,
    }));
  }, [parentRef.current]);

  useEffect(() => {
    if (!shadowRef.current) return;
    setContentState((prevContentState) => ({
      ...prevContentState,
      shadowRef: shadowRef.current,
    }));
  }, [shadowRef.current]);

  useEffect(() => {
    if (contentState.permissionsChecked) return;
    if (!permissionsRef.current) return;
    if (!contentState.showExtension) return;
    if (!contentState.permissionsLoaded) return;

    permissionsRef.current.contentWindow.postMessage(
      {
        type: "instructionscrafter-get-permissions",
      },
      "*"
    );

    setContentState((prevContentState) => ({
      ...prevContentState,
      permissionsChecked: true,
    }));
  }, [
    permissionsRef.current,
    contentState.showExtension,
    contentState.permissionsLoaded,
  ]);

  useEffect(() => {
    let stopTracking = null;

    // Start tracking clicks only when recording starts
    if (contentState.recording) {
      stopTracking = startClickTracking(contentStateRef);
    }

    return () => {
      stopTracking?.();
    };
  }, [contentState.recording]);

  return (
    <div ref={parentRef}>
      {contentState.showExtension && (
        <iframe
          className="instructionscrafter-iframe"
          style={{
            // all: "unset",
            display: "none",
            visibility: "hidden",
          }}
          ref={permissionsRef}
          src={chrome.runtime.getURL("permissions.html")}
          allow="camera *; microphone *"
        ></iframe>
      )}
      {contentState.zoomEnabled && <ZoomContainer />}
      <BlurTool />
      {contentState.showExtension || contentState.recording ? (
        <div>
          {!contentState.recording &&
            !contentState.drawingMode &&
            !contentState.blurMode && (
              <div
                style={{
                  // all: "unset",
                  width: "100%",
                  height: "100%",
                  zIndex: 999999999,
                  pointerEvents:
                    contentState.pendingRecording ||
                    contentState.preparingRecording
                      ? "none"
                      : "all",
                  position: "fixed",
                  background:
                    window.location.href.indexOf(
                      chrome.runtime.getURL("playground.html")
                    ) === -1 &&
                    !contentState.pendingRecording &&
                    !contentState.preparingRecording
                      ? "rgba(0,0,0,0.15)"
                      : "rgba(0,0,0,0)",
                  top: 0,
                  left: 0,
                }}
                onClick={() => {
                  const onboardingActive =
                    document.documentElement.classList.contains(
                      "instructionscrafter-driver-active"
                    ) || Boolean(document.querySelector(".driver-overlay"));
                  if (onboardingActive) return;

                  if (
                    window.location.href.indexOf(
                      chrome.runtime.getURL("playground.html")
                    ) === -1 &&
                    !contentState.pendingRecording
                  ) {
                    setContentState((prevContentState) => ({
                      ...prevContentState,
                      showExtension: false,
                      showPopup: false,
                    }));
                  }
                }}
              ></div>
            )}
          <Canvas />
          <CursorModes />
          <root.div
            className="root-container"
            id="instructionscrafter-root-container"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              position: "absolute",
              pointerEvents: "none",
              left: "0px",
              top: "0px",
              zIndex: 9999999999,
              // Isolation: prevent host-page inherited typography from
              // leaking through the shadow-DOM boundary.
              fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
              fontSize: "16px",
              lineHeight: "normal",
              letterSpacing: "normal",
              wordSpacing: "normal",
              textTransform: "none",
              textIndent: "0",
              textAlign: "left",
              color: "#15171C",
              direction: "ltr",
              whiteSpace: "normal",
              fontStyle: "normal",
              fontVariant: "normal",
              fontWeight: "normal",
            }}
            ref={shadowRef}
          >
            <div className="container">
              <Warning />
              {shadowRef.current && <Modal shadowRef={shadowRef} />}
              {contentState.preparingRecording && (
                <RecordingLoader />
              )}
              <Countdown />
              {!(contentState.hideToolbar && contentState.hideUI) &&
                !contentState.onboarding &&
                !(
                  contentState.isSubscribed === false &&
                  contentState.isLoggedIn === true
                ) &&
                !(!contentState.isLoggedIn && contentState.wasLoggedIn) && (
                  <Toolbar />
                )}
              {contentState.showPopup && (
                <PopupContainer shadowRef={shadowRef} />
              )}
            </div>
            <style type="text/css">{styles}</style>
          </root.div>
        </div>
      ) : (
        <div></div>
      )}
    </div>
  );
};

export default Wrapper;
