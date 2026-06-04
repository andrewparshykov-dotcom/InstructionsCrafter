import React, { useState } from "react";
import { colors, fonts, sizes, space, radius } from "../../design/tokens";

// "Which mode should I use?" guide, opened in its own popup window from the
// recorder popup. Editorial Manual aesthetic, with an EN / УК language toggle
// (one language shown at a time — the page is long, so a toggle keeps it
// scannable rather than a two-column parallel layout like the Welcome page).
//
// Ukrainian copy is the team's (Andrew is the native-speaker source of truth).
// Keep both languages in sync when editing T below.

const T = {
  markSuffix: { en: "GUIDE", uk: "ПОСІБНИК" },
  langName: { en: "English", uk: "Українська" },

  headline: { en: "Which mode should I use?", uk: "Який режим обрати?" },
  dek: {
    en: "InstructionsCrafter has two ways to capture a task. Pick the one that fits how you work — here is how they differ and when to reach for each.",
    uk: "InstructionsCrafter має два режими роботи. Оберіть той, що відповідає вашому поточному завданню — нижче пояснення, чим вони різняться і коли який обрати.",
  },

  chooseLabel: { en: "CHOOSE A MODE", uk: "ОБЕРІТЬ РЕЖИМ" },
  clickTitle: {
    en: "Use Click capture when…",
    uk: "Оберіть «Фіксацію кліків», коли…",
  },
  clickBody: {
    en: "…your whole task lives in one browser tab — web apps like Outlook on the web, dashboards, SaaS tools. You get a pixel-exact screenshot of every meaningful click, narration is optional, and you can blur or annotate any screenshot before it is sent.",
    uk: "…усе завдання виконується в одній вкладці браузера — вебзастосунки на кшталт Outlook у браузері, дашборди, SaaS-інструменти. Ви отримуєте піксельно точний знімок кожного значущого кліку, озвучення необов'язкове, і ви можете розмити чи підписати будь-який знімок перед надсиланням.",
  },
  videoTitle: { en: "Use Video when…", uk: "Оберіть «Відео», коли…" },
  videoBody: {
    en: "…you move across surfaces — the browser plus desktop apps (Adobe Acrobat, Microsoft Word), several windows or monitors, or whenever you need to show motion: scrolling, dragging, menus opening. Video records the screen or a window with your narration.",
    uk: "…ви працюєте на кількох поверхнях — браузер разом із десктопними програмами (Adobe Acrobat, Microsoft Word), кілька вікон чи моніторів, або коли потрібно показати рух: прокручування, перетягування, відкриття меню. «Відео» записує екран або вікно з вашим озвученням.",
  },
  ruleOfThumb: {
    en: "Rule of thumb: staying inside browser tabs → Click capture. Hopping between the browser and other apps or windows → Video.",
    uk: "Орієнтир: усе в вкладках браузера → «Фіксація кліків». Перемикаєтеся між браузером та іншими програмами чи вікнами → «Відео».",
  },

  worksLabel: { en: "HOW EACH MODE WORKS", uk: "ЯК ПРАЦЮЄ КОЖЕН РЕЖИМ" },
  worksVideo: {
    en: "Video — InstructionsCrafter records your screen (or a window) and your microphone. The whole recording, picture and sound, goes to Google Gemini, which watches it and writes one clear step per action, choosing the right moment for each screenshot. The screenshots are pulled from the video frames.",
    uk: "«Відео» — InstructionsCrafter записує ваш екран (або вікно) та мікрофон. Увесь запис — зображення і звук — надсилається в Google Gemini, який переглядає його й дає опис по одному зрозумілому кроку на кожну дію, обираючи влучний момент для кожного знімка. Знімки беруться з кадрів відео.",
  },
  worksClicks: {
    en: "Click capture — there is no video. Each time you click something meaningful, the extension takes a screenshot of the visible tab and remembers what you clicked. Gemini writes one step per screenshot, and a ring marks where you clicked. Clicks on empty space are ignored.",
    uk: "«Фіксація кліків» — відео немає. Щоразу, коли ви натискаєте щось значуще, розширення робить знімок видимої вкладки й запам'ятовує, на що ви натиснули. Gemini дає опис по одному кроку на кожен знімок, а кільце позначає місце кліку. Кліки по порожньому простору ігноруються.",
  },

  manualLabel: {
    en: "MANUAL SCREENSHOT · ALT+SHIFT+S",
    uk: "РУЧНИЙ ЗНІМОК · ALT+SHIFT+S",
  },
  manualBody: {
    en: "In Click capture, press Alt+Shift+S to capture the current screen even when you did not click — handy for a result, a confirmation message, or anything that appears without a click. An arrow marks where your pointer was. You can change this shortcut at chrome://extensions/shortcuts.",
    uk: "У режимі «Фіксація кліків» натисніть Alt+Shift+S, щоб зробити знімок поточного екрана навіть без кліку — зручно для результату, підтвердження або будь-чого, що з'являється без натискання. Стрілка позначає, де був курсор. Змінити це поєднання можна на сторінці chrome://extensions/shortcuts.",
  },

  notesLabel: { en: "GOOD TO KNOW", uk: "ВАРТО ЗНАТИ" },
  notes: [
    {
      en: "Narration is required for Video and optional for Click capture.",
      uk: "Озвучення обов'язкове для «Відео» й необов'язкове для «Фіксації кліків».",
    },
    {
      en: "Narrate in any language — the finished document comes back in English.",
      uk: "Озвучуйте будь-якою мовою — готовий документ повертається англійською.",
    },
    {
      en: "In Click capture you can blur, add arrows, or draw on each screenshot before it is uploaded — sensitive details never leave your browser.",
      uk: "У «Фіксації кліків» ви можете розмити, додати стрілки чи домалювати на кожному знімку перед завантаженням — конфіденційні дані не залишають ваш браузер.",
    },
    {
      en: "While recording clicks, the indicator and Stop live on the toolbar icon (the badge counts your shots) — nothing is drawn on the page, so it never appears in your screenshots.",
      uk: "Під час фіксації кліків індикатор і кнопка «Стоп» розташовані на піктограмі панелі (значок рахує знімки) — на сторінці нічого не малюється, тож воно не потрапляє у ваші знімки.",
    },
  ],
};

const detectInitialLang = () => {
  try {
    const ui = (chrome.i18n.getUILanguage() || "").toLowerCase();
    return ui.startsWith("uk") ? "uk" : "en";
  } catch {
    return "en";
  }
};

const Guide = () => {
  const [lang, setLang] = useState(detectInitialLang);
  const t = (key) => T[key][lang];

  return (
    <div style={styles.page}>
      <style>{cssRules}</style>
      <main style={styles.container}>
        <header style={styles.topbar}>
          <div style={styles.versionMark}>
            <span>INSTRUCTIONSCRAFTER</span>
            <span style={styles.versionDot}>·</span>
            <span>{t("markSuffix")}</span>
          </div>
          <div style={styles.langToggle} role="group" aria-label="Language">
            {["en", "uk"].map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                style={{
                  ...styles.langBtn,
                  ...(lang === code ? styles.langBtnActive : {}),
                }}
                aria-pressed={lang === code}
              >
                {code === "en" ? "EN" : "УК"}
              </button>
            ))}
          </div>
        </header>

        <h1 style={styles.headline}>{t("headline")}</h1>
        <p style={styles.dek}>{t("dek")}</p>

        <hr style={styles.rule} />
        <div style={styles.sectionLabel}>{t("chooseLabel")}</div>
        <div className="ic-guide-modegrid">
          <div style={styles.modeCard}>
            <h2 style={styles.modeTitle}>{t("clickTitle")}</h2>
            <p style={styles.modeBody}>{t("clickBody")}</p>
          </div>
          <div style={styles.modeCard}>
            <h2 style={styles.modeTitle}>{t("videoTitle")}</h2>
            <p style={styles.modeBody}>{t("videoBody")}</p>
          </div>
        </div>
        <p style={styles.ruleOfThumb}>{t("ruleOfThumb")}</p>

        <hr style={styles.rule} />
        <div style={styles.sectionLabel}>{t("worksLabel")}</div>
        <p style={styles.body}>{t("worksVideo")}</p>
        <p style={styles.body}>{t("worksClicks")}</p>

        <hr style={styles.rule} />
        <div style={styles.sectionLabel}>{t("manualLabel")}</div>
        <p style={styles.body}>{t("manualBody")}</p>

        <hr style={styles.rule} />
        <div style={styles.sectionLabel}>{t("notesLabel")}</div>
        <ul style={styles.notes}>
          {T.notes.map((n, i) => (
            <li key={i} style={styles.noteItem}>
              <span style={styles.noteMark}>—</span>
              <span style={styles.noteBody}>{n[lang]}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
};

const cssRules = `
  body { margin: 0; background: ${colors.surface}; }
  /* Subtle paper grain, matching the Welcome page. */
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
  .ic-guide-modegrid { display: grid; grid-template-columns: 1fr 1fr; gap: ${space.m}px; }
  @media (max-width: 640px) {
    .ic-guide-modegrid { grid-template-columns: 1fr; }
  }
`;

const styles = {
  page: {
    minHeight: "100vh",
    background: colors.surface,
    fontFamily: fonts.body,
    color: colors.ink,
    padding: `${space.xl}px ${space.l}px ${space.xl}px`,
    boxSizing: "border-box",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  },
  container: { maxWidth: 760, margin: "0 auto" },

  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.xl,
  },
  versionMark: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    display: "flex",
    gap: space.xs,
  },
  versionDot: { color: colors.hairlineStrong },

  langToggle: {
    display: "flex",
    gap: 4,
    padding: 4,
    background: "rgba(0,0,0,0.05)",
    borderRadius: 10,
  },
  langBtn: {
    appearance: "none",
    border: "none",
    cursor: "pointer",
    background: "transparent",
    color: colors.mid,
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 600,
    letterSpacing: "0.1em",
    padding: "6px 12px",
    borderRadius: 7,
    transition: "background 0.15s ease, color 0.15s ease",
  },
  langBtnActive: {
    background: "#fff",
    color: colors.accent,
    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
  },

  headline: {
    fontFamily: fonts.display,
    fontSize: sizes.h1,
    fontWeight: 400,
    lineHeight: 1.05,
    color: colors.ink,
    margin: `0 0 ${space.m}px`,
    letterSpacing: "-0.02em",
  },
  dek: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 1.55,
    color: colors.ink,
    margin: 0,
    maxWidth: 620,
  },

  rule: {
    border: "none",
    borderTop: `1px solid ${colors.hairline}`,
    margin: `${space.xl}px 0 ${space.l}px`,
  },
  sectionLabel: {
    fontFamily: fonts.mono,
    fontSize: sizes.mono,
    fontWeight: 500,
    letterSpacing: "0.14em",
    color: colors.mid,
    marginBottom: space.m,
  },

  modeCard: {
    background: colors.surfaceRaised,
    border: `1px solid ${colors.hairline}`,
    borderRadius: radius.l,
    padding: space.m,
  },
  modeTitle: {
    fontFamily: fonts.display,
    fontSize: sizes.h3,
    fontWeight: 400,
    lineHeight: 1.2,
    color: colors.accent,
    margin: `0 0 ${space.xs}px`,
  },
  modeBody: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.6,
    color: colors.ink,
    margin: 0,
  },
  ruleOfThumb: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.55,
    color: colors.ink,
    margin: `${space.m}px 0 0`,
    padding: `${space.s}px ${space.m}px`,
    borderLeft: `2px solid ${colors.accent}`,
    background: colors.accentSoft,
    borderRadius: `0 ${radius.s}px ${radius.s}px 0`,
  },

  body: {
    fontFamily: fonts.body,
    fontSize: sizes.body,
    lineHeight: 1.65,
    color: colors.ink,
    margin: `0 0 ${space.s}px`,
    maxWidth: 660,
  },

  notes: { listStyle: "none", padding: 0, margin: 0 },
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
    maxWidth: 660,
  },
};

export default Guide;
