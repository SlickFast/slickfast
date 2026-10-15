// sci-core shell — the house SVG chrome, PINNED to render-core's internal helpers.
//
// render-core keeps these tiny helpers private (unexported) and the sci-core rule
// is ZERO render-core diff, so this file carries a byte-faithful copy of just what
// the sci renderers need. If render-core's copies ever change, this file follows.
// Pinned to: packages/render-core/render-core.mjs (esc / svgOpen / r / fmt / txt /
// wAttr / wOpt / applyPreset). RATIO_PRESETS is exported there — imported, not copied.

import { RATIO_PRESETS } from '../render-core/render-core.mjs';
import { getLuminance, hexToHsl, hslToHex } from '../palette-core/palette-core.mjs';

// Contrast-guaranteed gridlines. The house grid colors are tuned for white and
// the standard dark slate — but a theme background can sit so close to them
// that the grid (and with it the LOG-AXIS FURNITURE) disappears, and a log
// chart with invisible minors reads as linear. When the luminance gap is big
// enough the house color passes through untouched (byte-stable goldens);
// otherwise the grid is re-derived from the background's own hue with a
// guaranteed lightness gap, and minors step up from 0.35 to 0.5 opacity.
export function gridTheme(bg, transparent, isDark) {
  const base = isDark ? '#1e293b' : '#e2e8f0';
  if (transparent || Math.abs(getLuminance(base) - getLuminance(bg)) >= 0.035) {
    return { grid: base, minorOp: '0.35' };
  }
  const { h, s, l } = hexToHsl(bg);
  const grid = l < 50
    ? hslToHex(h, Math.min(s, 40), Math.min(100, l + 14))
    : hslToHex(h, Math.min(s, 40), Math.max(0, l - 14));
  return { grid, minorOp: '0.5' };
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const svgOpen = (W, H, font) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto" font-family="${esc(font)}">`;
export const r = (n) => Math.round(n * 100) / 100;
export const fmt = (n) => (Number(n) || 0).toLocaleString('en-US');

export const txt = (spec, fallback) => spec.textColor || fallback;
export const wAttr = (spec, base) => {
  const w = spec.fontWeight ? esc(spec.fontWeight) : (spec.bold === true ? Math.min(900, base + 100) : base);
  return `font-weight="${w}"`;
};
export const wOpt = (spec) => {
  if (spec.fontWeight) return ` font-weight="${esc(spec.fontWeight)}"`;
  if (spec.bold === true) return ' font-weight="700"';
  return '';
};

export function applyPreset(spec) {
  const key = String(spec.preset || spec.ratio || '').trim().toLowerCase();
  const p = RATIO_PRESETS[key];
  if (!p) return spec;
  return { ...spec, width: spec.width != null ? spec.width : p[0], height: spec.height != null ? spec.height : p[1] };
}

// "Nice" linear axis numbers — same algorithm as render-core's niceScale.
function niceNum(x, round) {
  const v = x > 0 ? x : 1;
  const exp = Math.floor(Math.log10(v));
  const f = v / Math.pow(10, exp);
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * Math.pow(10, exp);
}
export function niceScale(max, ticks = 5) {
  const m = max > 0 ? max : 1;
  const step = niceNum(niceNum(m, false) / ticks, true);
  return { step, niceMax: Math.ceil(m / step) * step };
}

export function topRoundedBar(x, y, w, h, rad) {
  const rr = Math.min(rad, w / 2, h);
  return `M${r(x)},${r(y + h)} L${r(x)},${r(y + rr)} Q${r(x)},${r(y)} ${r(x + rr)},${r(y)} `
       + `L${r(x + w - rr)},${r(y)} Q${r(x + w)},${r(y)} ${r(x + w)},${r(y + rr)} `
       + `L${r(x + w)},${r(y + h)} Z`;
}

export function bottomRoundedBar(x, y, w, h, rad) {
  const rr = Math.min(rad, w / 2, h);
  return `M${r(x)},${r(y)} L${r(x + w)},${r(y)} L${r(x + w)},${r(y + h - rr)} `
       + `Q${r(x + w)},${r(y + h)} ${r(x + w - rr)},${r(y + h)} L${r(x + rr)},${r(y + h)} `
       + `Q${r(x)},${r(y + h)} ${r(x)},${r(y + h - rr)} Z`;
}
