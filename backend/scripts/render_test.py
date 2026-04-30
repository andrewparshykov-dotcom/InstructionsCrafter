"""Render-test the InstructionsCrafter Word template with mock data.

Generates a sample 3-step document at /tmp/render_test_output.docx so a
human can open it in Word and review how the template looks with real
content (substituted title, captions, embedded images, etc.).

Run from the project root with the venv activated:
    python backend/scripts/render_test.py
"""

import subprocess
from datetime import date
from pathlib import Path

from docx.shared import Mm
from docxtpl import DocxTemplate, InlineImage

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TEMPLATE_PATH = (
    PROJECT_ROOT / "backend" / "templates" / "instruction_template.docx"
)
OUTPUT_PATH = Path("/tmp/render_test_output.docx")
ASSET_DIR = Path("/tmp/render_test_assets")


def make_test_frames() -> list[Path]:
    """Build 3 sample JPEG screenshots via FFmpeg's synthetic testsrc."""
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    test_mp4 = ASSET_DIR / "test.mp4"

    # 30-second 1280x720 test pattern. The visible frame counter and
    # color bars make the per-step screenshots visually distinct.
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "testsrc=duration=30:size=1280x720:rate=30",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(test_mp4),
        ],
        check=True, capture_output=True, timeout=30,
    )

    frames = []
    for i, ts in enumerate((5, 15, 25), start=1):
        frame_path = ASSET_DIR / f"frame_{i}.jpg"
        subprocess.run(
            [
                "ffmpeg", "-y", "-ss", str(ts), "-i", str(test_mp4),
                "-frames:v", "1", "-q:v", "2", str(frame_path),
            ],
            check=True, capture_output=True, timeout=30,
        )
        frames.append(frame_path)
    return frames


def main() -> None:
    if not TEMPLATE_PATH.exists():
        raise SystemExit(f"Template not found: {TEMPLATE_PATH}")

    frames = make_test_frames()

    doc = DocxTemplate(str(TEMPLATE_PATH))

    context = {
        "title": "Step-by-Step Guide to Configuring a Network Proxy",
        "date": date.today().strftime("%B %d, %Y"),
        "steps": [
            {
                "instruction": (
                    "Open the application by clicking its icon on the desktop. "
                    "Wait for the main window to appear before continuing."
                ),
                "image": InlineImage(doc, str(frames[0]), width=Mm(150)),
                "caption": "The application's main window after launch.",
            },
            {
                "instruction": (
                    "Locate the gear icon in the top-right corner of the main "
                    "window and click it to open the settings menu."
                ),
                "image": InlineImage(doc, str(frames[1]), width=Mm(150)),
                "caption": "The settings gear icon in the top-right corner.",
            },
            {
                "instruction": (
                    "In the network panel, scroll down to the proxy options. "
                    "Enable the checkbox, enter your host and port, then click "
                    "Save to apply."
                ),
                "image": InlineImage(doc, str(frames[2]), width=Mm(150)),
                "caption": "The proxy options panel with the save button at the bottom.",
            },
        ],
    }

    doc.render(context)
    doc.save(str(OUTPUT_PATH))
    print(f"Wrote: {OUTPUT_PATH}  ({OUTPUT_PATH.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
