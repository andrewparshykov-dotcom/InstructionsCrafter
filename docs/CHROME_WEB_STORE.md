# Chrome Web Store submission guide (unlisted)

Step-by-step guide for publishing InstructionsCrafter to the Chrome Web Store as an **unlisted** extension (private install link, not searchable, $5 one-time developer registration).

---

## ⚠️ Read first: GPLv3 obligations

InstructionsCrafter is **forked from Screenity (GPLv3)**. Publishing the extension to the Chrome Web Store counts as "distribution" under GPLv3, which triggers obligations the current "internal-tool only" framing does **not** require:

- **Source code disclosure.** Every recipient (anyone who installs from the unlisted link) must be able to obtain the complete corresponding source code. Easiest path: make the GitHub repo public, link it from the store listing, and from the extension's Options page or "About" section.
- **License notice.** The extension's UI or About page must surface a "this software is licensed under GPLv3" notice with a link to the license text.
- **No additional restrictions.** You can't add a click-through EULA that contradicts GPLv3 terms.

If you want to skip these obligations, the alternative is to keep distributing as unpacked (see CLAUDE.md "deferred cleanup" → distribution decision). **Reconsider with the team before spending the $5 and starting the submission.**

The rest of this guide assumes you've decided to proceed with store submission.

---

## Step 1: Create a developer account

1. Open https://chrome.google.com/webstore/devconsole
2. Sign in with the Google account that will own the extension. Consider creating a team account (e.g. `instructionscrafter@safeshieldins.com`) so the listing isn't tied to one person.
3. Pay the **one-time $5 registration fee**. Google charges this once per account, not per extension.
4. Accept the developer agreement.

---

## Step 2: Host the privacy policy

Chrome Web Store requires a **publicly accessible URL** for the privacy policy. Two reasonable hosting options:

### Option A — Host on the backend (cleanest)

Add a route in FastAPI:

```python
# backend/app/main.py
from fastapi.responses import HTMLResponse

@app.get("/privacy", response_class=HTMLResponse)
async def privacy_policy():
    return open("templates/privacy.html").read()
```

Put the HTML version of the policy below in `backend/templates/privacy.html`, deploy, and the URL is `https://instructionscrafter.com/privacy`.

### Option B — Host on GitHub

Push `PRIVACY.md` to the (public) project repo and use the GitHub-rendered URL: `https://github.com/YOUR_ORG/InstructionsCrafter/blob/main/PRIVACY.md`. Requires the repo to be public — which you'll need anyway for GPLv3 disclosure.

### Privacy policy content

Use exactly this text (adjust the org name + contact email):

```markdown
# InstructionsCrafter — Privacy Policy

_Last updated: 2026-05-25_

## What we collect

When you use the InstructionsCrafter Chrome extension:

- **Screen recording and microphone audio** captured during a recording session, plus mouse-click coordinates while recording.
- **The document title** you enter on the post-recording page.
- **Local settings** stored in `chrome.storage.local`: the backend URL, an optional default document title, and recording session state (which Chrome clears when you uninstall the extension).

We do **not** collect: your name, email, IP address, browser history, cookies, screen content outside of an active recording session, or any data unrelated to producing the requested document.

## Where the data goes

Recordings and titles are sent to **our own backend server** (default: `https://instructionscrafter.com`) over HTTPS. The backend pipeline:

1. Saves the upload to a per-request temporary directory.
2. Extracts the audio track and sends it to **Groq's Whisper API** for transcription.
3. Sends the transcript and selected screenshots to **OpenAI's GPT API** for narration polishing.
4. Returns a `.docx` file to your browser.
5. **Deletes the upload + every intermediate file** as soon as the response is sent.

No copy is retained on the server. No database persists user content.

## Third-party services

- **Groq** (transcription) — receives the recorded audio. Subject to [Groq's privacy policy](https://groq.com/privacy-policy/).
- **OpenAI** (text polishing) — receives the transcript text. Subject to [OpenAI's privacy policy](https://openai.com/policies/privacy-policy).

## Authentication

The extension sends a shared password (entered on the post-recording page) with every request. The backend verifies it and rejects unauthenticated requests. The password is **not** stored locally between sessions.

## Data sharing

We do not share, sell, or transfer user data beyond the third-party services listed above.

## Open source

InstructionsCrafter is open source under GPLv3. Source code: [GITHUB_URL]. The Chrome extension portion is forked from [Screenity](https://github.com/alyssaxuu/screenity) (also GPLv3).

## Contact

Questions: andrewp@safeshieldins.com
```

---

## Step 3: Prepare the upload ZIP

The Chrome Web Store expects a ZIP of the **extension build directory** (not the `src/` directory).

```bash
cd extension
npm run build:prod    # production build (minified, no dev artifacts)

cd build
zip -r ../instructionscrafter-1.0.0.zip . -x "*.map" -x "**/.*"
```

Resulting file: `extension/instructionscrafter-1.0.0.zip`. Size should be ~5–15 MB.

---

## Step 4: Store listing copy

When prompted by the Chrome Web Store developer console, paste these verbatim.

### Short description (≤132 characters)

```
Record a screen with voice narration and turn it into a polished step-by-step Microsoft Word how-to document.
```

(108 chars — under the limit.)

### Long description (≤4000 characters)

```
InstructionsCrafter turns a screen recording with voice narration into a finished Microsoft Word step-by-step instruction document. It's the fastest way for a domain expert to turn "let me show you how this works" into a polished, shareable how-to.

How it works:

1. Click the InstructionsCrafter icon and choose what to record — full screen, a window, or a specific tab.
2. Narrate every step out loud as you click through the workflow.
3. When you stop, the recording is uploaded to your team's backend. The pipeline:
   • Transcribes the audio (Groq Whisper Large V3 Turbo — fast, multilingual).
   • Segments the narration into logical steps using sentence boundaries and pauses.
   • Extracts one screenshot per step at the midpoint of that segment.
   • Polishes the raw narration into clean imperative-voice instructions (OpenAI GPT-5.4).
   • Renders a Microsoft Word document with the title, an optional overview, and a numbered list of {screenshot, instruction} blocks.
4. The .docx downloads in your browser. No copy is kept on the server.

Designed for internal teams. No accounts, no cloud storage of recordings, no telemetry. A single shared password gates the backend.

Hardware requirements: a working microphone (the document is built from what you say, not from what you click).

Privacy: see https://instructionscrafter.com/privacy.

Source code (GPLv3): https://github.com/YOUR_ORG/InstructionsCrafter
```

### Single purpose statement (≤1000 characters)

```
This extension records a user's screen and microphone narration, uploads the recording to a self-hosted backend that converts the narration into a polished step-by-step Microsoft Word document, and downloads the document. All other capabilities (Chrome storage, downloads, tab capture, scripting) directly support this single end-to-end recording → document workflow.
```

### Category

**Productivity**

### Language

English (United States) — `en-US`

---

## Step 5: Permission justifications

Each permission needs a justification (≤1000 chars each) in the Chrome Web Store developer console. Paste these verbatim:

### `host_permissions: ["<all_urls>"]`

```
The content script must run on every page the user might want to record so the in-recording toolbar (start/stop/draw/blur controls) and the post-recording "Generate Document" overlay can render in-page. The extension does not read page content or DOM state — it only injects UI into a shadow DOM and starts/stops MediaRecorder against tracks the user explicitly granted via Chrome's native screen-share picker. No data is exfiltrated from host pages.
```

### `activeTab`

```
The recording lifecycle hinges on the currently-focused tab: which tab to capture, where to anchor the in-recording toolbar, and which tab to return focus to when recording stops. activeTab is the least-privileged way to do this without requesting broad tabs access for arbitrary pages.
```

### `storage`

```
chrome.storage.local persists user settings (backend URL, optional default document title) and short-lived recording state (in-progress chunk references, the current recording's session ID). All values are local to the user's profile; nothing is synced to Google or uploaded.
```

### `unlimitedStorage`

```
A recording is buffered to IndexedDB (via OPFS for the screen track) in 1–5 MB chunks until the user clicks Stop, at which point the chunks are concatenated into one upload and the storage is wiped. unlimitedStorage prevents Chrome from throttling the buffer for recordings longer than ~5 minutes.
```

### `downloads`

```
After the backend returns the generated .docx, the extension uses chrome.downloads.download() to save it under {sanitized_title}_{YYYY-MM-DD}.docx in the user's default Downloads folder.
```

### `tabs`

```
Used during the recording lifecycle: identifying the recording tab vs. the user's "active" tab, opening the post-recording Generate page in a new tab when the user clicks Stop, and reading the recording tab's URL to detect tab-close-mid-recording. No tabs metadata is logged or transmitted.
```

### `tabCapture`

```
Used by chrome.tabCapture.getMediaStreamId() to fetch a stream ID for the active tab when the user chooses to record the current tab (vs. screen or window). The stream ID is consumed only by Chrome's native getUserMedia() and never leaves the extension.
```

### `scripting`

```
chrome.scripting.executeScript injects a tiny helper script into the recording tab on demand: (a) to read window.innerWidth/innerHeight when computing click coordinates relative to the page viewport, and (b) to re-inject the content script after the page reloads mid-recording so the in-page toolbar reappears. No content script is ever injected into pages outside an active recording.
```

### `system.display`

```
chrome.system.display.getInfo() is called when the user clicks during a multi-monitor recording: we translate the click's page-relative coordinates to monitor-relative coordinates so they line up with the recorded video frame. Used only during an active recording session.
```

### `optional_permissions: ["offscreen", "desktopCapture", "alarms", "clipboardWrite"]`

These are requested at runtime, not granted up-front:
```
offscreen: hosts the MediaRecorder/WebCodecs encoder off the visible tab so a backgrounded recorder can keep encoding.
desktopCapture: shows Chrome's native screen-share picker when the user clicks Start.
alarms: keeps the recorder service worker awake during long recordings via chrome.alarms.create heartbeats.
clipboardWrite: not currently used; legacy from upstream Screenity. To be removed in a future release.
```

---

## Step 6: Data usage disclosures

In the developer console, the "Privacy practices" section asks about specific data types. Answer:

| Data category | Collected? | Notes |
|---|---|---|
| Personally identifiable info | No | We do not collect name, email, address, etc. |
| Health info | No | — |
| Financial info | No | — |
| Authentication info | **Yes** | A shared password is entered per request but **not stored**. |
| Personal communications | No | — |
| Location | No | — |
| Web history | No | — |
| User activity | **Yes** | Screen recording + audio + cursor positions during an active recording session. Sent to the team's backend, processed once, deleted. |
| Website content | No | We do not read host-page DOM/text. |

Check the boxes:
- ☑ **I do not sell or transfer user data to third parties, apart from the approved use cases** (the third parties are Groq + OpenAI, used solely to provide the requested functionality).
- ☑ **I do not use or transfer user data for purposes unrelated to my item's single purpose.**
- ☑ **I do not use or transfer user data to determine creditworthiness or for lending purposes.**

---

## Step 7: Screenshots

Chrome Web Store requires **at least 1 screenshot**, allows up to 5. Use **1280 × 800** pixels (the preferred size).

Suggested screenshot order:

1. **Toolbar icon + popup**: the extension popup with the Start button visible. Background: a real document or webpage.
2. **In-recording floating toolbar**: showing the controls (stop, pause, draw, blur, cursor) over a sample page.
3. **Post-recording Generate page**: with the recording loaded, the title field filled in, ready to click Generate Document.
4. **A generated .docx preview**: open the produced Word document and screenshot a page showing the title + 2–3 steps with screenshots.
5. **Welcome page**: the first-install Welcome screen.

Capture these on macOS via `Cmd+Shift+4` → drag to select 1280×800, or use a tool like CleanShot that lets you set exact dimensions.

---

## Step 8: Submit for review

In the developer console:

1. Upload the ZIP from Step 3.
2. Fill in store listing fields (Step 4 copy).
3. Fill in privacy practices (Step 6).
4. Enter the privacy policy URL from Step 2.
5. Set distribution: **Visibility = Unlisted**. Geographic distribution: **All regions**.
6. Click **Submit for review**.

Google's review typically takes **1–3 business days** for an unlisted extension. You'll get an email when the review completes.

---

## Step 9: Post-publish

Once published, you'll get:

- An **extension ID** (32-character string). Looks like `iikpfdkhhgockbnndahjkmhocfgpolaa` but will be different from the unpacked-dev ID.
- An **install link** (unlisted = not searchable; only people with the link can install). Format: `https://chromewebstore.google.com/detail/<extension-name>/<extension-id>`.

You **must** update the backend's `ALLOWED_ORIGINS` to use the new extension ID:

```bash
# SSH into the production server
ssh azureuser@4.227.180.120

sudo nano /opt/instruction-generator/.env
# Change: ALLOWED_ORIGINS=chrome-extension://<NEW-EXTENSION-ID>

sudo systemctl restart instruction-generator
```

Share the install link with the team. They click it, hit "Add to Chrome", and they're done — the extension auto-updates from now on whenever you publish a new version.

---

## Future updates

To publish a new version:

1. Bump `extension/src/manifest.json:6` (e.g. `1.0.0` → `1.0.1`).
2. `npm run build:prod` in `extension/`.
3. ZIP the new `build/` directory.
4. In the developer console, click your extension → **Package** → **Upload new package**.
5. Submit for review (subsequent reviews are usually faster than the initial submission).
6. Once approved, users auto-update within a few hours.
