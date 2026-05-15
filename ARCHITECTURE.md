# Custom Instruction Generator — Architecture Document

## Purpose of this document

This is a complete architecture and implementation plan for a custom tool that:

1. Records a user's screen and microphone narration via a Chrome extension
2. Uploads the recording to a backend server
3. Transcribes the audio, intelligently extracts screenshots at natural step boundaries
4. Uses an LLM to rewrite the raw narration into polished step-by-step instructions
5. Assembles a Microsoft Word (.docx) document with screenshots + text
6. Returns the document to the user for immediate download (no long-term storage)

This document is written to be handed directly to an agentic coding assistant (such as Claude Code) as the single source of truth for the project. It favors explicit instructions over open-ended ones.

---

## Critical principles — READ FIRST

These rules apply to the entire project. Violating them will cause over-engineering, wasted time, and a result that does not match user intent.

1. **Reuse over rewrite.** This project assembles existing open source components with custom glue code. Do not rewrite functionality that already exists in a reputable library. Specific directives below name the libraries to use.

2. **Prefer boring technology.** Use well-documented, widely-used libraries (FastAPI, python-docx-template, FFmpeg). Do not introduce exotic frameworks or pre-release tools.

3. **Target 1,000–1,500 lines of custom code total.** If the code grows substantially beyond this, something is being rewritten that should be a library call.

4. **Small team, internal tool.** This serves up to 5 internal users. Do not build enterprise features: no multi-tenancy, no RBAC, no advanced observability stacks, no microservices. A single FastAPI process on a single Linux VPS is the correct deployment shape.

5. **No long-term storage.** Generated Word documents are returned to the user and then deleted from the server. Uploaded videos are also deleted after processing completes. Do not add a database for storing user content.

6. **Ask before inventing.** If a requirement is ambiguous, write out the ambiguity and the chosen interpretation in a comment; do not silently invent behavior.

---

## High-level architecture

```
┌────────────────────────────────────────────────────────────────┐
│  CLIENT: Modified Screenity Chrome Extension                   │
│                                                                │
│  - Records screen (tab, window, or full desktop)               │
│  - Records microphone narration                                 │
│  - On "Stop", prompts for a title + shared password            │
│  - Uploads MP4/WebM to backend via multipart POST              │
│  - Shows progress, then triggers download of returned .docx     │
└───────────────────────┬────────────────────────────────────────┘
                        │  HTTPS (POST /api/generate)
                        │  Body: video file + title + password
                        ▼
┌────────────────────────────────────────────────────────────────┐
│  BACKEND: FastAPI server on Hetzner CPX22 (Ubuntu 24.04)       │
│                                                                │
│  Pipeline (all synchronous within a single request):           │
│                                                                │
│  1. Validate shared password (reject if wrong)                 │
│  2. Save uploaded video to /tmp                                │
│  3. FFmpeg: extract audio track (16kHz mono WAV)               │
│  4. Groq Whisper Large V3 Turbo: transcribe audio w/ timestamps│
│  5. Segment transcript into logical steps                      │
│     (use sentence boundaries + pause detection)                │
│  6. FFmpeg: extract one screenshot per step                    │
│     (frame at the midpoint timestamp of each step)             │
│  7. OpenAI GPT-5.4 API: rewrite each step's narration          │
│     into clean instruction text                                │
│  8. python-docx-template: render Word doc with                 │
│     title + {step_number, instruction, screenshot} list        │
│  9. Stream .docx back as response                              │
│ 10. Delete all temporary files                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Component 1: Chrome Extension (frontend)

### Directive
**Fork Screenity** (`alyssaxuu/screenity`, GPLv3) as the starting point. Do not build a Chrome extension from scratch. Screenity already handles:
- Tab, window, and full-desktop capture via `getDisplayMedia()`
- Microphone audio recording
- Video encoding (WebM/MP4)
- Recording UI (start/stop/pause overlay)

### Modifications required

**Remove** the following features from Screenity:
- Google Drive upload integration (entire `chrome.identity` OAuth flow)
- The built-in post-recording editor (trim, annotations, drawing)
- Camera background / webcam overlay features
- GIF export
- Countdown timer customization (keep a simple 3-second countdown)
- Push-to-talk feature

**Keep** the following features:
- Screen + window + tab selection picker (this is core browser UX, not extension code)
- Microphone recording
- Cursor/click highlighting (adds visual clarity to screenshots)
- The simple start/stop toolbar

**Add** the following:
- A new "Generate Instruction Document" button that appears after recording stops
- Clicking the button opens a modal asking for:
  - Document title (text input, required)
  - Shared password (password input, required)
- On submit, upload the recording as `multipart/form-data` to `POST {BACKEND_URL}/api/generate`
- Show a progress indicator during upload and processing
- When the backend returns a `.docx` file, trigger a browser download and close the modal
- Display any errors returned from the backend in the modal

### Configuration
The backend URL and default name should be configurable via the extension's options page, stored in `chrome.storage.local`. Do not hardcode the backend URL — the team will deploy the backend and then set the URL once per user.

### File naming convention
The downloaded file should be named `{sanitized_title}_{YYYY-MM-DD}.docx`. Sanitize the title by replacing non-alphanumeric characters (except spaces and hyphens) with underscores.

### Licensing note
Screenity is GPLv3. Because this tool is used internally by the team and not distributed as a product, GPLv3 obligations (source disclosure to recipients) do not apply. If the plan ever changes to distribute this externally, revisit licensing before doing so.

---

## Component 2: Backend server

### Technology stack
- **Language:** Python 3.11+
- **Web framework:** FastAPI (async, simple, well-documented)
- **ASGI server:** Uvicorn (standard for FastAPI)
- **Process manager:** systemd (do not use Docker for v1 — keep deployment simple)
- **OS:** Ubuntu 24.04 LTS on Hetzner CPX22 (2 vCPU, 4 GB RAM)

### Dependencies (requirements.txt)
```
fastapi>=0.110
uvicorn[standard]>=0.27
python-multipart>=0.0.9
openai>=1.30
python-docx-template>=0.17
Pillow>=10.0
pydantic>=2.6
python-dotenv>=1.0
```

FFmpeg must be installed at the OS level (`apt install ffmpeg`). Do not use a Python wrapper library for FFmpeg — invoke it via `subprocess.run()` with explicit arguments. This is more reliable and easier to debug.

### Directory structure
```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, routes
│   ├── config.py            # Environment variable loading
│   ├── pipeline.py          # The main processing pipeline
│   ├── transcription.py     # Whisper API wrapper
│   ├── segmentation.py      # Transcript → step segmentation logic
│   ├── screenshots.py       # FFmpeg frame extraction
│   ├── polishing.py         # GPT-5.4 vision: pick screenshot + rewrite text
│   └── document.py          # docxtpl rendering
├── templates/
│   └── instruction_template.docx   # Word template with Jinja tags
├── requirements.txt
├── .env.example
└── README.md
```

### Environment variables (.env)
```
OPENAI_API_KEY=sk-...           # used by segmentation.py and polishing.py (GPT-5.4)
GROQ_API_KEY=gsk-...            # used by transcription.py (whisper-large-v3-turbo)
SHARED_PASSWORD=<team-chosen-string>
MAX_VIDEO_SIZE_MB=500
TEMP_DIR=/tmp/instruction-generator
ALLOWED_ORIGINS=chrome-extension://<extension-id>
```

### API contract

#### POST /api/generate

**Request:**
- `Content-Type: multipart/form-data`
- Fields:
  - `video`: binary file (MP4 or WebM), max 500 MB
  - `title`: string, 1–200 characters
  - `password`: string (shared password)

**Response (success):**
- `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `Content-Disposition: attachment; filename="{title}_{date}.docx"`
- Body: binary .docx file

**Response (error):**
- `Content-Type: application/json`
- HTTP 401 if password wrong: `{"error": "Unauthorized"}`
- HTTP 400 if validation fails: `{"error": "<reason>"}`
- HTTP 413 if file too large: `{"error": "Video exceeds maximum size"}`
- HTTP 500 if pipeline fails: `{"error": "Processing failed", "detail": "<short description>"}`

#### GET /api/health

Returns `{"status": "ok"}` with HTTP 200. Used for monitoring and deployment verification. No authentication.

### The processing pipeline (pipeline.py)

The pipeline is sequential. Each step writes its output to a unique temp directory per request (e.g., `/tmp/instruction-generator/<uuid>/`). On completion or error, this directory is deleted.

```python
# Pseudocode — reference implementation shape, not final code

async def process_video(video_path: Path, title: str) -> Path:
    """Returns path to generated .docx file."""
    workdir = create_temp_workdir()
    try:
        # Step 1: Extract audio as 16kHz mono WAV
        audio_path = extract_audio(video_path, workdir)

        # Step 2: Transcribe with Whisper, getting word/segment timestamps
        transcript = transcribe(audio_path)
        # Returns: {segments: [{start, end, text}, ...], words: [...]}

        # Step 3: Segment into logical steps and generate document
        # introduction via Stage 1 GPT-5.4 (rule-based fallback returns
        # introduction="" so the template hides the Overview block).
        segmentation = await segment_transcript(transcript)
        introduction = segmentation["introduction"]
        steps = segmentation["steps"]
        # Each step: {start_time, end_time, narration_text, step_intent}

        # Step 4: Extract one screenshot per step
        for step in steps:
            midpoint = (step.start_time + step.end_time) / 2
            step.screenshot_path = extract_frame(video_path, midpoint, workdir)

        # Step 5: Polish narration into instruction text (parallel API calls)
        polished_steps = await polish_steps(steps)

        # Step 6: Render the Word document
        output_path = render_document(
            title, polished_steps, workdir, introduction=introduction
        )

        return output_path
    finally:
        # Cleanup happens in the route handler AFTER response is sent
        pass
```

### Step-by-step implementation details

#### Audio extraction (transcription.py)
Invoke FFmpeg with:
```
ffmpeg -i <input_video> -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 64k <output.mp3>
```
- `-vn`: drop video stream
- `-ac 1`: mono
- `-ar 16000`: 16 kHz sample rate (Whisper's native rate)
- `-c:a libmp3lame -b:a 64k`: MP3 at 64 kbps (transparent for voice; ~4× more capacity within Whisper's 25 MB file size cap than uncompressed PCM, lifting the effective duration limit from ~13 min to ~54 min)

Reject files where extraction fails with HTTP 400.

#### Transcription (transcription.py)
Use Groq's OpenAI-compatible `audio.transcriptions.create` with:
- `model="whisper-large-v3-turbo"`
- `response_format="verbose_json"` (provides segment-level timestamps)
- `timestamp_granularities=["segment", "word"]`
- `base_url="https://api.groq.com/openai/v1"` on the `OpenAI` client
- API key from `GROQ_API_KEY` (separate from `OPENAI_API_KEY`, which is used only by segmentation and polishing)

**Why Groq instead of OpenAI's whisper-1:** whisper-large-v3-turbo is more accurate than whisper-1 (especially for non-English speech, including Ukrainian), and Groq's free tier covers our expected usage at $0 instead of $0.006/min on OpenAI. The `openai` Python SDK is OpenAI-compatible with Groq, so no code-shape change is required beyond pointing at the new base URL.

**Note on cost and limits:** Free tier allows up to 7,200 audio seconds per hour and 28,800 audio seconds per day (~8 hours/day) with 2,000 requests per day. For ≤5 internal users this is enormously generous. If usage ever exceeds the free tier, requests start returning 429 errors -- at that point either upgrade to Groq's developer tier or fall back to OpenAI's whisper-1.

**Note on file size:** Groq's free tier accepts up to 25 MB audio files (same as OpenAI's whisper-1, so no regression). At our extraction settings (16 kHz mono MP3 at 64 kbps), the 25 MB cap holds about 54 minutes of audio -- comfortably above any realistic how-to recording length. If the extracted audio still exceeds this, chunk it into 24 MB segments, transcribe each, and reassemble. Do not implement this chunking in v1 unless testing shows it's needed — handle the error gracefully and display "Recording too long" to the user.

#### Transcript segmentation (segmentation.py)

This is the most important logic in the whole tool. The goal is to turn a stream of sentences into logical "steps" that each deserve their own screenshot + instruction block.

**Segmentation algorithm (v1, keep it simple):**

1. Start with the Whisper `segments` array (Whisper already breaks audio at natural pauses).
2. Merge adjacent segments that are less than 3 seconds apart and shorter than ~15 words each — these are likely the same step split by a brief pause.
3. If a segment is longer than 30 seconds OR more than 60 words, split it at the nearest sentence boundary (period, question mark, exclamation mark).
4. Drop segments shorter than 2 seconds that contain fewer than 5 words (probably filler like "okay" or "so").
5. Each resulting segment becomes one step with `start_time`, `end_time`, and `narration_text`.

Do not use an LLM for segmentation in v1. Rule-based segmentation is cheaper, faster, and easier to debug. If step boundaries turn out to be poor in practice, revisit in v2.

#### Screenshot extraction (screenshots.py)
For each step, invoke FFmpeg to extract a single frame at the step's midpoint:
```
ffmpeg -ss <midpoint_seconds> -i <input_video> -frames:v 1 -q:v 2 <output.jpg>
```
- `-ss` before `-i`: fast seek
- `-q:v 2`: high-quality JPEG

Resize extracted screenshots to a maximum width of 1920px using Pillow to keep the final Word doc file size reasonable. Preserve aspect ratio. 1920px matches the most common native screen-recording resolution (1080p), so the most common case avoids any downscaling.

#### Text polishing (polishing.py)

For each step, call GPT-5.4 (with vision input on the candidate screenshots) with a prompt roughly like this:

```
System: You rewrite informal spoken narration into clean, concise
step-by-step instructions for a technical how-to guide. Keep the
instruction to 1-3 sentences. Remove filler words ("um", "so",
"okay", "you know"). Use imperative voice ("Click X", not "I'm
clicking X"). Do not add information that wasn't in the narration.
Do not number the step — numbering is added by the template.

User: <raw narration text for this step>
```

Use:
- `model="gpt-5.4"`
- `reasoning_effort="low"` (writing task, not deep reasoning; GPT-5.4 reasoning models do not accept a custom `temperature`)
- `max_completion_tokens=16000`

Send these calls concurrently using `asyncio.gather()` to minimize total latency. With 10–20 steps per video, serial calls would add 20–40 seconds unnecessarily.

**Cost budget:** Per step, ~100 input tokens + ~60 output tokens = ~$0.00005. For a 15-step doc, under $0.001 total. Essentially free.

#### Document rendering (document.py)

Use python-docx-template with a pre-designed Word template at `templates/instruction_template.docx`.

**Template design (done in Microsoft Word by hand):**
- Title: `{{ title }}`
- Subtitle: `Generated on {{ date }}`
- Optional Overview block: `{%p if introduction %}` Heading 2 "Overview" + `{{ introduction }}` paragraph `{%p endif %}` — hidden entirely when the AI-generated introduction is empty (e.g., after rule-based fallback).
- Loop: `{% for step in steps %}`
  - Heading: `Step {{ loop.index }}`
  - Image: `{{ step.image }}` (InlineImage; width chosen dynamically per-step — see "Dynamic screenshot sizing" below)
  - Paragraph: `{{ step.instruction }}`
- `{% endfor %}`

In code:
```python
from docxtpl import DocxTemplate, InlineImage
from docx.shared import Mm

doc = DocxTemplate("templates/instruction_template.docx")
context = {
    "title": title,
    "date": date.today().strftime("%B %d, %Y"),
    "introduction": introduction,  # 3-4 sentence overview, "" hides the block
    "steps": [
        {
            "image": InlineImage(doc, step.screenshot_path, width=Mm(picked_width_mm)),
            "instruction": step.polished_text,
        }
        for step in polished_steps
    ],
}
doc.render(context)
doc.save(output_path)
```

### Request lifecycle and resource cleanup

**Critical:** Temp files must be cleaned up after the response is sent, not before. Use FastAPI's `BackgroundTasks` for this:

```python
from fastapi import BackgroundTasks

@app.post("/api/generate")
async def generate(background_tasks: BackgroundTasks, ...):
    workdir = create_temp_workdir()
    output_path = await process_video(...)
    background_tasks.add_task(cleanup_workdir, workdir)
    return FileResponse(output_path, ...)
```

### Rate limiting and concurrency

For 5 users making ~10–20 docs/day total, no meaningful rate limiting is needed. However, to prevent accidental parallel-upload overload of the 2 vCPU / 4 GB server, add a simple semaphore that limits concurrent pipeline executions to 2:

```python
PIPELINE_SEMAPHORE = asyncio.Semaphore(2)

async def process_video(...):
    async with PIPELINE_SEMAPHORE:
        # ... pipeline steps
```

Additional requests beyond 2 will queue automatically via the semaphore — this is acceptable for internal use.

### Error handling

- Every external call (FFmpeg, OpenAI, Groq) must have a timeout (60s for FFmpeg calls, 120s for Whisper, 90s for GPT-5.4).
- Wrap each pipeline step in its own try/except that logs the error (with request ID) and raises an HTTPException with a user-friendly message.
- Never expose raw exception messages or stack traces to the client.
- Log to stdout (systemd will capture it to journald). Do not set up a separate logging infrastructure.

---

## Component 3: Word template

The template is designed once in Microsoft Word and committed to the repo at `templates/instruction_template.docx`.

### Design specifications
- Page: A4 landscape, 0.25 in (≈0.635 cm) margins on all sides — digital-only document, no print constraints
- Title: 24pt bold, centered
- Subtitle: 11pt italic, centered, gray
- Step heading: 14pt bold, "Step {number}" format
- Step image: centered, width chosen dynamically per-step in the range [100mm, 220mm], snapped down to multiples of 10mm — see "Dynamic screenshot sizing"
- Step instruction: 11pt regular, justified, spacing after 12pt
- Page break between steps is **not** forced — let Word flow naturally. Step heading, instruction, and image paragraphs are marked "keep with next" so a screenshot is never orphaned from its step.

The team can edit this template (fonts, colors, logo, etc.) without touching code, as long as Jinja tags like `{{ title }}`, `{% for step in steps %}`, `{{ step.instruction }}`, and `{{ step.image }}` are preserved.

### Dynamic screenshot sizing

Each step's screenshot is sized at render time so the heading + instruction + image + caption all fit on a single landscape A4 page. Per-step (Flavor A) sizing — independent per step — preserves visual rhythm by snapping the computed width down to the nearest 10 mm.

Algorithm in `app/document.py:_pick_image_width_mm()`:

1. Estimate the rendered height of the instruction text. `lines = ceil(len(text) / 150)`, `height_in = lines * 0.20`. (150 chars/line and 0.20 in line height are calibrated for 11pt Body Text on landscape A4 content width 11.19 in.)
2. Subtract overhead and a safety margin: `available_height_in = 7.77 - 1.0 - text_height_in - 0.3`. If non-positive, fall back to the minimum width (the step will overflow).
3. Read the screenshot's actual aspect ratio (height/width) via Pillow. Use 9/16 as fallback on read error.
4. Compute `width_in = available_height_in / aspect`; convert to mm.
5. Clamp to `[100mm, 220mm]`.
6. Snap down to the nearest 10 mm.

Result: short instructions get max-width screenshots (220 mm); progressively longer instructions get progressively smaller screenshots. The template's `keep_with_next` properties act as a safety net for residual estimation errors.

### Starter template content

Create the template with this structure in Word (save as .docx):

```
[Title Style] {{ title }}
[Subtitle Style] Generated on {{ date }}

{% for step in steps %}
[Heading 2] Step {{ loop.index }}
[Centered paragraph] {{ step.image }}
[Body text] {{ step.instruction }}

{% endfor %}
```

Do not generate this file programmatically. A human creates it in Microsoft Word.

---

## Deployment

### Target
A single Hetzner CPX22 instance (2 vCPU, 4 GB RAM, ~$10/month) running Ubuntu 24.04.

### Deployment steps

1. Provision the VPS, SSH in as root, create a non-root user `app`
2. Install system dependencies:
   ```
   apt update && apt install -y python3.11 python3.11-venv ffmpeg nginx certbot python3-certbot-nginx
   ```
3. Clone the backend repo to `/opt/instruction-generator`
4. Create venv, install requirements
5. Create `/opt/instruction-generator/.env` from `.env.example`
6. Create systemd service file `/etc/systemd/system/instruction-generator.service`:
   ```ini
   [Unit]
   Description=Instruction Generator API
   After=network.target

   [Service]
   User=app
   WorkingDirectory=/opt/instruction-generator
   Environment="PATH=/opt/instruction-generator/venv/bin"
   ExecStart=/opt/instruction-generator/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```
7. Configure nginx as a reverse proxy with a 500 MB client body size limit:
   ```
   client_max_body_size 500M;
   proxy_read_timeout 300s;
   proxy_pass http://127.0.0.1:8000;
   ```
8. Obtain Let's Encrypt certificate via certbot
9. Enable and start the service: `systemctl enable --now instruction-generator`

### Security hardening (minimum viable)
- UFW firewall: allow 22 (SSH), 443 (HTTPS), deny all else inbound
- SSH: disable password auth, key-based only
- Fail2ban: install with defaults
- Do not expose port 8000 publicly — only nginx on 443

This is adequate for an internal tool used by 5 trusted users. Do not add OAuth, SSO, WAF, or other enterprise security measures.

---

## Implementation order (phased plan for Claude Code)

Work through these phases sequentially. Do not start phase N+1 until phase N is verified working end-to-end.

### Phase 1: Backend skeleton (4–8 hours)
- Create the directory structure
- Implement `/api/health` endpoint
- Implement `/api/generate` endpoint that accepts a video upload, validates the password, and returns a hardcoded stub .docx file
- Write a minimal test client (simple Python script with `requests`) to verify upload works
- **Verification:** Upload a sample MP4 via the test client, receive the stub .docx back

### Phase 2: FFmpeg integration (3–5 hours)
- Implement audio extraction
- Implement single-frame extraction
- Add timeouts and error handling around every FFmpeg call
- **Verification:** Given an MP4, produce a WAV and three JPEG frames at timestamps 5s, 15s, 30s

### Phase 3: Whisper integration (2–4 hours)
- Implement `transcribe(audio_path)` returning segments with timestamps
- Handle the 25 MB file size limit gracefully
- **Verification:** Transcribe a sample narration WAV, get back coherent segment list

### Phase 4: Segmentation logic (3–5 hours)
- Implement the segmentation rules from the "Transcript segmentation" section
- Write unit tests covering edge cases: very short segments, very long segments, heavy pause patterns
- **Verification:** Given a real transcript of 5-min narration, produce a sensible list of 8–12 steps

### Phase 5: Polishing + document rendering (4–6 hours)
- Design the Word template by hand in Microsoft Word
- Implement `polish_step(narration_text)` via GPT-5.4 with asyncio.gather
- Implement `render_document(title, steps)` using docxtpl
- **Verification:** Given segmented steps, produce a readable, well-formatted .docx

### Phase 6: End-to-end pipeline wiring (2–4 hours)
- Connect all pieces in `pipeline.py`
- Add the background cleanup task
- Add the concurrency semaphore
- **Verification:** Upload a real 5-minute recording, receive a proper instruction document back within 60 seconds

### Phase 7: Deploy backend (3–5 hours)
- Provision Hetzner, install dependencies
- Deploy via systemd + nginx + certbot
- Verify `/api/health` is reachable over HTTPS
- **Verification:** Backend is live at `https://<domain>/api/health`

### Phase 8: Screenity fork (10–20 hours)
- Fork Screenity repo
- Remove listed features
- Add the "Generate Document" button and modal
- Wire up the upload to the deployed backend
- Add a pre-recording notice (modal on first record-button click, or persistent hint near the button) clearly stating that voice narration is required for instruction generation. Without this, a user can record silently and only discover the requirement when the backend returns a 400 after upload -- preventing the bad recording is better than catching it. Backend already returns a clear actionable message (see pipeline.py "no narration" branch); the extension's job is to make the requirement visible before recording starts.
- Add a post-recording audio-level sanity check before the upload step. Detect when the captured audio is essentially silent (e.g., >95% of samples below approximately -50 dB; threshold needs calibration against typical room noise) and warn the user with an option to re-record before uploading. Safety net for cases where the pre-recording notice didn't help -- user ignored it, microphone permission was denied, or there was a hardware fault.
- Test end-to-end: record → upload → download document
- **Verification:** The extension successfully generates a document from a real screen recording

### Phase 9: Polish (4–8 hours)
- Error handling in the UI
- Options page for backend URL configuration
- Package the extension for distribution (.crx or unpacked for dev mode)
- Write a short README explaining how to install the extension and deploy the backend

**Total estimated time: 35–65 hours of focused development.**

The earlier 120–220 hour estimate included larger buffers for ambiguity and unknowns. With this detailed spec, the range should land in 40–70 hours for a competent developer working with Claude Code.

---

## What NOT to build

To prevent scope creep, these features are explicitly out of scope for v1:

- ❌ User accounts, email-based login, or individual permissions (shared password is enough)
- ❌ A database or persistent storage of generated documents
- ❌ A dashboard or admin UI
- ❌ Analytics, usage tracking, or audit logs
- ❌ Multi-language support (English-only for v1; Whisper handles other languages automatically if needed)
- ❌ PDF export (Word only)
- ❌ Collaborative editing of generated documents
- ❌ Integration with Confluence, Notion, SharePoint, etc.
- ❌ Sensitive-data detection or redaction in screenshots
- ❌ Mobile app
- ❌ Firefox or Safari extension support (Chrome + Chromium-based browsers only)

If any of these become genuinely needed later, revisit after 3 months of real usage.

---

## Open questions for the product owner

None at this stage — the preceding conversation established shared password auth, full-video upload, Option C (smart screenshot extraction), and hardcoded Word template.

If Claude Code encounters a decision during implementation that isn't covered by this document, it should:
1. Make the choice that is simplest and most consistent with the "Critical principles" section
2. Leave a `# DECISION: <explanation>` comment in the code at the point of the decision
3. Flag the list of such decisions in a summary at the end of each phase

---

## Glossary of reused open source components

| Component | Repo / source | License | Role |
|---|---|---|---|
| Screenity | github.com/alyssaxuu/screenity | GPLv3 | Screen + audio recording (Chrome extension base) |
| FastAPI | github.com/tiangolo/fastapi | MIT | Backend web framework |
| Uvicorn | github.com/encode/uvicorn | BSD | ASGI server |
| FFmpeg | ffmpeg.org | LGPL/GPL | Audio extraction and frame grabbing |
| Groq Whisper Large V3 Turbo API | console.groq.com | Commercial API (free tier) | Speech-to-text (OpenAI-compatible endpoint) |
| OpenAI GPT-5.4 API | platform.openai.com | Commercial API | Semantic segmentation + screenshot selection + text polishing (vision-aware) |
| python-docx-template | github.com/elapouya/python-docx-template | LGPL | Word document rendering |
| Pillow | python-pillow.org | HPND | Image resizing |

No other runtime dependencies should be added without strong justification.

---

## End of architecture document
