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

**Current phase: Phase 8 in progress — Stages A, B, C, and D complete. A: Screenity fork imported into `extension/`. B: options page, post-recording Generate page, recording-blob loading from OPFS (materialized into memory at load time) / IndexedDB, multipart upload to `/api/generate`, .docx download. C: welcome page replacing Screenity's `setup.html`, permanent toolbar tooltip stating the narration requirement, audio-silence detection both client-side (hard-blocks the Generate button) and backend-side (ffmpeg `volumedetect` gate at -50 dB rejects silent recordings before Whisper hallucinates filler from them), Download recording button, backend CORS middleware. D (6 sub-commits, ARCHITECTURE.md lines 86–98): D1 deleted `Editor/`, `EditorWebCodecs/`, `EditorViewer/`, `Sandbox/` source dirs + GIF export + crash-recovery (~13k lines); D2 deleted `Background/drive/` + `Background/modules/signIn.js` + `oauth2`/`identity` from manifest; D3 removed the countdown on/off toggle (3-second duration was already hardcoded); D4 removed push-to-talk Switch + Alt+Shift+U listeners + state plumbing; D5 deleted `Camera/`, `Content/camera/`, `Content/camera-only/`, MediaPipe `vision_wasm*` assets (~22 MB), camera tab in popup, camera toggle button in toolbar; D6 moved shared OPFS chunk-store (`opfsKvStore.js`, `chooseChunksStore.js`) from `CloudRecorder/recorderStorage/` to `Background/chunkStorage/` then deleted `CloudRecorder/` in full (~9k lines incl. 1701-line BunnyTus uploader + 6132-line CloudRecorder.jsx + encoder/) + `OffscreenRecorder/resumeJournal.js` + OffscreenRecorder cloud-branch. End-to-end verified against local backend. **Dead-code loose ends still in tree (all inert at runtime — gated by `CLOUD_FEATURES_ENABLED=false` in webpack DefinePlugin or no-data conditions): `Background/auth/loginWithWebsite.js`, `Background/listeners/onMessageExternalListener.js`, `Background/recording/restoreCloudRecording.js`, `Background/recording/resumePendingUploads.js`, `Background/index.js` cleanupOrphanOpfsSessions, local-playback-offer machinery in `Background/messaging/handlers.js`, `externally_connectable` manifest block, `isLoggedIn`/`isSubscribed`/`screenityToken` plumbing in Content/*, dead `recordingType === "camera"` branches in `Recorder.jsx`, dead `cameraActive`/`backgroundEffects` state plumbing, unused i18n strings in `_locales/*`, unused npm deps (`@mediapipe/tasks-vision`, `gif.js`, `plyr`, `plyr-react`, `fabric`, `react-advanced-cropper`, `fix-webm-duration`, `webm-duration-fix`, `@sentry/browser`), dead editor-routing branches in `stopRecording.js`.** Next: Phase 7 (deploy backend); the extension's stored `BACKEND_URL` flips from `http://127.0.0.1:8000` to the deployed domain at that point.**
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
