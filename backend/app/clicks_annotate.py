"""Draw a Scribe-style ring marker on a click screenshot (Pillow).

The extension captures each screenshot with ``chrome.tabs.captureVisibleTab``,
whose pixels are the tab viewport scaled by the device pixel ratio (dpr). The
recorded click coordinates are CSS pixels relative to that viewport, so the
marker's center in image pixels is ``(x*dpr, y*dpr)``. We draw a high-contrast
hollow ring -- with a white halo on both edges so it reads on any background --
centered there.

Anti-aliasing: ``ImageDraw`` does none, so the ring is rendered on a small
supersampled RGBA tile and downscaled with LANCZOS before compositing. That
gives smooth edges at a fraction of the memory of supersampling the whole image.

Best-effort by design: a bad/off-screen coordinate or any Pillow error simply
leaves the screenshot unmarked -- a missing ring must never fail a document.
"""

import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# Ring geometry as a fraction of the image's larger side, so the marker looks
# the same on a 1080p shot and a 4K one. Env-overridable, matching the rest of
# the backend's tuning-knob style.
RING_RADIUS_FRAC = float(os.getenv("CLICK_RING_RADIUS_FRAC", "0.020"))
RING_MIN_RADIUS_PX = int(os.getenv("CLICK_RING_MIN_RADIUS_PX", "22"))

# Stroke width and halo width, as fractions of the ring radius.
_STROKE_FRAC = 0.22
_HALO_FRAC = 0.16

# Vivid red-orange ring under a near-opaque white halo.
_RING_COLOR = (255, 45, 40, 255)
_HALO_COLOR = (255, 255, 255, 235)

# Supersample factor for the ring tile (then downscaled for anti-aliasing).
_SUPERSAMPLE = 4

# Re-encode quality for the marked JPEG. The pipeline resizes/re-encodes again
# afterward (screenshots.resize_screenshot), so this is just an intermediate.
_JPEG_QUALITY = 90

# Cursor-arrow geometry for manual (hotkey) captures. The base polygon (a classic
# pointer, tip at 0,0) is in arbitrary units; it is scaled to the image size and
# drawn white-filled with a dark outline so it reads on any background.
_POINTER_BASE = [
    (0.0, 0.0),    # tip (the marked point)
    (0.0, 16.0),
    (3.5, 12.5),
    (6.0, 18.0),
    (8.0, 17.0),
    (5.5, 11.5),
    (11.5, 11.5),
]
_POINTER_FILL = (255, 255, 255, 255)
_POINTER_OUTLINE = (20, 20, 24, 255)
# Arrow tip-to-tail length as a fraction of the image's larger side.
POINTER_LENGTH_FRAC = float(os.getenv("CLICK_POINTER_LENGTH_FRAC", "0.032"))
POINTER_MIN_LENGTH_PX = int(os.getenv("CLICK_POINTER_MIN_LENGTH_PX", "30"))


def annotate_click(
    image_path: Path, x: float, y: float, dpr: float, marker: str = "ring"
) -> Path:
    """Draw a marker, in place, on the JPEG at ``image_path``.

    ``x``/``y`` are CSS pixels from the viewport's top-left; ``dpr`` is the
    device pixel ratio at capture time. ``marker`` is ``"ring"`` (a click --
    a hollow circle centered on the point) or ``"pointer"`` (a manual/hotkey
    capture -- a cursor arrow whose TIP lands on the point, since
    captureVisibleTab never includes the real OS cursor). Returns ``image_path``
    either way.
    """
    try:
        dpr = float(dpr) if dpr and float(dpr) > 0 else 1.0
        with Image.open(image_path) as im:
            base = im.convert("RGBA")

        w, h = base.size
        cx = round(float(x) * dpr)
        cy = round(float(y) * dpr)
        # Off-viewport / junk coords (incl. the -1,-1 used when no point is
        # known) -> leave the shot unmarked rather than draw in the wrong place.
        if not (0 <= cx < w and 0 <= cy < h):
            return image_path

        if marker == "pointer":
            tile, (anchor_x, anchor_y) = _pointer_tile(max(w, h))
            base.paste(tile, (cx - anchor_x, cy - anchor_y), tile)
        else:
            radius = max(RING_MIN_RADIUS_PX, round(max(w, h) * RING_RADIUS_FRAC))
            stroke = max(2, round(radius * _STROKE_FRAC))
            halo = max(1, round(radius * _HALO_FRAC))
            tile = _ring_tile(radius, stroke, halo)
            # paste() (unlike alpha_composite) clips gracefully when the tile
            # runs past an image edge; the tile's own alpha is the blend mask.
            base.paste(tile, (cx - tile.width // 2, cy - tile.height // 2), tile)

        base.convert("RGB").save(image_path, "JPEG", quality=_JPEG_QUALITY)
    except (OSError, ValueError) as exc:
        print(f"annotate_click: skipped marker ({exc!r})", file=sys.stderr)
    return image_path


def _ring_tile(radius: int, stroke: int, halo: int) -> Image.Image:
    """A smooth ring (white halo on both edges of a colored stroke) on a small
    transparent RGBA tile, supersampled then downscaled for anti-aliasing.

    Built from four concentric filled disks (outermost first); each ``fill``
    overwrites the center, and a final transparent disk punches the hole. From
    outside in the result reads: halo / color / halo / transparent.
    """
    pad = stroke + halo + 2
    size = 2 * (radius + pad)
    s = _SUPERSAMPLE

    big = Image.new("RGBA", (size * s, size * s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    c = (size * s) // 2
    r = radius * s
    half = (stroke * s) / 2
    halo_s = halo * s

    _disk(draw, c, r + half + halo_s, _HALO_COLOR)   # outer halo edge
    _disk(draw, c, r + half, _RING_COLOR)            # colored ring (outer)
    _disk(draw, c, r - half, _HALO_COLOR)            # inner halo edge
    _disk(draw, c, r - half - halo_s, (0, 0, 0, 0))  # punch transparent hole

    return big.resize((size, size), Image.Resampling.LANCZOS)


def _disk(draw: ImageDraw.ImageDraw, center: float, radius: float, color) -> None:
    """Fill a disk of ``radius`` centered at ``(center, center)``. ``fill``
    writes raw RGBA values (no blending), so a transparent color erases."""
    r = max(0.0, radius)
    draw.ellipse([center - r, center - r, center + r, center + r], fill=color)


def _pointer_tile(max_dim: int):
    """Render a cursor-arrow tile (supersampled for anti-aliasing).

    Returns ``(tile, (anchor_x, anchor_y))`` where the anchor is the arrow tip's
    location within the tile, so pasting at ``(cx - anchor_x, cy - anchor_y)``
    lands the tip exactly on the target point.
    """
    length = max(POINTER_MIN_LENGTH_PX, round(max_dim * POINTER_LENGTH_FRAC))
    unit = length / 18.0  # the base polygon spans ~18 units tall
    pad = max(3, round(length * 0.16))
    s = _SUPERSAMPLE

    pts = [((px * unit) + pad, (py * unit) + pad) for (px, py) in _POINTER_BASE]
    width_px = round(11.5 * unit + 2 * pad)
    height_px = round(18.0 * unit + 2 * pad)

    big = Image.new("RGBA", (width_px * s, height_px * s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    draw.polygon(
        [(px * s, py * s) for (px, py) in pts],
        fill=_POINTER_FILL,
        outline=_POINTER_OUTLINE,
        width=max(1, round(1.6 * unit * s)),
    )
    tile = big.resize((width_px, height_px), Image.Resampling.LANCZOS)
    # The tip is base point (0,0), which mapped to (pad, pad).
    return tile, (pad, pad)
