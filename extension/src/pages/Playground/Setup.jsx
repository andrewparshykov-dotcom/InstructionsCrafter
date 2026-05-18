import React, { useEffect } from "react";
import { colors, fonts } from "../../design/tokens";

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
          Click the InstructionsCrafter icon in your toolbar to begin. Narrate
          every step out loud — the document is built from what you{" "}
          <em style={styles.emphasis}>say</em>, not from what you click.
        </p>
      </main>

      <footer style={styles.footer}>
        <span>INSTRUCTIONSCRAFTER</span>
        <span style={styles.dot}>·</span>
        <span>SCRATCHPAD</span>
      </footer>
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
    gridTemplateRows: "auto 1fr auto",
    rowGap: 32,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    position: "relative",
    zIndex: 1,
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
  },
  dot: { color: colors.hairlineStrong },

  main: {
    alignSelf: "start",
    maxWidth: 460,
    paddingLeft: 0,
    marginTop: "12vh",
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
  emphasis: {
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: "1.08em",
    color: colors.ink,
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
  },
};

export default Setup;
