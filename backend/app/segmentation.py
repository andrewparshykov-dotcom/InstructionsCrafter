"""Stage 1: AI-driven semantic segmentation with rule-based fallback.

Primary path uses GPT-5.4 to identify logical step boundaries from a Whisper
transcript. If the AI call fails for any reason (timeout, malformed JSON,
invalid timestamps, missing API key), falls back to the deterministic
rule-based algorithm originally specified in ARCHITECTURE.md.
"""

import json
import os
import re
import sys
from typing import Any

import openai
from openai import AsyncOpenAI

# AI segmentation parameters
GPT_MODEL = "gpt-5.4"
GPT_TIMEOUT_SECONDS = 60
GPT_MAX_COMPLETION_TOKENS = 16000
GPT_REASONING_EFFORT = "medium"

# Rule-based fallback constants (preserved from prior implementation per
# ARCHITECTURE.md "Transcript segmentation").
MERGE_MAX_GAP_SECONDS = 3.0
MERGE_MAX_WORDS_EACH = 15
SPLIT_MAX_DURATION_SECONDS = 30.0
SPLIT_MAX_WORDS = 60
DROP_MAX_DURATION_SECONDS = 2.0
DROP_MAX_WORDS = 5

_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")

# Allow returned end_time to overshoot the transcript's last timestamp by up
# to this many seconds before we treat it as invalid. Models often round.
_END_TIME_OVERSHOOT_TOLERANCE = 1.0

SYSTEM_PROMPT = """\
You analyze a transcript from a screen recording with voice narration and \
identify the logical steps of a tutorial. The user will provide the full \
transcript with sentence-level timestamps.

Return a JSON object with one key, "steps", whose value is a list of step \
objects. Each step object must have:
- start_time (number, seconds): the start of the first transcript sentence \
belonging to this step
- end_time (number, seconds): the end of the last transcript sentence \
belonging to this step
- narration_text (string): the verbatim transcript sentences belonging to \
this step, concatenated with spaces
- step_intent (string, max 20 words): a brief summary of what this step \
accomplishes

Rules:
- One step = one logical action a reader would perform (e.g., "navigate to \
bookmarks and click RLI"), even if the narrator pauses or elaborates across \
multiple sentences.
- If the narrator explains why or describes what's visible, keep that text \
in narration_text of the same step -- do not split it off into its own step.
- Do not invent content. Use only sentences present in the input transcript.
- Timestamps must come from the input transcript. Do not round.
- Skip pure filler at the end like "and that's all" or "thanks for watching".

Return ONLY the JSON object. No prose before or after.\
"""


async def segment_transcript(
    transcript: dict[str, Any],
) -> list[dict[str, Any]]:
    """Segment a Whisper transcript into logical tutorial steps.

    Primary path: GPT-5.4 semantic segmentation. Falls back to the
    rule-based algorithm if AI segmentation fails or is unavailable.

    Args:
        transcript: dict from Whisper API verbose_json (or transcribe()'s
            return). Reads the 'segments' key.

    Returns:
        A list of step dicts, each with keys 'start_time', 'end_time',
        'narration_text', and 'step_intent'. The 'step_intent' field is
        empty when the rule-based fallback is used. Empty list if the
        transcript has no segments.
    """
    raw = transcript.get("segments") or []
    if not raw:
        return []

    try:
        ai_steps = await _segment_with_ai(transcript)
        if ai_steps:
            return ai_steps
        print(
            "AI segmentation returned no usable steps, "
            "falling back to rule-based.",
            file=sys.stderr,
        )
    except Exception as exc:
        # DECISION: any AI failure (timeout, network, parsing, validation)
        # degrades to rule-based rather than killing the request. The
        # rule-based path was the original v1 implementation and is known
        # to produce a reasonable document.
        print(
            f"AI segmentation failed ({exc!r}), falling back to rule-based.",
            file=sys.stderr,
        )

    rule_steps = segment_transcript_rule_based(transcript)
    return [{**s, "step_intent": ""} for s in rule_steps]


async def _segment_with_ai(
    transcript: dict[str, Any],
) -> list[dict[str, Any]] | None:
    """Call GPT-5.4 to segment the transcript semantically.

    Returns a validated list of step dicts on success, or None if the API
    key is missing or the response fails validation. Raises on network/API
    errors so the caller can log and fall back.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    raw_segments = transcript.get("segments") or []
    transcript_text = "\n".join(
        f"[{float(seg['start']):.2f}-{float(seg['end']):.2f}] "
        f"{str(seg['text']).strip()}"
        for seg in raw_segments
    )
    user_message = "Transcript with timestamps:\n\n" + transcript_text

    transcript_duration = max(
        (float(seg["end"]) for seg in raw_segments),
        default=0.0,
    )

    async with AsyncOpenAI(api_key=api_key, timeout=GPT_TIMEOUT_SECONDS) as client:
        response = await client.chat.completions.create(
            model=GPT_MODEL,
            reasoning_effort=GPT_REASONING_EFFORT,
            max_completion_tokens=GPT_MAX_COMPLETION_TOKENS,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
        )

    content = response.choices[0].message.content or ""
    parsed = json.loads(content)
    return _validate_ai_steps(parsed, transcript_duration)


def _validate_ai_steps(
    parsed: Any,
    transcript_duration: float,
) -> list[dict[str, Any]] | None:
    """Validate the model's JSON output. Returns None if any step is bad."""
    if not isinstance(parsed, dict):
        return None
    steps = parsed.get("steps")
    if not isinstance(steps, list) or not steps:
        return None

    validated: list[dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict):
            return None
        try:
            start_time = float(step["start_time"])
            end_time = float(step["end_time"])
        except (KeyError, TypeError, ValueError):
            return None
        narration_text = step.get("narration_text")
        step_intent = step.get("step_intent", "")
        if not isinstance(narration_text, str) or not narration_text.strip():
            return None
        if not isinstance(step_intent, str):
            return None
        if start_time < 0 or end_time <= start_time:
            return None
        if (
            transcript_duration > 0
            and end_time > transcript_duration + _END_TIME_OVERSHOOT_TOLERANCE
        ):
            return None
        validated.append(
            {
                "start_time": start_time,
                "end_time": min(end_time, transcript_duration)
                if transcript_duration > 0
                else end_time,
                "narration_text": narration_text.strip(),
                "step_intent": step_intent.strip(),
            }
        )
    return validated


def segment_transcript_rule_based(
    transcript: dict[str, Any],
) -> list[dict[str, Any]]:
    """Apply the deterministic rule-based segmentation algorithm.

    Used as the fallback when AI segmentation fails, and as a synchronous
    entry point for unit tests. Returns step dicts with 'start_time',
    'end_time', and 'narration_text' (no 'step_intent' -- that field is
    populated only by the AI path).
    """
    raw = transcript.get("segments") or []
    if not raw:
        return []

    steps = [
        {
            "start_time": float(s["start"]),
            "end_time": float(s["end"]),
            "narration_text": str(s["text"]).strip(),
        }
        for s in raw
    ]

    steps = _merge_adjacent(steps)
    steps = _split_long(steps)
    steps = _drop_short_fillers(steps)

    return steps


def _word_count(text: str) -> int:
    return len(text.split())


def _merge_adjacent(steps: list[dict]) -> list[dict]:
    """Rule 2: merge adjacent segments < 3s apart and < 15 words each."""
    if not steps:
        return []
    out = [dict(steps[0])]
    for step in steps[1:]:
        prev = out[-1]
        gap = step["start_time"] - prev["end_time"]
        if (
            gap < MERGE_MAX_GAP_SECONDS
            and _word_count(prev["narration_text"]) < MERGE_MAX_WORDS_EACH
            and _word_count(step["narration_text"]) < MERGE_MAX_WORDS_EACH
        ):
            prev["end_time"] = step["end_time"]
            prev["narration_text"] = (
                prev["narration_text"] + " " + step["narration_text"]
            ).strip()
        else:
            out.append(dict(step))
    return out


def _split_long(steps: list[dict]) -> list[dict]:
    """Rule 3: split segments > 30s or > 60 words at sentence boundaries."""
    out = []
    for step in steps:
        duration = step["end_time"] - step["start_time"]
        words = _word_count(step["narration_text"])
        if duration <= SPLIT_MAX_DURATION_SECONDS and words <= SPLIT_MAX_WORDS:
            out.append(step)
            continue
        sentences = [
            s.strip()
            for s in _SENTENCE_BOUNDARY.split(step["narration_text"])
            if s.strip()
        ]
        if len(sentences) <= 1:
            out.append(step)
            continue
        total_chars = sum(len(s) for s in sentences) or 1
        cursor = step["start_time"]
        total_duration = step["end_time"] - step["start_time"]
        for i, sentence in enumerate(sentences):
            share = len(sentence) / total_chars
            this_end = (
                step["end_time"]
                if i == len(sentences) - 1
                else cursor + total_duration * share
            )
            out.append(
                {
                    "start_time": cursor,
                    "end_time": this_end,
                    "narration_text": sentence,
                }
            )
            cursor = this_end
    return out


def _drop_short_fillers(steps: list[dict]) -> list[dict]:
    """Rule 4: drop segments < 2s with < 5 words."""
    return [
        step
        for step in steps
        if not (
            (step["end_time"] - step["start_time"]) < DROP_MAX_DURATION_SECONDS
            and _word_count(step["narration_text"]) < DROP_MAX_WORDS
        )
    ]
