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

**Current phase: Phase 5 complete. Ready to begin Phase 6 (End-to-end pipeline wiring).**
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
