"""Polish raw transcript narration into clean step instructions + captions.

Uses GPT-4o mini. Per-step API calls run concurrently via asyncio.gather()
so a 15-step video does not pay the 20-40s latency cost of serial calls.
"""

import asyncio
import json
import os
from typing import Any

import openai
from fastapi import HTTPException
from openai import AsyncOpenAI

# ARCHITECTURE.md: 30s timeout for GPT-4o mini calls.
GPT_TIMEOUT_SECONDS = 30

GPT_MODEL = "gpt-4o-mini"
GPT_TEMPERATURE = 0.2  # ARCHITECTURE.md: consistency, not creativity.
GPT_MAX_TOKENS = 200

# DECISION: ARCHITECTURE.md's example prompt asks the model to return
# plain prose (just the polished instruction). To support the caption
# feature the user authorized on top of the spec, we ask for a small
# JSON object instead and use response_format=json_object so the API
# guarantees valid JSON.
SYSTEM_PROMPT = """\
You rewrite informal spoken narration from a screen recording into clean, \
concise step-by-step instructions for a technical how-to guide.

For each step you receive, return a JSON object with exactly two fields:
- "instruction": 1-3 sentences in imperative voice ("Click X", not "I am \
clicking X"). Remove filler words ("um", "so", "okay", "you know"). Do \
not add information that was not in the narration. Do not number the \
step -- numbering is added by the document template.
- "caption": one short sentence (under 15 words) describing what is \
likely visible in the screenshot for this step, based only on what the \
narration mentions. If the narration does not reveal what is on screen, \
return "Screenshot for this step." as a fallback.

Respond ONLY with the JSON object. No prose before or after.\
"""


async def polish_step(
    narration_text: str,
    *,
    client: AsyncOpenAI,
) -> dict[str, str]:
    """Polish one step's narration. Returns {"instruction", "caption"}.

    Raises HTTPException on API failure or malformed model response.
    """
    try:
        response = await client.chat.completions.create(
            model=GPT_MODEL,
            temperature=GPT_TEMPERATURE,
            max_tokens=GPT_MAX_TOKENS,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": narration_text},
            ],
        )
    except openai.APITimeoutError:
        raise HTTPException(status_code=504, detail="Polishing timed out")
    except openai.AuthenticationError:
        # DECISION: Same rationale as transcription.py -- bad OpenAI
        # credentials are a server config error, not a client auth error.
        raise HTTPException(
            status_code=500,
            detail="Server failed to authenticate to OpenAI",
        )
    except openai.APIError:
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
    """Polish every step's narration concurrently.

    Input: list of step dicts (e.g. from segment_transcript()) each with
    at least a 'narration_text' key.
    Output: a new list where each step dict has 'instruction' and
    'caption' keys added; original keys are preserved.
    """
    if not steps:
        return []

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key is not configured on the server",
        )

    async with AsyncOpenAI(api_key=api_key, timeout=GPT_TIMEOUT_SECONDS) as client:
        polished = await asyncio.gather(
            *(polish_step(step["narration_text"], client=client) for step in steps)
        )

    return [
        {**step, "instruction": p["instruction"], "caption": p["caption"]}
        for step, p in zip(steps, polished)
    ]
