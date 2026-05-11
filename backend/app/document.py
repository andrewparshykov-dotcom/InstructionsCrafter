"""Word document rendering using python-docx-template (docxtpl).

Loads the project's instruction template, fills it with the title, date,
and a list of polished steps (each with an inline screenshot), and writes
the final .docx.

Per-step dynamic screenshot sizing: each step's image width is chosen
based on the length of its polished instruction so that the heading +
instruction + image + caption all fit on one landscape A4 page. Width is
clamped to [MIN_IMAGE_WIDTH_MM, MAX_IMAGE_WIDTH_MM] and snapped down to
the nearest SNAP_INCREMENT_MM for visual rhythm across the document.
"""

import math
from datetime import date
from pathlib import Path
from typing import Any

from docx.shared import Mm
from docxtpl import DocxTemplate, InlineImage
from fastapi import HTTPException
from PIL import Image

# Resolve the template path relative to this file so the function works
# regardless of the caller's current working directory.
TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent
    / "templates"
    / "instruction_template.docx"
)

# --- Dynamic screenshot sizing -----------------------------------------

# Width clamping range. Below 100 mm screenshots become hard to read;
# above 220 mm there is no benefit and the keep-with-next group may
# overflow the page.
MIN_IMAGE_WIDTH_MM = 100
MAX_IMAGE_WIDTH_MM = 220

# Round computed widths down to a multiple of this many millimetres so
# screenshots across the document fall into a small set of distinct
# sizes (visual rhythm rather than arbitrary widths).
SNAP_INCREMENT_MM = 10

# Vertical padding (inches) between the bottom of the screenshot and the
# page edge, absorbing minor errors in text-height estimation.
SAFETY_MARGIN_IN = 0.3

# Page geometry. Must stay in sync with the section properties set by
# scripts/build_template.py (landscape A4, 0.25 in margins all sides).
PAGE_CONTENT_HEIGHT_IN = 7.77
PAGE_CONTENT_WIDTH_IN = 11.19

# Approximate inches consumed by everything on a step's page except the
# instruction text and the image itself: heading, caption, paragraph
# spacing, blank breathing line.
STEP_OVERHEAD_IN = 1.0

# Body text metrics used to estimate how tall instruction text will be
# when rendered. 11pt Body Text on a landscape A4 line (~11.19 in wide)
# fits roughly 150 characters; line height with default 1.15x spacing
# is about 0.20 in.
CHARS_PER_LINE = 150
LINE_HEIGHT_IN = 0.20

# Fallback aspect ratio (height / width) if a screenshot file cannot be
# read. 9/16 matches typical screen-recording resolutions (1080p, 1440p).
_FALLBACK_ASPECT_RATIO = 9.0 / 16.0


def _estimate_instruction_height_in(text: str) -> float:
    """Estimate the rendered height (inches) of an instruction paragraph.

    Approximates Word's line wrapping by dividing character count by
    CHARS_PER_LINE, rounded up, then multiplied by LINE_HEIGHT_IN.
    """
    char_count = max(1, len(text))
    lines = max(1, math.ceil(char_count / CHARS_PER_LINE))
    return lines * LINE_HEIGHT_IN


def _get_image_aspect_ratio(path: Path) -> float:
    """Return height/width for the image at `path`.

    Falls back to _FALLBACK_ASPECT_RATIO if the file is unreadable or
    has zero width.
    """
    try:
        with Image.open(path) as img:
            if img.width <= 0:
                return _FALLBACK_ASPECT_RATIO
            return img.height / img.width
    except (OSError, ValueError):
        return _FALLBACK_ASPECT_RATIO


def _pick_image_width_mm(
    instruction: str,
    screenshot_path: Path,
) -> int:
    """Pick the screenshot display width (mm) for one step.

    Sizes the image so the heading + instruction + image + caption all
    fit on a single landscape A4 page. Result is clamped to
    [MIN_IMAGE_WIDTH_MM, MAX_IMAGE_WIDTH_MM] and snapped down to the
    nearest SNAP_INCREMENT_MM.
    """
    text_height_in = _estimate_instruction_height_in(instruction)
    available_image_height_in = (
        PAGE_CONTENT_HEIGHT_IN
        - STEP_OVERHEAD_IN
        - text_height_in
        - SAFETY_MARGIN_IN
    )

    # If the instruction alone exhausts the page, fall back to the
    # minimum width and accept that this single step will overflow.
    # keep_with_next on the template still keeps the step together.
    if available_image_height_in <= 0:
        return MIN_IMAGE_WIDTH_MM

    aspect = _get_image_aspect_ratio(screenshot_path)
    # aspect = height / width, so width_in = height_in / aspect.
    width_in = available_image_height_in / aspect
    width_mm = width_in * 25.4

    # Clamp to the allowed range.
    width_mm = max(MIN_IMAGE_WIDTH_MM, min(MAX_IMAGE_WIDTH_MM, width_mm))

    # Snap down to the nearest grid step.
    snapped = (int(width_mm) // SNAP_INCREMENT_MM) * SNAP_INCREMENT_MM

    # Snapping after clamping could land just below MIN; re-clamp to keep
    # the [MIN, MAX] contract.
    return max(MIN_IMAGE_WIDTH_MM, snapped)


# --- Public API --------------------------------------------------------


def render_document(
    title: str,
    polished_steps: list[dict[str, Any]],
    output_path: Path,
) -> Path:
    """Render the instruction template into a finished .docx file.

    Args:
        title: Document title -- fills the {{ title }} placeholder.
        polished_steps: list of step dicts. Each must have keys:
            - 'screenshot_path' (Path or str): JPEG file for the step image.
            - 'instruction' (str): polished imperative-voice instruction.
            - 'caption' (str): one-line description of the screenshot.
        output_path: Destination path for the rendered .docx.

    Returns:
        `output_path` on success.

    Raises:
        HTTPException(500) if the template is missing or rendering fails.
    """
    if not TEMPLATE_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail="Document template is missing on the server",
        )

    try:
        doc = DocxTemplate(str(TEMPLATE_PATH))
        context = {
            "title": title,
            "date": date.today().strftime("%B %d, %Y"),
            "steps": [
                {
                    "image": InlineImage(
                        doc,
                        str(step["screenshot_path"]),
                        width=Mm(
                            _pick_image_width_mm(
                                step["instruction"],
                                Path(step["screenshot_path"]),
                            )
                        ),
                    ),
                    "instruction": step["instruction"],
                    "caption": step["caption"],
                }
                for step in polished_steps
            ],
        }
        doc.render(context)
        doc.save(str(output_path))
    except Exception as e:
        # Re-raise as a sanitized HTTPException; the original `e` is preserved
        # in the chain so server logs (uvicorn/journald) capture the cause.
        raise HTTPException(
            status_code=500,
            detail="Document rendering failed",
        ) from e

    return output_path
