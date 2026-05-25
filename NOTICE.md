# Notice

InstructionsCrafter is forked from [Screenity](https://github.com/alyssaxuu/screenity) (the Chrome extension portion) and licensed under **GNU General Public License v3.0**. See `LICENSE` for the full license text.

## Components

- **`extension/`** — Chrome extension code, derived from Screenity (GPLv3). Modifications by Andrew Parshykov and contributors.
- **`backend/`** — FastAPI server, original code by Andrew Parshykov and contributors. The backend is not derived from Screenity. Distributed under the same GPLv3 license for consistency with the extension.
- **`templates/instruction_template.docx`** — Microsoft Word document template, original.

## Third-party runtime dependencies

The extension and backend use the following open-source libraries at runtime:

- [FastAPI](https://github.com/tiangolo/fastapi) — MIT
- [Uvicorn](https://github.com/encode/uvicorn) — BSD
- [FFmpeg](https://ffmpeg.org/) — LGPL/GPL (invoked as a subprocess; not statically linked)
- [python-docx-template](https://github.com/elapouya/python-docx-template) — LGPL
- [Pillow](https://python-pillow.org/) — HPND
- [Geist + Geist Mono](https://github.com/vercel/geist-font) — SIL Open Font License 1.1
- [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) — SIL Open Font License 1.1
- React, Radix UI, Fabric.js, and others bundled in the extension (see `extension/package.json`).

## Third-party API services

- [Groq](https://groq.com/) — Whisper Large V3 Turbo for audio transcription.
- [OpenAI](https://openai.com/) — GPT-5.4 for narration polishing.

These services receive recording audio and transcripts respectively. See `docs/CHROME_WEB_STORE.md` "Privacy policy" for details on what data is sent and retention.
