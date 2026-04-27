"""Unit tests for app.segmentation.segment_transcript().

Run from the project root with:

    python backend/tests/test_segmentation.py
"""

import sys
from pathlib import Path

# Allow `from app.segmentation import ...` when this script is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.segmentation import segment_transcript  # noqa: E402


def _seg(start: float, end: float, text: str) -> dict:
    """Build a Whisper-shaped raw segment dict."""
    return {"start": start, "end": end, "text": text}


# ----- Empty / trivial inputs -----


def test_empty_transcript_returns_empty_list():
    assert segment_transcript({}) == []
    assert segment_transcript({"segments": []}) == []
    assert segment_transcript({"segments": None}) == []


def test_single_segment_passes_through():
    transcript = {"segments": [_seg(0.0, 5.0, "Click the file menu.")]}
    result = segment_transcript(transcript)
    assert len(result) == 1
    assert result[0]["start_time"] == 0.0
    assert result[0]["end_time"] == 5.0
    assert result[0]["narration_text"] == "Click the file menu."


def test_segments_with_leading_whitespace_are_stripped():
    # Whisper API often returns segments with a leading space.
    transcript = {"segments": [_seg(0.0, 2.0, " Click save.")]}
    result = segment_transcript(transcript)
    assert result[0]["narration_text"] == "Click save."


# ----- Rule 2: merge adjacent short segments -----


def test_rule_2_merges_adjacent_short_segments():
    transcript = {
        "segments": [
            _seg(0.0, 1.5, "Click the file menu."),
            _seg(2.5, 4.0, "Then save as."),
        ]
    }
    result = segment_transcript(transcript)
    assert len(result) == 1
    assert result[0]["start_time"] == 0.0
    assert result[0]["end_time"] == 4.0
    assert result[0]["narration_text"] == "Click the file menu. Then save as."


def test_rule_2_does_not_merge_when_gap_exceeds_3_seconds():
    transcript = {
        "segments": [
            # Both segs are deliberately big enough (>= 5 words) to survive
            # rule 4's filler-drop, so the only remaining question is whether
            # the 3.5s gap blocks the rule-2 merge -- which it should.
            _seg(0.0, 2.5, "Click the file menu carefully."),  # 5 words
            _seg(6.0, 8.5, "Then save the document please."),  # 5 words, gap = 3.5s
        ]
    }
    result = segment_transcript(transcript)
    assert len(result) == 2, f"expected 2 steps, got {len(result)}"


def test_rule_2_does_not_merge_when_either_segment_is_long():
    long_text = " ".join(["word"] * 16)  # 16 words, fails the < 15 check
    transcript = {
        "segments": [
            _seg(0.0, 5.0, long_text),
            # 6 words so it survives rule 4's filler-drop without needing merge
            _seg(5.5, 7.0, "Short text here for the test."),
        ]
    }
    result = segment_transcript(transcript)
    assert len(result) == 2, f"expected 2 steps, got {len(result)}"


def test_filler_between_meaningful_segments_gets_absorbed_via_merge():
    transcript = {
        "segments": [
            _seg(0.0, 1.5, "Click file menu."),
            _seg(2.0, 2.8, "Um okay."),
            _seg(3.5, 5.0, "Then save."),
        ]
    }
    # All gaps < 3s and all word counts < 15 -> all three merge into one.
    result = segment_transcript(transcript)
    assert len(result) == 1


# ----- Rule 3: split very long segments -----


def test_rule_3_splits_long_segment_at_sentence_boundaries():
    text = (
        "First click the file menu. "
        "Then choose save as. "
        "Finally enter the filename and click save."
    )
    transcript = {"segments": [_seg(0.0, 35.0, text)]}  # 35s > 30s
    result = segment_transcript(transcript)
    assert len(result) == 3
    # All sub-segments should end with sentence punctuation
    for s in result:
        assert s["narration_text"].rstrip().endswith((".", "!", "?"))
    # Time range is preserved and monotonic
    assert result[0]["start_time"] == 0.0
    assert result[-1]["end_time"] == 35.0
    for i in range(len(result) - 1):
        assert result[i]["end_time"] == result[i + 1]["start_time"]


def test_rule_3_splits_when_word_count_exceeds_60():
    sentence = "First we will click on the file menu and then save the file. "
    text = sentence * 7  # ~84 words
    transcript = {"segments": [_seg(0.0, 25.0, text)]}  # 25s < 30s but words > 60
    result = segment_transcript(transcript)
    assert len(result) >= 2


def test_rule_3_keeps_long_segment_with_no_sentence_boundaries():
    # A long segment with no period/question/exclamation -- can't split sensibly.
    transcript = {"segments": [_seg(0.0, 35.0, " ".join(["word"] * 70))]}
    result = segment_transcript(transcript)
    assert len(result) == 1


# ----- Rule 4: drop short filler segments -----


def test_rule_4_drops_short_isolated_filler():
    transcript = {
        "segments": [
            _seg(0.0, 5.0, "Click the file menu and select save as."),
            _seg(10.0, 11.5, "Um okay."),  # 1.5s, 2 words; isolated by big gaps
            _seg(15.0, 20.0, "Now type your filename."),
        ]
    }
    result = segment_transcript(transcript)
    assert len(result) == 2
    assert all("Um okay" not in s["narration_text"] for s in result)


def test_rule_4_does_not_drop_short_segment_with_many_words():
    # 1.5s but 6 words -- only one of the two drop conditions met -> keep.
    transcript = {"segments": [_seg(0.0, 1.5, "click save now please thank you")]}
    result = segment_transcript(transcript)
    assert len(result) == 1


def test_rule_4_does_not_drop_long_segment_with_few_words():
    # 3s but only 2 words -- only one of the two drop conditions met -> keep.
    transcript = {"segments": [_seg(0.0, 3.0, "click save")]}
    result = segment_transcript(transcript)
    assert len(result) == 1


# ----- Architecture verification -----


def test_verification_5min_narration_produces_8_to_12_steps():
    """ARCHITECTURE.md Phase 4 verification:
    Given a real transcript of 5-min narration, produce a sensible list
    of 8-12 steps.
    """
    # Synthetic 5-minute Whisper-shaped transcript. Designed to exercise
    # all four rules together: pairs of short adjacent segments that should
    # merge, a long segment that should split at a sentence boundary, a
    # couple of isolated short fillers that should be dropped, and several
    # well-formed standalone steps that pass through unchanged.
    segments = [
        # Two short segs with brief gap -> merge (rule 2)
        _seg(0, 4, "Hello and welcome to this tutorial."),
        _seg(5, 11, "Today we will configure the network proxy."),
        # Single seg
        _seg(15, 24, "First, open the application by clicking its icon on the desktop."),
        # Isolated short filler -> drop (rule 4)
        _seg(27, 27.8, "Okay."),
        # Two short segs with brief gap -> merge (rule 2)
        _seg(32, 36, "Look for the settings icon."),
        _seg(36.5, 43, "It is the gear in the top-right corner."),
        # 40s long seg with two sentences -> split (rule 3)
        _seg(
            50,
            90,
            "Click on it to open the settings menu. "
            "Find the network configuration section in the sidebar list.",
        ),
        # Single seg
        _seg(95, 114, "In the network panel, scroll down to the proxy options area."),
        # Single seg
        _seg(120, 139, "Enable the proxy checkbox and enter your host and port number."),
        # Single seg
        _seg(145, 169, "Click the save button at the bottom of the panel to apply."),
        # Isolated short filler -> drop (rule 4)
        _seg(175, 175.8, "So."),
        # Single seg
        _seg(180, 209, "Restart the application to make the new settings take effect."),
        # Single seg
        _seg(215, 249, "Verify the connection by opening any website in your browser now."),
        # Closing seg
        _seg(260, 284, "And that completes the network configuration tutorial."),
    ]
    transcript = {"segments": segments}
    result = segment_transcript(transcript)

    print(f"\n  Produced {len(result)} steps from {len(segments)} raw segments:")
    for i, s in enumerate(result, 1):
        dur = s["end_time"] - s["start_time"]
        preview = s["narration_text"][:64]
        print(
            f"    Step {i:2}: {s['start_time']:6.1f}-{s['end_time']:6.1f}s "
            f"({dur:5.1f}s)  {preview!r}"
        )

    assert 8 <= len(result) <= 12, (
        f"Expected 8-12 steps from 5-minute narration, got {len(result)}"
    )


# ----- Runner -----


def main():
    tests = sorted(
        (name, fn)
        for name, fn in globals().items()
        if name.startswith("test_") and callable(fn)
    )
    failures = []
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS  {name}")
        except AssertionError as e:
            failures.append((name, e))
            print(f"  FAIL  {name}: {e}")
        except Exception as e:
            failures.append((name, e))
            print(f"  ERROR {name}: {type(e).__name__}: {e}")

    print()
    if failures:
        print(f"{len(failures)} of {len(tests)} tests FAILED")
        sys.exit(1)
    print(f"All {len(tests)} tests passed")


if __name__ == "__main__":
    main()
