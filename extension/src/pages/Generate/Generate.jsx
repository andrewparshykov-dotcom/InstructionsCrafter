import React, { useEffect, useState } from "react";
import { loadRecording } from "./loadRecording";
import { checkAudioSilence } from "./audioCheck";

// DECISION (2026-05-15): Post-recording flows all route here (not Screenity's editor)
// because the editor is sandboxed, which complicates chrome.* API usage. This page is
// non-sandboxed and is the permanent destination after Stage D strips the editor.
// Phase 8 status: B1 page skeleton + B2 modal UI + B3 blob loading and upload.

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

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

  const handleDiscard = () => {
    window.close();
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

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Recording ready</h1>
      <p style={styles.subheading}>
        Review the preview, then generate your step-by-step instruction document.
      </p>

      <div style={styles.previewArea}>
        {recording ? (
          <video src={recording.blobUrl} controls style={styles.video} />
        ) : loadingError ? (
          <div style={styles.previewError}>
            <strong>Could not load the recording.</strong>
            <p style={{ margin: "8px 0 0", fontSize: 13 }}>{loadingError}</p>
          </div>
        ) : (
          <div style={styles.previewLoading}>Loading recording…</div>
        )}
      </div>

      {audioCheck.status === "silent" && (
        <div style={styles.silenceWarning}>
          <h3 style={styles.silenceWarningHeading}>
            This recording appears silent
          </h3>
          <p style={styles.silenceWarningBody}>
            {Math.round(audioCheck.silentFraction * 100)}% of audio samples are
            at or below -50 dB. Common causes: microphone was off, denied at
            the OS level, or muted in the recorder.
          </p>
          <p style={styles.silenceWarningBody}>
            Without voice narration this recording cannot be used. Re-record
            while speaking through each step.
          </p>
          <div style={styles.silenceWarningActions}>
            <button
              style={{ ...styles.button, ...styles.primary }}
              onClick={handleDiscard}
            >
              Discard and re-record
            </button>
          </div>
        </div>
      )}

      <div style={styles.actions}>
        <button
          style={{
            ...styles.button,
            ...styles.primary,
            ...(recording && audioCheck.status !== "silent"
              ? {}
              : styles.disabledButton),
          }}
          onClick={handleOpenModal}
          disabled={!recording || audioCheck.status === "silent"}
          title={
            !recording
              ? "Recording not loaded yet"
              : audioCheck.status === "silent"
              ? "Recording is silent — re-record before generating"
              : ""
          }
        >
          Generate Instruction Document
        </button>
        <button
          style={{
            ...styles.button,
            ...styles.secondary,
            ...(recording ? {} : styles.disabledButton),
          }}
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
      </div>

      {modalOpen && (
        <div style={styles.backdrop} onClick={handleCloseModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalHeading}>Generate Instruction Document</h2>
            <form onSubmit={handleSubmit}>
              <label style={styles.label} htmlFor="doc-title">
                Document title
              </label>
              <input
                id="doc-title"
                type="text"
                style={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                disabled={isUploading}
                autoFocus
                required
              />

              <label style={styles.label} htmlFor="doc-password">
                Shared password
              </label>
              <input
                id="doc-password"
                type="password"
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isUploading}
                required
              />

              {uploadError && <div style={styles.error}>{uploadError}</div>}

              {uploadPhase === "uploading" && (
                <div style={styles.progress}>
                  <div>Uploading… {uploadProgress}%</div>
                  <div style={styles.progressBarTrack}>
                    <div
                      style={{
                        ...styles.progressBarFill,
                        width: `${uploadProgress}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {uploadPhase === "processing" && (
                <div style={styles.progress}>
                  <div>Upload complete. Generating document…</div>
                  <div style={styles.progressHint}>
                    Usually 30–60 seconds for a 5-minute recording.
                  </div>
                </div>
              )}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  style={{ ...styles.button, ...styles.secondary }}
                  onClick={handleCloseModal}
                  disabled={isUploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    ...styles.button,
                    ...styles.primary,
                    ...(canSubmit ? {} : styles.disabledButton),
                  }}
                  disabled={!canSubmit}
                >
                  {isUploading ? "Working…" : "Generate"}
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

// Per ARCHITECTURE.md: replace non-alphanumeric (except space and hyphen) with underscore.
function sanitizeFilename(title) {
  return title.replace(/[^a-zA-Z0-9 \-]/g, "_").trim() || "document";
}

function getDocxFilename(title) {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilename(title)}_${date}.docx`;
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    maxWidth: 720,
    margin: "0 auto",
    padding: 32,
    color: "#222",
  },
  heading: { fontSize: 22, margin: "0 0 8px" },
  subheading: { color: "#666", margin: "0 0 24px" },
  previewArea: {
    background: "#f0f0f0",
    border: "1px dashed #bbb",
    borderRadius: 8,
    aspectRatio: "16 / 9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    overflow: "hidden",
  },
  previewLoading: { color: "#888", fontSize: 14 },
  previewError: { padding: 24, textAlign: "center", color: "#a33" },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#000",
  },
  actions: { display: "flex", gap: 12, alignItems: "center" },
  button: {
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid #888",
    borderRadius: 6,
  },
  primary: { background: "#2a7", color: "#fff", borderColor: "#2a7" },
  secondary: { background: "#f6f6f6", color: "#222" },
  disabledButton: {
    background: "#e5e5e5",
    color: "#999",
    borderColor: "#d0d0d0",
    cursor: "not-allowed",
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "#fff",
    borderRadius: 8,
    padding: 24,
    width: "100%",
    maxWidth: 440,
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
  },
  modalHeading: { fontSize: 18, margin: "0 0 16px" },
  label: {
    display: "block",
    fontWeight: 600,
    fontSize: 13,
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    width: "100%",
    padding: 8,
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    boxSizing: "border-box",
  },
  error: {
    background: "#fde7e7",
    border: "1px solid #f5b3b3",
    color: "#a33",
    padding: 10,
    borderRadius: 4,
    fontSize: 13,
    marginTop: 16,
  },
  progress: { color: "#555", fontSize: 13, marginTop: 16 },
  progressHint: { fontSize: 12, color: "#888", marginTop: 4 },
  progressBarTrack: {
    width: "100%",
    height: 6,
    background: "#e5e5e5",
    borderRadius: 3,
    marginTop: 8,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    background: "#2a7",
    transition: "width 200ms ease-out",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 20,
  },
  silenceWarning: {
    background: "#fff4e0",
    border: "2px solid #e89800",
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  silenceWarningHeading: {
    fontSize: 16,
    margin: "0 0 8px",
    color: "#8a4a00",
  },
  silenceWarningBody: {
    fontSize: 13,
    margin: "0 0 8px",
    color: "#444",
    lineHeight: 1.5,
  },
  silenceWarningActions: {
    display: "flex",
    gap: 8,
    marginTop: 12,
  },
};

export default Generate;
