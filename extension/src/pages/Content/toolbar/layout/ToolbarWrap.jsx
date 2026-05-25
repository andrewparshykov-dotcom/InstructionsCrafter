import React, {
  useLayoutEffect,
  useEffect,
  useContext,
  useState,
  useRef,
} from "react";
import * as Toolbar from "@radix-ui/react-toolbar";

import { Rnd } from "react-rnd";

import DrawingToolbar from "./DrawingToolbar";
import CursorToolbar from "./CursorToolbar";
import BlurToolbar from "./BlurToolbar";

import ToolTrigger from "../components/ToolTrigger";
import Toast from "../components/Toast";

import { CloseIconPopup } from "../components/SVG";

import { contentStateContext } from "../../context/ContentState";

import {
  GrabIcon,
  StopIcon,
  DrawIcon,
  PauseIcon,
  ResumeIcon,
  CursorIcon,
  TargetCursorIcon,
  HighlightCursorIcon,
  SpotlightCursorIcon,
  RestartIcon,
  DiscardIcon,
  BlurIcon,
  CloseButtonToolbar,
} from "../components/SVG";

const ToolbarWrap = () => {
  const [contentState, setContentState, t, setT] =
    useContext(contentStateContext);
  const [mode, setMode] = React.useState("");
  const modeRef = React.useRef(mode);
  const [hovering, setHovering] = React.useState(false);
  const DragRef = React.useRef(null);
  const ToolbarRef = React.useRef(null);
  const [side, setSide] = React.useState("ToolbarTop");
  const [elastic, setElastic] = React.useState("");
  const [shake, setShake] = React.useState("");
  const [dragging, setDragging] = React.useState("");
  const [timer, setTimer] = React.useState(0);
  const [timestamp, setTimestamp] = React.useState("00:00");
  const [visuallyHidden, setVisuallyHidden] = useState(false);
  const timeRef = React.useRef("");

  // Playground anchors the toolbar to a zero-height marker that lives inside
  // the page's CSS layout (#playground-toolbar-anchor in Setup.jsx). Because
  // the anchor is part of the page flow, its getBoundingClientRect() scales
  // in lockstep with the headline / paragraph when Chrome page-zooms — so the
  // toolbar stays glued to the text instead of drifting. See F28.
  const isPlayground =
    typeof window !== "undefined" &&
    typeof chrome !== "undefined" &&
    chrome.runtime?.id &&
    window.location.href.includes("/playground.html");
  const playgroundToolbarPosition = () => {
    const anchor =
      typeof document !== "undefined"
        ? document.getElementById("playground-toolbar-anchor")
        : null;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      return { x: Math.round(rect.left), y: Math.round(rect.top) };
    }
    // Fallback if anchor isn't in the DOM yet — the resize listener / rAF
    // re-pin in useLayoutEffect will overwrite this once it appears.
    return { x: 80, y: 500 };
  };

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    setContentState((prev) => ({
      ...prev,
      setToolbarMode: setMode,
      toolbarMode: mode,
    }));
  }, [mode, setContentState]);

  useEffect(() => {
    if (!isNaN(t)) {
      setTimer(t);
      const clampedT = Math.max(0, t);
      const hours = Math.floor(clampedT / 3600);
      const minutes = Math.floor((clampedT % 3600) / 60);
      const seconds = clampedT % 60;

      let newTimestamp =
        hours > 0
          ? `${hours.toString().padStart(2, "0")}:${minutes
              .toString()
              .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
          : `${minutes.toString().padStart(2, "0")}:${seconds
              .toString()
              .padStart(2, "0")}`;

      if (hours > 0) {
        timeRef.current.style.width = "58px";
      } else {
        timeRef.current.style.width = "42px";
      }

      setTimestamp(newTimestamp);
    }
  }, [t]);

  useLayoutEffect(() => {
    if (isPlayground) {
      const pin = () => {
        if (DragRef.current) {
          DragRef.current.updatePosition(playgroundToolbarPosition());
        }
      };
      pin();
      // Re-pin once on the next frame in case the page anchor wasn't laid out
      // yet when we first read it (the content script can mount slightly
      // before the host page's React tree commits its anchors).
      const raf = requestAnimationFrame(pin);
      window.addEventListener("resize", pin);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", pin);
      };
    }
    function setToolbarPosition(e) {
      let xpos = DragRef.current.getDraggablePosition().x;
      let ypos = DragRef.current.getDraggablePosition().y;

      const rect = ToolbarRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      // Keep toolbar proportional to bottom-right.
      if (xpos + width + 30 > window.innerWidth) {
        xpos = window.innerWidth - width - 30;
      }
      if (ypos + height - 60 > window.innerHeight) {
        ypos = window.innerHeight - height + 60;
      }

      DragRef.current.updatePosition({ x: xpos, y: ypos });
    }
    window.addEventListener("resize", setToolbarPosition);
    setToolbarPosition();
    return () => window.removeEventListener("resize", setToolbarPosition);
  }, []);

  const handleChange = (value) => {
    setMode(value);
  };

  const handleDragStart = (e, d) => {
    setDragging("ToolbarDragging");
  };

  const handleDrag = (e, d) => {
    // Drag fires ~60Hz; cache rect.
    const rect = ToolbarRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (d.y < 130) {
      setSide("ToolbarBottom");
    } else {
      setSide("ToolbarTop");
    }

    if (
      d.x < -25 ||
      d.x + width > window.innerWidth ||
      d.y < 60 ||
      d.y + height - 80 > window.innerHeight
    ) {
      setShake("ToolbarShake");
    } else {
      setShake("");
    }
  };

  const handleDrop = (e, d) => {
    setShake("");
    setDragging("");
    let xpos = d.x;
    let ypos = d.y;

    const rect = ToolbarRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (d.x < -10) {
      setElastic("ToolbarElastic");
      xpos = -10;
    } else if (d.x + width + 30 > window.innerWidth) {
      setElastic("ToolbarElastic");
      xpos = window.innerWidth - width - 30;
    }

    if (d.y < 130) {
      setSide("ToolbarBottom");
    } else {
      setSide("ToolbarTop");
    }

    if (d.y < 80) {
      setElastic("ToolbarElastic");
      ypos = 80;
    } else if (d.y + height - 60 > window.innerHeight) {
      setElastic("ToolbarElastic");
      ypos = window.innerHeight - height + 60;
    }
    DragRef.current.updatePosition({ x: xpos, y: ypos });

    setTimeout(() => {
      setElastic("");
    }, 250);

    setContentState((prevContentState) => ({
      ...prevContentState,
      toolbarPosition: {
        ...prevContentState.toolbarPosition,
        offsetX: xpos,
        offsetY: ypos,
        left: xpos < window.innerWidth / 2 ? true : false,
        right: xpos < window.innerWidth / 2 ? false : true,
        top: ypos < window.innerHeight / 2 ? true : false,
        bottom: ypos < window.innerHeight / 2 ? false : true,
      },
    }));

    let left = xpos < window.innerWidth / 2 ? true : false;
    let right = xpos < window.innerWidth / 2 ? false : true;
    let top = ypos < window.innerHeight / 2 ? true : false;
    let bottom = ypos < window.innerHeight / 2 ? false : true;
    let offsetX = xpos;
    let offsetY = ypos;

    if (right) {
      offsetX = window.innerWidth - xpos;
    }
    if (bottom) {
      offsetY = window.innerHeight - ypos;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      toolbarPosition: {
        ...prevContentState.toolbarPosition,
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
      },
    }));

    chrome.storage.local.set({
      toolbarPosition: {
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
      },
    });
  };

  useEffect(() => {
    if (isPlayground) {
      DragRef.current?.updatePosition(playgroundToolbarPosition());
      return;
    }
    let x = contentState.toolbarPosition.offsetX;
    let y = contentState.toolbarPosition.offsetY;

    if (contentState.toolbarPosition.bottom) {
      y = window.innerHeight - contentState.toolbarPosition.offsetY;
    }

    if (contentState.toolbarPosition.right) {
      x = window.innerWidth - contentState.toolbarPosition.offsetX;
    }

    // Clamp into viewport: saved positions from a larger display can land
    // off-screen (external monitor saved, restored on built-in).
    const rect = ToolbarRef.current?.getBoundingClientRect();
    const tbWidth = rect?.width || 0;
    const tbHeight = rect?.height || 0;
    if (x + tbWidth > window.innerWidth) x = window.innerWidth - tbWidth;
    if (y + tbHeight > window.innerHeight) y = window.innerHeight - tbHeight;
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    DragRef.current.updatePosition({ x: x, y: y });

    handleDrop(null, { x: x, y: y });
  }, []);

  useEffect(() => {
    if (!contentState.openToast) return;
    if (contentState.drawingMode) {
      contentState.openToast(chrome.i18n.getMessage("drawingModeToast"), () => {
        setMode("");
      });
    }
    if (contentState.blurMode) {
      contentState.openToast(chrome.i18n.getMessage("blurModeToast"), () => {
        setMode("");
      });
    }
  }, [contentState.drawingMode, contentState.blurMode, contentState.openToast]);

  useEffect(() => {
    if (contentState.drawingMode) setMode("draw");
    else if (contentState.blurMode) setMode("blur");
    else setMode("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === "draw") {
      setContentState((prevContentState) => ({
        ...prevContentState,
        drawingMode: true,
      }));
    } else {
      setContentState((prevContentState) => ({
        ...prevContentState,
        drawingMode: false,
      }));
    }
    if (mode === "blur") {
      setContentState((prevContentState) => ({
        ...prevContentState,
        blurMode: true,
        drawingMode: false,
      }));
    } else {
      setContentState((prevContentState) => ({
        ...prevContentState,
        blurMode: false,
      }));
    }
  }, [mode]);

  return (
    <div>
      <Toast />
      <div
        className={
          contentState.paused && contentState.recording
            ? "ToolbarPaused"
            : "ToolbarPaused hidden"
        }
      ></div>
      <div className={"ToolbarBounds" + " " + shake}></div>
      <Rnd
        default={isPlayground ? playgroundToolbarPosition() : { x: 200, y: 500 }}
        disableDragging={isPlayground}
        className={
          "react-draggable" + " " + elastic + " " + shake + " " + dragging
        }
        dragHandleClassName="grab"
        enableResizing={false}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDrop}
        ref={DragRef}
        id="pro-onboarding-recording-toolbar"
      >
        <Toolbar.Root
          id="pro-onboarding-recording-toolbar-root"
          className={
            "ToolbarRoot" +
            " " +
            side +
            (visuallyHidden ? " visually-hidden-toolbar" : "")
          }
          ref={ToolbarRef}
          onMouseOver={() => {
            setHovering(true);
          }}
          onMouseLeave={() => {
            setHovering(false);
          }}
        >
          <ToolTrigger grab type="button" content="">
            <GrabIcon />
          </ToolTrigger>
          {!contentState.recording && (
            <div
              className={`popup-controls toolbar-controls ${
                hovering ? "open" : ""
              }`}
              onClick={() => {
                if (contentState.openToast) {
                  contentState.openToast(
                    chrome.i18n.getMessage("reopenToolbarToast"),
                    () => {},
                  );
                }

                setVisuallyHidden(true);

                setContentState((prev) => ({
                  ...prev,

                  drawingMode: false,
                  blurMode: false,
                }));
                // Wait for toast (~3s) before real hide.
                setTimeout(() => {
                  setContentState((prev) => ({
                    ...prev,
                    hideToolbar: true,
                    drawingMode: false,
                    blurMode: false,
                    hideUI: true,
                  }));

                  chrome.storage.local.set({
                    hideToolbar: true,
                    hideUI: true,
                  });
                }, 3000);
              }}
            >
              <div className="popup-control popup-close">
                <CloseIconPopup />
              </div>
            </div>
          )}
          <div
            className={"ToolbarRecordingControls"}
            id="pro-onboarding-recording-toolbar-controls"
          >
            <ToolTrigger
              type="button"
              content={chrome.i18n.getMessage("finishRecordingTooltip")}
              disabled={!contentState.recording}
              onClick={() => {
                contentState.stopRecording();
              }}
            >
              <StopIcon width="20" height="20" />
            </ToolTrigger>
            <div
              className={`ToolbarRecordingTime ${
                contentState.timeWarning ? "TimerWarning" : ""
              }`}
              ref={timeRef}
            >
              {timestamp}
            </div>
            <ToolTrigger
              type="button"
              content={chrome.i18n.getMessage("restartRecordingTooltip")}
              disabled={!contentState.recording}
              onClick={() => {
                contentState.tryRestartRecording();
              }}
            >
              <RestartIcon />
            </ToolTrigger>
            {!contentState.paused && (
              <ToolTrigger
                type="button"
                content={chrome.i18n.getMessage("pauseRecordingTooltip")}
                disabled={!contentState.recording}
                onClick={() => {
                  contentState.pauseRecording();
                }}
              >
                <PauseIcon />
              </ToolTrigger>
            )}
            {contentState.recording && contentState.paused && (
              <ToolTrigger
                type="button"
                resume
                content={chrome.i18n.getMessage("resumeRecordingTooltip")}
                disabled={!contentState.recording}
                onClick={() => {
                  contentState.resumeRecording();
                }}
              >
                <ResumeIcon />
              </ToolTrigger>
            )}
            <ToolTrigger
              type="button"
              content={chrome.i18n.getMessage("cancelRecordingTooltip")}
              disabled={!contentState.recording}
              onClick={() => {
                if (contentState.tryDismissRecording !== undefined) {
                  contentState.tryDismissRecording();
                }
              }}
            >
              <DiscardIcon />
            </ToolTrigger>
          </div>
          <Toolbar.Separator className="ToolbarSeparator" />
          <Toolbar.ToggleGroup
            type="single"
            className="ToolbarToggleGroup"
            value={mode}
            onValueChange={handleChange}
          >
            <div className="ToolbarToggleWrap">
              <ToolTrigger
                type="mode"
                content={chrome.i18n.getMessage("toggleDrawingToolsTooltip")}
                value="draw"
              >
                {mode === "draw" && <CloseButtonToolbar />}
                {mode !== "draw" && <DrawIcon />}
              </ToolTrigger>
              <DrawingToolbar visible={mode === "draw" ? "show-toolbar" : ""} />
            </div>
            <div className="ToolbarToggleWrap">
              <ToolTrigger
                type="mode"
                content={chrome.i18n.getMessage("toggleBlurToolTooltip")}
                value="blur"
              >
                {mode === "blur" && <CloseButtonToolbar />}
                {mode !== "blur" && <BlurIcon />}
              </ToolTrigger>
              <BlurToolbar visible={mode === "blur" ? "show-toolbar" : ""} />
            </div>

            <div className="ToolbarToggleWrap">
              <ToolTrigger
                type="mode"
                content={chrome.i18n.getMessage("toggleCursorOptionsTooltip")}
                value="cursor"
              >
                {contentState.cursorMode === "target" && <TargetCursorIcon />}
                {contentState.cursorMode === "highlight" && (
                  <HighlightCursorIcon />
                )}
                {contentState.cursorMode === "spotlight" && (
                  <SpotlightCursorIcon />
                )}
                {contentState.cursorMode === "none" && <CursorIcon />}
              </ToolTrigger>
              <CursorToolbar
                visible={mode === "cursor" ? "show-toolbar" : ""}
                mode={mode}
                setMode={setMode}
              />
            </div>
          </Toolbar.ToggleGroup>
        </Toolbar.Root>
      </Rnd>
    </div>
  );
};

export default ToolbarWrap;
