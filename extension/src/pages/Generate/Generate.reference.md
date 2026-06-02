# `Generate.jsx` — reference / index

Index for the Generate page (the post-recording screen: preview → "Generate document").
It is the single destination for **both** capture modes:

- **`video`** — narrated screen recording → uploaded to `POST /api/generate`.
- **`clicks`** — Click-capture screenshots (+ optional narration) → `POST /api/generate-clicks`.

The mode is decided on mount from `chrome.storage.local.lastRecordingMode`.

> Line numbers are approximate and drift as the file changes — search by symbol name if a
> number looks off. File is ~1,500 lines; this index keeps it navigable.

Related files:
- `loadRecording.js` — `loadRecording()` (video), `loadClickCapture()` (clicks), `discardRecording()`.
- `ScreenshotEditor.jsx` — the Click-capture screenshot editor (blur/arrow/pen) opened from the strip.
- `audioCheck.js` — `checkAudioSilence()` used for the video silence warning.

---

## Module-level constants

| Line | Name | Purpose |
|---|---|---|
| 14 | `DEFAULT_BACKEND_URL` | `"https://instructionscrafter.com"` — overridden by `storage.backendUrl` (Options page). |
| 18 | `PAGE_ARRIVAL_MS` | Arrival animation duration (1000 ms). |

## Component `Generate` (line 20)

### State (21–52)
- **Loading/params:** `params` (21), `recording` (22, video blob+meta), `loadingError` (23).
- **Mode + clicks data:** `mode` (26, `"video"|"clicks"`), `clickShots` (27, `[{blob,label,x,y,dpr,order}]`), `clickAudio` (28), `shotUrls` (29, thumbnail object URLs).
- **Screenshot editor:** `edits` (34, `{ [index]: {annotations, blob, url} }`), `editorIndex` (35, open shot or `null`), `editsRef` (36, mirror of `edits` for unmount URL cleanup).
- **Generate modal/form:** `modalOpen` (38), `title` (39), `password` (40), `backendUrl` (41).
- **Upload:** `uploadPhase` (43, `idle|uploading|processing|error`), `uploadProgress` (44), `uploadError` (45).
- **Other:** `audioCheck` (47), `discardConfirmOpen` (49), `isDiscarding` (50), `arrived` (52, animation).

### Derived flags (computed before `return`)
- `isUploading` (54) — `uploadPhase` is uploading/processing.
- `hasContent` (357) — clicks: ≥1 shot; video: recording loaded.
- `canSubmit` (359) — content + title + password + not uploading.
- `generateDisabled` (367) — no content, or (video only) audio is silent.

### Effects (57–183)
| Line | Does |
|---|---|
| 57 | **Mount load.** Reads URL params + `storage` (defaultTitle/backendUrl/sharedPassword). Branches on `lastRecordingMode` (78): `clicks` → `loadClickCapture()` (82); else `loadRecording()` (92). |
| 110 | Arrival animation (two rAF → `arrived=true`). |
| 121 | Revoke `recording.blobUrl` on unmount. |
| 127 | Revoke `shotUrls` on unmount. |
| 135 | Mirror `edits` → `editsRef` (136). |
| 138 | Revoke edited-screenshot object URLs on unmount (140). |
| 146 | Audio silence check (**video only**) → `audioCheck`. |
| 167 | `Esc` closes the generate modal (when not uploading). |
| 176 | `Esc` closes the discard-confirm modal. |

### Handlers
| Line | Name | Notes |
|---|---|---|
| 185 | `handleOpenModal` | Opens generate modal; does **not** clear pre-filled password. |
| 195 | `handleCloseModal` | Close unless uploading. |
| 199 | `performDiscard` | `discardRecording()` then `window.close()`. |
| 216 | `handleDiscard` | Silence-warning discard (skips confirm). |
| 220/224/228 | `handleDiscardClick` / `handleCancelDiscard` / `handleConfirmDiscard` | Confirm-modal wiring. |
| 232 | `handleDownloadRecording` | Save the raw recording (video mode). |
| 252 | `handleSubmitClicks` | **Clicks upload.** Builds `shotsToSend` = edited blob where `edits[i]` exists, else original (262 area), → `uploadClickCapture`. Saves password on success; clears on 401. |
| 290 | `handleSubmit` | Form submit. Clicks → `handleSubmitClicks`; video → reads `clickLog` from storage, → `uploadRecording`. |

### Render (return at 370)
| Line | Section |
|---|---|
| 379 | `<main>` container |
| 380 | `<header>` version mark |
| 399 | `previewSection` |
| 416 | **Clicks:** `stripFrame` — thumbnail strip; each thumb is a `<button>` (421 map) that sets `editorIndex` to open the editor. Shows `EDITED` badge + hover "Edit" hint. |
| 467 | **Video:** `previewFrame` — `<video>` preview |
| 487 | `silenceWarning` (video, silent audio) |
| 511 | `actions` — Generate button + utility row (Download/Discard) |
| 570 | Discard-confirm modal |
| 606 | Generate modal (title + password form, progress UI) |
| 704 | `<ScreenshotEditor>` mount — clicks editor; `onSave(annotations, blob)` stores into `edits[editorIndex]` (revoking the old URL) and closes. |

## Module helpers (outside the component)
| Line | Name | Notes |
|---|---|---|
| 731 | `uploadRecording({...})` | XHR `POST /api/generate`. FormData: `video`, `title`, `password`, optional `clicklog`. Progress + processing events. |
| 800 | `uploadClickCapture({...})` | XHR `POST /api/generate-clicks`. FormData: `title`, `password`, `meta` (JSON array of `{label,x,y,dpr,marker}` per shot), `shots` (`shot_NNNN.jpg`), optional `audio` (`narration.webm/ogg`). |
| 883 | `sanitizeFilename(title)` | Strips non-alphanumerics. |
| 887 | `getDocxFilename(title)` | `<title>_<YYYY-MM-DD>.docx`. |
| 892 | `cssRules` | Page CSS template string (animations, button states, `.ic-thumb` hover). |
| 1026 | `styles` | Inline style objects. |

## Key logic / gotchas
- **Originals are never mutated.** The screenshot editor stores per-shot edits in `edits`; `clickShots[i].blob` stays the original. Upload sends the **edited** blob where present, so redacted (blurred) pixels never leave the browser. See `ScreenshotEditor.jsx`.
- **Click metadata is preserved** through editing: `handleSubmitClicks` spreads `{...s, blob}` so `label/x/y/dpr/marker` are unchanged → the backend still places its click-marker correctly (the editor exports at the original pixel size).
- **Password UX:** pre-filled from `storage.sharedPassword`, saved only on HTTP 2xx, cleared on 401 (handles team rotation).
- **Silence** blocks only the video path (narration required there); Click-capture narration is optional, so silence never blocks.
- **XHR (not fetch)** is used for upload-progress + a "processing" phase flagged on the upload `load` event.
