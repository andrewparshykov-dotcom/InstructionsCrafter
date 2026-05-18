import React from "react";
import { colors, fonts, sizes, space, radius } from "../../design/tokens";

// First-run welcome page, "Editorial Manual" aesthetic.
// The page reads like the opening pages of a manual: typographic hierarchy
// driven by a display serif, mono numerals running in the left rail, hairlines
// between sections, vivid blue as a sparingly used accent — not as fill.

const Welcome = () => {
  const handleClose = () => window.close();

  return (
    <div style={styles.page}>
      <style>{cssRules}</style>

      <main style={styles.container}>
        <header style={styles.versionMark}>
          <span>INSTRUCTIONSCRAFTER</span>
          <span style={styles.versionDot}>·</span>
          <span>FIRST RUN</span>
        </header>

        <h1 style={styles.headline}>
          Welcome to
          <br />
          <em style={styles.headlineItalic}>InstructionsCrafter.</em>
        </h1>

        <p style={styles.dek}>
          A small workshop for turning a screen recording with voice narration
          into a polished, step-by-step Microsoft Word instruction document.
        </p>

        <hr style={styles.rule} />

        <section style={styles.section}>
          <aside style={styles.sectionRail}>
            <span>01</span>
            <span style={styles.railLabel}>REQUIRED</span>
          </aside>
          <div>
            <h2 style={styles.h2}>Voice narration is mandatory.</h2>
            <p style={styles.body}>
              InstructionsCrafter builds each step from what you{" "}
              <em style={styles.emphasis}>say</em> while recording, not from
              what you click. Talk through each step out loud as you go.
            </p>
            <blockquote style={styles.exampleQuote}>
              "First, I'm clicking on the menu icon in the top-left. Now I'm
              selecting Settings from the dropdown. Finally, I'm clicking
              Save."
            </blockquote>
            <p style={styles.body}>
              Silent recordings are rejected after upload.
            </p>
          </div>
        </section>

        <hr style={styles.rule} />

        <section style={styles.section}>
          <aside style={styles.sectionRail}>
            <span>02</span>
            <span style={styles.railLabel}>HOW IT WORKS</span>
          </aside>
          <div>
            <h2 style={styles.h2}>Five steps, one document.</h2>
            <ol style={styles.steps}>
              <Step
                n="01"
                body="Click the InstructionsCrafter icon in the toolbar to open the recorder."
              />
              <Step
                n="02"
                body="Pick the current tab, a window, or the full desktop. Keep the microphone enabled."
              />
              <Step
                n="03"
                body="Click record, narrate through your steps, then click stop."
              />
              <Step
                n="04"
                body={
                  <>
                    On the <em style={styles.emphasis}>Recording ready</em>{" "}
                    page, click Generate document. Enter a title and the shared
                    team password.
                  </>
                }
              />
              <Step
                n="05"
                body="Wait thirty to sixty seconds. A Microsoft Word document downloads automatically."
              />
            </ol>
          </div>
        </section>

        <hr style={styles.rule} />

        <footer style={styles.cta}>
          <button
            type="button"
            className="ic-welcome-button"
            style={styles.button}
            onClick={handleClose}
          >
            Begin recording <span style={styles.buttonArrow}>→</span>
          </button>
          <p style={styles.colophon}>
            Close this tab when you're ready to return to your previous window.
          </p>
        </footer>
      </main>
    </div>
  );
};

const Step = ({ n, body }) => (
  <li style={styles.stepItem}>
    <span style={styles.stepNumber}>{n}</span>
    <span style={styles.stepBody}>{body}</span>
  </li>
);

const cssRules = `
  .ic-welcome-button:hover {
    background: ${colors.accentHover};
  }
  .ic-welcome-button:focus-visible {
    outline: 2px solid ${colors.accent};
    outline-offset: 3px;
  }
  .ic-welcome-button:active {
    transform: translateY(1px);
  }
  /* Subtle paper grain on the surface */
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
  main { position: relative; z-index: 1; }
`;

const styles = {
  page: {
    minHeight: "100vh",
    background: colors.surface,
    fontFamily: fonts.body,
    color: colors.ink,
    padding: `${space.xxl}px ${space.l}px ${space.xl}px`,
    boxSizing: "border-box",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  },
  container: {
    maxWidth: 720,
    margin: "0 auto",
  },
  versionMark: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    display: "flex",
    gap: space.xs,
    marginBottom: space.xl,
    textTransform: "none",
  },
  versionDot: { color: colors.hairlineStrong },

  headline: {
    fontFamily: fonts.display,
    fontSize: sizes.display,
    fontWeight: 400,
    lineHeight: 0.98,
    color: colors.ink,
    margin: `0 0 ${space.l}px`,
    letterSpacing: "-0.02em",
  },
  headlineItalic: {
    fontStyle: "italic",
    color: colors.accent,
  },

  dek: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 1.55,
    color: colors.ink,
    maxWidth: 540,
    margin: `0 0 ${space.xl}px`,
    fontWeight: 400,
  },

  rule: {
    border: "none",
    borderTop: `1px solid ${colors.hairline}`,
    margin: `${space.xl}px 0`,
  },

  section: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: space.l,
    alignItems: "start",
  },
  sectionRail: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    paddingTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
  },
  railLabel: {
    color: colors.accent,
  },

  h2: {
    fontFamily: fonts.display,
    fontSize: sizes.h1,
    fontWeight: 400,
    lineHeight: 1.05,
    margin: `0 0 ${space.m}px`,
    color: colors.ink,
    letterSpacing: "-0.015em",
  },
  body: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.65,
    color: colors.ink,
    margin: `0 0 ${space.s}px`,
  },
  emphasis: {
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: "1.08em",
    color: colors.ink,
  },

  exampleQuote: {
    fontFamily: fonts.display,
    fontSize: 21,
    fontStyle: "italic",
    color: colors.ink,
    lineHeight: 1.45,
    padding: `${space.s}px 0 ${space.s}px ${space.m}px`,
    borderLeft: `2px solid ${colors.accent}`,
    margin: `${space.m}px 0`,
  },

  steps: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  stepItem: {
    display: "grid",
    gridTemplateColumns: "44px 1fr",
    gap: space.m,
    padding: `${space.m}px 0`,
    borderBottom: `1px solid ${colors.hairline}`,
    alignItems: "baseline",
  },
  stepNumber: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
  },
  stepBody: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.6,
    color: colors.ink,
  },

  cta: {
    marginTop: space.xl,
    textAlign: "left",
  },
  button: {
    fontFamily: fonts.body,
    fontSize: 16,
    fontWeight: 600,
    background: colors.accent,
    color: "#fff",
    border: "none",
    borderRadius: radius.s,
    padding: "14px 28px",
    cursor: "pointer",
    letterSpacing: "0.005em",
    transition: "background 0.15s ease, transform 0.05s ease",
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
  },
  buttonArrow: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 1,
    transform: "translateY(-1px)",
  },
  colophon: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    color: colors.mid,
    letterSpacing: "0.14em",
    marginTop: space.m,
    textTransform: "uppercase",
    fontWeight: 500,
  },
};

export default Welcome;
