# InstructionsCrafter — Project Instructions

## What this project is

A tool that turns a screen recording with voice narration into a polished Microsoft Word step-by-step instruction document. A Chrome extension (forked from Screenity) records screen + audio and uploads to a FastAPI backend, which transcribes the audio with OpenAI Whisper, segments it into logical steps, extracts one screenshot per step, polishes the narration with GPT-4o mini, and returns a `.docx` file. No long-term storage.

## Source of truth

**Full specification: `ARCHITECTURE.md`** in the project root.
Read it before making design decisions. Do not rewrite or duplicate the plan it contains.

## Critical principles (from ARCHITECTURE.md — must follow)

1. **Reuse over rewrite.** Assemble existing libraries with glue code. Do not reimplement what reputable libraries already do.
2. **Prefer boring technology.** FastAPI, FFmpeg, python-docx-template, OpenAI APIs. No exotic frameworks.
3. **Target 1,000–1,500 lines of custom code total.** Code growing far beyond this signals over-engineering.
4. **Internal tool for ≤5 users.** No multi-tenancy, RBAC, microservices, or enterprise observability.
5. **No long-term storage.** Videos and generated documents are deleted after each request. No database for user content.
6. **Ask before inventing.** If a requirement is ambiguous, state the interpretation explicitly before implementing.

## Development workflow

Work through the 9 phases in `ARCHITECTURE.md` **sequentially**. Do not start phase N+1 until phase N is verified working end-to-end per its listed verification step.

**Current phase: Phase 8 in progress — Stages A, B, C, D, and E complete. A: Screenity fork imported into `extension/`. B: options page, post-recording Generate page, recording-blob loading from OPFS (materialized into memory at load time) / IndexedDB, multipart upload to `/api/generate`, .docx download. C: welcome page replacing Screenity's `setup.html`, permanent toolbar tooltip stating the narration requirement, audio-silence detection both client-side (hard-blocks the Generate button) and backend-side (ffmpeg `volumedetect` gate at -50 dB rejects silent recordings before Whisper hallucinates filler from them), Download recording button, backend CORS middleware. D (6 sub-commits, ARCHITECTURE.md lines 86–98): D1 deleted `Editor/`, `EditorWebCodecs/`, `EditorViewer/`, `Sandbox/` source dirs + GIF export + crash-recovery (~13k lines); D2 deleted `Background/drive/` + `Background/modules/signIn.js` + `oauth2`/`identity` from manifest; D3 removed the countdown on/off toggle (3-second duration was already hardcoded); D4 removed push-to-talk Switch + Alt+Shift+U listeners + state plumbing; D5 deleted `Camera/`, `Content/camera/`, `Content/camera-only/`, MediaPipe `vision_wasm*` assets (~22 MB), camera tab in popup, camera toggle button in toolbar; D6 moved shared OPFS chunk-store from `CloudRecorder/recorderStorage/` to `Background/chunkStorage/` then deleted `CloudRecorder/` in full (~9k lines) + `OffscreenRecorder/resumeJournal.js` + OffscreenRecorder cloud-branch. E (5 sub-commits, "surface cleanup"): E1 dropped `externally_connectable` from manifest; E2 flattened dead `recordingType === "camera"` branches in `Recorder.jsx`, dead `editorUrl === "editorviewer.html"` branch + duplicate-string ternary in `stopRecording.js`, and three `disabled={...camera}` props on toolbar `ToolTrigger`s; E3 deleted orphan `Setup/` (Stage C replaced its trigger with `Welcome/`) and the now-dead setup.html filter checks across `openRecorderTab.js`, `onActionButtonClickedListener.js`, `onCommandListener.js`, `Wrapper.jsx`, manifest, webpack — kept `Playground/` and `Backup/` after audit (both still actively opened); E4 stripped 173 unused i18n keys × 18 locales (~12k lines deleted; detected via `getMessage("KEY")` cross-reference); E5 npm-uninstalled 8 unused deps (`@mediapipe/tasks-vision`, `gif.js`, `plyr`, `plyr-react`, `react-advanced-cropper`, `fix-webm-duration`, `webm-duration-fix`, `@sentry/browser`) — kept `fabric` (still used by `Content/canvas/` for in-recording annotation overlay). End-to-end verified against local backend. **Deferred to Phase 9 polish (all inert at runtime via `CLOUD_FEATURES_ENABLED=false` or no-data conditions; cleanup touches Background messaging surface so deferred until after Phase 7 deploy verification): `Background/auth/loginWithWebsite.js` + 3 callers, `Background/listeners/onMessageExternalListener.js`, `Background/recording/restoreCloudRecording.js`, `Background/recording/resumePendingUploads.js`, `Background/index.js` cleanupOrphanOpfsSessions, local-playback-offer machinery in `Background/messaging/handlers.js` (~200 lines + 4-5 Content/context senders), `isLoggedIn`/`isSubscribed`/`screenityToken` state plumbing in Content/* (gates ~50+ UI branches; risk of breaking popup layout if flattened sloppily), `cameraActive`/`backgroundEffects` state plumbing.** Next: Phase 7 (deploy backend); the extension's stored `BACKEND_URL` flips from `http://127.0.0.1:8000` to the deployed domain at that point.**
Update this line whenever the current phase changes.

## Tech stack (see ARCHITECTURE.md for full list)

- **Backend:** Python 3.11+, FastAPI, Uvicorn
- **Media processing:** FFmpeg (invoked via `subprocess`, not a wrapper library)
- **AI services:** OpenAI Whisper API, OpenAI GPT-4o mini API
- **Document generation:** python-docx-template, Pillow
- **Frontend:** Chrome extension forked from Screenity (GPLv3, internal-use only)
- **Deployment:** Single Hetzner CPX22 (Ubuntu 24.04) via systemd + nginx + certbot

## Behavior notes for Claude

- When a decision is not covered by `ARCHITECTURE.md`, make the simplest choice consistent with the critical principles above, and leave a `# DECISION: <explanation>` comment at the point of decision in the code.
- At the end of each phase, summarize any such decisions made during that phase.
- Shared password auth only — never add OAuth, user accounts, or permission systems without explicit approval.
- The user is a newcomer to programming (see `~/.claude/CLAUDE.md` for global preferences). Use simple language, provide step-by-step commands, and ask for approval before refactoring.
