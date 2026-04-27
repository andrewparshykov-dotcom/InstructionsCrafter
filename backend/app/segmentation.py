"""Transcript segmentation into logical steps.

Implements the rule-based algorithm described in ARCHITECTURE.md
"Transcript segmentation". Takes a Whisper verbose_json transcript and
returns a list of step dicts ready for screenshot extraction and polishing.
"""

import re
from typing import Any

# Algorithm tuning constants from ARCHITECTURE.md "Transcript segmentation".
MERGE_MAX_GAP_SECONDS = 3.0
MERGE_MAX_WORDS_EACH = 15
SPLIT_MAX_DURATION_SECONDS = 30.0
SPLIT_MAX_WORDS = 60
DROP_MAX_DURATION_SECONDS = 2.0
DROP_MAX_WORDS = 5

# Split text at sentence-ending punctuation followed by whitespace.
# Keeps the punctuation attached to the preceding sentence.
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")


def segment_transcript(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply the 4-rule segmentation algorithm to a Whisper transcript.

    Args:
        transcript: dict from Whisper API verbose_json (or transcribe()'s
            return). Reads only the 'segments' key.

    Returns:
        A list of step dicts, each with keys 'start_time', 'end_time',
        and 'narration_text'. Empty if the transcript has no segments.
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
            # DECISION: ARCHITECTURE.md says split "at the nearest sentence
            # boundary" but does not specify behavior when there is none.
            # Keeping the segment whole is the safest choice — splitting
            # mid-sentence would harm readability.
            out.append(step)
            continue
        # Apportion the original time range across sentences proportionally
        # by character count. ARCHITECTURE.md does not specify how to
        # redistribute timestamps after splitting; proportional-by-chars is
        # the simplest faithful estimate.
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
