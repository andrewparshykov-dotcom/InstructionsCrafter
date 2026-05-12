"""Stage 2: vision-aware polishing of segmented narration into rich step text.

For each step, sends GPT-5.4 the step's narration + intent + neighbor intents
+ the screenshot itself. Returns rich imperative-voice instructions that
preserve the narrator's explanatory detail, plus a screenshot-grounded caption.

Per-step API calls run concurrently via asyncio.gather() so an N-step video
does not pay the latency cost of serial calls.
"""

import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

import openai
from fastapi import HTTPException
from openai import AsyncOpenAI

GPT_MODEL = "gpt-5.4"
GPT_TIMEOUT_SECONDS = 60
GPT_MAX_COMPLETION_TOKENS = 16000
# Reasoning models (gpt-5.4) do not accept custom `temperature`; only the
# default value is supported. Consistency is controlled by reasoning_effort
# and the prompt rather than by temperature sampling.
GPT_REASONING_EFFORT = "low"  # writing task, not deep reasoning

SYSTEM_PROMPT = """\
You rewrite informal spoken narration from a screen recording into clean \
step-by-step instructions for a how-to document. You also select the most \
informative screenshot for the step from a small set of candidate frames.

You will receive: this step's narration text, this step's intent, the \
previous step's intent, the next step's intent, and several candidate \
screenshots labeled Frame 1, Frame 2, ... in chronological order within \
the step (Frame 1 is the earliest, the last frame is the latest).

Frame selection. The candidate screenshots are sampled at different \
moments during the step. Some may show the page mid-load -- those are \
not useful for a how-to document. Pick the single frame that best \
illustrates the action this step describes.

Prefer frames that:
- Show a fully rendered page with stable content (no spinners, no \
"Loading..." or "Redirecting..." indicators, no large blank or black \
areas where content should be).
- Show the UI element or page state the narration refers to.

Avoid frames that:
- Show loading spinners, progress bars, or skeleton placeholders.
- Have a mostly empty content area beneath a populated browser chrome \
(this typically indicates an in-progress page load).
- Show a page clearly unrelated to what the narration describes.

If every candidate has issues, pick the least bad one -- never refuse \
to choose.

Return a JSON object with exactly three fields:
- "chosen_frame": integer (1-indexed) identifying which frame you \
selected.
- "instruction": imperative voice ("Click X", not "I click X" or "you \
need to click X"). Preserve all explanatory detail the narrator \
provided -- if they explained why, keep the why; if they described what \
is visible, keep that. Strip only filler ("um", "okay", "you know", "as \
you can see", "alright"). Do not invent content. Do not number the step \
-- numbering is added by the document template. No length cap; use as \
many sentences as the narration warrants.
- "caption": one short sentence (under 25 words) describing what is \
actually visible in the frame you chose. If your chosen frame is \
unclear or generic, fall back to a one-line summary of the step.

Use the neighbor intents only to maintain continuity (for example, to \
disambiguate references like "click it" by knowing what "it" refers \
to). Do not include neighbor content in your output.

Respond ONLY with the JSON object. No prose before or after.\
"""


async def polish_step(
    step: dict[str, Any],
    *,
    prev_intent: str,
    next_intent: str,
    client: AsyncOpenAI,
    request_id: str,
    step_index: int,
) -> dict[str, Any]:
    """Polish one step and select the best candidate screenshot.

    Sends all of `step["candidate_frame_paths"]` to the model, which picks
    the most informative frame (avoiding mid-load captures) and writes the
    polished instruction grounded in that frame.

    Returns {"instruction", "caption", "screenshot_path"} where
    `screenshot_path` is the chosen candidate (used by the document
    renderer downstream).

    Raises HTTPException on API failure or malformed model response.
    """
    candidate_paths = [Path(p) for p in step["candidate_frame_paths"]]
    n = len(candidate_paths)
    image_data_urls = [_encode_image_data_url(p) for p in candidate_paths]

    user_text = (
        f"Previous step intent: "
        f"{prev_intent or '(none -- this is the first step)'}\n"
        f"Next step intent: "
        f"{next_intent or '(none -- this is the last step)'}\n"
        f"This step's intent: "
        f"{step.get('step_intent', '') or '(not provided)'}\n\n"
        f"This step's narration:\n{step['narration_text']}\n\n"
        f"Candidate screenshots: {n} frames provided in chronological "
        f"order, labeled Frame 1 (earliest) through Frame {n} (latest)."
    )

    user_content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
    for url in image_data_urls:
        user_content.append({"type": "image_url", "image_url": {"url": url}})

    try:
        response = await client.chat.completions.create(
            model=GPT_MODEL,
            reasoning_effort=GPT_REASONING_EFFORT,
            max_completion_tokens=GPT_MAX_COMPLETION_TOKENS,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
    except openai.APITimeoutError:
        raise HTTPException(status_code=504, detail="Polishing timed out")
    except openai.AuthenticationError:
        # Same rationale as transcription.py -- bad OpenAI credentials are
        # a server config error, not a client auth error.
        raise HTTPException(
            status_code=500,
            detail="Server failed to authenticate to OpenAI",
        )
    except openai.APIError as exc:
        # Log the underlying API error so it's visible in server logs even
        # though the client only sees the generic "Polishing failed" detail.
        print(f"polish_step: OpenAI APIError: {exc!r}", file=sys.stderr)
        raise HTTPException(status_code=500, detail="Polishing failed")

    raw_content = response.choices[0].message.content or ""
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Polishing returned invalid JSON",
        )

    instruction = parsed.get("instruction")
    caption = parsed.get("caption")
    if not isinstance(instruction, str) or not isinstance(caption, str):
        raise HTTPException(
            status_code=500,
            detail="Polishing returned unexpected JSON shape",
        )

    chosen_idx = _resolve_chosen_index(
        parsed.get("chosen_frame"), n, request_id, step_index
    )

    print(
        f"[{request_id}] step={step_index} polish: "
        f"chose frame {chosen_idx + 1} of {n}"
    )

    return {
        "instruction": instruction.strip(),
        "caption": caption.strip(),
        "screenshot_path": candidate_paths[chosen_idx],
    }


def _resolve_chosen_index(
    raw: Any, n: int, request_id: str, step_index: int,
) -> int:
    """Validate the model's chosen_frame (1-indexed) and convert to 0-index.

    Falls back to the middle candidate (with a warning log) if the model
    returned a missing, malformed, or out-of-range value. Never raises --
    the pipeline should produce a degraded result rather than fail when
    the model misbehaves.
    """
    fallback = (n - 1) // 2  # middle candidate, 0-indexed

    try:
        one_indexed = int(raw)
    except (TypeError, ValueError):
        print(
            f"[{request_id}] step={step_index} polish: invalid chosen_frame="
            f"{raw!r} (N={n}), falling back to middle (frame {fallback + 1})",
            file=sys.stderr,
        )
        return fallback

    if 1 <= one_indexed <= n:
        return one_indexed - 1

    clamped = max(1, min(one_indexed, n))
    print(
        f"[{request_id}] step={step_index} polish: chosen_frame="
        f"{one_indexed} out of range (N={n}), clamped to {clamped}",
        file=sys.stderr,
    )
    return clamped - 1


async def polish_steps(
    steps: list[dict[str, Any]],
    request_id: str,
) -> list[dict[str, Any]]:
    """Polish every step concurrently with cross-step context and vision.

    Input: list of step dicts with at least 'narration_text' and
    'candidate_frame_paths' (a list of Paths). May also carry 'step_intent'
    (populated when AI segmentation succeeded).

    Output: a new list where each step dict has 'instruction', 'caption',
    and 'screenshot_path' keys added/overwritten. The 'screenshot_path'
    points to the candidate frame the model selected and is what the
    document renderer uses.
    """
    if not steps:
        return []

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key is not configured on the server",
        )

    intents = [str(s.get("step_intent", "") or "") for s in steps]

    async with AsyncOpenAI(api_key=api_key, timeout=GPT_TIMEOUT_SECONDS) as client:
        polished = await asyncio.gather(
            *(
                polish_step(
                    step,
                    prev_intent=intents[i - 1] if i > 0 else "",
                    next_intent=intents[i + 1] if i + 1 < len(intents) else "",
                    client=client,
                    request_id=request_id,
                    step_index=i,
                )
                for i, step in enumerate(steps)
            )
        )

    return [
        {
            **step,
            "instruction": p["instruction"],
            "caption": p["caption"],
            "screenshot_path": p["screenshot_path"],
        }
        for step, p in zip(steps, polished)
    ]


def _encode_image_data_url(path: Path) -> str:
    """Read an image file and return a base64 data URL for OpenAI vision."""
    suffix = path.suffix.lower().lstrip(".")
    mime = {
        "jpg": "jpeg",
        "jpeg": "jpeg",
        "png": "png",
        "webp": "webp",
        "gif": "gif",
    }.get(suffix, "jpeg")
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return f"data:image/{mime};base64,{encoded}"
