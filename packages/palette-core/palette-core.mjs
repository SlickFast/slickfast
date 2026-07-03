// palette-core — the shared color engine for BarGraphFast / PieChartFast / the API.
//
// Pure functions only: NO DOM, NO Chart.js, NO framework. Safe to import in a
// browser site, in Node, or to re-implement line-for-line in another language
// for the API repo. Behavior is pinned by golden-vectors.json — any port MUST
// reproduce those exact outputs.
//
// Math is ported verbatim from the refined PieChartFast site so it can adopt
// this module without any visual change. Tunable constants live in tokens.json
// (rampConfig) and are injected below.

import tokens from './tokens.json' with { type: 'json' };

const RAMP = tokens.rampConfig;

// ── Color-space conversions ───────────────────────────────────────────────────

/** "#rgb" or "#rrggbb" -> {r,g,b} (0-255). */
export function hexToRgb(hex) {
  hex = String(hex).replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** r,g,b (0-255) -> {h:0-360, s:0-100, l:0-100}. */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h, s, l = (mx + mn) / 2;
  if (mx === mn) { h = s = 0; }
  else {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** "#rrggbb" -> {h,s,l}. */
export function hexToHsl(hex) { const { r, g, b } = hexToRgb(hex); return rgbToHsl(r, g, b); }

/** h (deg), s/l (0-100) -> "#rrggbb". Wraps hue, clamps s/l. */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) { [r, g, b] = [c, x, 0]; }
  else if (h < 120) { [r, g, b] = [x, c, 0]; }
  else if (h < 180) { [r, g, b] = [0, c, x]; }
  else if (h < 240) { [r, g, b] = [0, x, c]; }
  else if (h < 300) { [r, g, b] = [x, 0, c]; }
  else { [r, g, b] = [c, 0, x]; }
  const to = v => ('0' + Math.round((v + m) * 255).toString(16)).slice(-2);
  return '#' + to(r) + to(g) + to(b);
}

// ── Contrast / readability ────────────────────────────────────────────────────

/** WCAG relative luminance (0-1) of a hex color. */
export function getLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return [r, g, b].reduce((sum, c, i) => {
    c /= 255;
    c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return sum + c * [0.2126, 0.7152, 0.0722][i];
  }, 0);
}

/** Best label text color (#1a1a1a dark / #ffffff light) for a given background. */
export function contrastColor(hex) { return getLuminance(hex) > 0.179 ? '#1a1a1a' : '#ffffff'; }

// ── Generative palettes ───────────────────────────────────────────────────────

/** A monochromatic ramp at a fixed hue/saturation, stepping lightness start->end. */
export function generateMonochromaticPalette(
  baseHue, baseSaturation, sliceCount,
  startLightness = RAMP.monochromatic.startLightness,
  endLightness = RAMP.monochromatic.endLightness
) {
  const colors = [];
  const step = (startLightness - endLightness) / Math.max(sliceCount - 1, 1);
  for (let i = 0; i < sliceCount; i++) {
    colors.push(hslToHex(baseHue, baseSaturation, startLightness - i * step));
  }
  return colors;
}

/** Derive a child tier's palette from a root hex. depth 1 = Pie 2, depth 2 = Pie 3. */
export function tierPalette(rootHex, depth, count, opts = {}) {
  const { hueShift = 0, hueSpread = 0 } = opts;
  const d1 = RAMP.tier.depth1, dN = RAMP.tier.depthN, ceil = RAMP.tier.lightnessCeiling;
  const base = hexToHsl(rootHex);
  const startL = depth === 1 ? Math.min(Math.max(base.l, d1.startLightnessClampMin), d1.startLightnessClampMax) : dN.startLightness;
  const spanL  = depth === 1 ? d1.lightnessSpan : dN.lightnessSpan;
  const S      = depth === 1 ? Math.max(d1.saturationFloor, base.s - d1.saturationDrop) : Math.max(dN.saturationFloor, base.s - dN.saturationDrop);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    out.push(hslToHex(base.h + hueShift * depth + hueSpread * t, S, Math.min(ceil, startL + t * spanL)));
  }
  return out;
}

/** Use predefined colors first; when more are needed, extend with a monochromatic ramp. */
export function generateTierPaletteWithFallback(predefinedColors, sliceCount, rootHex = null) {
  if (sliceCount <= predefinedColors.length) return predefinedColors.slice(0, sliceCount);
  const fb = RAMP.fallback;
  const result = predefinedColors.slice();
  const remaining = sliceCount - predefinedColors.length;
  const baseHsl = hexToHsl(predefinedColors[predefinedColors.length - 1]);
  const baseHue = rootHex ? hexToHsl(rootHex).h : baseHsl.h;
  const startLightness = baseHsl.l + fb.startLightnessOffset;
  const endLightness = Math.min(fb.lightnessCeiling, baseHsl.l + remaining * fb.endLightnessStep);
  const dynamic = generateMonochromaticPalette(baseHue, baseHsl.s, remaining + 1, startLightness, endLightness);
  result.push(...dynamic.slice(1));
  return result.slice(0, sliceCount);
}

// ── Token-aware resolvers (the public API the sites/API call) ──────────────────

export const FLAT_PALETTES = tokens.flatPalettes;
export const NESTED_THEMES = tokens.nestedThemes;

/**
 * Resolve a named flat palette to exactly `count` colors. Scales gracefully past
 * the predefined list via monochromatic fallback (this is the upgrade the bar
 * site lacks today). Unknown names fall back to the first palette.
 */
export function resolveFlatPalette(name, count) {
  // A flat-palette name wins. Otherwise a NESTED-theme name is honored on flat charts by
  // using its own color set — the tiers flattened, or the generative root triad — so a valid
  // theme like "Nordic Earth" renders its real colors instead of silently falling back to the
  // default. Only a truly unknown name lands on FLAT_PALETTES[0] (the MCP enum blocks those).
  let colors = FLAT_PALETTES.find(p => p.name === name)?.colors;
  if (!colors) {
    const nested = NESTED_THEMES.find(t => t.name === name);
    if (nested) colors = nested.tiers ? nested.tiers.flat() : nested.pie1;
  }
  return generateTierPaletteWithFallback(colors || FLAT_PALETTES[0].colors, count);
}

/**
 * Resolve a nested-theme palette for one pie in a Pie-of-Pie cascade.
 *   themeName     — name in tokens.nestedThemes
 *   pieIndex      — 0 = Pie 1 (root triad), 1 = Pie 2, 2 = Pie 3, ...
 *   count         — slices in this pie
 *   rootHexOverride — Pie 1's edited Slice-A color, so manual edits cascade to children
 */
export function resolveNestedTheme(themeName, pieIndex, count, rootHexOverride = null) {
  const theme = NESTED_THEMES.find(t => t.name === themeName) || NESTED_THEMES[0];
  if (theme.tiers) {
    const predefined = theme.tiers[Math.min(pieIndex, theme.tiers.length - 1)];
    return generateTierPaletteWithFallback(predefined, count);
  }
  if (pieIndex === 0) return generateTierPaletteWithFallback(theme.pie1, count);
  const root = rootHexOverride || theme.pie1[0];
  return tierPalette(root, pieIndex, count, theme);
}

export { tokens };
