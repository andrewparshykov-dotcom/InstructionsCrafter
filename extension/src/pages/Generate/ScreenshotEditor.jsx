import React, { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import { colors, fonts, radius, space, sizes } from "../../design/tokens";

// Screenshot annotation editor for Click-capture mode (DECISION 2026-06-02).
//
// Opens on the Generate page when the user clicks a screenshot in the strip.
// Three tools: Blur (mosaic/pixelate redaction), Arrow, and Pen (freehand).
// We REUSE the fabric.js library that the video-mode in-page tool already
// depends on, but NOT its components — those are wired into the live-recording
// ContentState. This editor is self-contained and operates on a static image.
//
// Editing model = RE-EDITABLE (Andrew's pick): annotations are stored as plain
// fabric vector objects (arrows, pen paths) plus lightweight blur rectangles,
// serialized to JSON. Reopening a screenshot restores them as movable objects.
// The pixels are only "baked" into a flattened JPEG at save time (for the strip
// thumbnail + upload); the original screenshot blob is never mutated.
//
// Blur is shown DURING editing as a shaded placeholder box (re-editable as a
// normal rectangle, and lightweight to serialize — no embedded image data).
// The real mosaic is rasterized at flatten time on a full-resolution canvas, so
// the hidden content is destroyed in the pixels before anything is uploaded.
// The flattened image keeps the screenshot's exact pixel dimensions so the
// backend's click-marker (placed from meta x/y/dpr) still lands correctly.

const PALETTE = ["#E5484D", "#3080F8", "#F5A623", "#16A34A", "#111111", "#FFFFFF"];

// Natural-pixel sizes (converted to on-screen units via the display scale so
// strokes look consistent at full resolution regardless of how far the image
// was scaled to fit the editor).
const NAT_STROKE = 6; // arrow line + pen base thickness
const NAT_HEAD = 26; // arrow head triangle size

const EDITOR_PAD = 24;
const TOOLBAR_H = 60;

// Load an object/data URL into an HTMLImageElement (natural-resolution source).
function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

// Replace a rectangular region of the destination canvas with a blocky mosaic
// of the same region from the (full-resolution) source image. Downscale to a
// tiny canvas, then upscale with smoothing disabled — a strong, non-reversible
// redaction (DECISION: mosaic, Andrew's pick over soft blur).
function pixelateRegion(ctx, img, rx, ry, rw, rh, block) {
  const cols = Math.max(1, Math.round(rw / block));
  const rows = Math.max(1, Math.round(rh / block));
  const tmp = document.createElement("canvas");
  tmp.width = cols;
  tmp.height = rows;
  const tctx = tmp.getContext("2d");
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(img, rx, ry, rw, rh, 0, 0, cols, rows);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, cols, rows, rx, ry, rw, rh);
  ctx.imageSmoothingEnabled = true;
}

const ScreenshotEditor = ({
  imageBlob,
  initialAnnotations,
  shotNumber,
  onSave,
  onCancel,
}) => {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const srcImgRef = useRef(null);
  const scaleRef = useRef(1);
  const natRef = useRef({ w: 0, h: 0 });
  const dimsRef = useRef({ strokeDisp: 4, headDisp: 18, blockNat: 12 });
  const toolRef = useRef("select");
  const colorRef = useRef(PALETTE[0]);
  const drawingRef = useRef(null);
  const historyRef = useRef([]);
  const objUrlRef = useRef(null);

  const [tool, setTool] = useState("select");
  const [color, setColor] = useState(PALETTE[0]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---- canvas state serialization (without the heavy background image) ----
  const snapshot = () => {
    const json = fabricRef.current.toJSON(["ic_blur", "ic_arrow"]);
    delete json.backgroundImage;
    return json;
  };

  const pushHistory = () => {
    const str = JSON.stringify(snapshot());
    const h = historyRef.current;
    if (h[h.length - 1] === str) return;
    h.push(str);
    if (h.length > 40) h.shift();
  };

  const restoreBackground = (done) => {
    const canvas = fabricRef.current;
    const fImg = new fabric.Image(srcImgRef.current, {
      selectable: false,
      evented: false,
    });
    fImg.scaleX = scaleRef.current;
    fImg.scaleY = scaleRef.current;
    canvas.setBackgroundImage(fImg, () => {
      canvas.requestRenderAll();
      if (done) done();
    });
  };

  // Apply the active tool to the canvas: drawing mode for pen, manual handlers
  // for blur/arrow (see attachHandlers), and selectability gated to "select".
  const applyTool = (name) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    toolRef.current = name;

    if (name === "pen") {
      canvas.isDrawingMode = true;
      if (!canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      }
      canvas.freeDrawingBrush.color = colorRef.current;
      canvas.freeDrawingBrush.width = dimsRef.current.strokeDisp;
      canvas.freeDrawingBrush.strokeLineCap = "round";
    } else {
      canvas.isDrawingMode = false;
    }

    const selectMode = name === "select";
    canvas.selection = selectMode;
    canvas.skipTargetFind = !selectMode;
    canvas.forEachObject((o) => {
      o.selectable = selectMode;
      o.evented = selectMode;
    });
    if (!selectMode) canvas.discardActiveObject();
    canvas.requestRenderAll();
  };

  const setToolAndApply = (name) => {
    setTool(name);
    applyTool(name);
  };

  // ---- manual drag handlers for blur (rectangle) and arrow (line + head) ----
  const attachHandlers = (canvas) => {
    const onDown = (opt) => {
      const t = toolRef.current;
      if (t !== "blur" && t !== "arrow") return;
      const p = canvas.getPointer(opt.e);
      if (t === "blur") {
        const rect = new fabric.Rect({
          left: p.x,
          top: p.y,
          width: 1,
          height: 1,
          fill: "rgba(15,17,28,0.5)",
          stroke: "#FFFFFF",
          strokeWidth: 1,
          strokeDashArray: [5, 4],
          strokeUniform: true,
          lockRotation: true,
          objectCaching: false,
          ic_blur: true,
        });
        rect.setControlsVisibility({ mtr: false });
        drawingRef.current = { kind: "blur", startX: p.x, startY: p.y, rect };
        canvas.add(rect);
      } else {
        const c = colorRef.current;
        const { strokeDisp, headDisp } = dimsRef.current;
        const line = new fabric.Line([p.x, p.y, p.x, p.y], {
          stroke: c,
          strokeWidth: strokeDisp,
          strokeLineCap: "round",
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        const head = new fabric.Triangle({
          left: p.x,
          top: p.y,
          width: headDisp,
          height: headDisp,
          fill: c,
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        drawingRef.current = { kind: "arrow", startX: p.x, startY: p.y, line, head };
        canvas.add(line, head);
      }
    };

    const onMove = (opt) => {
      const d = drawingRef.current;
      if (!d) return;
      const p = canvas.getPointer(opt.e);
      if (d.kind === "blur") {
        d.rect.set({
          left: Math.min(p.x, d.startX),
          top: Math.min(p.y, d.startY),
          width: Math.abs(p.x - d.startX),
          height: Math.abs(p.y - d.startY),
        });
      } else {
        d.line.set({ x2: p.x, y2: p.y });
        const angle = (Math.atan2(p.y - d.startY, p.x - d.startX) * 180) / Math.PI;
        d.head.set({ left: p.x, top: p.y, angle: angle + 90 });
      }
      canvas.requestRenderAll();
    };

    const onUp = () => {
      const d = drawingRef.current;
      if (!d) return;
      drawingRef.current = null;
      if (d.kind === "blur") {
        if (d.rect.width < 6 || d.rect.height < 6) {
          canvas.remove(d.rect);
        } else {
          d.rect.setCoords();
        }
      } else {
        const dist = Math.hypot(d.line.x2 - d.startX, d.line.y2 - d.startY);
        canvas.remove(d.line);
        canvas.remove(d.head);
        if (dist > 8) {
          const group = new fabric.Group([d.line, d.head], {
            lockRotation: false,
            ic_arrow: true,
          });
          group.setControlsVisibility({ mtr: true });
          canvas.add(group);
        }
      }
      canvas.requestRenderAll();
      pushHistory();
      // Drop into select so the just-drawn shape can be nudged immediately.
      setToolAndApply("select");
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    canvas.on("path:created", pushHistory);
    canvas.on("object:modified", pushHistory);
  };

  // ---- one-time init ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = URL.createObjectURL(imageBlob);
      objUrlRef.current = url;
      const img = await loadImageEl(url);
      if (cancelled) return;
      srcImgRef.current = img;

      const natW = img.naturalWidth;
      const natH = img.naturalHeight;
      natRef.current = { w: natW, h: natH };

      const availW = window.innerWidth * 0.94 - 2 * EDITOR_PAD;
      const availH = window.innerHeight * 0.94 - TOOLBAR_H - 2 * EDITOR_PAD;
      const s = Math.min(availW / natW, availH / natH, 1);
      scaleRef.current = s;
      dimsRef.current = {
        strokeDisp: Math.max(2, Math.round(NAT_STROKE * s)),
        headDisp: Math.max(8, Math.round(NAT_HEAD * s)),
        blockNat: Math.min(40, Math.max(8, Math.round(Math.min(natW, natH) / 48))),
      };

      const canvas = new fabric.Canvas(canvasElRef.current, {
        selection: true,
        preserveObjectStacking: true,
        enableRetinaScaling: false,
        uniformScaling: false,
      });
      fabricRef.current = canvas;
      canvas.setDimensions({
        width: Math.round(natW * s),
        height: Math.round(natH * s),
      });

      const finalize = () => {
        restoreBackground(() => {
          attachHandlers(canvas);
          applyTool("select");
          historyRef.current = [];
          pushHistory();
          setReady(true);
        });
      };

      if (initialAnnotations) {
        canvas.loadFromJSON(initialAnnotations, () => finalize());
      } else {
        finalize();
      }
    })();

    return () => {
      cancelled = true;
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
      if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pen brush colour in sync with the swatch selection.
  useEffect(() => {
    colorRef.current = color;
    const canvas = fabricRef.current;
    if (canvas && canvas.isDrawingMode && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = color;
    }
  }, [color]);

  // Delete / Backspace removes the current selection.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = () => {
    const h = historyRef.current;
    const canvas = fabricRef.current;
    if (h.length < 2 || !canvas) return;
    h.pop();
    const prev = h[h.length - 1];
    canvas.loadFromJSON(prev, () => {
      restoreBackground(() => {
        applyTool(toolRef.current);
        canvas.renderAll();
      });
    });
  };

  const deleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    pushHistory();
  };

  // Bake annotations into a full-resolution JPEG: original pixels, then each
  // blur region pixelated, then the vector layer (arrows/pen) drawn on top.
  const flatten = async () => {
    const canvas = fabricRef.current;
    const img = srcImgRef.current;
    const { w: natW, h: natH } = natRef.current;
    const s = scaleRef.current;

    const out = document.createElement("canvas");
    out.width = natW;
    out.height = natH;
    const ctx = out.getContext("2d");
    ctx.drawImage(img, 0, 0, natW, natH);

    const blurObjs = canvas.getObjects().filter((o) => o.ic_blur);
    blurObjs.forEach((o) => {
      const b = o.getBoundingRect(true, true); // absolute display coords
      let rx = Math.max(0, Math.floor(b.left / s));
      let ry = Math.max(0, Math.floor(b.top / s));
      let rw = Math.min(natW - rx, Math.ceil(b.width / s));
      let rh = Math.min(natH - ry, Math.ceil(b.height / s));
      if (rw > 0 && rh > 0) {
        pixelateRegion(ctx, img, rx, ry, rw, rh, dimsRef.current.blockNat);
      }
    });

    // Export only the vector overlay (arrows/pen) at full resolution: hide the
    // background + blur placeholders, render to a transparent PNG, restore.
    const bg = canvas.backgroundImage;
    canvas.backgroundImage = null;
    blurObjs.forEach((o) => (o.visible = false));
    canvas.renderAll();
    const overlayUrl = canvas.toDataURL({ format: "png", multiplier: 1 / s });
    canvas.backgroundImage = bg;
    blurObjs.forEach((o) => (o.visible = true));
    canvas.renderAll();

    const overlayImg = await loadImageEl(overlayUrl);
    ctx.drawImage(overlayImg, 0, 0, natW, natH);

    return await new Promise((resolve) =>
      out.toBlob((b) => resolve(b), "image/jpeg", 0.92)
    );
  };

  const handleSave = async () => {
    if (saving || !ready) return;
    setSaving(true);
    try {
      const annotations = JSON.stringify(snapshot());
      const blob = await flatten();
      onSave(annotations, blob);
    } catch (err) {
      console.error("Failed to flatten screenshot edits:", err);
      setSaving(false);
    }
  };

  const toolButtons = [
    { key: "select", label: "Select" },
    { key: "blur", label: "Blur" },
    { key: "arrow", label: "Arrow" },
    { key: "pen", label: "Pen" },
  ];

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.toolbar}>
          <span style={styles.shotTag}>SCREENSHOT {shotNumber}</span>

          <div style={styles.toolGroup} role="group" aria-label="Tools">
            {toolButtons.map((t) => (
              <button
                key={t.key}
                type="button"
                style={{
                  ...styles.toolBtn,
                  ...(tool === t.key ? styles.toolBtnActive : {}),
                }}
                onClick={() => setToolAndApply(t.key)}
                disabled={!ready}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={styles.colorGroup} role="group" aria-label="Colour">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                style={{
                  ...styles.swatch,
                  background: c,
                  outline: color === c ? `2px solid ${colors.accent}` : "none",
                  outlineOffset: 2,
                  border:
                    c.toUpperCase() === "#FFFFFF"
                      ? `1px solid ${colors.hairlineStrong}`
                      : "1px solid rgba(0,0,0,0.15)",
                }}
                disabled={!ready}
              />
            ))}
          </div>

          <div style={styles.actionGroup}>
            <button
              type="button"
              style={styles.utilBtn}
              onClick={undo}
              disabled={!ready}
            >
              Undo
            </button>
            <button
              type="button"
              style={styles.utilBtn}
              onClick={deleteSelected}
              disabled={!ready}
            >
              Delete
            </button>
            <span style={styles.divider} />
            <button
              type="button"
              style={styles.ghostBtn}
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              style={{
                ...styles.primaryBtn,
                ...(ready && !saving ? {} : styles.primaryBtnDisabled),
              }}
              onClick={handleSave}
              disabled={!ready || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div style={styles.canvasArea}>
          <div style={styles.canvasHolder}>
            <canvas ref={canvasElRef} />
          </div>
          {!ready && <div style={styles.loading}>Loading screenshot…</div>}
        </div>

        <div style={styles.hint}>
          Blur hides an area with a mosaic that's baked into the image before
          upload. Drag to draw; switch to <strong>Select</strong> to move,
          resize, or delete. Edits are saved with this screenshot and stay
          editable until you generate.
        </div>
      </div>
    </div>
  );
};

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 17, 28, 0.62)",
    backdropFilter: "blur(2px)",
    WebkitBackdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    padding: EDITOR_PAD,
    boxSizing: "border-box",
  },
  panel: {
    background: colors.surfaceRaised,
    border: `1px solid ${colors.hairline}`,
    borderRadius: radius.m,
    boxShadow: "0 24px 70px rgba(15, 17, 28, 0.30)",
    display: "flex",
    flexDirection: "column",
    maxWidth: "96vw",
    maxHeight: "96vh",
    fontFamily: fonts.body,
    overflow: "hidden",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: space.m,
    flexWrap: "wrap",
    padding: `${space.s}px ${space.m}px`,
    borderBottom: `1px solid ${colors.hairline}`,
    minHeight: TOOLBAR_H,
    boxSizing: "border-box",
  },
  shotTag: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 600,
    letterSpacing: "0.12em",
    color: colors.mid,
  },
  toolGroup: {
    display: "flex",
    gap: 4,
    padding: 4,
    background: "rgba(0,0,0,0.05)",
    borderRadius: 10,
  },
  toolBtn: {
    appearance: "none",
    border: "none",
    cursor: "pointer",
    background: "transparent",
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 14px",
    borderRadius: 8,
    transition: "background 0.15s ease, color 0.15s ease",
  },
  toolBtnActive: {
    background: "#fff",
    color: colors.accent,
    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
  },
  colorGroup: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    cursor: "pointer",
    padding: 0,
  },
  actionGroup: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    marginLeft: "auto",
  },
  utilBtn: {
    background: "none",
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: radius.s,
    padding: "7px 12px",
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: 500,
    color: colors.ink,
    cursor: "pointer",
  },
  divider: {
    width: 1,
    height: 22,
    background: colors.hairlineStrong,
    margin: `0 ${space.xxs}px`,
  },
  ghostBtn: {
    background: "transparent",
    color: colors.ink,
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: radius.s,
    padding: "8px 16px",
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  primaryBtn: {
    background: colors.accent,
    color: "#fff",
    border: "none",
    borderRadius: radius.s,
    padding: "8px 20px",
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryBtnDisabled: {
    background: colors.hairlineStrong,
    color: colors.mid,
    cursor: "not-allowed",
  },
  canvasArea: {
    position: "relative",
    background: colors.surface,
    padding: EDITOR_PAD,
    overflow: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  canvasHolder: {
    boxShadow: "0 2px 18px rgba(15,17,28,0.18)",
    lineHeight: 0,
  },
  loading: {
    position: "absolute",
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: 20,
    color: colors.mid,
  },
  hint: {
    padding: `${space.s}px ${space.m}px`,
    borderTop: `1px solid ${colors.hairline}`,
    fontSize: 12,
    lineHeight: 1.5,
    color: colors.mid,
    fontFamily: fonts.body,
  },
};

export default ScreenshotEditor;
