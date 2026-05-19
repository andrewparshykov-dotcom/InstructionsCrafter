import React, {
  useState,
  useEffect,
  useContext,
  useCallback,
} from "react";

import { CameraCloseIcon } from "../toolbar/components/SVG";

import * as ToastEl from "@radix-ui/react-toast";

import { contentStateContext } from "../context/ContentState";

// "Editorial Manual" notice toast (Phase 8 F29). Paper-surface card with a
// vertical accent-blue rule on the left edge — same visual signal magazines
// use for marginalia and sidebars. The previous icon column was dropped in
// favor of a mono-caps "NOTICE" label that ties into the version marks on
// the Playground / Welcome pages.
const Warning = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // `kind` no longer drives icon rendering (icon column is gone) but it still
  // gates the audio-toast auto-dismiss when the user switches to a region
  // recording. Kept the original third-positional-arg signature so the call
  // sites in ContentState.jsx don't have to change.
  const [kind, setKind] = useState("");
  const [duration, setDuration] = useState(10000);

  const openWarning = useCallback((title, description, kind, duration) => {
    setTitle(title);
    setDescription(description);
    setKind(kind);
    setDuration(duration);
    setOpen(true);
  }, []);

  useEffect(() => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      openWarning: openWarning,
    }));

    return () => {
      setContentState((prevContentState) => ({
        ...prevContentState,
        openWarning: null,
      }));
    };
  }, []);

  useEffect(() => {
    if (kind === "AudioIcon") {
      if (contentState.recordingType === "region") {
        setOpen(false);
      }
    }
  }, [contentState.recordingType, kind]);

  useEffect(() => {
    if (contentState.recording) {
      setOpen(false);
    }
  }, [contentState.recording]);

  return (
    <ToastEl.Provider swipeDirection="up" duration={duration}>
      <ToastEl.Root
        className="warning-root"
        open={open}
        onOpenChange={setOpen}
        onSwipeEnd={() => {
          setOpen(false);
        }}
      >
        <div className="warning-content">
          <div className="warning-label">NOTICE</div>
          <ToastEl.Title className="warning-title">{title}</ToastEl.Title>
          <ToastEl.Description className="warning-description">
            {description}
          </ToastEl.Description>
        </div>
        <ToastEl.Close
          className="warning-close"
          onClick={() => {
            setOpen(false);
          }}
          aria-label="Dismiss notice"
        >
          <CameraCloseIcon />
        </ToastEl.Close>
      </ToastEl.Root>
      <ToastEl.Viewport className="WarningViewport" />
    </ToastEl.Provider>
  );
};

export default Warning;
