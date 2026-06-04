import React, { useState } from "react";
import { colors, fonts, sizes, space, radius } from "../../design/tokens";

// First-run welcome page, "Editorial Manual" aesthetic, presented BILINGUALLY:
// English in the left column, Ukrainian in the right, aligned section by section
// (a shared full-width mono header carries the section number + bilingual label,
// with a hairline running between the two language columns). The copy covers both
// capture modes -- narrated video and Click capture -- and the Gemini pipeline.
//
// Ukrainian copy is the team's (Andrew is the native-speaker source of truth;
// reviewed 2026-06-03). Keep the two languages in sync when editing.

// Close transition: the page composition scales down + fades when the user
// clicks the CTA -- like a document zooming away. Tab closes when the animation
// finishes. See F36.
const PAGE_RECEDE_MS = 1000;

// --- parallel content ------------------------------------------------------

const MODES = [
  {
    en: {
      t: "Narrated video",
      d: "record your screen or a window and talk through each step. Gemini watches the video and listens to your narration.",
    },
    uk: {
      t: "Відео з озвученням",
      d: "запишіть екран або вікно й проговорюйте кожен крок. Gemini переглядає відео та аналізує ваше озвучення.",
    },
  },
  {
    en: {
      t: "Click capture",
      d: "just click through a task in your browser. Each meaningful click becomes a screenshot, and you can blur, draw on, or annotate any shot before it's sent. Narration here is optional.",
    },
    uk: {
      t: "Фіксація кліків",
      d: "просто виконуйте завдання у браузері. Кожен значущий клік стає знімком екрана; ви можете розмити, домалювати чи підписати будь-який знімок перед надсиланням. Озвучення тут необов'язкове.",
    },
  },
];

const STEPS = [
  {
    n: "01",
    en: "Click the InstructionsCrafter icon in the toolbar and choose Video or Click capture.",
    uk: "Натисніть піктограму InstructionsCrafter на панелі інструментів і оберіть «Відео» або «Фіксацію кліків».",
  },
  {
    n: "02",
    en: "Record — narrate your steps (video) or click through the task (clicks). Stop when you're done.",
    uk: "Записуйте — проговорюйте кроки (відео) або виконуйте завдання кліками. Зупиніть, коли завершите.",
  },
  {
    n: "03",
    en: "On the Recording ready page, optionally edit or redact your screenshots, then click Generate document.",
    uk: "На сторінці «Запис готовий» за потреби відредагуйте або приховайте дані на знімках, потім натисніть «Згенерувати документ».",
  },
  {
    n: "04",
    en: "Enter a title and the shared team password.",
    uk: "Введіть назву та спільний командний пароль.",
  },
  {
    n: "05",
    en: "A Microsoft Word document downloads automatically.",
    uk: "Документ Microsoft Word завантажиться автоматично.",
  },
];

const NOTES = [
  {
    en: "Narration is required for Video mode and optional for Click capture.",
    uk: "Озвучення обов'язкове для режиму «Відео» й необов'язкове для «Фіксації кліків».",
  },
  {
    en: "Your recording goes to an Azure Virtual Machine and Google Gemini, is processed once, and is deleted — nothing is stored. A shared password protects it.",
    uk: "Ваш запис надсилається на віртуальну машину Azure та в Google Gemini, обробляється один раз і видаляється — нічого не зберігається. Доступ захищено спільним паролем.",
  },
  {
    en: "Narrate in any language — the document comes back in English.",
    uk: "Озвучуйте будь-якою мовою — документ повернеться англійською.",
  },
];

// --- small building blocks -------------------------------------------------

// A bilingual row: English cell, hairline, Ukrainian cell. Collapses to a single
// stacked column on narrow viewports (see cssRules @media).
const TwoCol = ({ en, uk }) => (
  <div className="ic-twocol">
    <div className="ic-col-en">{en}</div>
    <div className="ic-divider" />
    <div className="ic-col-uk">{uk}</div>
  </div>
);

const Section = ({ number, label, en, uk }) => (
  <>
    <hr style={styles.rule} />
    <div style={styles.sectionHeader}>
      <span style={styles.sectionNum}>{number}</span>
      <span style={styles.sectionLabel}>{label}</span>
    </div>
    <TwoCol en={en} uk={uk} />
  </>
);

const ModeList = ({ lang }) =>
  MODES.map((m, i) => (
    <p key={i} style={styles.body}>
      <strong style={styles.modeName}>{m[lang].t}</strong> — {m[lang].d}
    </p>
  ));

const StepList = ({ lang }) => (
  <ol style={styles.steps}>
    {STEPS.map((s) => (
      <li key={s.n} style={styles.stepItem}>
        <span style={styles.stepNumber}>{s.n}</span>
        <span style={styles.stepBody}>{s[lang]}</span>
      </li>
    ))}
  </ol>
);

const NoteList = ({ lang }) => (
  <ul style={styles.notes}>
    {NOTES.map((nt, i) => (
      <li key={i} style={styles.noteItem}>
        <span style={styles.noteMark}>—</span>
        <span style={styles.noteBody}>{nt[lang]}</span>
      </li>
    ))}
  </ul>
);

const Headline = ({ label, lead, brand, dek }) => (
  <>
    <div style={styles.langLabel}>{label}</div>
    <h1 style={styles.headline}>
      {lead}
      <br />
      <em style={styles.headlineItalic}>{brand}</em>
    </h1>
    <p style={styles.dek}>{dek}</p>
  </>
);

// --- page ------------------------------------------------------------------

const Welcome = () => {
  const [closing, setClosing] = useState(false);

  const handleClose = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      window.close();
      return;
    }
    // Lock body scroll only during the recede animation so the scrollbar
    // doesn't shimmy as the page scales down.
    document.body.style.overflow = "hidden";
    setClosing(true);
    setTimeout(() => {
      window.close();
    }, PAGE_RECEDE_MS);
  };

  // Respect reduced-motion: don't auto-loop the pin clip; offer controls instead.
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      style={styles.page}
      className={
        "ic-welcome-page" + (closing ? " ic-welcome-page-receding" : "")
      }
    >
      <style>{cssRules}</style>

      <main style={styles.container}>
        <header style={styles.versionMark}>
          <span>INSTRUCTIONSCRAFTER</span>
          <span style={styles.versionDot}>·</span>
          <span>FIRST RUN</span>
        </header>

        <TwoCol
          en={
            <Headline
              label="ENGLISH"
              lead="Welcome to"
              brand="InstructionsCrafter."
              dek="A small workshop that turns a screen demonstration into a polished, step-by-step Microsoft Word instruction document — powered by Google Gemini."
            />
          }
          uk={
            <Headline
              label="УКРАЇНСЬКА"
              lead="Вітаємо в"
              brand="InstructionsCrafter."
              dek="Невелика майстерня, що перетворює показ на екрані на охайний покроковий документ-інструкцію в Microsoft Word — на основі Google Gemini."
            />
          }
        />

        <Section
          number="01"
          label="TWO MODES · ДВА РЕЖИМИ"
          en={
            <>
              <h2 style={styles.h2}>Two ways to capture.</h2>
              <ModeList lang="en" />
            </>
          }
          uk={
            <>
              <h2 style={styles.h2}>Два способи запису.</h2>
              <ModeList lang="uk" />
            </>
          }
        />

        <Section
          number="02"
          label="HOW IT WORKS · ЯК ЦЕ ПРАЦЮЄ"
          en={
            <>
              <h2 style={styles.h2}>From capture to document.</h2>
              <StepList lang="en" />
            </>
          }
          uk={
            <>
              <h2 style={styles.h2}>Від запису до документа.</h2>
              <StepList lang="uk" />
            </>
          }
        />

        <Section
          number="03"
          label="GOOD TO KNOW · ВАРТО ЗНАТИ"
          en={
            <>
              <h2 style={styles.h2}>A few good things to know.</h2>
              <NoteList lang="en" />
            </>
          }
          uk={
            <>
              <h2 style={styles.h2}>Кілька корисних деталей.</h2>
              <NoteList lang="uk" />
            </>
          }
        />

        <hr style={styles.rule} />

        <figure style={styles.pinFigure}>
          <figcaption style={styles.pinLabel}>
            PIN THE EXTENSION · ЗАКРІПІТЬ РОЗШИРЕННЯ
          </figcaption>
          <video
            ref={(el) => {
              if (el) el.muted = true;
            }}
            style={styles.pinVideo}
            src={chrome.runtime.getURL("assets/helper/pin-extension.mp4")}
            autoPlay={!prefersReducedMotion}
            loop
            muted
            playsInline
            controls={prefersReducedMotion}
            aria-label="How to pin the InstructionsCrafter extension to the Chrome toolbar"
          />
        </figure>

        <footer style={styles.cta}>
          <button
            type="button"
            className="ic-welcome-button"
            style={styles.button}
            onClick={handleClose}
          >
            Get started · Почати <span style={styles.buttonArrow}>→</span>
          </button>
        </footer>
      </main>
    </div>
  );
};

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

  /* Close transition: the page composition scales down + fades on click. See F36. */
  body {
    background: ${colors.surface};
    margin: 0;
  }
  .ic-welcome-page {
    transform-origin: center center;
    transition: transform ${PAGE_RECEDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1),
      opacity ${PAGE_RECEDE_MS}ms ease;
    min-height: 100vh;
  }
  .ic-welcome-page-receding {
    transform: scale(0.85) translateY(20px);
    opacity: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .ic-welcome-page { transition: none; }
  }

  /* Slow breathing pulse on the CTA so it visually asks for attention. */
  @keyframes ic-welcome-breath {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.025); }
  }
  .ic-welcome-button {
    animation: ic-welcome-breath 3.5s ease-in-out infinite;
  }
  .ic-welcome-page-receding .ic-welcome-button {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .ic-welcome-button { animation: none; }
  }

  /* Bilingual two-column layout: English left, Ukrainian right, hairline between. */
  .ic-twocol {
    display: grid;
    grid-template-columns: 1fr 1px 1fr;
    align-items: stretch;
  }
  .ic-divider { background: ${colors.hairline}; }
  .ic-col-en { padding-right: ${space.l}px; }
  .ic-col-uk { padding-left: ${space.l}px; }
  @media (max-width: 880px) {
    .ic-twocol { grid-template-columns: 1fr; }
    .ic-divider { display: none; }
    .ic-col-en { padding-right: 0; padding-bottom: ${space.l}px; }
    .ic-col-uk {
      padding-left: 0;
      padding-top: ${space.l}px;
      border-top: 1px solid ${colors.hairline};
    }
  }
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
    maxWidth: 1040,
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
  },
  versionDot: { color: colors.hairlineStrong },

  langLabel: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.16em",
    color: colors.accent,
    marginBottom: space.m,
  },

  headline: {
    fontFamily: fonts.display,
    fontSize: 44,
    fontWeight: 400,
    lineHeight: 1.0,
    color: colors.ink,
    margin: `0 0 ${space.m}px`,
    letterSpacing: "-0.02em",
  },
  headlineItalic: {
    fontStyle: "italic",
    color: colors.accent,
  },
  dek: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 1.55,
    color: colors.ink,
    margin: 0,
    fontWeight: 400,
  },

  rule: {
    border: "none",
    borderTop: `1px solid ${colors.hairline}`,
    margin: `${space.xl}px 0 ${space.l}px`,
  },

  sectionHeader: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    display: "flex",
    gap: space.s,
    alignItems: "baseline",
    marginBottom: space.m,
  },
  sectionNum: { color: colors.accent },
  sectionLabel: { color: colors.mid },

  h2: {
    fontFamily: fonts.display,
    fontSize: sizes.h2,
    fontWeight: 400,
    lineHeight: 1.1,
    margin: `0 0 ${space.s}px`,
    color: colors.ink,
    letterSpacing: "-0.01em",
  },
  body: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.6,
    color: colors.ink,
    margin: `0 0 ${space.s}px`,
  },
  modeName: { fontWeight: 600, color: colors.ink },

  steps: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  stepItem: {
    display: "grid",
    gridTemplateColumns: "32px 1fr",
    gap: space.s,
    padding: `${space.s}px 0`,
    borderBottom: `1px solid ${colors.hairline}`,
    alignItems: "baseline",
  },
  stepNumber: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.12em",
    color: colors.mid,
  },
  stepBody: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.55,
    color: colors.ink,
  },

  notes: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  noteItem: {
    display: "grid",
    gridTemplateColumns: "16px 1fr",
    gap: space.s,
    padding: `${space.xs}px 0`,
    alignItems: "baseline",
  },
  noteMark: { color: colors.accent, fontFamily: fonts.body, lineHeight: 1.55 },
  noteBody: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.55,
    color: colors.ink,
  },

  pinFigure: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },
  pinLabel: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    marginBottom: space.s,
  },
  pinVideo: {
    width: "100%",
    maxWidth: 400,
    height: "auto",
    display: "block",
    borderRadius: radius.l,
    border: `1px solid ${colors.hairline}`,
    background: colors.surfaceRaised,
    boxShadow: "0 8px 28px rgba(21, 23, 28, 0.10)",
  },
  cta: {
    marginTop: space.xl,
    textAlign: "center",
  },
  button: {
    fontFamily: fonts.body,
    fontSize: 17,
    fontWeight: 600,
    background: colors.accent,
    color: "#fff",
    border: "none",
    borderRadius: radius.s,
    padding: "18px 44px",
    cursor: "pointer",
    letterSpacing: "0.005em",
    transition: "background 0.15s ease, box-shadow 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    boxShadow: "0 6px 20px rgba(48, 128, 248, 0.28)",
  },
  buttonArrow: {
    fontFamily: fonts.body,
    fontSize: 19,
    lineHeight: 1,
    transform: "translateY(-1px)",
  },
};

export default Welcome;
