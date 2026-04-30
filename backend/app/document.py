"""Word document rendering using python-docx-template (docxtpl).

Loads the project's instruction template, fills it with the title, date,
and a list of polished steps (each with an inline screenshot), and writes
the final .docx.
"""

from datetime import date
from pathlib import Path
from typing import Any

from docx.shared import Mm
from docxtpl import DocxTemplate, InlineImage
from fastapi import HTTPException

# Resolve the template path relative to this file so the function works
# regardless of the caller's current working directory.
TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent
    / "templates"
    / "instruction_template.docx"
)

# ARCHITECTURE.md: max 150mm wide for inline screenshots.
IMAGE_WIDTH_MM = 150


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
                        width=Mm(IMAGE_WIDTH_MM),
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
