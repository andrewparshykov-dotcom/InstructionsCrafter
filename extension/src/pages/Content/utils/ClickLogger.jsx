import { useEffect } from "react";

/**
 * ClickLogger records every left-click the user makes during a recording so the
 * backend can place each screenshot on the exact control the user clicked --
 * instead of having Gemini guess the moment from the video.
 *
 * It fires on mousedown (the button-PRESS instant), not the click event: a
 * control's own handler runs on release and may navigate away, so the press is
 * the last moment the control is reliably still on screen. (Consequence: a
 * pure keyboard activation -- Tab to a button, press Enter -- is not captured,
 * and that step falls back to narration-window sampling.)
 *
 * For each click it logs:
 *  - t: the click's time in SECONDS from the start of the recorded video,
 *       derived from the same anchor the on-screen timer uses
 *       (recordingStartTime / totalPausedMs in chrome.storage.local).
 *  - label/role/tag: a best-effort description of the clicked control, so the
 *       generated instruction can name it exactly ("Click **Get a Quote**").
 *
 * The entry is sent to the background service worker (type "log-click"), which
 * accumulates the list for the current recording. This component renders
 * nothing; it only attaches a document-level listener while it is mounted
 * (Wrapper mounts it during recording, alongside CursorModes).
 */

// Elements that represent a real, clickable control. We climb from the literal
// click target (often an inner <span> / <svg>) up to the nearest one of these,
// so the logged label names the control the user actually meant to click.
const ACTIONABLE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "option",
  "[role=button]",
  "[role=link]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=option]",
  "[role=switch]",
  "[onclick]",
  "[tabindex]",
].join(",");

const MAX_LABEL_LEN = 200;

// Collapse runs of whitespace, trim, and cap the length.
const clean = (s) =>
  (s || "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LEN);

const attr = (el, name) =>
  el && el.getAttribute ? clean(el.getAttribute(name)) : "";

// Best-effort accessible name for a control: aria-label, then aria-labelledby
// targets, then form-control specifics, then visible text, then common
// attributes. A pragmatic subset of the full ARIA name computation -- enough to
// label a step well without pulling in a library.
const accessibleName = (el) => {
  if (!el || el.nodeType !== 1) return "";

  const aria = attr(el, "aria-label");
  if (aria) return aria;

  const labelledby = attr(el, "aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => {
        const ref = document.getElementById(id);
        return ref ? ref.textContent : "";
      })
      .join(" ");
    const cleaned = clean(text);
    if (cleaned) return cleaned;
  }

  const tag = el.tagName ? el.tagName.toLowerCase() : "";

  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      const v = clean(el.value);
      if (v) return v;
    }
    if (el.labels && el.labels.length) {
      const lbl = clean(el.labels[0].textContent);
      if (lbl) return lbl;
    }
    const ph = attr(el, "placeholder");
    if (ph) return ph;
  }

  if (tag === "img") {
    const alt = attr(el, "alt");
    if (alt) return alt;
  }

  const text = clean(el.innerText || el.textContent);
  if (text) return text;

  return attr(el, "title") || attr(el, "placeholder") || attr(el, "name") || "";
};

const describeTarget = (e) => {
  // composedPath()[0] is the true target even across shadow boundaries;
  // e.target gets retargeted to the shadow host on web-component pages.
  const path = typeof e.composedPath === "function" ? e.composedPath() : null;
  let el = (path && path[0]) || e.target;
  if (el && el.nodeType === 3) el = el.parentElement; // text node -> parent
  const actionable = el && el.closest ? el.closest(ACTIONABLE_SELECTOR) : null;
  const chosen = actionable || el;
  if (!chosen || chosen.nodeType !== 1) {
    return { label: "", role: "", tag: "" };
  }
  return {
    label: accessibleName(chosen),
    role: attr(chosen, "role"),
    tag: chosen.tagName ? chosen.tagName.toLowerCase() : "",
  };
};

const ClickLogger = () => {
  useEffect(() => {
    const onMouseDown = (e) => {
      // Left button only.
      if (e.button !== 0) return;
      // Capture the timestamp synchronously, before the async storage read.
      const now = Date.now();
      const info = describeTarget(e);
      chrome.storage.local.get(
        ["recording", "recordingStartTime", "paused", "totalPausedMs"],
        (s) => {
          if (chrome.runtime.lastError || !s) return;
          // Only while a recording is actually running and not paused.
          if (!s.recording || s.paused || !s.recordingStartTime) return;
          // Same formula the recording timer uses to map wall-clock -> video
          // time, so a click logged here lines up with the recorded frame.
          const t = (now - s.recordingStartTime - (s.totalPausedMs || 0)) / 1000;
          if (!isFinite(t) || t < 0) return;
          chrome.runtime
            .sendMessage({
              type: "log-click",
              t: Math.round(t * 100) / 100,
              label: info.label,
              role: info.role,
              tag: info.tag,
            })
            .catch(() => {});
        }
      );
    };
    // mousedown (not click): a control's own handler runs on RELEASE and may
    // navigate away, so the press instant is the last moment the control is
    // still on screen. Capture phase so we still see it if a page handler calls
    // stopPropagation(); passive because we never preventDefault().
    document.addEventListener("mousedown", onMouseDown, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener("mousedown", onMouseDown, { capture: true });
  }, []);

  return null;
};

export default ClickLogger;
