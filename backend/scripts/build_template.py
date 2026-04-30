"""Generate the InstructionsCrafter Word template.

Writes a python-docx-template (docxtpl)-compatible .docx file at
backend/templates/instruction_template.docx.

The template provides these placeholders:
    {{ title }}              -- document title (top of page)
    {{ date }}               -- formatted generation date
    {%p for step in steps %} -- begin per-step block
        {{ loop.index }}     -- current step number (1, 2, 3, ...)
        {{ step.instruction }}
        {{ step.image }}     -- replaced with an InlineImage by docxtpl
        {{ step.caption }}
    {%p endfor %}            -- end per-step block

The team can later open the resulting .docx in Microsoft Word and
adjust fonts, colors, or spacing -- but the Jinja tags ({{ ... }} and
{%p ... %}) must be preserved or rendering will break.

Re-running this script overwrites any manual edits to the .docx, so
adjust the script (or stop using it) once the template is finalized.

Run from the project root:
    python backend/scripts/build_template.py
"""

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt

OUTPUT = (
    Path(__file__).resolve().parent.parent
    / "templates"
    / "instruction_template.docx"
)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()

    # Page setup: A4 with 2.5 cm uniform margins (ARCHITECTURE.md spec).
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.5)

    # Title -- 24pt bold, centered (Title style).
    title_p = doc.add_paragraph(style=doc.styles["Title"])
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_p.add_run("{{ title }}")

    # Subtitle -- italic, centered (Subtitle style already styles this).
    subtitle_p = doc.add_paragraph(style=doc.styles["Subtitle"])
    subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle_p.add_run("Generated on {{ date }}")

    # For-loop opener -- {%p ... %} tells docxtpl to delete the entire
    # paragraph after processing, so no blank line appears in output.
    doc.add_paragraph("{%p for step in steps %}")

    # Step heading -- "Step N" (Heading 2 style).
    heading_p = doc.add_paragraph(style=doc.styles["Heading 2"])
    heading_p.add_run("Step {{ loop.index }}")

    # Instruction body -- justified, 12pt space-after (Body Text style).
    instruction_p = doc.add_paragraph(style=doc.styles["Body Text"])
    instruction_p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    instruction_p.paragraph_format.space_after = Pt(12)
    instruction_p.add_run("{{ step.instruction }}")

    # Image placeholder -- centered. docxtpl replaces {{ step.image }} with
    # the InlineImage object passed in the rendering context.
    image_p = doc.add_paragraph()
    image_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    image_p.add_run("{{ step.image }}")

    # Caption -- italic, centered (Caption style is italic by default).
    caption_p = doc.add_paragraph(style=doc.styles["Caption"])
    caption_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption_p.add_run("{{ step.caption }}")

    # Blank line for visual breathing room between steps.
    doc.add_paragraph()

    # For-loop closer.
    doc.add_paragraph("{%p endfor %}")

    doc.save(OUTPUT)
    print(f"Wrote: {OUTPUT}")
    print(f"Size:  {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
