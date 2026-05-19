import React, {
  useState,
  useEffect,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import {
  TempLogo,
  ProfilePic,
} from "../images/popup/images";

import { Rnd } from "react-rnd";

import { CloseIconPopup, GrabIconPopup } from "../toolbar/components/SVG";

import RecordingTab from "./layout/RecordingTab";

import SettingsMenu from "./layout/SettingsMenu";
import InactiveSubscription from "./layout/InactiveSubscription";
import LoggedOut from "./layout/LoggedOut";
import Welcome from "./layout/Welcome";
import {
  runProPopupOnboardingIfNeeded,
  runProCameraOnboardingIfNeeded,
} from "./onboarding/proOnboarding";

import { contentStateContext } from "../context/ContentState";

const PopupContainer = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const contentStateRef = useRef(contentState);
  const [tab, setTab] = useState("record");
  const [badge, setBadge] = useState(TempLogo);
  const DragRef = useRef(null);
  const PopupRef = useRef(null);
  const [elastic, setElastic] = React.useState("");
  const [shake, setShake] = React.useState("");
  const [dragging, setDragging] = React.useState("");
  const [onboarding, setOnboarding] = useState(false);
  const [showProSplash, setShowProSplash] = useState(false);
  const [open, setOpen] = useState(false);
  const recordTabRef = useRef(null);
  const videoTabRef = useRef(null);
  const pillRef = useRef(null);
  const isCloudBuild = process.env.SCREENITY_ENABLE_CLOUD_FEATURES === "true";
  const wasCameraActiveRef = useRef(null);

  // Playground anchors the popup to a zero-height marker placed directly
  // below the toolbar's anchor inside the page's CSS layout
  // (#playground-popup-anchor in Setup.jsx). Same idea as the toolbar:
  // because the anchor scales with the page, the popup stays glued under
  // the toolbar across all Chrome zoom levels. See F28.
  const isPlayground =
    typeof window !== "undefined" &&
    typeof chrome !== "undefined" &&
    chrome.runtime?.id &&
    window.location.href.includes("/playground.html");
  const playgroundPopupPosition = () => {
    const anchor =
      typeof document !== "undefined"
        ? document.getElementById("playground-popup-anchor")
        : null;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      return { x: Math.round(rect.left), y: Math.round(rect.top) };
    }
    // Fallback if anchor isn't in the DOM yet — the resize listener / rAF
    // re-pin in useLayoutEffect will overwrite this once it appears.
    return { x: 80, y: 560 };
  };

  useEffect(() => {
    chrome.storage.local.get(["onboarding", "showProSplash"], (result) => {
      const nextOnboarding = Boolean(result.onboarding);
      const nextShowProSplash = Boolean(result.showProSplash);
      setOnboarding(nextOnboarding);
      setShowProSplash(nextShowProSplash);
      setContentState((prevContentState) => ({
        ...prevContentState,
        onboarding: nextOnboarding,
        showProSplash: nextShowProSplash,
      }));
    });
  }, [setContentState]);

  useEffect(() => {
    if (contentState.isLoggedIn) {
      setOnboarding(false);
      setShowProSplash(false);
      return;
    }
    setOnboarding(Boolean(contentState.onboarding));
    setShowProSplash(Boolean(contentState.showProSplash));
  }, [
    contentState.isLoggedIn,
    contentState.onboarding,
    contentState.showProSplash,
  ]);

  const onValueChange = (tab) => {
    setTab(tab);

    if (contentState.isLoggedIn && contentState.isSubscribed === false) {
      setBadge(
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text x='0' y='24' font-size='28'>⚠️</text></svg>"
      );
    } else if (tab === "record" && !contentState.isLoggedIn) {
      setBadge(TempLogo);
    } else {
      const avatar = contentState?.screenityUser?.avatar;
      setBadge(avatar || ProfilePic);
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      bigTab: tab,
    }));
  };
  useEffect(() => {
    setTab(contentState.bigTab);
  }, []);

  useEffect(() => {
    if (contentState.isLoggedIn && contentState.isSubscribed === false) {
      setBadge(
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text x='0' y='24' font-size='28'>⚠️</text></svg>"
      );
    } else if (tab === "record" && !contentState.isLoggedIn) {
      setBadge(TempLogo);
    } else {
      const avatar = contentState?.screenityUser?.avatar;
      setBadge(avatar || ProfilePic);
    }
  }, [
    contentState.isLoggedIn,
    contentState.isSubscribed,
    contentState.wasLoggedIn,
    tab,
  ]);

  const showWelcomeSplash = Boolean(
    isCloudBuild &&
      !contentState.isLoggedIn &&
      !contentState.wasLoggedIn &&
      (
        onboarding ||
        showProSplash ||
        contentState.onboarding ||
        contentState.showProSplash
      ),
  );

  useLayoutEffect(() => {
    if (!recordTabRef.current || !videoTabRef.current || !pillRef.current)
      return;

    const tabRef =
      tab === "record" ? recordTabRef.current : videoTabRef.current;

    pillRef.current.style.left = `${tabRef.offsetLeft}px`;
    pillRef.current.style.width = `${tabRef.getBoundingClientRect().width}px`;
  }, [tab]);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  useLayoutEffect(() => {
    if (isPlayground) {
      const pin = () => {
        if (DragRef.current) {
          DragRef.current.updatePosition(playgroundPopupPosition());
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
    function setPopupPosition(e) {
      let xpos = DragRef.current.getDraggablePosition().x;
      let ypos = DragRef.current.getDraggablePosition().y;

      const rect = PopupRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      // Keep popup positioned proportionally to bottom-right.
      if (xpos > window.innerWidth + 10) {
        xpos = window.innerWidth + 10;
      }
      if (ypos + height + 40 > window.innerHeight) {
        ypos = window.innerHeight - height - 40;
      }

      if (contentStateRef.current.popupPosition.fixed) {
        if (xpos < window.innerWidth) {
          xpos = window.innerWidth + 10;
        }
      }

      DragRef.current.updatePosition({ x: xpos, y: ypos });
    }
    window.addEventListener("resize", setPopupPosition);
    setPopupPosition();
    return () => window.removeEventListener("resize", setPopupPosition);
  }, []);

  const handleDragStart = (e, d) => {
    setDragging("ToolbarDragging");
  };

  const handleDrag = (e, d) => {
    // Drag fires ~60Hz; cache rect to avoid 120 reflows/sec.
    const rect = PopupRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (
      d.x - 40 < width ||
      d.x > window.innerWidth + 10 ||
      d.y < 0 ||
      d.y + height + 40 > window.innerHeight
    ) {
      setShake("ToolbarShake");
    } else {
      setShake("");
    }
  };

  const handleDrop = (e, d) => {
    let anim = "ToolbarElastic";
    if (e === null) {
      anim = "";
    }
    setShake("");
    setDragging("");
    let xpos = d.x;
    let ypos = d.y;

    const rect = PopupRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (d.x - 40 < width) {
      setElastic(anim);
      xpos = width + 40;
    } else if (d.x + 10 > window.innerWidth) {
      setElastic(anim);
      xpos = window.innerWidth + 10;
    }

    if (d.y < 0) {
      setElastic(anim);
      ypos = 0;
    } else if (d.y + height + 40 > window.innerHeight) {
      setElastic(anim);
      ypos = window.innerHeight - height - 40;
    }
    DragRef.current.updatePosition({ x: xpos, y: ypos });

    setTimeout(() => {
      setElastic("");
    }, 250);

    setContentState((prevContentState) => ({
      ...prevContentState,
      popupPosition: {
        ...prevContentState.popupPosition,
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
    let fixed = d.x + 9 > window.innerWidth ? true : false;

    if (right) {
      offsetX = window.innerWidth - xpos;
    }
    if (bottom) {
      offsetY = window.innerHeight - ypos;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      popupPosition: {
        ...prevContentState.popupPosition,
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        fixed: fixed,
      },
    }));

    chrome.storage.local.set({
      popupPosition: {
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        fixed: fixed,
      },
    });
  };

  useEffect(() => {
    if (isPlayground) {
      DragRef.current?.updatePosition(playgroundPopupPosition());
      return;
    }
    let x = contentState.popupPosition.offsetX;
    let y = contentState.popupPosition.offsetY;

    if (contentState.popupPosition.bottom) {
      y = window.innerHeight - contentState.popupPosition.offsetY;
    }

    if (contentState.popupPosition.right) {
      x = window.innerWidth - contentState.popupPosition.offsetX;
    }

    DragRef.current.updatePosition({ x: x, y: y });

    handleDrop(null, { x: x, y: y });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      const tabRef =
        contentState.bigTab === "record"
          ? recordTabRef.current
          : videoTabRef.current;

      if (tabRef && pillRef.current) {
        pillRef.current.style.left = `${tabRef.offsetLeft}px`;
        pillRef.current.style.width = `${
          tabRef.getBoundingClientRect().width
        }px`;
      }
    });
  }, [
    contentState.isLoggedIn,
    contentState.bigTab,
    contentState.wasLoggedIn,
    pillRef.current,
  ]);

  useEffect(() => {
    const isPro = Boolean(contentState.isLoggedIn && contentState.isSubscribed);
    if (!isCloudBuild || !isPro) return;
    runProPopupOnboardingIfNeeded({
      rootContext: props.shadowRef?.current?.shadowRoot || document,
      isPro,
      isLoggedIn: Boolean(contentState.isLoggedIn),
      popupOpen: Boolean(contentState.showPopup && contentState.showExtension),
      cameraEnabled: Boolean(contentState.cameraActive),
      pendingRecording: Boolean(contentState.pendingRecording),
      preparingRecording: Boolean(contentState.preparingRecording),
      recording: Boolean(contentState.recording),
      countdownActive: Boolean(contentState.countdownActive),
      isCountdownVisible: Boolean(contentState.isCountdownVisible),
    });
  }, [
    isCloudBuild,
    contentState.isLoggedIn,
    contentState.isSubscribed,
    contentState.showPopup,
    contentState.showExtension,
    contentState.recordingToScene,
    contentState.cameraActive,
    contentState.pendingRecording,
    contentState.preparingRecording,
    contentState.recording,
    contentState.countdownActive,
    contentState.isCountdownVisible,
    props.shadowRef,
  ]);

  useEffect(() => {
    const isPro = Boolean(contentState.isLoggedIn && contentState.isSubscribed);
    const cameraEnabled = Boolean(contentState.cameraActive);
    if (wasCameraActiveRef.current === null) {
      wasCameraActiveRef.current = cameraEnabled;
      return;
    }
    const becameEnabled = cameraEnabled && !wasCameraActiveRef.current;
    wasCameraActiveRef.current = cameraEnabled;
    if (!becameEnabled || !isCloudBuild || !isPro) return;
    runProCameraOnboardingIfNeeded({
      rootContext: props.shadowRef?.current?.shadowRoot || document,
      isPro,
      isLoggedIn: Boolean(contentState.isLoggedIn),
      popupOpen: Boolean(contentState.showPopup && contentState.showExtension),
      cameraEnabled,
      pendingRecording: Boolean(contentState.pendingRecording),
      preparingRecording: Boolean(contentState.preparingRecording),
      recording: Boolean(contentState.recording),
      countdownActive: Boolean(contentState.countdownActive),
      isCountdownVisible: Boolean(contentState.isCountdownVisible),
    });
  }, [
    isCloudBuild,
    contentState.cameraActive,
    contentState.isLoggedIn,
    contentState.isSubscribed,
    contentState.showPopup,
    contentState.showExtension,
    contentState.pendingRecording,
    contentState.preparingRecording,
    contentState.recording,
    contentState.countdownActive,
    contentState.isCountdownVisible,
    props.shadowRef,
  ]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
      }}
    >
      <div className={"ToolbarBounds" + " " + shake}></div>
      <Rnd
        default={
          isPlayground
            ? playgroundPopupPosition()
            : {
                x: contentState.popupPosition.offsetX,
                y: contentState.popupPosition.offsetY,
              }
        }
        className={
          "react-draggable" + " " + elastic + " " + shake + " " + dragging
        }
        enableResizing={false}
        disableDragging={isPlayground}
        dragHandleClassName="drag-area"
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDrop}
        ref={DragRef}
      >
        <div
          className="popup-container"
          id="pro-onboarding-popup-container"
          ref={PopupRef}
          // On Playground we anchor the popup via Rnd's transform; the
          // default CSS pins it to top-right of a width-0 wrapper (which
          // throws it off-screen left). Override to follow Rnd directly.
          style={
            isPlayground ? { top: 0, right: "auto", left: 0 } : undefined
          }
        >
          <div
            className={
              open ? "popup-controls open" : "popup-controls drag-area"
            }
          >
            <SettingsMenu
              shadowRef={props.shadowRef}
              open={open}
              setOpen={setOpen}
            />
            <div
              className="popup-control popup-close"
              onClick={() => {
                setContentState((prevContentState) => ({
                  ...prevContentState,
                  showExtension: false,
                }));
              }}
            >
              <CloseIconPopup />
            </div>
          </div>
          <div className="popup-cutout drag-area">
            {contentState.isLoggedIn && contentState.isSubscribed === false ? (
              <div
                style={{
                  fontSize: "34px",
                }}
              >
                ⚠️
              </div>
            ) : (
              <img
                src={badge}
                crossOrigin="anonymous"
                style={{
                  width:
                    tab === "record" && !contentState.isLoggedIn
                      ? "90%"
                      : "100%",
                  height:
                    tab === "record" && !contentState.isLoggedIn
                      ? "90%"
                      : "100%",
                  filter:
                    tab === "record" && !contentState.isLoggedIn
                      ? "drop-shadow(rgba(86, 123, 218, 0.35) 0px 4px 11px) drop-shadow(rgba(53, 87, 98, 0.2) 0px 4px 10px)"
                      : "none",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
                draggable={false}
                referrerPolicy="no-referrer"
              />
            )}
          </div>
          <div className="popup-nav"></div>
          <div className="popup-content">
            {showWelcomeSplash ? (
              <Welcome
                setOnboarding={() => {
                  setOnboarding(false);
                  setShowProSplash(false);
                  chrome.storage.local.set({
                    onboarding: false,
                    showProSplash: false,
                    firstTimePro: false,
                  });
                  setContentState((prev) => ({
                    ...prev,
                    onboarding: false,
                    showProSplash: false,
                  }));
                }}
                isBack={showProSplash}
                clearBack={() => {
                  setShowProSplash(false);
                  setContentState((prev) => ({
                    ...prev,
                    showProSplash: false,
                  }));
                  chrome.storage.local.set({ showProSplash: false });
                }}
                setContentState={setContentState}
              />
            ) : isCloudBuild &&
            contentState.isSubscribed === false &&
            contentState.isLoggedIn === true ? (
              <InactiveSubscription
                subscription={contentState.proSubscription}
                hasSubscribedBefore={contentState.hasSubscribedBefore}
                onManageClick={() => {
                  const type = contentState.hasSubscribedBefore
                    ? "handle-reactivate"
                    : "handle-upgrade";
                  chrome.runtime.sendMessage({ type });
                }}
                onDowngradeClick={async () => {
                  chrome.runtime.sendMessage({ type: "handle-logout" });
                  setContentState((prev) => ({
                    ...prev,
                    isLoggedIn: false,
                    isSubscribed: false,
                    screenityUser: null,
                    proSubscription: null,
                    wasLoggedIn: false,
                    bigTab: "record",
                  }));
                  contentState.openToast(
                    chrome.i18n.getMessage("loggedOutToastTitle"),
                    () => {},
                    2000
                  );
                }}
              />
            ) : isCloudBuild &&
              !contentState.isLoggedIn &&
              contentState.wasLoggedIn ? (
              <LoggedOut
                onManageClick={() => {
                  chrome.runtime.sendMessage({ type: "handle-login" });
                }}
                onDowngradeClick={() => {
                  chrome.storage.local.set({
                    wasLoggedIn: false,
                    stayLoggedOut: true,
                  });
                  setContentState((prev) => ({
                    ...prev,
                    isLoggedIn: false,
                    wasLoggedIn: false,
                    bigTab: "record",
                  }));
                  setTab("record");

                  requestAnimationFrame(() => {
                    if (recordTabRef.current && pillRef.current) {
                      const tabRef = recordTabRef.current;
                      pillRef.current.style.left = `${tabRef.offsetLeft}px`;
                      pillRef.current.style.width = `${
                        tabRef.getBoundingClientRect().width
                      }px`;
                    }
                  });
                }}
              />
            ) : (
              <RecordingTab shadowRef={props.shadowRef} />
            )}
          </div>
        </div>
      </Rnd>
    </div>
  );
};

export default PopupContainer;
