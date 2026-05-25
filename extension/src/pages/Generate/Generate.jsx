import React, { useEffect, useState } from "react";
import { loadRecording, discardRecording } from "./loadRecording";
import { checkAudioSilence } from "./audioCheck";
import { colors, fonts, sizes, space, radius } from "../../design/tokens";

// DECISION (2026-05-15): Post-recording flows all route here (not Screenity's editor)
// because the editor is sandboxed, which complicates chrome.* API usage. This page is
// non-sandboxed and is the permanent destination after Stage D strips the editor.
// Phase 8 visual rebrand: Editorial Manual aesthetic shared with Welcome + Playground.

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

// Arrival animation: page scales in + fades in, mirroring Welcome's close
// transition for design-system coherence. Honors prefers-reduced-motion.
const PAGE_ARRIVAL_MS = 1000;

const Generate = () => {
  const [params, setParams] = useState({});
  const [recording, setRecording] = useState(null);
  const [loadingError, setLoadingError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);

  const [uploadPhase, setUploadPhase] = useState("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const [audioCheck, setAudioCheck] = useState({ status: "idle", silentFraction: 0 });

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const [arrived, setArrived] = useState(false);

  const isUploading =
    uploadPhase === "uploading" || uploadPhase === "processing";

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const obj = Object.fromEntries(searchParams.entries());
    setParams(obj);

    chrome.storage.local.get(["defaultTitle", "backendUrl"], (data) => {
      if (data.defaultTitle) setTitle(data.defaultTitle);
      if (data.backendUrl) setBackendUrl(data.backendUrl);
    });

    (async () => {
      try {
        const result = await loadRecording();
        const blobUrl = URL.createObjectURL(result.blob);
        setRecording({ ...result, blobUrl });
        console.log(
          `Loaded recording from ${result.source}: ${result.blob.size} bytes (${result.mimeType})`
        );
      } catch (err) {
        console.error("Failed to load recording:", err);
        setLoadingError(err.message || "Failed to load the recording.");
      }
    })();
  }, []);

  // Trigger the arrival animation after first paint. Two rAFs guarantee the
  // initial frame (arrived=false → opacity 0, scale 0.85) lands on screen
  // before we switch to arrived=true, so the browser animates the transition
  // rather than skipping straight to the end state.
  useEffect(() => {
    let rafB;
    const rafA = requestAnimationFrame(() => {
      rafB = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(rafA);
      if (rafB) cancelAnimationFrame(rafB);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recording?.blobUrl) URL.revokeObjectURL(recording.blobUrl);
    };
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    setAudioCheck({ status: "checking", silentFraction: 0 });
    checkAudioSilence(recording.blob)
      .then((result) => {
        const pct = Math.round(result.silentFraction * 100);
        if (result.silent) {
          console.warn(`Audio appears silent: ${pct}% of samples below -50 dB`);
          setAudioCheck({ status: "silent", silentFraction: result.silentFraction });
        } else {
          console.log(`Audio check OK: ${pct}% silent samples`);
          setAudioCheck({ status: "ok", silentFraction: result.silentFraction });
        }
      })
      .catch((err) => {
        // Decoder failures shouldn't block the user — treat as "couldn't check".
        console.warn("Audio level check failed:", err);
        setAudioCheck({ status: "failed", silentFraction: 0 });
      });
  }, [recording]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !isUploading) setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen, isUploading]);

  useEffect(() => {
    if (!discardConfirmOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !isDiscarding) setDiscardConfirmOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [discardConfirmOpen, isDiscarding]);

  const handleOpenModal = () => {
    setUploadError("");
    setUploadPhase("idle");
    setUploadProgress(0);
    setPassword("");
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    if (!isUploading) setModalOpen(false);
  };

  const performDiscard = async () => {
    if (isDiscarding) return;
    setIsDiscarding(true);
    if (recording?.blobUrl) {
      URL.revokeObjectURL(recording.blobUrl);
    }
    try {
      await discardRecording();
    } catch (err) {
      console.warn("Discard failed:", err);
    }
    window.close();
  };

  // Silence warning skips the extra confirm modal that the utility-row
  // Discard button uses — the warning panel itself already explains why
  // discarding is the right move.
  const handleDiscard = () => {
    performDiscard();
  };

  const handleDiscardClick = () => {
    setDiscardConfirmOpen(true);
  };

  const handleCancelDiscard = () => {
    if (!isDiscarding) setDiscardConfirmOpen(false);
  };

  const handleConfirmDiscard = () => {
    performDiscard();
  };

  const handleDownloadRecording = () => {
    if (!recording) return;
    const date = new Date().toISOString().slice(0, 10);
    const filename = `recording_${date}.${recording.extension}`;
    // recording.blob is materialized in-memory at load time (see
    // loadRecording.js), so the blob: URL Chrome reads here is stable —
    // no stale OPFS reference. saveAs: true gives the user the Save dialog.
    chrome.downloads.download(
      { url: recording.blobUrl, filename, saveAs: true },
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            "chrome.downloads.download error:",
            chrome.runtime.lastError
          );
        }
      }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!recording) {
      setUploadError("Recording not loaded.");
      return;
    }
    setUploadError("");
    setUploadPhase("uploading");
    setUploadProgress(0);

    try {
      const docxBlob = await uploadRecording({
        blob: recording.blob,
        extension: recording.extension,
        title: title.trim(),
        password,
        backendUrl,
        onProgress: (pct) => setUploadProgress(pct),
        onProcessingStart: () => setUploadPhase("processing"),
      });
      const filename = getDocxFilename(title.trim());
      const docxUrl = URL.createObjectURL(docxBlob);
      await chrome.downloads.download({
        url: docxUrl,
        filename,
        saveAs: false,
      });
      // Intentionally do NOT call discardRecording() here. The recording is
      // kept in IndexedDB / OPFS so the user can retry from the Generate
      // page if the download is lost, the tab is closed prematurely, or the
      // browser crashes between upload-success and download-complete. The
      // recording is bounded to one at a time -- the next recording's
      // preflight clears it (Recorder.jsx chunksStore.clear() calls).
      setTimeout(() => {
        URL.revokeObjectURL(docxUrl);
        window.close();
      }, 1500);
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadError(err.message || "Upload failed.");
      setUploadPhase("error");
    }
  };

  const canSubmit =
    !!recording &&
    title.trim().length > 0 &&
    password.length > 0 &&
    !isUploading;

  const generateDisabled = !recording || audioCheck.status === "silent";

  return (
    <div
      className={
        "ic-generate-page" + (arrived ? " ic-generate-page-arrived" : "")
      }
      style={styles.page}
    >
      <style>{cssRules}</style>

      <main style={styles.container}>
        <header style={styles.versionMark}>
          <span>INSTRUCTIONSCRAFTER</span>
          <span style={styles.versionDot}>·</span>
          <span>RECORDING READY</span>
        </header>

        <h1 style={styles.headline}>
          One recording,
          <br />
          <em style={styles.headlineItalic}>one document.</em>
        </h1>

        <p style={styles.dek}>
          Review the preview, then generate your step-by-step instruction
          document.
        </p>

        <hr style={styles.rule} />

        <section style={styles.previewSection}>
          <div style={styles.previewCaption}>
            <span>PREVIEW</span>
          </div>
          <div style={styles.previewFrame}>
            {recording ? (
              <video src={recording.blobUrl} controls style={styles.video} />
            ) : loadingError ? (
              <div style={styles.previewError}>
                <em style={styles.previewErrorHeading}>
                  Could not load the recording.
                </em>
                <p style={styles.previewErrorBody}>{loadingError}</p>
              </div>
            ) : (
              <em style={styles.previewLoading}>Loading recording…</em>
            )}
          </div>
        </section>

        <hr style={styles.rule} />

        {audioCheck.status === "silent" && (
          <div style={styles.silenceWarning}>
            <h3 style={styles.silenceHeading}>
              This recording appears silent.
            </h3>
            <p style={styles.silenceBody}>
              {Math.round(audioCheck.silentFraction * 100)}% of audio samples
              are at or below -50 dB. Common causes: the microphone was off,
              denied at the OS level, or muted in the recorder.
            </p>
            <p style={styles.silenceBody}>
              Without voice narration this recording cannot be used. Re-record
              while speaking through each step.
            </p>
            <button
              type="button"
              className="ic-generate-danger"
              style={styles.silenceButton}
              onClick={handleDiscard}
            >
              Discard and re-record <span style={styles.buttonArrow}>→</span>
            </button>
          </div>
        )}

        <div style={styles.actions}>
          <button
            type="button"
            className="ic-generate-button"
            style={{
              ...styles.button,
              ...(generateDisabled ? styles.disabledButton : {}),
            }}
            onClick={handleOpenModal}
            disabled={generateDisabled}
            title={
              !recording
                ? "Recording not loaded yet"
                : audioCheck.status === "silent"
                ? "Recording is silent — re-record before generating"
                : ""
            }
          >
            Generate document <span style={styles.buttonArrow}>→</span>
          </button>

          <div style={styles.utilityRow}>
            <button
              type="button"
              className="ic-generate-util"
              style={styles.utilityLink}
              onClick={handleDownloadRecording}
              disabled={!recording}
              title={
                recording
                  ? `Save as .${recording.extension}`
                  : "Recording not loaded yet"
              }
            >
              Download recording
            </button>
            <span style={styles.utilityDot}>·</span>
            <button
              type="button"
              className="ic-generate-util"
              style={styles.utilityLinkMuted}
              onClick={handleDiscardClick}
              disabled={!recording || isDiscarding}
              title={
                recording
                  ? "Permanently delete this recording"
                  : "Recording not loaded yet"
              }
            >
              Discard
            </button>
          </div>
        </div>
      </main>

      {discardConfirmOpen && (
        <div style={styles.backdrop} onClick={handleCancelDiscard}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalHeading}>Discard recording?</h2>
            <p style={styles.modalBody}>
              This will permanently delete the recording. This cannot be
              undone.
            </p>
            <div style={styles.modalActions}>
              <button
                type="button"
                className="ic-generate-ghost"
                style={styles.ghostButton}
                onClick={handleCancelDiscard}
                disabled={isDiscarding}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ic-generate-danger"
                style={{
                  ...styles.dangerButton,
                  ...(isDiscarding ? styles.dangerButtonDisabled : {}),
                }}
                onClick={handleConfirmDiscard}
                disabled={isDiscarding}
                autoFocus
              >
                {isDiscarding ? "Discarding…" : "Discard"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div style={styles.backdrop} onClick={handleCloseModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalHeading}>Generate document</h2>
            <form onSubmit={handleSubmit}>
              <label style={styles.fieldLabel} htmlFor="doc-title">
                DOCUMENT TITLE
              </label>
              <input
                id="doc-title"
                className="ic-generate-input"
                type="text"
                style={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                disabled={isUploading}
                autoFocus
                required
              />

              <label style={styles.fieldLabel} htmlFor="doc-password">
                SHARED PASSWORD
              </label>
              <input
                id="doc-password"
                className="ic-generate-input"
                type="password"
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isUploading}
                required
              />

              {uploadError && <div style={styles.errorBox}>{uploadError}</div>}

              {uploadPhase === "uploading" && (
                <div style={styles.progress}>
                  <div style={styles.progressLabel}>
                    <span>UPLOADING</span>
                    <span style={styles.progressPct}>{uploadProgress}%</span>
                  </div>
                  <div style={styles.progressTrack}>
                    <div
                      style={{
                        ...styles.progressFill,
                        width: `${uploadProgress}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {uploadPhase === "processing" && (
                <div style={styles.progress}>
                  <div style={styles.processingLabel}>
                    <em style={styles.processingEm}>Generating document…</em>
                  </div>
                  <div style={styles.processingHint}>
                    Usually 30–60 seconds for a 5-minute recording.
                  </div>
                </div>
              )}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  className="ic-generate-ghost"
                  style={styles.ghostButton}
                  onClick={handleCloseModal}
                  disabled={isUploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ic-generate-modal-primary"
                  style={{
                    ...styles.modalPrimary,
                    ...(canSubmit ? {} : styles.modalPrimaryDisabled),
                  }}
                  disabled={!canSubmit}
                >
                  {isUploading ? (
                    "Working…"
                  ) : (
                    <>
                      Generate <span style={styles.buttonArrow}>→</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

function uploadRecording({
  blob,
  extension,
  title,
  password,
  backendUrl,
  onProgress,
  onProcessingStart,
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let processingFlagged = false;

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.upload.addEventListener("load", () => {
      if (!processingFlagged) {
        processingFlagged = true;
        onProcessingStart();
      }
    });

    xhr.addEventListener("load", async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        let errorMsg = `Server returned status ${xhr.status}.`;
        try {
          const text = await xhr.response.text();
          const json = JSON.parse(text);
          if (json.error) errorMsg = json.error;
        } catch {
          // Couldn't parse JSON — keep the default message.
        }
        reject(new Error(errorMsg));
      }
    });

    xhr.addEventListener("error", () =>
      reject(
        new Error(`Network error — is the backend running at ${backendUrl}?`)
      )
    );
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted.")));

    xhr.responseType = "blob";
    xhr.open("POST", `${backendUrl}/api/generate`);

    const formData = new FormData();
    formData.append("video", blob, `recording.${extension}`);
    formData.append("title", title);
    formData.append("password", password);
    xhr.send(formData);
  });
}

// Replace non-alphanumeric (except space and hyphen) with underscore.
function sanitizeFilename(title) {
  return title.replace(/[^a-zA-Z0-9 \-]/g, "_").trim() || "document";
}

function getDocxFilename(title) {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilename(title)}_${date}.docx`;
}

const cssRules = `
  body {
    background: ${colors.surface};
    margin: 0;
  }
  /* Subtle paper grain on the surface, same recipe as Welcome/Playground */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.04 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    opacity: 0.5;
    mix-blend-mode: multiply;
    z-index: 0;
  }
  main { position: relative; z-index: 1; }

  /* Arrival animation: mirrors Welcome's close transition in reverse.
     Page starts at scale(0.85) translateY(20px) opacity(0) and animates in. */
  .ic-generate-page {
    opacity: 0;
    transform: scale(0.85) translateY(20px);
    transform-origin: center top;
    transition: opacity ${PAGE_ARRIVAL_MS}ms ease,
      transform ${PAGE_ARRIVAL_MS}ms cubic-bezier(0.4, 0, 0.2, 1);
    min-height: 100vh;
  }
  .ic-generate-page-arrived {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  @media (prefers-reduced-motion: reduce) {
    .ic-generate-page {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }

  /* Primary button: breathing pulse, same as Welcome's "Begin recording".
     animation-delay matches the page arrival duration so the breath doesn't
     compound with the wrapper's scale animation during arrival. */
  @keyframes ic-generate-breath {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.025); }
  }
  .ic-generate-page-arrived .ic-generate-button:not(:disabled) {
    animation: ic-generate-breath 3.5s ease-in-out infinite;
    animation-delay: ${PAGE_ARRIVAL_MS}ms;
  }
  .ic-generate-button:hover:not(:disabled) {
    background: ${colors.accentHover};
  }
  .ic-generate-button:focus-visible {
    outline: 2px solid ${colors.accent};
    outline-offset: 3px;
  }
  .ic-generate-button:active:not(:disabled) {
    transform: translateY(1px);
  }
  @media (prefers-reduced-motion: reduce) {
    .ic-generate-page-arrived .ic-generate-button:not(:disabled) {
      animation: none;
    }
  }

  /* Input focus ring: accent blue with a soft halo */
  .ic-generate-input:focus {
    border-color: ${colors.accent};
    box-shadow: 0 0 0 3px ${colors.accentSoft};
    outline: none;
  }

  /* Ghost button (Cancel in modals) */
  .ic-generate-ghost:hover:not(:disabled) {
    background: ${colors.surface};
    border-color: ${colors.mid};
  }
  .ic-generate-ghost:focus-visible {
    outline: 2px solid ${colors.accent};
    outline-offset: 2px;
  }

  /* Danger button (silence-warning + confirm-discard) */
  .ic-generate-danger:hover:not(:disabled) {
    background: #A22424;
  }
  .ic-generate-danger:focus-visible {
    outline: 2px solid ${colors.danger};
    outline-offset: 2px;
  }

  /* Modal-sized primary button */
  .ic-generate-modal-primary:hover:not(:disabled) {
    background: ${colors.accentHover};
  }
  .ic-generate-modal-primary:focus-visible {
    outline: 2px solid ${colors.accent};
    outline-offset: 2px;
  }

  /* Utility links (Download recording / Discard) */
  .ic-generate-util:hover:not(:disabled) {
    color: ${colors.accent};
    text-decoration-color: ${colors.accent};
  }
  .ic-generate-util:focus-visible {
    outline: 2px solid ${colors.accent};
    outline-offset: 3px;
    border-radius: 2px;
  }
  .ic-generate-util:disabled {
    color: ${colors.hairlineStrong};
    cursor: not-allowed;
    text-decoration-color: ${colors.hairline};
  }
`;

const styles = {
  page: {
    minHeight: "100vh",
    background: colors.surface,
    fontFamily: fonts.body,
    color: colors.ink,
    padding: `${space.xxl}px ${space.l}px ${space.xl}px`,
    boxSizing: "border-box",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  },
  container: {
    maxWidth: 720,
    margin: "0 auto",
  },

  versionMark: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    display: "flex",
    gap: space.xs,
    marginBottom: space.xl,
  },
  versionDot: { color: colors.hairlineStrong },

  headline: {
    fontFamily: fonts.display,
    fontSize: sizes.display,
    fontWeight: 400,
    lineHeight: 0.98,
    color: colors.ink,
    margin: `0 0 ${space.l}px`,
    letterSpacing: "-0.02em",
  },
  headlineItalic: {
    fontStyle: "italic",
    color: colors.accent,
  },

  dek: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 1.55,
    color: colors.ink,
    maxWidth: 540,
    margin: `0 0 ${space.xl}px`,
    fontWeight: 400,
  },

  rule: {
    border: "none",
    borderTop: `1px solid ${colors.hairline}`,
    margin: `${space.xl}px 0`,
  },

  previewSection: {},
  previewCaption: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    display: "flex",
    gap: space.xs,
    marginBottom: space.s,
  },
  previewFrame: {
    background: colors.surfaceRaised,
    border: `1px solid ${colors.hairline}`,
    borderRadius: radius.m,
    aspectRatio: "16 / 9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#000",
  },
  previewLoading: {
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: 20,
    color: colors.mid,
  },
  previewError: {
    padding: space.l,
    textAlign: "center",
    maxWidth: 440,
  },
  previewErrorHeading: {
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: 22,
    color: colors.danger,
    fontWeight: 400,
    display: "block",
    marginBottom: space.xs,
  },
  previewErrorBody: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    color: colors.ink,
    lineHeight: 1.55,
    margin: 0,
  },

  silenceWarning: {
    borderLeft: `2px solid ${colors.danger}`,
    paddingLeft: space.m,
    marginBottom: space.xl,
  },
  silenceHeading: {
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: sizes.h2,
    fontWeight: 400,
    margin: `0 0 ${space.s}px`,
    color: colors.danger,
    letterSpacing: "-0.012em",
  },
  silenceBody: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.65,
    color: colors.ink,
    margin: `0 0 ${space.s}px`,
  },
  silenceButton: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: 600,
    background: colors.danger,
    color: "#fff",
    border: "none",
    borderRadius: radius.s,
    padding: "12px 22px",
    cursor: "pointer",
    marginTop: space.s,
    display: "inline-flex",
    alignItems: "center",
    gap: space.xxs,
    transition: "background 0.15s ease",
  },

  actions: {},
  button: {
    fontFamily: fonts.body,
    fontSize: 18,
    fontWeight: 600,
    background: colors.accent,
    color: "#fff",
    border: "none",
    borderRadius: radius.s,
    padding: "18px 36px",
    cursor: "pointer",
    letterSpacing: "0.005em",
    transition: "background 0.15s ease, box-shadow 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    boxShadow: "0 6px 20px rgba(48, 128, 248, 0.28)",
  },
  buttonArrow: {
    fontFamily: fonts.body,
    fontSize: 20,
    lineHeight: 1,
    transform: "translateY(-1px)",
  },
  disabledButton: {
    background: colors.hairlineStrong,
    color: colors.mid,
    cursor: "not-allowed",
    boxShadow: "none",
  },

  utilityRow: {
    display: "flex",
    alignItems: "center",
    gap: space.s,
    marginTop: space.m,
  },
  utilityLink: {
    background: "none",
    border: "none",
    padding: 0,
    fontFamily: fonts.body,
    fontSize: sizes.body,
    color: colors.ink,
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationColor: colors.hairlineStrong,
    textUnderlineOffset: "3px",
    fontWeight: 500,
    transition: "color 0.15s ease, text-decoration-color 0.15s ease",
  },
  utilityLinkMuted: {
    background: "none",
    border: "none",
    padding: 0,
    fontFamily: fonts.body,
    fontSize: sizes.body,
    color: colors.mid,
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationColor: colors.hairlineStrong,
    textUnderlineOffset: "3px",
    fontWeight: 500,
    transition: "color 0.15s ease, text-decoration-color 0.15s ease",
  },
  utilityDot: {
    fontFamily: fonts.mono,
    color: colors.hairlineStrong,
    userSelect: "none",
  },

  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 17, 28, 0.42)",
    backdropFilter: "blur(2px)",
    WebkitBackdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: colors.surfaceRaised,
    border: `1px solid ${colors.hairline}`,
    borderRadius: radius.m,
    padding: space.l,
    width: "100%",
    maxWidth: 480,
    boxShadow: "0 20px 60px rgba(15, 17, 28, 0.18)",
    fontFamily: fonts.body,
    boxSizing: "border-box",
  },
  modalHeading: {
    fontFamily: fonts.display,
    fontSize: sizes.h2,
    fontWeight: 400,
    margin: `0 0 ${space.m}px`,
    color: colors.ink,
    letterSpacing: "-0.012em",
  },
  modalBody: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.6,
    color: colors.ink,
    margin: `0 0 ${space.m}px`,
  },
  fieldLabel: {
    display: "block",
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    marginTop: space.m,
    marginBottom: space.xs,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    fontFamily: fonts.body,
    fontSize: sizes.body,
    background: "#fff",
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: radius.s,
    color: colors.ink,
    boxSizing: "border-box",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    outline: "none",
  },
  errorBox: {
    background: colors.dangerSoft,
    borderLeft: `2px solid ${colors.danger}`,
    color: colors.danger,
    padding: `${space.s}px ${space.m}px`,
    fontFamily: fonts.body,
    fontSize: sizes.caption,
    marginTop: space.m,
    lineHeight: 1.5,
  },

  progress: {
    marginTop: space.m,
  },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    marginBottom: space.xs,
  },
  progressPct: {
    fontFamily: fonts.mono,
    color: colors.ink,
  },
  progressTrack: {
    width: "100%",
    height: 4,
    background: colors.hairline,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: colors.accent,
    transition: "width 200ms ease-out",
  },
  processingLabel: {
    marginBottom: space.xxs,
  },
  processingEm: {
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: 18,
    color: colors.ink,
    fontWeight: 400,
  },
  processingHint: {
    fontFamily: fonts.body,
    fontSize: sizes.caption,
    color: colors.mid,
  },

  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: space.s,
    marginTop: space.l,
  },
  ghostButton: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: 500,
    background: "transparent",
    color: colors.ink,
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: radius.s,
    padding: "10px 20px",
    cursor: "pointer",
    transition: "background 0.15s ease, border-color 0.15s ease",
  },
  modalPrimary: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: 600,
    background: colors.accent,
    color: "#fff",
    border: "none",
    borderRadius: radius.s,
    padding: "10px 20px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: space.xxs,
    transition: "background 0.15s ease",
  },
  modalPrimaryDisabled: {
    background: colors.hairlineStrong,
    color: colors.mid,
    cursor: "not-allowed",
  },
  dangerButton: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: 600,
    background: colors.danger,
    color: "#fff",
    border: "none",
    borderRadius: radius.s,
    padding: "10px 20px",
    cursor: "pointer",
    transition: "background 0.15s ease",
  },
  dangerButtonDisabled: {
    background: colors.hairlineStrong,
    color: colors.mid,
    cursor: "not-allowed",
  },
};

export default Generate;
