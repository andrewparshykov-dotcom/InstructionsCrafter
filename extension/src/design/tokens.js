// Shared design tokens for the rebranded auxiliary pages: Welcome, Playground,
// and Generate. The aesthetic is "Editorial Manual" — the tool that produces
// instruction documents itself looks like a thoughtfully designed manual.
// Type pairs Instrument Serif (display) with Geist (body) and Geist Mono
// (numerals, timecodes, version marks). Palette honors the InstructionsCrafter
// icon: a paper-tone surface, vivid blue accent used sparingly.

export const colors = {
  // surfaces
  surface: "#F6F7FB",
  surfaceRaised: "#FBFBFE",

  // text
  ink: "#15171C",
  mid: "#6E7684",

  // structural
  hairline: "#E8E9EE",
  hairlineStrong: "#C9CDD6",

  // accents
  accent: "#3080F8",
  accentHover: "#1F6CDC",
  accentSoft: "#E8F1FE",

  // semantic
  danger: "#C53030",
  dangerSoft: "#FBEAEA",
};

export const fonts = {
  display: '"Instrument Serif", "Times New Roman", serif',
  body: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
};

export const sizes = {
  display: 64,
  h1: 40,
  h2: 26,
  h3: 19,
  body: 15,
  caption: 13,
  mono: 11,
};

export const space = {
  xxs: 4,
  xs: 8,
  s: 12,
  m: 20,
  l: 32,
  xl: 56,
  xxl: 96,
};

export const radius = {
  s: 4,
  m: 8,
  l: 12,
};
