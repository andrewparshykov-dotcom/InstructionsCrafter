import {
  registerMessage,
  messageRouter,
} from "../../../../messaging/messageRouter";
import { setContentState, contentStateRef } from "../ContentState";
import { updateFromStorage } from "../utils/updateFromStorage";

import { checkAuthStatus } from "../utils/checkAuthStatus";
import { traceStep, setStartFlowOutcome } from "../../../utils/startFlowTrace";
import { perfMark } from "../../../utils/perfMarks";

const CLOUD_FEATURES_ENABLED =
  process.env.SCREENITY_ENABLE_CLOUD_FEATURES === "true";

const getState = () => contentStateRef.current;

export const setupHandlers = () => {
  if (window.__instructionsCrafterSetupHandlersRan) return;
  window.__instructionsCrafterSetupHandlersRan = true;
  let lastToggleDrawingAt = 0;
  const TOGGLE_DRAWING_COOLDOWN_MS = 400;
  let projectReadySeq = 0;
  const TRUSTED_APP_ORIGIN = (() => {
    try {
      const appBase = process.env.SCREENITY_APP_BASE;
      return appBase ? new URL(appBase).origin : null;
    } catch {
      return null;
    }
  })();

  const getProjectMessageTargetOrigin = () => {
    if (!TRUSTED_APP_ORIGIN) return null;
    return window.location.origin === TRUSTED_APP_ORIGIN
      ? TRUSTED_APP_ORIGIN
      : null;
  };

  const postProjectHandoff = (payload) => {
    const targetOrigin = getProjectMessageTargetOrigin();
    if (!targetOrigin) {
      console.warn(
        "[InstructionsCrafter][Content] Ignoring project handoff on untrusted origin",
        {
          source: payload?.source || "unknown",
          pageOrigin: window.location.origin,
          trustedOrigin: TRUSTED_APP_ORIGIN,
          projectId: payload?.projectId || null,
        },
      );
      return false;
    }

    window.postMessage(payload, targetOrigin);
    // Replay shortly after to reduce races with late listeners.
    setTimeout(() => {
      window.postMessage(
        {
          ...payload,
          replay: true,
          replayAt: Date.now(),
        },
        targetOrigin,
      );
    }, 250);
    return true;
  };

  // Pending scene-create handoffs awaiting reply from the editor page.
  // Keyed by requestId so concurrent multi-scene flows don't collide.
  const pendingSceneCreates = new Map();

  const onWindowProjectMessage = (event) => {
    if (event.source !== window) return;
    if (event.origin !== TRUSTED_APP_ORIGIN) return;
    const data = event?.data || {};

    if (data?.source === "create-scene-from-recording-result") {
      const pending = pendingSceneCreates.get(data.requestId);
      if (pending) {
        pendingSceneCreates.delete(data.requestId);
        clearTimeout(pending.timeout);
        pending.respond({
          ok: !!data.ok,
          status: data.status ?? 0,
          body: data.body ?? null,
          error: data.error || null,
        });
      }
      return;
    }

  };

  window.addEventListener("message", onWindowProjectMessage);

  if (!window.__instructionsCrafterHandlersInitialized) {
    messageRouter();
    window.__instructionsCrafterHandlersInitialized = true;
  }

  // Bridge from BG to the editor page: BG forwards a scene-create payload
  // here; we postMessage it into the page (same-origin) so the editor's own
  // app code does the API call (cookie auth, no CORS, no SW lifecycle).
  registerMessage("proxy-create-scene", (message, sender) => {
    if (window.location.origin !== TRUSTED_APP_ORIGIN) {
      return { ok: false, error: "untrusted-origin" };
    }
    const { projectId, requestId, payload } = message || {};
    if (!projectId || !requestId || !payload) {
      return { ok: false, error: "invalid-proxy-create-scene" };
    }
    return new Promise((resolve) => {
      const post = () => {
        window.postMessage(
          {
            source: "create-scene-from-recording",
            projectId,
            requestId,
            payload,
          },
          TRUSTED_APP_ORIGIN,
        );
      };
      // Repost on a 500ms cadence in case the editor app's listener
      // isn't mounted yet (?load=true loading shell, async route swap).
      // The pending entry gates against duplicate replies.
      post();
      const repost = setInterval(post, 500);
      const timeout = setTimeout(() => {
        if (pendingSceneCreates.has(requestId)) {
          pendingSceneCreates.delete(requestId);
          clearInterval(repost);
          resolve({ ok: false, error: "editor-no-reply-timeout" });
        }
      }, 15_000);
      pendingSceneCreates.set(requestId, {
        respond: (val) => {
          clearInterval(repost);
          resolve(val);
        },
        timeout,
      });
    });
  });

  registerMessage("time", () => {
    // Timer is driven by ContentState's storage tick;
    // ignore external pushes to avoid jitter/skips.
  });

  registerMessage("toggle-popup", () => {
    setContentState((prev) => ({
      ...prev,
      showExtension: !prev.showExtension,
      hasOpenedBefore: true,
      showPopup: true,
    }));
    setTimer(0);
    updateFromStorage();
  });

  registerMessage("ready-to-record", async () => {
    perfMark("Content ready-to-record.received");
    traceStep("readyToRecordReceived");

    setContentState((prev) => ({
      ...prev,
      showPopup: false,
      showExtension: true,
      preparingRecording: false,
      pendingRecording: true,
    }));

    // BG is source of truth; reading React default would race the user
    // setting and produce double beeps.
    const { countdown: storedCountdown } = await chrome.storage.local.get([
      "countdown",
    ]);
    const state = getState();

    if (storedCountdown) {
      perfMark("Content countdown.start");
      traceStep("countdownStart");
      setContentState((prev) => ({
        ...prev,
        countdownActive: true,
        isCountdownVisible: true,
        countdownCancelled: false,
      }));
      chrome.runtime.sendMessage({ type: "diag-countdown-started" }).catch(() => {});
    } else {
      // countdownCancelled is cleared in startStreaming, so not stale here.
      state.startRecordingAfterCountdown();
    }
  });

  registerMessage("stop-recording-tab", () => {
    const state = getState();
    if (!state.recording) return;
    state.stopRecording();
  });

  registerMessage("toggle-drawing-mode", () => {
    const now = Date.now();
    if (now - lastToggleDrawingAt < TOGGLE_DRAWING_COOLDOWN_MS) {
      return;
    }
    lastToggleDrawingAt = now;
    if (document.hidden || !document.hasFocus()) {
      return;
    }
    if (contentStateRef.current.recordingType === "camera") return;
    const nextDrawingMode = !contentStateRef.current.drawingMode;
    setContentState((prev) => ({
      ...prev,
      drawingMode: nextDrawingMode,
      blurMode: nextDrawingMode ? false : prev.blurMode,
    }));

    registerMessage("toggle-drawing-mode", () => {
      const now = Date.now();
      if (now - lastToggleDrawingAt < TOGGLE_DRAWING_COOLDOWN_MS) return;
      lastToggleDrawingAt = now;
      if (document.hidden || !document.hasFocus()) return;
      if (contentStateRef.current.recordingType === "camera") return;

      const nextDrawingMode = !contentStateRef.current.drawingMode;

      setContentState((prev) => ({
        ...prev,
        drawingMode: nextDrawingMode,
        blurMode: nextDrawingMode ? false : prev.blurMode,
      }));

      chrome.storage.local.set({
        drawingMode: nextDrawingMode,
        ...(nextDrawingMode ? { blurMode: false } : {}),
      });
    });
  });

  registerMessage("toggle-blur-mode", () => {
    if (contentStateRef.current.recordingType === "camera") return;
    const nextBlurMode = !contentStateRef.current.blurMode;
    setContentState((prev) => ({
      ...prev,
      blurMode: nextBlurMode,
      drawingMode: nextBlurMode ? false : prev.drawingMode,
    }));
    chrome.storage.local.set({
      blurMode: nextBlurMode,
      drawingMode: nextBlurMode ? false : contentStateRef.current.drawingMode,
    });
  });

  registerMessage("toggle-hide-ui", () => {
    const nextHideUI = !contentStateRef.current.hideUI;
    setContentState((prev) => ({
      ...prev,
      hideUI: nextHideUI,
      hideToolbar: nextHideUI ? true : prev.hideToolbar,
    }));
    chrome.storage.local.set({
      hideUI: nextHideUI,
      ...(nextHideUI ? { hideToolbar: true } : {}),
    });
  });

  registerMessage("toggle-cursor-mode", () => {
    if (contentStateRef.current.recordingType === "camera") return;
    const state = getState();
    const nextMode =
      contentStateRef.current.cursorMode === "none" ? "cursor" : "";
    if (state?.setToolbarMode) {
      state.setToolbarMode(nextMode);
    } else {
      setContentState((prev) => ({
        ...prev,
        toolbarMode: nextMode,
      }));
    }
  });

  registerMessage("recording-ended", async () => {
    const state = getState();

    // SW restart can leave stale state; double-check storage before reset.
    const { recording, recorderSession, pendingRecording } =
      await chrome.storage.local.get([
        "recording",
        "recorderSession",
        "pendingRecording",
      ]);

    const isActuallyRecording =
      recording || (recorderSession && recorderSession.status === "recording");

    if (isActuallyRecording || pendingRecording) {
      console.warn(
        "Ignoring stale recording-ended message - recording still active",
      );
      return;
    }

    if (!state.showPopup) {
      setContentState((prev) => ({
        ...prev,
        showExtension: false,
        recording: false,
        paused: false,
        pipEnded: false,
        time: 0,
        timer: 0,
      }));
    }
  });

  registerMessage("recording-error", () => {
    setStartFlowOutcome("error");
    setContentState((prev) => ({
      ...prev,
      pendingRecording: false,
      preparingRecording: false,
      recording: false,
      paused: false,
      time: 0,
      timer: 0,
      pipEnded: false,
    }));
    const state = getState();
    if (state && typeof state.openModal === "function") {
      state.openModal(
        chrome.i18n.getMessage("recordingFailedModalTitle"),
        chrome.i18n.getMessage("recordingFailedModalDescription"),
        chrome.i18n.getMessage("permissionsModalDismiss"),
        null,
        () => {},
        () => {},
        null,
        null,
        null,
        false,
      );
    }
  });

  registerMessage("start-stream", () => {
    const state = getState();
    if (
      state.preparingRecording ||
      state.pendingRecording ||
      state.recording ||
      state.pipEnded
    ) {
      console.warn("[InstructionsCrafter][Content] start-stream BLOCKED by guard state:", {
        preparingRecording: state.preparingRecording,
        pendingRecording: state.pendingRecording,
        recording: state.recording,
        pipEnded: state.pipEnded,
      });
      return;
    }

    setContentState((prev) => ({
      ...prev,
      showExtension: true,
      showPopup: true,
    }));

    if (state.recordingType !== "camera") {
      state.startStreaming();
    } else if (state.defaultVideoInput !== "none" && state.cameraActive) {
      state.startStreaming();
    }
  });

  registerMessage("cancel-recording", () => {
    const state = getState();
    state.dismissRecording();
  });

  registerMessage("pause-recording", () => {
    const state = getState();
    if (state.paused) {
      state.resumeRecording();
    } else {
      state.pauseRecording();
    }
  });

  registerMessage("set-surface", (message) => {
    setContentState((prev) => ({
      ...prev,
      surface: message.surface,
    }));
  });

  registerMessage("pip-ended", () => {
    const state = getState();
    if (state.recording || state.pendingRecording) {
      setContentState((prev) => ({
        ...prev,
        pipEnded: true,
      }));
    }
  });

  registerMessage("pip-started", () => {
    const state = getState();
    if (state.recording || state.pendingRecording) {
      setContentState((prev) => ({
        ...prev,
        pipEnded: false,
      }));
    }
  });

  registerMessage("hide-popup-recording", () => {
    setContentState((prev) => ({
      ...prev,
      showPopup: false,
      showExtension: false,
      recording: false,
    }));
  });

  registerMessage("stream-error", () => {
    const state = getState();

    state.openModal(
      chrome.i18n.getMessage("streamErrorModalTitle"),
      chrome.i18n.getMessage("streamErrorModalDescription"),
      chrome.i18n.getMessage("permissionsModalDismiss"),
      null,
      () => {
        state.dismissRecording();
      },
      () => {
        state.dismissRecording();
      },
      null,
      null,
      null,
      false,
    );
  });

  registerMessage("stream-ended-warning", (message) => {
    const state = getState();
    if (state.openToast) {
      state.openToast(
        message.message ||
          chrome.i18n.getMessage("streamEndedWarningToast"),
        () => {},
        10000,
      );
    }
  });

  registerMessage("show-toast", (message) => {
    const state = getState();
    if (typeof state.openToast !== "function") return;
    state.openToast(message?.message || "", () => {}, message?.timeout || 5000);
  });

  registerMessage("backup-error", () => {
    const state = getState();
    state.openModal(
      chrome.i18n.getMessage("backupPermissionFailTitle"),
      chrome.i18n.getMessage("backupPermissionFailDescription"),
      chrome.i18n.getMessage("permissionsModalDismiss"),
      null,
      () => {
        state.dismissRecording();
      },
      () => {
        state.dismissRecording();
      },
      null,
      null,
      null,
      false,
    );
  });

  registerMessage("fast-recorder-hard-fail", () => {
    const state = getState();
    if (typeof state.openModal !== "function") return;

    state.openModal(
      chrome.i18n.getMessage("fastRecorderFailedTitle"),
      chrome.i18n.getMessage("fastRecorderFailedDescription"),
      chrome.i18n.getMessage("downloadAnywayButton"),
      chrome.i18n.getMessage("cancelButton"),
      () => {
        chrome.runtime.sendMessage({ type: "open-download-mp4" });
      },
      () => {},
      null,
      null,
      null,
      true,
    );
  });

  registerMessage("recording-check", (message, sender) => {
    const state = getState();

    if (!message.force) {
      if (!state.showExtension && !state.recording) {
        updateFromStorage(true, sender.id);
      }
    } else {
      // Post-navigation, PiP is destroyed with the old iframe. Set pipEnded
      // so the inline camera overlay shows immediately; "pip-started" will
      // flip it back if the new iframe re-enters PiP.
      setContentState((prev) => ({
        ...prev,
        showExtension: true,
        recording: true,
        pipEnded: true,
      }));
      updateFromStorage(false, sender.id);
    }
  });

  registerMessage("stop-pending", () => {
    setStartFlowOutcome("error");
    setContentState((prev) => ({
      ...prev,
      pendingRecording: false,
      preparingRecording: false,
      pipEnded: false,
    }));
  });

  registerMessage("reopen-popup-multi", (message) => {
    setContentState((prev) => ({
      ...prev,
      showExtension: true,
      showPopup: true,
      preparingRecording: false,
    }));
    updateFromStorage(false, message.senderId);

    setTimeout(() => {
      const state = getState();
      if (state.openToast) {
        state.openToast(chrome.i18n.getMessage("addedToMultiToast"), () => {});
      }
    }, 1000);
  });

  registerMessage("open-popup-project", (message) => {
    setContentState((prev) => ({
      ...prev,
      showExtension: true,
      showPopup: true,
      recordingProjectTitle: message.projectTitle,
      projectId: message.projectId,
      recordingToScene: message.recordingToScene,
      activeSceneId: message.activeSceneId,
    }));

    updateFromStorage(false, message.senderId);

    setTimeout(() => {
      const state = getState();
      if (state.openToast) {
        state.openToast(
          chrome.i18n.getMessage("readyRecordSceneToast"),
          () => {},
        );
      }
    }, 1000);
  });

  registerMessage("time-warning", () => {
    const state = getState();

    if (state.recording && !state.paused) {
      setContentState((prev) => ({
        ...prev,
        timeWarning: true,
      }));

      if (state.openToast) {
        state.openToast(
          chrome.i18n.getMessage("reachingRecordingLimitToast"),
          () => {},
          5000,
        );
      }
    }
  });
  registerMessage("time-stopped", () => {
    const state = getState();
    if (state.recording && !state.paused) {
      setContentState((prev) => ({
        ...prev,
        timeWarning: false,
      }));

      if (state.openToast) {
        state.openToast(
          chrome.i18n.getMessage("recordingLimitReachedToast"),
          () => {},
          5000,
        );
      }
    }
  });

  registerMessage("get-project-info", (message) => {
    const payload = {
      source: "get-project-info",
      requestedAt: Date.now(),
    };
    postProjectHandoff(payload);
  });
  registerMessage("check-auth", async (message) => {
    if (!CLOUD_FEATURES_ENABLED) {
      const { recording } = await chrome.storage.local.get("recording");

      setContentState((prev) => ({
        ...prev,
        isLoggedIn: false,
        screenityUser: null,
        isSubscribed: false,
        proSubscription: null,
        showExtension: true,
        showPopup: !recording,
      }));

      return;
    }

    const result = await checkAuthStatus();

    const { recording } = await chrome.storage.local.get("recording");

    setContentState((prev) => ({
      ...prev,
      isLoggedIn: result.authenticated,
      screenityUser: result.user,
      isSubscribed: result.subscribed,
      proSubscription: result.proSubscription,
      ...(result.authenticated ? { wasLoggedIn: false } : {}),
      showExtension: true,
      showPopup: !recording,
    }));

    if (result.authenticated) {
      // Client-side zoom is unavailable for authenticated users.
      setContentState((prev) => ({
        ...prev,
        onboarding: false,
        showProSplash: false,
        zoomEnabled: false,
      }));

      chrome.storage.local.set({
        zoomEnabled: false,
        wasLoggedIn: false,
      });
    }
  });
  registerMessage("update-project-loading", (message, sender) => {
    window.postMessage(
      { source: "update-project-loading", multiMode: message.multiMode },
      "*",
    );

    if (!message.multiMode) {
      setContentState((prev) => ({
        ...prev,
        showExtension: false,
        showPopup: false,
      }));
    }

    updateFromStorage(true, sender.id);
  });
  registerMessage("update-project-ready", (message, sender) => {
    const projectId = message?.projectId || null;
    if (!projectId) {
      console.warn(
        "[InstructionsCrafter][Content] Ignoring update-project-ready without projectId",
      );
      return;
    }

    projectReadySeq += 1;
    const handoffAt = Date.now();
    const handoffId = `${projectId}:${handoffAt}:${projectReadySeq}`;

    const posted = postProjectHandoff({
      source: "update-project-ready",
      share: message.share,
      newProject: message.newProject,
      sceneId: message.sceneId,
      projectId,
      handoffAt,
      handoffId,
      handoffSeq: projectReadySeq,
      forceRefresh: true,
    });

    if (posted) {
      window.__instructionsCrafterLastProjectReady = {
        projectId,
        sceneId: message.sceneId || null,
        handoffAt,
        handoffId,
      };
      updateFromStorage(false, sender?.id);
    }
  });
  registerMessage("clear-project-recording", (message) => {
    updateFromStorage(false, message.senderId);
  });
  registerMessage("preparing-recording", () => {
    traceStep("preparingReceived");
    setContentState((prev) => ({
      ...prev,
      preparingRecording: true,
      showExtension: true,
      showPopup: false,
    }));
  });
};
