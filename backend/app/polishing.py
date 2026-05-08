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
step-by-step instructions for a how-to document.

You will receive: this step's narration text, this step's intent, the \
previous step's intent, the next step's intent, and a screenshot of this \
step.

Return a JSON object with exactly two fields:
- "instruction": imperative voice ("Click X", not "I click X" or "you need \
to click X"). Preserve all explanatory detail the narrator provided -- if \
they explained why, keep the why; if they described what is visible, keep \
that. Strip only filler ("um", "okay", "you know", "as you can see", \
"alright"). Do not invent content. Do not number the step -- numbering is \
added by the document template. No length cap; use as many sentences as \
the narration warrants.
- "caption": one short sentence (under 25 words) describing what is \
actually visible in the provided screenshot. If the screenshot is unclear \
or generic, fall back to a one-line summary of the step.

Use the neighbor intents only to maintain continuity (for example, to \
disambiguate references like "click it" by knowing what "it" refers to). \
Do not include neighbor content in your output.

Respond ONLY with the JSON object. No prose before or after.\
"""


async def polish_step(
    step: dict[str, Any],
    *,
    prev_intent: str,
    next_intent: str,
    client: AsyncOpenAI,
) -> dict[str, str]:
    """Polish one step. Returns {"instruction", "caption"}.

    Raises HTTPException on API failure or malformed model response.
    """
    image_data_url = _encode_image_data_url(Path(step["screenshot_path"]))

    user_text = (
        f"Previous step intent: "
        f"{prev_intent or '(none -- this is the first step)'}\n"
        f"Next step intent: "
        f"{next_intent or '(none -- this is the last step)'}\n"
        f"This step's intent: "
        f"{step.get('step_intent', '') or '(not provided)'}\n\n"
        f"This step's narration:\n{step['narration_text']}"
    )

    try:
        response = await client.chat.completions.create(
            model=GPT_MODEL,
            reasoning_effort=GPT_REASONING_EFFORT,
            max_completion_tokens=GPT_MAX_COMPLETION_TOKENS,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {
                            "type": "image_url",
                            "image_url": {"url": image_data_url},
                        },
                    ],
                },
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

    content = response.choices[0].message.content or ""
    try:
        parsed = json.loads(content)
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

    return {
        "instruction": instruction.strip(),
        "caption": caption.strip(),
    }


async def polish_steps(
    steps: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Polish every step concurrently with cross-step context and vision.

    Input: list of step dicts with at least 'narration_text' and
    'screenshot_path'. May also carry 'step_intent' (populated when AI
    segmentation succeeded).

    Output: a new list where each step dict has 'instruction' and 'caption'
    keys added; original keys are preserved.
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
                )
                for i, step in enumerate(steps)
            )
        )

    return [
        {**step, "instruction": p["instruction"], "caption": p["caption"]}
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
