# Chrome Web Store submission guide (unlisted)

Step-by-step guide for publishing InstructionsCrafter to the Chrome Web Store as an **unlisted** extension (private install link, not searchable, $5 one-time developer registration).

> **Current product (keep this listing in sync):** InstructionsCrafter sends a capture to a self-hosted backend that uses **one Google Gemini call** to write a step-by-step Microsoft Word document. There are **two capture modes**:
> - **Narrated video** — record the screen or a window and talk through the steps (Gemini watches the video + audio).
> - **Click capture** — browser-only; the extension screenshots each meaningful click (narration optional) and Gemini writes one imperative step per screenshot. Screenshots can be blurred/redacted/annotated in the browser before upload.
>
> This replaces the old Groq-Whisper + OpenAI-GPT pipeline. The `tabCapture` and `clipboardWrite` permissions have been removed. Target version for the next submission: **1.1.0**.

---

## ⚠️ Read first: GPLv3 obligations

InstructionsCrafter is **forked from Screenity (GPLv3)**. Publishing the extension to the Chrome Web Store counts as "distribution" under GPLv3, which triggers obligations the "internal-tool only" framing does **not** require:

- **Source code disclosure.** Every recipient (anyone who installs from the unlisted link) must be able to obtain the complete corresponding source code. Easiest path: keep the GitHub repo public, link it from the store listing, and from the extension's Options page / "About" section.
- **License notice.** The extension's UI or About page must surface a "this software is licensed under GPLv3" notice with a link to the license text.
- **No additional restrictions.** You can't add a click-through EULA that contradicts GPLv3 terms.

The repo is already public (https://github.com/andrewparshykov-dotcom/InstructionsCrafter) and the About section carries the GPLv3 notice, so these are satisfied.

---

## Step 1: Developer account

Already done — the item exists under the team's developer account (one-time $5 fee paid). **Production extension ID: `fcogglgcploggfgchifbeaoofljfgmoc`.** For a brand-new account: open https://chrome.google.com/webstore/devconsole, sign in, pay the $5, accept the agreement.

---

## Step 2: Privacy policy

The privacy policy is **already written and hosted**: `backend/templates/privacy.html`, served by FastAPI at **https://instructionscrafter.com/privacy** (route in `backend/app/main.py`). It is Gemini-accurate.

> ⚠️ **Update before resubmit:** the live policy currently describes only the **narrated-video** pipeline ("the entire recording — video and audio" → Gemini). Add a short paragraph for **Click-capture mode**: the extension uploads a **screenshot of the page for each click** (plus the click's on-screen label) to the backend → Gemini, and the user can **blur/redact/annotate each screenshot in the browser before it is uploaded**, so redacted pixels never leave the device. Keep the existing "paid Gemini tier → Google does not train on the content" and "deleted after processing" wording.

Hosting reference (if the URL ever needs to move):
- **Option A (current):** the FastAPI `/privacy` route returns `backend/templates/privacy.html`.
- **Option B:** push the policy to the public GitHub repo and use the rendered URL.

---

## Step 3: Build the upload ZIP

The Chrome Web Store expects a ZIP of the **production build**, not `src/`.

1. Bump the version in **both** `extension/src/manifest.json` and `extension/package.json` (e.g. `1.0.0` → `1.1.0` — the GPT→Gemini change plus Click-capture mode is a real feature release).
2. From `extension/`, produce the zip:

```bash
cd extension
npm run build:cws        # production build + zips to build-cws.zip (runs nothing else)
# — or —
npm run release:cws      # build:cws + the CWS preflight check, then uploads via the API
```

`build:cws` writes `extension/build-cws.zip`. (`release:cws` also uploads it straight to the item with `chrome-webstore-upload`; `release:cws:publish` then publishes. See `docs`/memory for the credentialed flow.)

---

## Step 4: Store listing copy

Paste these into the developer console.

### Short description (≤132 characters)

```
Turn a screen recording or a series of clicks into a polished step-by-step Microsoft Word how-to. Narration optional.
```

(117 chars — under the limit.)

### Long description (≤4000 characters)

```
InstructionsCrafter turns a quick demonstration into a finished Microsoft Word step-by-step instruction document — the fastest way to turn "let me show you how this works" into a polished, shareable how-to.

Two ways to capture:
• Narrated video — record your screen or a window and talk through the steps.
• Click capture — work through a task in your browser; the extension snaps a clean screenshot of each meaningful click. Narration is optional.

When you stop, your capture is uploaded to your team's own backend, which uses Google Gemini to watch (or read) it and write the document in a single pass: a short introduction plus one clear, imperative step per action, each with its screenshot. The finished .docx downloads in your browser.

Built for internal teams:
• No accounts, no cloud storage of your recordings, no telemetry — files are processed once, then deleted on the server.
• A single shared password gates the backend.
• In Click-capture mode you can blur/redact, add arrows, or draw on any screenshot before it is uploaded — sensitive details never leave your browser.
• Multilingual — narrate in any language and get a clean document in English.

Privacy: https://instructionscrafter.com/privacy
Source code (GPLv3): https://github.com/andrewparshykov-dotcom/InstructionsCrafter
```

### Single purpose statement (≤1000 characters)

```
InstructionsCrafter records the user's screen (with optional microphone narration) or captures a screenshot of each click the user makes, uploads the capture to a self-hosted backend that uses Google Gemini to turn it into a step-by-step Microsoft Word document, and downloads that document. All other capabilities (storage, downloads, screen capture, offscreen audio, scripting) directly support this single recording → document workflow.
```

### Release notes (for the "What's new" / version notes field)

```
v1.1.0
• New: Click-capture mode — build a how-to from your clicks. Each meaningful click is screenshotted (narration optional), with an in-browser blur / arrow / pen editor to redact screenshots before they upload.
• Document generation now uses Google Gemini in a single pass (replaces the previous transcription + GPT pipeline).
• Narrated-video mode records the screen or a window.
• Removed permissions the extension no longer uses (clipboardWrite, tabCapture).
```

### Category

**Productivity**

### Language

English (United States) — `en-US`

---

## Step 5: Permission justifications

Justify each permission the manifest requests (≤1000 chars each). The current manifest requests: `host_permissions: ["<all_urls>"]`; `permissions: [storage, unlimitedStorage, downloads, tabs, scripting, system.display]`; `optional_permissions: [offscreen, desktopCapture, alarms]`.

> ⚠️ **Remove `activeTab` from the manifest before building the resubmission.** A code audit found nothing uses the `activeTab` *permission* — the only `activeTab` references in the source are a `chrome.storage.local` key that stores a tab id, and `<all_urls>` already grants everything `activeTab` would. Shipping an unused permission is exactly what got v1.0.0 rejected, so drop it (no justification needed once removed).

### `host_permissions: ["<all_urls>"]`

```
The content script runs on every page so the recorder UI and per-click logging work wherever the user chooses to record. In Click-capture mode the extension calls chrome.tabs.captureVisibleTab to screenshot the page the user is demonstrating, and reads the accessible name/role of the clicked element to label each step. <all_urls> is what authorizes capturing and scripting the active page. The extension collects no page content beyond the screenshots and click labels needed to build the requested document, and sends nothing anywhere except the user's own backend.
```

### `storage`

```
chrome.storage.local persists user settings (backend URL, optional default document title, shared password cached after a successful run) and short-lived recording state (session id, capture mode, in-progress chunk references, live click log). All values are local to the user's profile; nothing is synced to Google or uploaded.
```

### `unlimitedStorage`

```
In narrated-video mode the recording is buffered to IndexedDB / OPFS in 1–5 MB chunks until the user clicks Stop, then concatenated into one upload and wiped. unlimitedStorage prevents Chrome from throttling or evicting that buffer for recordings longer than a few minutes.
```

### `downloads`

```
After the backend returns the generated .docx, the extension uses chrome.downloads.download() to save it under {sanitized_title}_{YYYY-MM-DD}.docx in the user's default Downloads folder.
```

### `tabs`

```
Used across the recording lifecycle: opening the post-recording Generate page when the user stops (chrome.tabs.create), identifying/focusing the recording vs. active tab, detecting when the recorded tab closes mid-recording, and messaging the content script. Tab URL/title (the 'tabs'-gated fields) are read only to manage the recording tab; no tab metadata is logged or transmitted.
```

### `scripting`

```
chrome.scripting.executeScript injects a tiny helper into the recording tab on demand: to read window.innerWidth/innerHeight when mapping click coordinates to the page viewport, and to re-inject the content script after a mid-recording navigation so the recorder UI reappears. No script is injected into pages outside an active recording.
```

### `system.display`

```
chrome.system.display.getInfo() is called during a multi-monitor recording to translate a click's page-relative coordinates to monitor-relative coordinates so they line up with the recorded video frame. Used only during an active recording session.
```

### `optional_permissions: [offscreen, desktopCapture, alarms]`

Requested at runtime, not up-front:
```
offscreen: hosts the MediaRecorder/WebCodecs encoder and the microphone-narration recorder off the visible tab so recording continues when the tab is backgrounded.
desktopCapture: shows Chrome's native screen/window picker when the user starts a narrated-video recording.
alarms: keeps the service worker awake during long recordings via periodic chrome.alarms heartbeats.
```

### `commands` (not a permission — no justification needed)

`chrome.commands` provides the optional **Alt+Shift+S** "capture the current screen now" hotkey in Click-capture mode (rebindable at `chrome://extensions/shortcuts`). It does not require a permission entry or justification.

---

## Step 6: Data usage disclosures

In the developer console's "Privacy practices" section:

| Data category | Collected? | Notes |
|---|---|---|
| Personally identifiable info | No | We do not collect name, email, address, etc. |
| Health info | No | — |
| Financial info | No | — |
| Authentication info | **Yes** | A shared password is entered per request, sent only to the team's backend, and cached in `chrome.storage.local` for convenience (cleared if the server rejects it or on uninstall). |
| Personal communications | No | — |
| Location | No | — |
| Web history | No | We do not track or transmit browsing history. |
| User activity | **Yes** | Screen + microphone recording, click timing and the on-screen labels of clicked controls, and (in Click-capture mode) a screenshot per click. Sent to the team's backend, processed once, deleted. |
| Website content | **Yes** | Click-capture mode uploads screenshots of the page being demonstrated (and narrated-video mode records the screen). The user can blur/redact any screenshot in the browser before it uploads. |

Check the boxes:
- ☑ **I do not sell or transfer user data to third parties, apart from the approved use cases** — the only third party is **Google (Gemini API)**, which receives the capture solely to generate the requested document (paid tier: Google does not train on the content).
- ☑ **I do not use or transfer user data for purposes unrelated to my item's single purpose.**
- ☑ **I do not use or transfer user data to determine creditworthiness or for lending purposes.**

---

## Step 7: Screenshots

Chrome Web Store requires **at least 1**, allows up to 5, preferred size **1280 × 800**. The current set in `docs/store-screenshots/` (`01`–`06-cws.png`, dated May 2026) is **stale** — it predates Gemini and Click-capture mode and still shows the removed "Chrome Tab" share option. Recapture before resubmit.

Suggested order for the refreshed set:

1. **Popup with the Video | Click-capture toggle** — show that the extension does both.
2. **Narrated-video recording** — the in-page recorder toolbar over a sample page, or Chrome's screen/window picker (**Entire Screen / Window only** — no "Chrome Tab").
3. **Click-capture recording in progress** — a real web app with the **toolbar badge** showing the live capture count (the recording indicator lives on the extension icon, *not* in the page, so nothing pollutes the screenshots).
4. **Generate page with the screenshot editor** — the captured-clicks strip with the **blur / arrow / pen** editor open on one screenshot.
5. **Generate dialog** — the document title + shared password modal.
6. **A generated .docx** — open the produced Word document showing the title + 2–3 steps with screenshots.

Capture on macOS via `Cmd+Shift+4` (drag to 1280×800) or a tool like CleanShot that sets exact dimensions.

---

## Step 8: Submit for review

In the developer console:

1. Upload the ZIP from Step 3 (`build-cws.zip`) — or use `npm run release:cws` to upload via the API.
2. Fill in store listing fields (Step 4 copy).
3. Fill in privacy practices (Step 6).
4. Enter the privacy policy URL: https://instructionscrafter.com/privacy.
5. Distribution: **Visibility = Unlisted**, Geographic distribution: **All regions**.
6. Click **Submit for review**.

Review typically takes **1–3 business days**. Because v1.0.0 was rejected for an unused permission, double-check the manifest contains **no** unused permissions (notably remove `activeTab`) before submitting.

---

## Step 9: Post-publish

- The **production extension ID** is `fcogglgcploggfgchifbeaoofljfgmoc` (stays the same across updates to the same item).
- The **unlisted install link** is `https://chromewebstore.google.com/detail/<extension-name>/fcogglgcploggfgchifbeaoofljfgmoc`. Share it with the team only after the new version is live and end-to-end tested.

Backend CORS: `ALLOWED_ORIGINS` in the VM `.env` is currently **empty**, which falls back to a permissive `chrome-extension://` regex that accepts any extension ID — so installs from the store ID work without changes. (If you ever lock `ALLOWED_ORIGINS` down to specific IDs, add `chrome-extension://fcogglgcploggfgchifbeaoofljfgmoc` and restart the service.)

---

## Future updates

1. Bump the version in **both** `extension/src/manifest.json` and `extension/package.json`.
2. From `extension/`, run `npm run build:cws` (→ `build-cws.zip`) or `npm run release:cws`.
3. In the developer console: your extension → **Package** → **Upload new package** (or let `release:cws` upload it), then **Submit for review**.
4. Once approved, users auto-update within a few hours.
