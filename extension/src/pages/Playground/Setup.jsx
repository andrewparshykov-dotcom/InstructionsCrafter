import React, { useEffect, useState } from "react";
import { colors, fonts } from "../../design/tokens";
import IconHero from "./IconHero";

// Approximate popup height in CSS pixels (RECORDER label + mic dropdown +
// waveform iframe + Start button + Hide toolbar row + padding). Used to
// predict whether the popup will collide with the footer at the current
// viewport size, so the footer can fade out gracefully on cramped screens.
// See F34.
const PREDICTED_POPUP_HEIGHT = 300;
const POPUP_FOOTER_GAP = 16;

// Playground page. The "blank canvas" tab the extension opens when there's
// no real page to record. The popup overlay (mic dropdown, Start recording)
// is injected by contentScript.bundle.js and floats top-right. This page's
// visible content lives in the LEFT half so it never fights the popup.
//
// Aesthetic continues the "Editorial Manual" direction set on the Welcome
// page: same surface tone, same typography, same mono caps version marks,
// same subtle paper grain. Quiet by design -- users see this every time they
// record, so it should set context without nagging.

const Setup = () => {
  // When the predicted bottom of the popup overlay (rendered by the content
  // script in its own shadow DOM, but anchored to #playground-popup-anchor)
  // would crowd the footer, fade the footer to invisible. We keep it in the
  // grid slot (visibility/opacity, not display:none) so the rest of the
  // layout doesn't reflow. See F34.
  const [cramped, setCramped] = useState(false);

  useEffect(() => {
    const checkCramped = () => {
      const anchor = document.getElementById("playground-popup-anchor");
      const footer = document.getElementById("playground-footer");
      if (!anchor || !footer) return;
      const predictedBottom =
        anchor.getBoundingClientRect().top + PREDICTED_POPUP_HEIGHT;
      const footerTop = footer.getBoundingClientRect().top;
      setCramped(predictedBottom + POPUP_FOOTER_GAP > footerTop);
    };

    checkCramped();
    window.addEventListener("resize", checkCramped);
    return () => window.removeEventListener("resize", checkCramped);
  }, []);

  useEffect(() => {
    // Inject the extension content script -- this is what creates the
    // popup overlay on top of the page.
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("contentScript.bundle.js");
    script.async = true;
    document.body.appendChild(script);

    // Inject Satoshi font stylesheet for the popup overlay's own typography.
    // (The playground page itself uses Google-hosted Instrument Serif + Geist
    // loaded via index.html.)
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.type = "text/css";
    style.href = chrome.runtime.getURL("assets/fonts/fonts.css");
    document.body.appendChild(style);

    return () => {
      document.body.removeChild(script);
      document.body.removeChild(style);
    };
  }, []);

  return (
    <div style={styles.page}>
      <style>{cssRules}</style>

      <header style={styles.versionMark}>
        <span>INSTRUCTIONSCRAFTER</span>
        <span style={styles.dot}>·</span>
        <span>STAGING</span>
      </header>

      <main style={styles.main}>
        <h1 style={styles.headline}>
          A blank page
          <br />
          <em style={styles.headlineItalic}>to record from.</em>
        </h1>
        <p style={styles.body}>
          Click the InstructionsCrafter icon to begin, then pick Video or Click
          capture. In Video mode, narrate each step out loud; in Click capture,
          your clicks become the steps and narration is optional.
        </p>
        <p style={styles.bodyUk}>
          Натисніть піктограму InstructionsCrafter, щоб почати, і оберіть
          «Відео» або «Фіксацію кліків». У режимі «Відео» проговорюйте кожен
          крок; у «Фіксації кліків» вашими кроками стають кліки, а озвучення
          необов'язкове.
        </p>

        {/* Anchors for the content-script overlays (toolbar + popup). These
            live in the page's CSS layout, so their getBoundingClientRect()
            scales with Chrome's page zoom — keeping the overlays visually
            "glued" to the text instead of drifting at higher zoom levels.
            Each anchor is positioned absolutely inside the wrapper so it can
            carry its own X offset (the toolbar's CSS shifts it visually one
            way; the popup's CSS shifts it the other way, so they can't
            share a single wrapper-level offset). */}
        <div style={styles.overlayAnchors}>
          <div id="playground-toolbar-anchor" style={styles.toolbarAnchor} />
          <div id="playground-popup-anchor" style={styles.popupAnchor} />
        </div>
      </main>

      <footer
        id="playground-footer"
        style={{
          ...styles.footer,
          opacity: cramped ? 0 : 1,
          transition: "opacity 0.2s ease",
          pointerEvents: cramped ? "none" : "auto",
        }}
      >
        <span>INSTRUCTIONSCRAFTER</span>
        <span style={styles.dot}>·</span>
        <span>SCRATCHPAD</span>
      </footer>

      <div style={styles.heroWrap}>
        <IconHero />
      </div>
    </div>
  );
};

const cssRules = `
  body {
    margin: 0;
    background: ${colors.surface};
    overflow: hidden;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.04 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    opacity: 0.5;
    mix-blend-mode: multiply;
    z-index: 0;
  }
`;

const styles = {
  page: {
    minHeight: "100vh",
    background: colors.surface,
    fontFamily: fonts.body,
    color: colors.ink,
    padding: "48px 56px",
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: "440px 1fr",
    gridTemplateRows: "auto 1fr auto",
    columnGap: 32,
    rowGap: 32,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    position: "relative",
    zIndex: 1,
  },
  heroWrap: {
    gridColumn: "2 / 3",
    gridRow: "1 / -1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    minHeight: 0,
    pointerEvents: "none",
    zIndex: 0,
  },
  versionMark: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    display: "flex",
    gap: 8,
    alignSelf: "start",
    gridColumn: "1 / 2",
    gridRow: "1 / 2",
  },
  dot: { color: colors.hairlineStrong },

  main: {
    alignSelf: "start",
    maxWidth: 400,
    paddingLeft: 0,
    marginTop: "8vh",
    gridColumn: "1 / 2",
    gridRow: "2 / 3",
  },
  headline: {
    fontFamily: fonts.display,
    fontSize: 48,
    fontWeight: 400,
    lineHeight: 1.02,
    color: colors.ink,
    margin: "0 0 28px",
    letterSpacing: "-0.018em",
  },
  headlineItalic: {
    fontStyle: "italic",
    color: colors.accent,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 1.6,
    color: colors.ink,
    margin: 0,
    maxWidth: 440,
  },
  bodyUk: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 1.55,
    color: colors.mid,
    margin: "12px 0 0",
    maxWidth: 440,
  },

  overlayAnchors: {
    // marginTop pushes the toolbar's anchor far enough below the paragraph
    // that the toolbar's visible top clears the last line of text. Larger
    // value than visual gap because .ToolbarRoot has `bottom: 20px` +
    // height:48px in its CSS, which raises its visible top above the Rnd
    // wrapper's transform-set y. See _Toolbar.scss lines 188-191.
    marginTop: 88,
    // Negative marginLeft compensates for .ToolbarRoot's `left: 20px` so
    // the toolbar's visible left edge aligns close to the text's leftmost
    // glyph. The popup uses absolute positioning to undo this compensation
    // (see popupAnchor below).
    marginLeft: -20,
    position: "relative",
    pointerEvents: "none",
    height: 0,
  },
  toolbarAnchor: {
    // Default flow position (top: 0, left: 0 inside the wrapper) — the
    // wrapper's marginLeft: -20 already carries the toolbar's compensation.
    height: 0,
  },
  popupAnchor: {
    // Absolutely positioned so the popup gets a different X offset than
    // the toolbar. The wrapper has marginLeft: -20 for the toolbar; the
    // popup needs to undo that and shift slightly further right to align
    // its visible left edge with the toolbar's visible left edge.
    position: "absolute",
    top: 0,
    left: 22,
    width: 0,
    height: 0,
  },

  footer: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    display: "flex",
    gap: 8,
    alignSelf: "end",
    gridColumn: "1 / 2",
    gridRow: "3 / 4",
  },
};

export default Setup;
