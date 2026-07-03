// render-core — SlickFast's chart engine. A PURE function: (spec) => SVG string.
//
// GOLD RULES: no IO, no DOM, no network, no Date/Math.random. Same spec = same
// bytes, forever. This is the single renderer the API, MCP server, and playground
// all call — none of them re-implement drawing. All color comes from palette-core.
//
// v1: vertical bar only. More chart types fan out from here, reusing the helpers.

import { resolveFlatPalette, resolveNestedTheme, tierPalette, NESTED_THEMES, getLuminance, contrastColor, hexToHsl, hslToHex } from '../palette-core/palette-core.mjs';

// Floor a mark's contrast against the background: if its luminance sits too close
// to the background's, nudge its lightness AWAY (darker on light bg, lighter on
// dark) so pale palette colors (e.g. Monochrome on white) don't wash out. A no-op
// when there's already enough separation, or when the background is transparent.
function contrastFloor(color, bg, transparent) {
  if (transparent || typeof color !== 'string' || color[0] !== '#') return color;
  const lc = getLuminance(color), lb = getLuminance(bg);
  if (Math.abs(lc - lb) >= 0.22) return color;
  const hsl = hexToHsl(color);
  const dl = lb > 0.5 ? -30 : 30;
  return hslToHex(hsl.h, hsl.s, Math.max(0, Math.min(100, hsl.l + dl)));
}
import { resolveFont } from '../fonts/fonts.mjs';

// ── tiny pure helpers ─────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// THE one root-<svg> opener — every top-level renderer opens through here (dashboard tile
// re-rooting strips this tag, so tiles are unaffected). Change the root tag ONLY here.
// width/height attrs stay FIXED — resvg reads them for PNG output size. The style attr is
// browser-only (resvg ignores it): it makes the SVG shrink-to-fit narrow containers
// (chat panels, artifacts) instead of clipping, scaling proportionally via the viewBox.
const svgOpen = (W, H, font) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto" font-family="${esc(font)}">`;
const r = (n) => Math.round(n * 100) / 100;                 // 2dp — keeps SVG clean & snapshots stable
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US'); // deterministic thousands separators

// Largest-remainder rounding → integer percentages that sum to EXACTLY 100
// (RULES-LEDGER: 100% stacks never drift to 99/101 from naïve rounding).
function pct100(vals) {
  const tot = vals.reduce((a, b) => a + b, 0);
  if (tot <= 0) return vals.map(() => 0);
  const exact = vals.map((v) => (v / tot) * 100);
  const out = exact.map(Math.floor);
  const rem = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [i, v - Math.floor(v)]).sort((a, b) => b[1] - a[1]);
  for (let k = 0; k < rem; k++) out[order[k % order.length][0]]++;
  return out;
}

// Universal text styling — let an agent override the auto-contrast text color and
// weight on the fly. Designed to be SNAPSHOT-SAFE: when none of these are set the
// emitted bytes are identical to before.
//   spec.textColor  — any CSS color; overrides the luminance-derived NEUTRAL text
//                     (title, axis, category, value, legend, pie slice labels).
//                     Semantic colors (green ▲ / red ▼ deltas & gaps) stay meaningful.
//   spec.bold       — true → thicken every text element.
//   spec.fontWeight — raw weight ("700", "bold", …); full control, overrides bold.
const txt = (spec, fallback) => spec.textColor || fallback;
// For text that ALREADY carries a weight: returns `font-weight="N"` (base unless overridden).
const wAttr = (spec, base) => {
  const w = spec.fontWeight ? esc(spec.fontWeight) : (spec.bold === true ? Math.min(900, base + 100) : base);
  return `font-weight="${w}"`;
};
// For normal-weight text: emits nothing unless bold/fontWeight is set (keeps bytes stable).
const wOpt = (spec) => {
  if (spec.fontWeight) return ` font-weight="${esc(spec.fontWeight)}"`;
  if (spec.bold === true) return ' font-weight="700"';
  return '';
};

// Empty-data guard. Renderers that index data.series[0] crash on an empty/absent
// series (a filtered-to-nothing dataset). Normalize to two named-empty series so they
// draw an empty FRAME instead of throwing. No-op (same object) when data is present,
// so non-empty output is byte-identical (golden-safe). Two series cover the types that
// need a pair (diverging/difference); single-series renderers ignore the extra.
function safeData(spec) {
  const d = spec.data || {};
  if (Array.isArray(d.series) && d.series.length) return spec;
  return { ...spec, data: { labels: Array.isArray(d.labels) ? d.labels : [], series: [{ name: '', values: [] }, { name: '', values: [] }] } };
}

// "Nice" axis numbers (the classic graph-label algorithm) so ticks read 0/200/400…
function niceNum(x, round) {
  const v = x > 0 ? x : 1;
  const exp = Math.floor(Math.log10(v));
  const f = v / Math.pow(10, exp);
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * Math.pow(10, exp);
}
function niceScale(max, ticks = 5) {
  const m = max > 0 ? max : 1;
  const step = niceNum(niceNum(m, false) / ticks, true);
  return { step, niceMax: Math.ceil(m / step) * step };
}

// Bar with rounded TOP corners, flat bottom (sits flush on the axis) — the
// RULES-LEDGER bar look, as an SVG path.
function topRoundedBar(x, y, w, h, rad) {
  const rr = Math.min(rad, w / 2, h);
  return `M${r(x)},${r(y + h)} L${r(x)},${r(y + rr)} Q${r(x)},${r(y)} ${r(x + rr)},${r(y)} `
       + `L${r(x + w - rr)},${r(y)} Q${r(x + w)},${r(y)} ${r(x + w)},${r(y + rr)} `
       + `L${r(x + w)},${r(y + h)} Z`;
}

// Bar with rounded RIGHT corners, flat left (the horizontal-stacked end cap).
function rightRoundedBar(x, y, w, h, rad) {
  const rr = Math.min(rad, h / 2, w);
  return `M${r(x)},${r(y)} L${r(x + w - rr)},${r(y)} Q${r(x + w)},${r(y)} ${r(x + w)},${r(y + rr)} `
       + `L${r(x + w)},${r(y + h - rr)} Q${r(x + w)},${r(y + h)} ${r(x + w - rr)},${r(y + h)} `
       + `L${r(x)},${r(y + h)} Z`;
}

// Bar with rounded BOTTOM corners, flat top (the downward diverging bar).
function bottomRoundedBar(x, y, w, h, rad) {
  const rr = Math.min(rad, w / 2, h);
  return `M${r(x)},${r(y)} L${r(x + w)},${r(y)} L${r(x + w)},${r(y + h - rr)} `
       + `Q${r(x + w)},${r(y + h)} ${r(x + w - rr)},${r(y + h)} L${r(x + rr)},${r(y + h)} `
       + `Q${r(x)},${r(y + h)} ${r(x)},${r(y + h - rr)} Z`;
}

// Line-path builders (shared by line/smooth/area/stepped).
function straightPath(pts) { return pts.map((pt, i) => (i ? 'L' : 'M') + pt[0] + ',' + pt[1]).join(' '); }
function steppedPath(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0]},${pts[i - 1][1]} L${pts[i][0]},${pts[i][1]}`;
  return d;
}
// Catmull-Rom → cubic bezier for a smooth curve through the points.
function smoothPath(pts) {
  if (pts.length < 3) return straightPath(pts);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Pie/donut slice as an SVG arc path (angles in radians; donut when innerR > 0).
function arcPath(cx, cy, rad, a0, a1, innerR) {
  const x0 = r(cx + rad * Math.cos(a0)), y0 = r(cy + rad * Math.sin(a0));
  const x1 = r(cx + rad * Math.cos(a1)), y1 = r(cy + rad * Math.sin(a1));
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  if (innerR > 0) {
    const ix0 = r(cx + innerR * Math.cos(a0)), iy0 = r(cy + innerR * Math.sin(a0));
    const ix1 = r(cx + innerR * Math.cos(a1)), iy1 = r(cy + innerR * Math.sin(a1));
    return `M${x0},${y0} A${rad},${rad} 0 ${large} 1 ${x1},${y1} L${ix1},${iy1} A${innerR},${innerR} 0 ${large} 0 ${ix0},${iy0} Z`;
  }
  return `M${r(cx)},${r(cy)} L${x0},${y0} A${rad},${rad} 0 ${large} 1 ${x1},${y1} Z`;
}

// ── vertical bar ──────────────────────────────────────────────────────────────
export function renderBar(spec) {
  spec = safeData(spec);
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';   // universal: background
  const isDark = !transparent && getLuminance(bg) < 0.35;      // luminance via the color library
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13                       // universal: text size
  const font = resolveFont(spec);
  const title = spec.title || '';
  const labels = spec.data.labels;
  const values = spec.data.series[0].values.map((v) => Number(v) || 0);
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues !== false;
  const showTotal = spec.showTotal !== false && spec.valueUnit !== '%';          // single-type "Total: N" (RULES-LEDGER)
  const watermark = spec.watermark !== false;          // free-tier attribution (off for the feeder sites)
  // Explicit per-bar colors (e.g. a site export where the user customized bars)
  // win; otherwise pull from the palette by index.
  const explicit = spec.data.series[0].colors;
  const colors = (Array.isArray(explicit) && explicit.length >= labels.length)
    ? explicit
    : resolveFlatPalette(spec.palette || 'Clean Corporate', labels.length);

  // Text colors derive from background luminance → readable on any background.
  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText  = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const M = { left: 56, right: 24, top: title ? 54 : 28, bottom: 46 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxV = Math.max(0, ...values);
  const { step, niceMax } = niceScale(maxV);
  const yPix = (v) => M.top + plotH - (v / niceMax) * plotH;
  const band = plotW / labels.length;
  const barW = Math.min(band * 0.62, 96);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // gridlines + y-axis numbers
  for (let v = 0; v <= niceMax + 1e-9; v += step) {
    const y = r(yPix(v));
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }

  // bars + value labels + category labels
  values.forEach((v, i) => {
    const x = M.left + i * band + (band - barW) / 2;
    const y = yPix(v);
    const h = (M.top + plotH) - y;
    const cx = r(x + barW / 2);
    p.push(`<path d="${topRoundedBar(x, y, barW, h, 5)}" fill="${colors[i]}"/>`);
    if (showValues) p.push(`<text x="${cx}" y="${r(y - 7)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(v) + u)}</text>`);
    p.push(`<text x="${cx}" y="${r(M.top + plotH + 18)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(labels[i])}</text>`);
  });

  // total (single-type badge), title, watermark
  if (showTotal) {
    const total = values.reduce((s, v) => s + v, 0);
    p.push(`<text x="${r(W - M.right)}" y="${title ? 50 : 20}" text-anchor="end" font-size="${fs - 1}"${wOpt(spec)} fill="${axisText}">Total: ${esc(fmt(total) + u)}</text>`);
  }
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── grouped bar (clustered bars: one bar per series inside each category) ──────
// RULES-LEDGER (harvested from BarGraphFast):
//   • color = SERIES identity: one solid color per series, repeated across every
//     group — NEVER rainbow within a series. A=palette[0], B=palette[mid], extras
//     spread (cols[i % len]) — the bar site's applyPalette formula, verbatim.
//   • the GROUPS are the categories (labels); a "series" is the Nth bar in every group.
export function renderBarGrouped(spec) {
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const title = spec.title || '';
  const labels = spec.data.labels;
  const series = spec.data.series;
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues !== false;
  const watermark = spec.watermark !== false;

  // Series-identity color: A=cols[0], B=cols[mid], extras=cols[i%len] (bar-site rule).
  const cols = resolveFlatPalette(spec.palette || 'Clean Corporate', 8);
  const mid = Math.floor(cols.length / 2);
  const seriesColor = (s, i) => s.color || (i === 0 ? cols[0] : i === 1 ? (cols[mid] || cols[1]) : cols[i % cols.length]);

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText  = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const multi = series.length > 1;
  const M = { left: 56, right: 24, top: title ? 54 : 28, bottom: multi ? 64 : 46 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxV = Math.max(0, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  const { step, niceMax } = niceScale(maxV);
  const yPix = (v) => M.top + plotH - (v / niceMax) * plotH;
  const band = plotW / labels.length;               // one group per category
  const groupW = Math.min(band * 0.72, 132);         // width of the whole cluster
  const n = series.length;
  const barW = groupW / n;                            // each series' bar

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // gridlines + y-axis numbers
  for (let v = 0; v <= niceMax + 1e-9; v += step) {
    const y = r(yPix(v));
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }

  // clustered bars + per-bar value labels + category label per group
  labels.forEach((lab, i) => {
    const gx = M.left + i * band + (band - groupW) / 2;  // left edge of cluster
    series.forEach((s, si) => {
      const v = Number(s.values[i]) || 0;
      const x = gx + si * barW;
      const y = yPix(v);
      const h = (M.top + plotH) - y;
      const cx = r(x + barW / 2);
      p.push(`<path d="${topRoundedBar(x + 1, y, barW - 2, h, 4)}" fill="${seriesColor(s, si)}"/>`);
      if (showValues && v > 0) p.push(`<text x="${cx}" y="${r(y - 6)}" text-anchor="middle" font-size="${fs - 3}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(v) + u)}</text>`);
    });
    p.push(`<text x="${r(M.left + i * band + band / 2)}" y="${r(M.top + plotH + 18)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(lab)}</text>`);
  });

  // legend — series identity (RULES-LEDGER bar charts have no on-chart series names;
  // the engine's multi-series legend supplies them, matching the line family).
  if (multi) {
    const items = series.map((s, i) => ({ name: s.name || ('Bar ' + (i + 1)), col: seriesColor(s, i) }));
    const widths = items.map((it) => 16 + it.name.length * (fs * 0.56) + 18);
    let lx = (W - widths.reduce((a, b) => a + b, 0)) / 2;
    const ly = H - 16;
    items.forEach((it, i) => {
      p.push(`<rect x="${r(lx)}" y="${r(ly - 9)}" width="11" height="11" rx="2.5" fill="${it.col}"/>`);
      p.push(`<text x="${r(lx + 17)}" y="${r(ly)}" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(it.name)}</text>`);
      lx += widths[i];
    });
  }

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── stacked bar (segments stack within each category bar) ─────────────────────
// RULES-LEDGER (harvested from BarGraphFast):
//   • each label is a column/bar; each SERIES is a segment, the SAME color in every
//     bar — each segment a DISTINCT palette color, cycling the whole palette.
//   • TWO inside-labels per segment: name pinned to the segment TOP, value to the
//     BOTTOM — never overlapping; text color is contrast-aware per segment (WCAG).
//   • segments thinner than ~12% of their bar hide the name, keep the value.
//   • only the OUTER edge of the top segment is rounded; segment joins stay flush.
export function renderBarStacked(spec) {
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const title = spec.title || '';
  const labels = spec.data.labels;
  const series = spec.data.series;
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues !== false;
  const watermark = spec.watermark !== false;
  const is100 = spec.type === 'stacked100';   // normalize every bar to 100%

  // Segment color = per-series distinct palette color, cycling (RULES-LEDGER).
  const cols = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(series.length, 2));
  const segColor = (s, i) => s.color || cols[i % cols.length];

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const M = { left: 56, right: 24, top: title ? 54 : 28, bottom: 64 };  // legend in the bottom band
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const raw = (si, i) => Math.max(0, Number(series[si].values[i]) || 0);
  const colPct = is100 ? labels.map((_, i) => pct100(series.map((_s, si) => raw(si, i)))) : null;
  const val = (si, i) => (is100 ? colPct[i][si] : raw(si, i));
  const totals = labels.map((_, i) => series.reduce((a, _s, si) => a + val(si, i), 0));
  const maxV = is100 ? 100 : Math.max(0, ...totals);
  const { step, niceMax } = is100 ? { step: 20, niceMax: 100 } : niceScale(maxV);
  const yPix = (v) => M.top + plotH - (v / niceMax) * plotH;
  const band = plotW / labels.length;
  const barW = Math.min(band * 0.62, 96);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // gridlines + y-axis numbers
  for (let v = 0; v <= niceMax + 1e-9; v += step) {
    const y = r(yPix(v));
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }

  // stacked bars: each column stacks its segments bottom→top
  labels.forEach((lab, i) => {
    const x = M.left + i * band + (band - barW) / 2;
    const cx = r(x + barW / 2);
    const barTotalH = (totals[i] / niceMax) * plotH || 1;
    let topSeg = -1;                                   // topmost non-zero segment (gets the rounded edge)
    for (let k = series.length - 1; k >= 0; k--) { if ((Number(series[k].values[i]) || 0) > 0) { topSeg = k; break; } }
    let cum = 0;
    series.forEach((s, si) => {
      const v = val(si, i);
      if (v <= 0) return;
      const yTop = yPix(cum + v), yBot = yPix(cum), h = yBot - yTop;
      const col = segColor(s, si);
      if (si === topSeg) p.push(`<path d="${topRoundedBar(x, yTop, barW, h, 5)}" fill="${col}"/>`);
      else p.push(`<rect x="${r(x)}" y="${r(yTop)}" width="${r(barW)}" height="${r(h)}" fill="${col}"/>`);
      const tc = spec.textColor || contrastColor(col);
      // name pinned to segment top (hidden when the segment is too thin), value to bottom
      if (s.name && h >= 24 && h >= 0.12 * barTotalH) p.push(`<text x="${cx}" y="${r(yTop + 14)}" text-anchor="middle" font-size="${fs - 2}" ${wAttr(spec, 700)} fill="${tc}">${esc(s.name)}</text>`);
      if (showValues && h >= 14) p.push(`<text x="${cx}" y="${r(yBot - 7)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${tc}">${esc(fmt(v) + (is100 ? '%' : u))}</text>`);
      cum += v;
    });
    p.push(`<text x="${cx}" y="${r(M.top + plotH + 18)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(lab)}</text>`);
  });

  // legend names the segments (series)
  const items = series.map((s, i) => ({ name: s.name || ('Series ' + (i + 1)), col: segColor(s, i) }));
  const widths = items.map((it) => 16 + it.name.length * (fs * 0.56) + 18);
  let lx = (W - widths.reduce((a, b) => a + b, 0)) / 2;
  const ly = H - 16;
  items.forEach((it, i) => {
    p.push(`<rect x="${r(lx)}" y="${r(ly - 9)}" width="11" height="11" rx="2.5" fill="${it.col}"/>`);
    p.push(`<text x="${r(lx + 17)}" y="${r(ly)}" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(it.name)}</text>`);
    lx += widths[i];
  });

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── horizontal stacked bar (segments stack left→right within each row) ────────
// Same data model as `stacked` (label = a bar, series = a segment with one color
// across all bars), transposed: bars run horizontally, the LAST segment rounds its
// right edge, joins stay flush.
export function renderBarStackedH(spec) {
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const title = spec.title || '';
  const labels = spec.data.labels;
  const series = spec.data.series;
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues !== false;
  const watermark = spec.watermark !== false;

  const cols = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(series.length, 2));
  const segColor = (s, i) => s.color || cols[i % cols.length];

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  // wide left margin for the category labels (they sit to the LEFT of each row)
  const longest = Math.max(0, ...labels.map((l) => String(l).length));
  const M = { left: Math.min(160, 24 + longest * (fs * 0.62)), right: 28, top: title ? 54 : 28, bottom: 64 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const raw = (si, i) => Math.max(0, Number(series[si].values[i]) || 0);
  const totals = labels.map((_, i) => series.reduce((a, _s, si) => a + raw(si, i), 0));
  const maxV = Math.max(0, ...totals);
  const { step, niceMax } = niceScale(maxV);
  const xPix = (v) => M.left + (v / niceMax) * plotW;
  const band = plotH / labels.length;
  const barH = Math.min(band * 0.62, 64);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // vertical gridlines + x-axis numbers along the bottom
  for (let v = 0; v <= niceMax + 1e-9; v += step) {
    const x = r(xPix(v));
    p.push(`<line x1="${x}" y1="${M.top}" x2="${x}" y2="${r(M.top + plotH)}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<text x="${x}" y="${r(M.top + plotH + 18)}" text-anchor="middle" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }

  // rows: each label stacks its segments left→right
  labels.forEach((lab, i) => {
    const y = M.top + i * band + (band - barH) / 2;
    const my = r(y + barH / 2 + 4);
    let lastSeg = -1;
    for (let k = series.length - 1; k >= 0; k--) { if (raw(k, i) > 0) { lastSeg = k; break; } }
    let cum = 0;
    series.forEach((s, si) => {
      const v = raw(si, i);
      if (v <= 0) return;
      const xL = xPix(cum), xR = xPix(cum + v), w = xR - xL;
      const col = segColor(s, si);
      if (si === lastSeg) p.push(`<path d="${rightRoundedBar(xL, y, w, barH, 5)}" fill="${col}"/>`);
      else p.push(`<rect x="${r(xL)}" y="${r(y)}" width="${r(w)}" height="${r(barH)}" fill="${col}"/>`);
      const tc = spec.textColor || contrastColor(col);
      const cx = r(xL + w / 2);
      // name + value centered when the segment is wide enough; value-only when narrow
      if (s.name && w >= 58 && barH >= 30) {
        p.push(`<text x="${cx}" y="${r(y + barH / 2 - 3)}" text-anchor="middle" font-size="${fs - 3}" ${wAttr(spec, 700)} fill="${tc}">${esc(s.name)}</text>`);
        if (showValues) p.push(`<text x="${cx}" y="${r(y + barH / 2 + 13)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${tc}">${esc(fmt(v) + u)}</text>`);
      } else if (showValues && w >= 28) {
        p.push(`<text x="${cx}" y="${my}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${tc}">${esc(fmt(v) + u)}</text>`);
      }
      cum += v;
    });
    p.push(`<text x="${r(M.left - 10)}" y="${my}" text-anchor="end" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(lab)}</text>`);
  });

  // legend names the segments
  const items = series.map((s, i) => ({ name: s.name || ('Series ' + (i + 1)), col: segColor(s, i) }));
  const widths = items.map((it) => 16 + it.name.length * (fs * 0.56) + 18);
  let lx = (W - widths.reduce((a, b) => a + b, 0)) / 2;
  const ly = H - 16;
  items.forEach((it, i) => {
    p.push(`<rect x="${r(lx)}" y="${r(ly - 9)}" width="11" height="11" rx="2.5" fill="${it.col}"/>`);
    p.push(`<text x="${r(lx + 17)}" y="${r(ly)}" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(it.name)}</text>`);
    lx += widths[i];
  });

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── horizontal bar (single series, one row per category) ──────────────────────
// Single-bar RULES-LEDGER look: each bar its own distinct palette color by index,
// a "Total: N" badge top-right, no series concept. Just rotated to horizontal.
export function renderBarH(spec) {
  spec = safeData(spec);
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const title = spec.title || '';
  const labels = spec.data.labels;
  const values = spec.data.series[0].values.map((v) => Number(v) || 0);
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues !== false;
  const showTotal = spec.showTotal !== false && spec.valueUnit !== '%';
  const watermark = spec.watermark !== false;
  const explicit = spec.data.series[0].colors;
  const colors = (Array.isArray(explicit) && explicit.length >= labels.length)
    ? explicit : resolveFlatPalette(spec.palette || 'Clean Corporate', labels.length);

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText  = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const longest = Math.max(0, ...labels.map((l) => String(l).length));
  // Left margin grows with the longest label. Cap at 42% of canvas (not a fixed 160px,
  // which clipped long labels on wide / Share-Card sizes); floor at 56 so it never collapses.
  const M = { left: Math.max(56, Math.min(W * 0.42, 28 + longest * (fs * 0.62))), right: 52, top: title ? 54 : 28, bottom: 46 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxV = Math.max(0, ...values);
  const { step, niceMax } = niceScale(maxV);
  const xPix = (v) => M.left + (v / niceMax) * plotW;
  const band = plotH / labels.length;
  const barH = Math.min(band * 0.62, 56);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // vertical gridlines + x-axis numbers
  for (let v = 0; v <= niceMax + 1e-9; v += step) {
    const x = r(xPix(v));
    p.push(`<line x1="${x}" y1="${M.top}" x2="${x}" y2="${r(M.top + plotH)}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<text x="${x}" y="${r(M.top + plotH + 18)}" text-anchor="middle" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }

  // bars + value labels + category labels
  values.forEach((v, i) => {
    const y = M.top + i * band + (band - barH) / 2;
    const my = r(y + barH / 2 + 4);
    const w = xPix(v) - M.left;
    p.push(`<path d="${rightRoundedBar(M.left, y, Math.max(0, w), barH, 5)}" fill="${colors[i]}"/>`);
    if (showValues) {
      if (w >= 44) p.push(`<text x="${r(xPix(v) - 8)}" y="${my}" text-anchor="end" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${spec.textColor || contrastColor(colors[i])}">${esc(fmt(v) + u)}</text>`);
      else p.push(`<text x="${r(xPix(v) + 6)}" y="${my}" text-anchor="start" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(v) + u)}</text>`);
    }
    p.push(`<text x="${r(M.left - 10)}" y="${my}" text-anchor="end" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(labels[i])}</text>`);
  });

  if (showTotal) {
    const total = values.reduce((s, v) => s + v, 0);
    p.push(`<text x="${r(W - M.right + 44)}" y="${title ? 50 : 20}" text-anchor="end" font-size="${fs - 1}"${wOpt(spec)} fill="${axisText}">Total: ${esc(fmt(total) + u)}</text>`);
  }
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── diverging bar (around a zero line) ───────────────────────────────────────
// TWO modes, chosen by series count:
//  • TWO series → opposing bars: Series A forced UP, Series B forced DOWN (both
//    abs-valued), one color each (A=palette[0], B=palette[mid]); legend names
//    both. For agree/disagree, inflow/outflow, etc.
//  • ONE series → classic SIGNED diverging: each value plotted by its own sign
//    (positive UP, negative DOWN), a single color, a single-name legend, and
//    SIGNED value labels (e.g. "-3" below). Previously a lone series was silently
//    abs-valued (negatives flipped up) and drew a phantom empty "Series B" in the
//    legend — both fixed here.
// The zero line is emphasized; down-bar labels sit BELOW their bars.
export function renderDiverging(spec) {
  spec = safeData(spec);
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const title = spec.title || '';
  const labels = spec.data.labels;
  const series = spec.data.series;
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues !== false;
  const watermark = spec.watermark !== false;

  const cols = resolveFlatPalette(spec.palette || 'Clean Corporate', 8);
  const mid = Math.floor(cols.length / 2);
  const singleSigned = series.length < 2;              // one series → split it by sign (pos up / neg down)
  const A = series[0], B = series[1] || { name: '', values: [] };
  const colA = A.color || cols[0];
  const colB = B.color || cols[mid] || cols[1];
  const colDown = singleSigned ? colA : colB;          // single series uses one color for both up & down

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const zeroCol  = isDark ? '#64748b' : '#334155';   // emphasized zero line
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText  = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const M = { left: 56, right: 24, top: title ? 54 : 28, bottom: 64 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  // Two series: A up, B down (abs). One series: split A by sign — positives up, negatives down.
  const aVals = labels.map((_, i) => {
    const n = Number(A.values[i]) || 0;
    return singleSigned ? Math.max(0, n) : Math.abs(n);
  });
  const bVals = labels.map((_, i) => {
    const n = singleSigned ? (Number(A.values[i]) || 0) : (Number(B.values[i]) || 0);
    return singleSigned ? Math.max(0, -n) : Math.abs(n);
  });
  const S = Math.max(1, ...aVals, ...bVals);
  const { step, niceMax } = niceScale(S);
  const half = plotH / 2;
  const yZero = M.top + half;
  const yUp = (v) => yZero - (v / niceMax) * half;
  const yDn = (v) => yZero + (v / niceMax) * half;
  const band = plotW / labels.length;
  const barW = Math.min(band * 0.5, 72);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // gridlines (both sides) + symmetric axis numbers; zero line drawn emphasized
  for (let v = step; v <= niceMax + 1e-9; v += step) {
    [yUp(v), yDn(v)].forEach((y) => {
      p.push(`<line x1="${M.left}" y1="${r(y)}" x2="${r(M.left + plotW)}" y2="${r(y)}" stroke="${gridCol}" stroke-width="1"/>`);
    });
    p.push(`<text x="${M.left - 8}" y="${r(yUp(v) + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
    p.push(`<text x="${M.left - 8}" y="${r(yDn(v) + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }

  // bars: A up, B down, around the zero line
  labels.forEach((lab, i) => {
    const x = M.left + i * band + (band - barW) / 2;
    const cx = r(x + barW / 2);
    if (aVals[i] > 0) {
      const yt = yUp(aVals[i]), h = yZero - yt;
      p.push(`<path d="${topRoundedBar(x, yt, barW, h, 4)}" fill="${colA}"/>`);
      if (showValues) p.push(`<text x="${cx}" y="${r(yt - 7)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(aVals[i]) + u)}</text>`);
    }
    if (bVals[i] > 0) {
      const h = yDn(bVals[i]) - yZero;
      p.push(`<path d="${bottomRoundedBar(x, yZero, barW, h, 4)}" fill="${colDown}"/>`);
      const downLabel = (singleSigned ? '-' : '') + fmt(bVals[i]) + u;   // signed for single-series mode
      if (showValues) p.push(`<text x="${cx}" y="${r(yDn(bVals[i]) + 16)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${valText}">${esc(downLabel)}</text>`);
    }
  });

  // emphasized zero line (drawn last, over the bars' base)
  p.push(`<line x1="${M.left}" y1="${r(yZero)}" x2="${r(M.left + plotW)}" y2="${r(yZero)}" stroke="${zeroCol}" stroke-width="1.75"/>`);

  // category labels straddle the zero line in a background-colored pill, so they
  // read crisply over the down-bars (the old faint-gray-over-red was unreadable).
  const pillFill = transparent ? (isDark ? '#0b0f17' : '#ffffff') : bg;
  labels.forEach((lab, i) => {
    const cx = r(M.left + i * band + band / 2);
    const lw = String(lab).length * (fs - 2) * 0.6 + 14;
    p.push(`<rect x="${r(cx - lw / 2)}" y="${r(yZero - 9)}" width="${r(lw)}" height="18" rx="9" fill="${pillFill}"/>`);
    p.push(`<text x="${cx}" y="${r(yZero + 4)}" text-anchor="middle" font-size="${fs - 2}" ${wAttr(spec, 600)} fill="${catText}">${esc(lab)}</text>`);
  });

  // legend names the two series
  const items = singleSigned
    ? [{ name: A.name || 'Series A', col: colA }]                                              // no phantom B
    : [{ name: A.name || 'Series A', col: colA }, { name: B.name || 'Series B', col: colB }];
  const widths = items.map((it) => 16 + it.name.length * (fs * 0.56) + 18);
  let lx = (W - widths.reduce((a, b) => a + b, 0)) / 2;
  const ly = H - 16;
  items.forEach((it, i) => {
    p.push(`<rect x="${r(lx)}" y="${r(ly - 9)}" width="11" height="11" rx="2.5" fill="${it.col}"/>`);
    p.push(`<text x="${r(lx + 17)}" y="${r(ly)}" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(it.name)}</text>`);
    lx += widths[i];
  });

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── lollipop (single series: thin stem + dot per category) ────────────────────
// Single-bar RULES-LEDGER look (each its own palette color by index, "Total: N"
// badge) drawn as stems + dots instead of bars.
export function renderLollipop(spec) {
  spec = safeData(spec);
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const title = spec.title || '';
  const labels = spec.data.labels;
  const values = spec.data.series[0].values.map((v) => Number(v) || 0);
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues !== false;
  const showTotal = spec.showTotal !== false && spec.valueUnit !== '%';
  const watermark = spec.watermark !== false;
  const explicit = spec.data.series[0].colors;
  const colors = (Array.isArray(explicit) && explicit.length >= labels.length)
    ? explicit : resolveFlatPalette(spec.palette || 'Clean Corporate', labels.length);

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText  = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const M = { left: 56, right: 24, top: title ? 54 : 28, bottom: 46 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxV = Math.max(0, ...values);
  const { step, niceMax } = niceScale(maxV);
  const yPix = (v) => M.top + plotH - (v / niceMax) * plotH;
  const band = plotW / labels.length;
  const baseY = M.top + plotH;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // gridlines + y-axis numbers
  for (let v = 0; v <= niceMax + 1e-9; v += step) {
    const y = r(yPix(v));
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }

  // stems + dots + value/category labels
  values.forEach((v, i) => {
    const cx = r(M.left + i * band + band / 2);
    const y = yPix(v);
    const mc = contrastFloor(colors[i], bg, transparent);   // keep pale marks visible
    p.push(`<line x1="${cx}" y1="${r(baseY)}" x2="${cx}" y2="${r(y)}" stroke="${mc}" stroke-width="3" stroke-linecap="round"/>`);
    p.push(`<circle cx="${cx}" cy="${r(y)}" r="7" fill="${mc}"/>`);
    if (showValues) p.push(`<text x="${cx}" y="${r(y - 14)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(v) + u)}</text>`);
    p.push(`<text x="${cx}" y="${r(baseY + 18)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(labels[i])}</text>`);
  });

  if (showTotal) {
    const total = values.reduce((s, v) => s + v, 0);
    p.push(`<text x="${r(W - M.right)}" y="${title ? 50 : 20}" text-anchor="end" font-size="${fs - 1}"${wOpt(spec)} fill="${axisText}">Total: ${esc(fmt(total) + u)}</text>`);
  }
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── KPI tile — the executive-snapshot building block (big number + delta) ─────
export function renderKpi(spec) {
  const W = spec.width || 340, H = spec.height || 180;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const accent = spec.color || resolveFlatPalette(spec.palette || 'Clean Corporate', 1)[0];

  const labelCol = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const valueCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint = isDark ? '#475569' : '#94a3b8';

  const label = spec.label || '';
  const valueStr = (spec.valuePrefix || '') + fmt(spec.value) + (spec.valueUnit ? ' ' + spec.valueUnit : '');

  const hasDelta = spec.delta !== undefined && spec.delta !== null;
  const d = Number(spec.delta) || 0;
  // The arrow always reflects the literal direction (▲ up / ▼ down). The COLOR
  // reflects whether that's good or bad: by default up=good, but deltaGoodWhen:"down"
  // flips it for lower-is-better metrics (churn, latency, cost, CAC). Unset → old behavior.
  const goodDown = spec.deltaGoodWhen === 'down';
  const good = goodDown ? d < 0 : d > 0;
  const bad = goodDown ? d > 0 : d < 0;
  const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '–';
  const dText = arrow + ' ' + fmt(Math.abs(d)) + (spec.deltaUnit || '%');
  const pillBg = good ? (isDark ? '#064e3b' : '#ecfdf5') : bad ? (isDark ? '#7f1d1d' : '#fef2f2') : (isDark ? '#334155' : '#f1f5f9');
  const pillTx = good ? (isDark ? '#6ee7b7' : '#059669') : bad ? (isDark ? '#fca5a5' : '#dc2626') : labelCol;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="${bg}"/>`);

  // Portrait/large frames center a scaled content block; the compact landscape tile
  // (default 340×180) keeps its fixed layout, so its bytes are unchanged.
  const portrait = H > W;
  if (!portrait) {
    const cx = 40; // content left edge (past the accent strip)
    p.push(`<rect x="18" y="28" width="5" height="${r(H - 56)}" rx="2.5" fill="${accent}"/>`);
    if (label) p.push(`<text x="${cx}" y="48" font-size="${fs + 1}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(label)}</text>`);
    p.push(`<text x="${cx}" y="104" font-size="42" ${wAttr(spec, 800)} fill="${valueCol}">${esc(valueStr)}</text>`);
    if (hasDelta) {
      const pillW = Math.round(dText.length * 7.3 + 18);
      p.push(`<rect x="${cx}" y="124" width="${pillW}" height="24" rx="12" fill="${pillBg}"/>`);
      p.push(`<text x="${r(cx + pillW / 2)}" y="140" text-anchor="middle" font-size="12.5" ${wAttr(spec, 700)} fill="${pillTx}">${esc(dText)}</text>`);
    }
    // sparkline (optional, landscape tile) — minimalist trend along the bottom. Defaults
    // OFF, so a tile without `sparkline` is byte-identical. Color follows the delta's good/bad.
    const spark = spec.sparkline;
    if (Array.isArray(spark) && spark.length >= 2) {
      const sv = spark.map((n) => Number(n) || 0);
      const lo = Math.min(...sv), hi = Math.max(...sv), span = hi - lo;
      const sx0 = cx, sx1 = W - 16, syTop = H - 30, syBot = H - 16;
      const sxOf = (i) => sx0 + (i / (sv.length - 1)) * (sx1 - sx0);
      const syOf = (v) => span === 0 ? (syTop + syBot) / 2 : syBot - ((v - lo) / span) * (syBot - syTop);
      const sparkCol = good ? (isDark ? '#6ee7b7' : '#059669') : bad ? (isDark ? '#fca5a5' : '#dc2626') : accent;
      const pts = sv.map((v, i) => `${r(sxOf(i))},${r(syOf(v))}`).join(' ');
      p.push(`<polyline points="${pts}" fill="none" stroke="${sparkCol}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
      p.push(`<circle cx="${r(sxOf(sv.length - 1))}" cy="${r(syOf(sv[sv.length - 1]))}" r="2.6" fill="${sparkCol}"/>`);
    }
  } else {
    const hasLabel = !!label;
    const px = Math.round(W * 0.09);                                   // content left edge
    const valFont = Math.max(48, Math.min(Math.round(W * 0.16), Math.round((W - 2 * px) / Math.max(1, valueStr.length) * 1.7)));
    const labelFont = Math.round(valFont * 0.32);
    const pillFont = Math.round(valFont * 0.30);
    const pillH = Math.round(pillFont * 1.9);
    const gap1 = Math.round(valFont * 0.30), gap2 = Math.round(valFont * 0.34);
    const blockH = (hasLabel ? labelFont + gap1 : 0) + valFont + (hasDelta ? gap2 + pillH : 0);
    let y = Math.round((H - blockH) / 2);                              // vertically centered block
    const accW = Math.max(5, Math.round(W * 0.012));
    p.push(`<rect x="${Math.round(W * 0.04)}" y="${r(y)}" width="${accW}" height="${r(blockH)}" rx="${r(accW / 2)}" fill="${accent}"/>`);
    if (hasLabel) { const by = y + labelFont; p.push(`<text x="${px}" y="${r(by)}" font-size="${labelFont}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(label)}</text>`); y = by + gap1; }
    const vy = y + valFont; p.push(`<text x="${px}" y="${r(vy)}" font-size="${valFont}" ${wAttr(spec, 800)} fill="${valueCol}">${esc(valueStr)}</text>`); y = vy + gap2;
    if (hasDelta) {
      const pillW = Math.round(dText.length * pillFont * 0.62 + pillFont * 1.4);
      p.push(`<rect x="${px}" y="${r(y)}" width="${pillW}" height="${pillH}" rx="${r(pillH / 2)}" fill="${pillBg}"/>`);
      p.push(`<text x="${r(px + pillW / 2)}" y="${r(y + pillH * 0.68)}" text-anchor="middle" font-size="${pillFont}" ${wAttr(spec, 700)} fill="${pillTx}">${esc(dText)}</text>`);
    }
  }
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── line chart (single or multi-series) ──────────────────────────────────────
export function renderLine(spec) {
  spec = safeData(spec);
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const labels = spec.data.labels;
  const series = spec.data.series;
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const showValues = spec.showValues === true;   // off by default for lines (clutter)
  const showPoints = spec.showPoints !== false;   // on by default
  // Line shape + area fill — set via options (curve/area) or convenience type names.
  const smooth = spec.curve === 'smooth' || spec.type === 'smooth';
  const stepped = spec.curve === 'stepped' || spec.type === 'stepped';
  const area = spec.area === true || spec.type === 'area';
  const stackedArea = spec.stacked === true || spec.type === 'stackedArea' || spec.type === 'stacked-area';
  const difference = spec.type === 'difference';
  const pal = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(series.length, 2));
  const colorOf = (s, i) => s.color || pal[i % pal.length];

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const gridCol  = isDark ? '#1e293b' : '#e2e8f0';
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText  = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const multi = series.length > 1;
  const M = { left: 56, right: 24, top: title ? 54 : 28, bottom: multi ? 64 : 46 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxV = stackedArea
    ? Math.max(1, ...labels.map((_, i) => series.reduce((s, sr) => s + (Number(sr.values[i]) || 0), 0)))
    : Math.max(0, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  const { step, niceMax } = niceScale(maxV);
  const yPix = (v) => M.top + plotH - (v / niceMax) * plotH;
  const n = labels.length;
  const xPix = (i) => M.left + (n > 1 ? i / (n - 1) : 0.5) * plotW;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  for (let v = 0; v <= niceMax + 1e-9; v += step) {
    const y = r(yPix(v));
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${fmt(v)}</text>`);
  }
  labels.forEach((lab, i) => {
    // First/last labels anchor inward (start/end) so long edge categories don't
    // clip the SVG boundary; interior labels stay centered on their point.
    const anchor = i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle';
    p.push(`<text x="${r(xPix(i))}" y="${r(M.top + plotH + 18)}" text-anchor="${anchor}" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(lab)}</text>`);
  });

  const dot = (pt, col) => `<circle cx="${pt[0]}" cy="${pt[1]}" r="3.5" fill="${col}" stroke="${transparent ? col : bg}" stroke-width="1.5"/>`;

  if (stackedArea) {
    // Each series stacks on the running total; fill the band, line the top edge.
    const cum = new Array(n).fill(0);
    series.forEach((s, si) => {
      const col = colorOf(s, si);
      const top = cum.map((c, i) => c + (Number(s.values[i]) || 0));
      const topPts = top.map((v, i) => [r(xPix(i)), r(yPix(v))]);
      const botPts = cum.map((v, i) => [r(xPix(i)), r(yPix(v))]);
      const topD = straightPath(topPts);
      const botD = botPts.slice().reverse().map((pt) => 'L' + pt[0] + ',' + pt[1]).join(' ');
      p.push(`<path d="${topD} ${botD} Z" fill="${col}" fill-opacity="0.8" stroke="none"/>`);
      p.push(`<path d="${topD}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`);
      if (showPoints) topPts.forEach((pt) => p.push(dot(pt, col)));
      top.forEach((v, i) => { cum[i] = v; });
    });
  } else if (difference) {
    // Two lines + the shaded gap between them; the gap value is labeled at each
    // point, green where line 1 leads, red where it trails.
    const a = series[0], b = series[1] || series[0];
    const colA = colorOf(a, 0), colB = colorOf(b, 1);
    const aPts = labels.map((_, i) => [r(xPix(i)), r(yPix(Number(a.values[i]) || 0))]);
    const bPts = labels.map((_, i) => [r(xPix(i)), r(yPix(Number(b.values[i]) || 0))]);
    const aD = straightPath(aPts);
    const bandBack = bPts.slice().reverse().map((pt) => 'L' + pt[0] + ',' + pt[1]).join(' ');
    p.push(`<path d="${aD} ${bandBack} Z" fill="${isDark ? '#475569' : '#cbd5e1'}" fill-opacity="0.35" stroke="none"/>`);
    p.push(`<path d="${aD}" fill="none" stroke="${colA}" stroke-width="2.5"/>`);
    p.push(`<path d="${straightPath(bPts)}" fill="none" stroke="${colB}" stroke-width="2.5"/>`);
    if (showPoints) { aPts.forEach((pt) => p.push(dot(pt, colA))); bPts.forEach((pt) => p.push(dot(pt, colB))); }
    labels.forEach((_, i) => {
      const gap = (Number(a.values[i]) || 0) - (Number(b.values[i]) || 0);
      const my = r((aPts[i][1] + bPts[i][1]) / 2 + 4);
      p.push(`<text x="${r(xPix(i))}" y="${my}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 700)} fill="${gap >= 0 ? '#059669' : '#dc2626'}">${(gap >= 0 ? '+' : '') + fmt(gap)}</text>`);
    });
  } else {
    series.forEach((s, si) => {
      const col = colorOf(s, si);
      const vals = s.values.slice(0, n).map((v) => Number(v) || 0);
      const pts = vals.map((v, i) => [r(xPix(i)), r(yPix(v))]);
      if (!pts.length) return;   // empty series → draw nothing (area/stepped index pts[0])
      const d = smooth ? smoothPath(pts) : stepped ? steppedPath(pts) : straightPath(pts);
      if (area) {
        const baseY = r(M.top + plotH);
        p.push(`<path d="${d} L${pts[pts.length - 1][0]},${baseY} L${pts[0][0]},${baseY} Z" fill="${col}" fill-opacity="0.16" stroke="none"/>`);
      }
      p.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
      if (showPoints) pts.forEach((pt) => p.push(dot(pt, col)));
      if (showValues) vals.forEach((v, i) => p.push(`<text x="${r(xPix(i))}" y="${r(yPix(v) - 9)}" text-anchor="middle" font-size="${fs - 2}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(v) + u)}</text>`));
    });
  }

  if (multi) {
    const items = series.map((s, i) => ({ name: s.name || ('Series ' + (i + 1)), col: colorOf(s, i) }));
    const widths = items.map((it) => 16 + it.name.length * (fs * 0.56) + 18);
    const totalW = widths.reduce((a, b) => a + b, 0);
    let lx = (W - totalW) / 2;
    const ly = H - 16;
    items.forEach((it, i) => {
      p.push(`<circle cx="${r(lx + 5)}" cy="${r(ly - 4)}" r="5" fill="${it.col}"/>`);
      p.push(`<text x="${r(lx + 16)}" y="${r(ly)}" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(it.name)}</text>`);
      lx += widths[i];
    });
  }

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── slope chart (slopegraph: first point vs last point) ──────────────────────
export function renderSlope(spec) {
  const W = spec.width || 800, H = spec.height || 450;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const labels = spec.data.labels;
  const series = spec.data.series;
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const li = labels.length - 1;
  const pal = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(series.length, 2));
  const colorOf = (s, i) => s.color || pal[i % pal.length];

  const guide = isDark ? '#1e293b' : '#e2e8f0';
  const catText = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint = isDark ? '#475569' : '#94a3b8';

  const multi = series.length > 1;
  const M = { left: 72, right: 132, top: title ? 54 : 28, bottom: multi ? 64 : 44 };
  const plotH = H - M.top - M.bottom;
  const leftX = M.left, rightX = W - M.right, baseY = M.top + plotH;
  const firstVals = series.map((s) => Number(s.values[0]) || 0);
  const lastVals = series.map((s) => Number(s.values[li]) || 0);
  const { niceMax } = niceScale(Math.max(1, ...firstVals, ...lastVals));
  const yPix = (v) => M.top + plotH - (v / niceMax) * plotH;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  p.push(`<line x1="${leftX}" y1="${M.top}" x2="${leftX}" y2="${r(baseY)}" stroke="${guide}" stroke-width="1"/>`);
  p.push(`<line x1="${rightX}" y1="${M.top}" x2="${rightX}" y2="${r(baseY)}" stroke="${guide}" stroke-width="1"/>`);

  series.forEach((s, si) => {
    const col = colorOf(s, si);
    const y0 = r(yPix(firstVals[si])), y1 = r(yPix(lastVals[si]));
    p.push(`<line x1="${leftX}" y1="${y0}" x2="${rightX}" y2="${y1}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`);
    p.push(`<circle cx="${leftX}" cy="${y0}" r="4" fill="${col}"/>`);
    p.push(`<circle cx="${rightX}" cy="${y1}" r="4" fill="${col}"/>`);
    p.push(`<text x="${leftX - 10}" y="${r(y0 + 4)}" text-anchor="end" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(firstVals[si]) + u)}</text>`);
    const delta = lastVals[si] - firstVals[si];
    p.push(`<text x="${rightX + 10}" y="${r(y1 + 4)}" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(lastVals[si]) + u)} <tspan fill="${delta >= 0 ? '#059669' : '#dc2626'}">(${delta >= 0 ? '+' : ''}${esc(fmt(delta))})</tspan></text>`);
  });

  p.push(`<text x="${leftX}" y="${r(baseY + 22)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(labels[0])}</text>`);
  p.push(`<text x="${rightX}" y="${r(baseY + 22)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(labels[li])}</text>`);

  if (multi) {
    const items = series.map((s, i) => ({ name: s.name || ('Series ' + (i + 1)), col: colorOf(s, i) }));
    const widths = items.map((it) => 16 + it.name.length * (fs * 0.56) + 18);
    let lx = (W - widths.reduce((a, b) => a + b, 0)) / 2;
    const ly = H - 16;
    items.forEach((it, i) => {
      p.push(`<circle cx="${r(lx + 5)}" cy="${r(ly - 4)}" r="5" fill="${it.col}"/>`);
      p.push(`<text x="${r(lx + 16)}" y="${r(ly)}" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(it.name)}</text>`);
      lx += widths[i];
    });
  }

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── pie / donut ───────────────────────────────────────────────────────────────
export function renderPie(spec) {
  spec = safeData(spec);
  const W = spec.width || 640, H = spec.height || 420;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));   // auto-scale text with canvas area; default sizes stay 13
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const donut = spec.type === 'donut' || spec.donut === true;
  const labels = spec.data.labels;
  const values = spec.data.series[0].values.map((v) => Number(v) || 0);
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';
  const pre = spec.valuePrefix || '';   // e.g. "$" — honored in legend + donut total
  const explicit = spec.data.series[0].colors;
  const colors = (Array.isArray(explicit) && explicit.length >= labels.length)
    ? explicit : resolveFlatPalette(spec.palette || 'Clean Corporate', labels.length);

  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const legendText = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const faint = isDark ? '#475569' : '#94a3b8';

  const total = values.reduce((a, b) => a + b, 0) || 1;
  const top = title ? 54 : 24;
  const bottomPad = 24;
  // Portrait (tall) frames put the legend BELOW the pie and let it use the full
  // width; landscape keeps the right-side legend. Default 640×420 is landscape, so
  // its bytes are unchanged.
  const portrait = H > W;
  const legendRowH = 26;
  const legendW = 184;
  const legendH = portrait ? labels.length * legendRowH + 14 : 0;
  const cx = portrait ? W / 2 : (W - legendW) / 2;
  const pieAreaH = portrait ? (H - top - legendH - bottomPad) : (H - top - 24);
  const cy = top + pieAreaH / 2;
  const rad = r(Math.min(portrait ? W - 48 : W - legendW, pieAreaH) / 2 - 10);
  const innerR = r(donut ? rad * 0.58 : 0);
  // Slice gap: a thin border in the background color between slices — easier to read.
  // spec.sliceGap (px) overrides; 0 disables. No gap on a transparent background.
  const gapColor = transparent ? null : bg;
  const gapW = spec.sliceGap != null ? Number(spec.sliceGap) : Math.max(2, r(rad * 0.016));
  const gapAttr = (gapColor && gapW > 0) ? ` stroke="${gapColor}" stroke-width="${gapW}" stroke-linejoin="round"` : '';

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  let a = -Math.PI / 2;
  values.forEach((v, i) => {
    const frac = v / total;
    if (frac <= 0) return;
    const a1 = a + frac * Math.PI * 2;
    const col = colors[i];
    if (frac >= 0.9999) {
      if (innerR > 0) p.push(`<circle cx="${r(cx)}" cy="${r(cy)}" r="${r((rad + innerR) / 2)}" fill="none" stroke="${col}" stroke-width="${r(rad - innerR)}"/>`);
      else p.push(`<circle cx="${r(cx)}" cy="${r(cy)}" r="${rad}" fill="${col}"/>`);
    } else {
      p.push(`<path d="${arcPath(cx, cy, rad, a, a1, innerR)}" fill="${col}"${gapAttr}/>`);
    }
    if (frac >= 0.06) {
      const mid = (a + a1) / 2;
      const lr = innerR > 0 ? (rad + innerR) / 2 : rad * 0.62;
      p.push(`<text x="${r(cx + lr * Math.cos(mid))}" y="${r(cy + lr * Math.sin(mid) + 4)}" text-anchor="middle" font-size="${fs}" ${wAttr(spec, 700)} fill="${spec.textColor || contrastColor(col)}">${Math.round(frac * 100)}%</text>`);
    }
    a = a1;
  });

  if (donut) {
    p.push(`<text x="${r(cx)}" y="${r(cy - 2)}" text-anchor="middle" font-size="${fs + 10}" ${wAttr(spec, 800)} fill="${titleCol}">${esc(pre + fmt(total) + u)}</text>`);
    p.push(`<text x="${r(cx)}" y="${r(cy + 18)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${legendText}">Total</text>`);
  }

  if (portrait) {
    // legend centered as a block BELOW the pie
    const maxChars = Math.max(...labels.map((lab, i) => (String(lab) + ' · ' + pre + fmt(values[i]) + u).length));
    const blockW = 18 + maxChars * (fs - 1) * 0.55;
    const lx = r((W - blockW) / 2);
    let lgy = H - legendH - bottomPad + 20;
    labels.forEach((lab, i) => {
      p.push(`<rect x="${lx}" y="${r(lgy - 9)}" width="11" height="11" rx="2.5" fill="${colors[i]}"/>`);
      p.push(`<text x="${r(lx + 18)}" y="${r(lgy)}" font-size="${fs - 1}"${wOpt(spec)} fill="${legendText}">${esc(lab)} · ${esc(pre + fmt(values[i]) + u)}</text>`);
      lgy += legendRowH;
    });
  } else {
    const lgx = W - legendW + 8;
    let lgy = top + 8;
    labels.forEach((lab, i) => {
      p.push(`<rect x="${lgx}" y="${r(lgy - 9)}" width="11" height="11" rx="2.5" fill="${colors[i]}"/>`);
      p.push(`<text x="${lgx + 18}" y="${r(lgy)}" font-size="${fs - 1}"${wOpt(spec)} fill="${legendText}">${esc(lab)} · ${esc(pre + fmt(values[i]) + u)}</text>`);
      lgy += 24;
    });
  }

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── pie of pie (of pie…) ────────────────────────────────────────────────────
// A row of pies; each pie's first slice (the "bridge") explodes toward the next
// pie and breaks down into it, joined by two connector lines. 2 pies = pie-of-pie,
// 3 = pie-of-pie-of-pie, N supported. Donut by default. Each pie shrinks to 75%
// of the one before it, all centered on a single horizontal axis.
// Data: spec.pies = [{ title?, labels[], values[], colors?, palette? }, …]
export function renderPieOfPie(spec) {
  const W = spec.width || 920, H = spec.height || 460;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const title = spec.title || '';
  const watermark = spec.watermark !== false;
  const donut = spec.donut !== false;            // default true (matches the site)
  const showValues = spec.showValues !== false;
  const pre = spec.valuePrefix || '';                       // legend honors prefix…
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';     // …and unit

  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const subCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const faint = isDark ? '#475569' : '#94a3b8';
  const sliceBorder = isDark ? '#0b0f17' : '#ffffff';
  const accent = isDark ? '#a78bfa' : '#8b5cf6';

  const cascade = spec.cascade !== false;   // child pies shade from parent bridge hue
  const raw = Array.isArray(spec.pies) ? spec.pies : [];
  const pies = raw.map((pp) => {
    const labels = (pp.labels || []).map(String);
    const vals = (pp.values || []).map((v) => Number(v) || 0);
    const keep = vals.map((v, i) => [v, i]).filter((e) => e[0] > 0);
    const values = keep.map((e) => e[0]);
    const lbls = keep.map((e) => labels[e[1]] || '');
    return {
      title: pp.title || '', labels: lbls, values, total: values.reduce((a, b) => a + b, 0) || 1,
      explicit: (Array.isArray(pp.colors) && pp.colors.length >= keep.length) ? pp.colors : null,
      palette: pp.palette,
    };
  }).filter((pie) => pie.values.length);

  // Colors via palette-core (GOLD RULE 6). A named NESTED theme cascades by design
  // — the inspired per-pie tiers (Analogous Shift, Retro Editorial, …) or a
  // generative root→child family. Otherwise pie 0 takes the flat palette and each
  // child derives a tier from Pie 1's bridge hue. Per-pie explicit colors always
  // win; spec.cascade:false flattens every pie to one palette.
  const themeName = spec.palette || 'Clean Corporate';
  const isNested = NESTED_THEMES.some((t) => t.name === themeName);
  pies.forEach((pie, i) => {
    const count = pie.values.length;
    if (pie.explicit) pie.colors = pie.explicit;
    else if (isNested && cascade) pie.colors = resolveNestedTheme(themeName, i, count, i > 0 ? pies[0].colors[0] : null);
    else if (i === 0 || !cascade) pie.colors = resolveFlatPalette(pie.palette || themeName, count);
    else pie.colors = tierPalette(pies[0].colors[0], i, count);
  });

  const n = pies.length;
  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (n === 0) { p.push(`</svg>`); return p.join('\n'); }

  const SHRINK = 0.75, EXPL = 0.10, innerFrac = 0.58;
  const fac = (i) => Math.pow(SHRINK, i);
  const sumDiam = pies.reduce((s, _, i) => s + 2 * fac(i), 0);
  const sidePad = 28;
  const gap = Math.max(28, W * 0.035);
  const topMain = title ? 40 : 16;
  const perTitleH = 30;
  const botPad = 16 + (watermark ? 6 : 0);
  // reserve a band below the pies for a per-pie "name · value" legend
  const lgRowH = 22;
  const maxRows = Math.max(...pies.map((pie) => pie.labels.length));
  const legendH = maxRows * lgRowH + 14;
  let R = Math.min((W - 2 * sidePad - (n - 1) * gap) / sumDiam, (H - topMain - perTitleH - botPad - legendH) / 2);
  R = Math.max(20, R);
  const cyAxis = topMain + perTitleH + R;

  // x-centers, left to right, then center the whole row horizontally
  const cxs = [];
  let cursor = sidePad;
  pies.forEach((_, i) => { const rad = R * fac(i); cxs.push(cursor + rad); cursor += 2 * rad + gap; });
  const rowRight = cxs[n - 1] + R * fac(n - 1);
  const center = (W - (rowRight - sidePad)) / 2 - sidePad;
  for (let i = 0; i < n; i++) cxs[i] += center;

  // connectors first (tuck behind the pies)
  const clamp = (x) => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, x));
  for (let i = 0; i < n - 1; i++) {
    const rad = R * fac(i), nrad = R * fac(i + 1), cx = cxs[i], ncx = cxs[i + 1];
    const frac0 = pies[i].values[0] / pies[i].total;
    const exCx = cx + rad * EXPL;
    const s0 = clamp(-frac0 * Math.PI), e0 = clamp(frac0 * Math.PI);
    const ex1 = exCx + rad * Math.cos(s0), ey1 = cyAxis + rad * Math.sin(s0);
    const ex2 = exCx + rad * Math.cos(e0), ey2 = cyAxis + rad * Math.sin(e0);
    const lx = ncx - Math.cos(Math.PI / 3) * nrad;
    const lyT = cyAxis - Math.sin(Math.PI / 3) * nrad, lyB = cyAxis + Math.sin(Math.PI / 3) * nrad;
    const col = pies[i].colors[0] || '#94a3b8';
    const sw = Math.max(1, r(rad * 0.012));
    p.push(`<line x1="${r(ex1)}" y1="${r(ey1)}" x2="${r(lx)}" y2="${r(lyT)}" stroke="${col}" stroke-width="${sw}" stroke-opacity="0.4"/>`);
    p.push(`<line x1="${r(ex2)}" y1="${r(ey2)}" x2="${r(lx)}" y2="${r(lyB)}" stroke="${col}" stroke-width="${sw}" stroke-opacity="0.4"/>`);
  }

  // the pies
  pies.forEach((pie, i) => {
    const rad = R * fac(i), cx = cxs[i];
    const innerR = donut ? r(rad * innerFrac) : 0;
    const isBridge = i < n - 1;
    const frac0 = pie.values[0] / pie.total;
    let a = isBridge ? -frac0 * Math.PI : -Math.PI / 2;
    pie.values.forEach((v, si) => {
      const frac = v / pie.total;
      const a1 = a + frac * Math.PI * 2;
      const col = pie.colors[si];
      const bridge = isBridge && si === 0;
      const drawCx = bridge ? cx + rad * EXPL : cx;
      const stroke = bridge ? ` stroke="${sliceBorder}" stroke-width="${Math.max(1.5, r(rad * 0.02))}"` : '';
      if (frac >= 0.9999) p.push(`<circle cx="${r(drawCx)}" cy="${r(cyAxis)}" r="${r(rad)}" fill="${col}"${stroke}/>`);
      else p.push(`<path d="${arcPath(drawCx, cyAxis, rad, a, a1, innerR)}" fill="${col}"${stroke}/>`);
      if (showValues && frac >= 0.07) {
        const mid = (a + a1) / 2;
        const lr = innerR > 0 ? (rad + innerR) / 2 : rad * 0.62;
        const lfs = Math.max(9, r(fs * Math.sqrt(fac(i))));
        p.push(`<text x="${r(drawCx + lr * Math.cos(mid))}" y="${r(cyAxis + lr * Math.sin(mid) + 4)}" text-anchor="middle" font-size="${lfs}" ${wAttr(spec, 700)} fill="${spec.textColor || contrastColor(col)}">${Math.round(frac * 100)}%</text>`);
      }
      a = a1;
    });
    if (pie.title) p.push(`<text x="${r(cx)}" y="${r(topMain + 13)}" text-anchor="middle" font-size="${fs}" ${wAttr(spec, 700)} fill="${subCol}">${esc(pie.title)}</text>`);
    // "↳ <parent slice>" subtitle on child pies — only when it adds info
    // (skip when the pie's own title already names the expanded slice).
    const parentLabel = i > 0 ? pies[i - 1].labels[0] : '';
    if (parentLabel && parentLabel !== pie.title) {
      const sy = pie.title ? topMain + 27 : topMain + 14;
      p.push(`<text x="${r(cx)}" y="${r(sy)}" text-anchor="middle" font-size="${fs - 3}"${wOpt(spec)} fill="${accent}">↳ ${esc(parentLabel)}</text>`);
    }
  });

  // per-pie legend (name · value) beneath each pie — fills the lower band and makes
  // slices readable (the slices keep their %). Honors valuePrefix/valueUnit.
  const legendTop = cyAxis + R + 16;
  const lfs = fs - 1;
  pies.forEach((pie, i) => {
    const len = (si) => (String(pie.labels[si]) + ' · ' + pre + fmt(pie.values[si]) + u).length;
    const blockW = 16 + Math.max(0, ...pie.labels.map((_, si) => len(si))) * lfs * 0.55;
    const lx = cxs[i] - blockW / 2;
    let ly = legendTop;
    pie.labels.forEach((lab, si) => {
      p.push(`<rect x="${r(lx)}" y="${r(ly - 9)}" width="10" height="10" rx="2.5" fill="${pie.colors[si]}"/>`);
      p.push(`<text x="${r(lx + 16)}" y="${r(ly)}" font-size="${lfs}"${wOpt(spec)} fill="${subCol}">${esc(lab)} · ${esc(pre + fmt(pie.values[si]) + u)}</text>`);
      ly += lgRowH;
    });
  });

  if (title) p.push(`<text x="${r(W / 2)}" y="26" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(`<text x="${r(W - 8)}" y="${r(H - 8)}" text-anchor="end" font-size="10" fill="${faint}" opacity="0.7">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// Aspect-ratio presets (name / ratio → recommended export width×height). The shape is
// the real choice; SVG is resolution-independent, so these are sensible default pixels.
export const RATIO_PRESETS = {
  'share card': [1200, 630], 'sharecard': [1200, 630], 'share-card': [1200, 630], '1.91:1': [1200, 630],
  'wide': [1280, 720], '16:9': [1280, 720],
  'square': [1080, 1080], '1:1': [1080, 1080],
  'portrait': [1080, 1350], '4:5': [1080, 1350],
  'tall': [1080, 1920], '9:16': [1080, 1920],
  'classic': [1200, 900], '4:3': [1200, 900],
};
// Resolve spec.preset / spec.ratio → width/height (an explicit width/height still wins).
function applyPreset(spec) {
  const key = String(spec.preset || spec.ratio || '').trim().toLowerCase();
  const p = RATIO_PRESETS[key];
  if (!p) return spec;
  return { ...spec, width: spec.width != null ? spec.width : p[0], height: spec.height != null ? spec.height : p[1] };
}

// ── stat cards (a row/grid of KPI tiles) ─────────────────────────────────────
// A plural shape (its own `cards` array, like pieofpie's `pies`) — NOT kpi's single
// value, NOT labels+series. Each card reuses kpi's exact field vocabulary
// (label/value/valuePrefix/valueUnit/delta/deltaUnit/deltaGoodWhen) and delta-pill
// logic, laid out on a bounded, computed grid. Additive & isolated: touches no
// shared axis/scale code. Default = single-row strip, wrapping to a grid past 4.
export function renderCards(spec) {
  const cards = Array.isArray(spec.cards) ? spec.cards : [];
  const n = Math.max(1, cards.length);
  const title = spec.title || '';

  // Grid: default a strip capped at 4 wide; `gridColumns` forces a width; wraps to rows.
  // (Falls back to a numeric `columns` for any pre-0.4.0 spec; 0.4.0 renamed it to
  // gridColumns so `columns` could be a clean string[] header field for heatmap/matrix/table.)
  const forced = spec.gridColumns != null ? Number(spec.gridColumns) : (typeof spec.columns === 'number' ? spec.columns : null);
  const cols = Math.max(1, Math.min(forced || Math.min(n, 4), n));
  const rows = Math.ceil(n / cols);

  const PAD = 24, GAP = 18, CARD_W = 300, CARD_H = 148;
  const titleH = title ? 44 : 0;
  const W = spec.width || PAD * 2 + cols * CARD_W + (cols - 1) * GAP;
  const H = spec.height || PAD * 2 + titleH + rows * CARD_H + (rows - 1) * GAP;

  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));

  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const valueCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint = isDark ? '#475569' : '#94a3b8';
  const surface = isDark ? '#1e293b' : '#ffffff';
  const border = isDark ? '#334155' : '#e2e8f0';

  // Fit cell size to the available canvas (honors explicit width/height too).
  const cellW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  const cellH = (H - PAD * 2 - titleH - GAP * (rows - 1)) / rows;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  cards.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = PAD + col * (cellW + GAP);
    const y = PAD + titleH + row * (cellH + GAP);
    const accent = contrastFloor(c.color || palette[i % palette.length], bg, transparent);

    // card surface
    p.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(cellW)}" height="${r(cellH)}" rx="14" fill="${transparent ? 'none' : surface}" stroke="${border}" stroke-width="1"/>`);
    // accent strip
    p.push(`<rect x="${r(x + cellW * 0.05)}" y="${r(y + cellH * 0.18)}" width="5" height="${r(cellH * 0.64)}" rx="2.5" fill="${accent}"/>`);

    const contentX = r(x + cellW * 0.115);
    const labelFs = fs + 1;
    const valFs = Math.max(20, Math.round(cellH * 0.235));
    const valueStr = (c.valuePrefix || '') + fmt(c.value) + (c.valueUnit ? ' ' + c.valueUnit : '');

    const cLabel = c.label || '';
    if (cLabel) p.push(`<text x="${contentX}" y="${r(y + cellH * 0.27)}" font-size="${labelFs}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(cLabel)}</text>`);
    p.push(`<text x="${contentX}" y="${r(y + cellH * 0.58)}" font-size="${valFs}" ${wAttr(spec, 800)} fill="${valueCol}">${esc(valueStr)}</text>`);

    // delta pill — identical good/bad logic to renderKpi
    const hasDelta = c.delta !== undefined && c.delta !== null;
    if (hasDelta) {
      const d = Number(c.delta) || 0;
      const goodDown = c.deltaGoodWhen === 'down';
      const good = goodDown ? d < 0 : d > 0;
      const bad = goodDown ? d > 0 : d < 0;
      const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '–';
      const dText = arrow + ' ' + fmt(Math.abs(d)) + (c.deltaUnit || '%');
      const pillBg = good ? (isDark ? '#064e3b' : '#ecfdf5') : bad ? (isDark ? '#7f1d1d' : '#fef2f2') : (isDark ? '#334155' : '#f1f5f9');
      const pillTx = good ? (isDark ? '#6ee7b7' : '#059669') : bad ? (isDark ? '#fca5a5' : '#dc2626') : labelCol;
      const pillFs = 12.5;
      const pillH = 24;
      const pillW = Math.round(dText.length * 7.3 + 18);
      const py = r(y + cellH * 0.70);
      p.push(`<rect x="${contentX}" y="${py}" width="${pillW}" height="${pillH}" rx="12" fill="${pillBg}"/>`);
      p.push(`<text x="${r(Number(contentX) + pillW / 2)}" y="${r(Number(py) + 16)}" text-anchor="middle" font-size="${pillFs}" ${wAttr(spec, 700)} fill="${pillTx}">${esc(dText)}</text>`);
    }
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── labeled box-stack / layer diagram ────────────────────────────────────────
// A plural shape (its own `layers` array) — a vertical stack of labeled blocks,
// each a `{ title, subtitle? }`. No values, no axis: a structure/architecture
// picture (e.g. a tech stack), NOT a stacked bar. Each block fills a distinct
// palette color; on-block text is contrast-aware (RULES-LEDGER: never hard-coded
// white). Additive & isolated: touches no shared axis/scale code.
export function renderLayers(spec) {
  const layers = Array.isArray(spec.layers) ? spec.layers : [];
  const n = Math.max(1, layers.length);
  const title = spec.title || '';

  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));

  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, GAP = 10, BLOCK_H = 72;
  const topY = title ? 54 : 24;
  const W = spec.width || 600;
  const H = spec.height || topY + n * BLOCK_H + (n - 1) * GAP + 16;

  const blockW = W - PAD * 2;
  const blockH = (H - topY - 16 - GAP * (n - 1)) / n;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  layers.forEach((layer, i) => {
    const y = topY + i * (blockH + GAP);
    const fill = layer.color || palette[i % palette.length];
    const tc = spec.textColor || contrastColor(fill);
    const cx = r(W / 2);
    const lTitle = layer.title || '';
    const lSub = layer.subtitle || '';

    p.push(`<rect x="${PAD}" y="${r(y)}" width="${r(blockW)}" height="${r(blockH)}" rx="12" fill="${fill}"/>`);
    if (lSub) {
      p.push(`<text x="${cx}" y="${r(y + blockH / 2 - 2)}" text-anchor="middle" font-size="${fs + 4}" ${wAttr(spec, 700)} fill="${tc}">${esc(lTitle)}</text>`);
      p.push(`<text x="${cx}" y="${r(y + blockH / 2 + 16)}" text-anchor="middle" font-size="${fs}"${wOpt(spec)} fill="${tc}" opacity="0.85">${esc(lSub)}</text>`);
    } else {
      p.push(`<text x="${cx}" y="${r(y + blockH / 2 + fs / 2)}" text-anchor="middle" font-size="${fs + 4}" ${wAttr(spec, 700)} fill="${tc}">${esc(lTitle)}</text>`);
    }
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── labeled progress / bullet bars ───────────────────────────────────────────
// Its own `bars` array: each `{ label, value, target?, valueUnit? }`. Fills toward
// `target` (the track end = the target); with no target, `value` is read as a
// percent (0–100). Bounded rows of rounded rects — no axis, no new primitive.
export function renderProgress(spec) {
  const bars = Array.isArray(spec.bars) ? spec.bars : [];
  const n = Math.max(1, bars.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const trackCol = isDark ? '#334155' : '#e2e8f0';
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, ROW_H = 46;
  const topY = title ? 54 : 24;
  const W = spec.width || 600;
  const H = spec.height || topY + n * ROW_H + 8;
  const trackW = W - PAD * 2;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  bars.forEach((b, i) => {
    const ry = topY + i * ROW_H;
    const val = Number(b.value) || 0;
    const hasTarget = b.target !== undefined && b.target !== null;
    const target = Number(b.target) || 0;
    const unit = b.valueUnit || '';
    const ratio = hasTarget ? (target > 0 ? val / target : 0) : val / 100;
    const cl = Math.max(0, Math.min(1, ratio));
    const valStr = hasTarget ? `${fmt(val)} / ${fmt(target)}${unit ? ' ' + unit : ''}` : `${fmt(val)}${unit || '%'}`;
    const fill = b.color || palette[i % palette.length];
    const labelY = ry + 13, barY = ry + 22, barH = 14;
    p.push(`<text x="${PAD}" y="${r(labelY)}" font-size="${fs}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(b.label || '')}</text>`);
    p.push(`<text x="${W - PAD}" y="${r(labelY)}" text-anchor="end" font-size="${fs}"${wOpt(spec)} fill="${valCol}">${esc(valStr)}</text>`);
    p.push(`<rect x="${PAD}" y="${r(barY)}" width="${r(trackW)}" height="${barH}" rx="7" fill="${trackCol}"/>`);
    if (cl > 0) p.push(`<rect x="${PAD}" y="${r(barY)}" width="${r(Math.max(barH, cl * trackW))}" height="${barH}" rx="7" fill="${fill}"/>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── waffle / dot grid ─────────────────────────────────────────────────────────
// Its own `parts` array `{ label, value, color? }`. Parts fill a 10×10 grid out of
// 100 cells; if they sum to <100 the remainder are empty track cells (so one part =
// a simple "% filled" gauge, many parts = categorical part-to-whole). Largest-
// remainder allocation keeps the filled count exact. Bounded grid, no new primitive.
export function renderWaffle(spec) {
  const parts = Array.isArray(spec.parts) ? spec.parts : [];
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(parts.length, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const legendCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const trackCol = isDark ? '#334155' : '#e2e8f0';
  const faint = isDark ? '#475569' : '#94a3b8';

  // allocate 100 cells across the parts (largest-remainder), empties = the rest.
  const vals = parts.map((pt) => Math.max(0, Number(pt.value) || 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  const scale = sum > 100 ? 100 / sum : 1;
  const exact = vals.map((v) => v * scale);
  const cells = exact.map(Math.floor);
  const targetFilled = Math.min(100, Math.round(sum));
  const rem = targetFilled - cells.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [i, v - Math.floor(v)]).sort((a, b) => b[1] - a[1]);
  for (let k = 0; k < rem && order.length; k++) cells[order[k % order.length][0]]++;
  const colors = [];
  parts.forEach((pt, i) => { const c = pt.color || palette[i % palette.length]; for (let k = 0; k < cells[i]; k++) colors.push(c); });
  while (colors.length < 100) colors.push(trackCol);
  colors.length = 100;

  const PAD = 24, CELL = 26, GAP = 4;
  const topY = title ? 54 : 24;
  const gridSize = 10 * CELL + 9 * GAP;
  const gridX = PAD, gridY = topY;
  const legendX = gridX + gridSize + 28;
  const W = spec.width || 600;
  const H = spec.height || topY + gridSize + 16;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  for (let k = 0; k < 100; k++) {
    const row = Math.floor(k / 10), col = k % 10;
    const x = gridX + col * (CELL + GAP), y = gridY + row * (CELL + GAP);
    p.push(`<rect x="${r(x)}" y="${r(y)}" width="${CELL}" height="${CELL}" rx="4" fill="${colors[k]}"/>`);
  }
  parts.forEach((pt, i) => {
    const ly = topY + 6 + i * 24;
    const c = pt.color || palette[i % palette.length];
    p.push(`<rect x="${legendX}" y="${r(ly)}" width="13" height="13" rx="3" fill="${c}"/>`);
    p.push(`<text x="${legendX + 20}" y="${r(ly + 11)}" font-size="${fs}"${wOpt(spec)} fill="${legendCol}">${esc((pt.label || '') + '  ' + fmt(vals[i]))}</text>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── heatmap grid ──────────────────────────────────────────────────────────────
// Its own 2D shape: `rows`, `columns`, `values[row][col]`. Each cell colored from
// light→dark on a single palette hue by value; cell value text is contrast-aware.
// Bounded grid of rects — uses palette-core's HSL helpers, no new primitive.
export function renderHeatmap(spec) {
  const rows = Array.isArray(spec.rows) ? spec.rows : [];
  const cols = Array.isArray(spec.columns) ? spec.columns : [];
  const values = Array.isArray(spec.values) ? spec.values : [];
  const nr = Math.max(1, rows.length), nc = Math.max(1, cols.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const showValues = spec.showValues !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', 3);
  const baseHsl = hexToHsl(spec.color || palette[0]);
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const faint = isDark ? '#475569' : '#94a3b8';

  let min = Infinity, max = -Infinity;
  values.forEach((rv) => (rv || []).forEach((v) => { const x = Number(v) || 0; if (x < min) min = x; if (x > max) max = x; }));
  if (!isFinite(min)) { min = 0; max = 1; }
  const span = (max - min) || 1;
  const cellColor = (v) => hslToHex(baseHsl.h, Math.max(35, baseHsl.s), Math.max(0, Math.min(100, 92 - ((v - min) / span) * 52)));

  const PAD = 24, LEFT = 84, COLH = 24, CELL_H = 44;
  const topY = title ? 54 : 24;
  const W = spec.width || 640;
  const H = spec.height || topY + COLH + nr * CELL_H + 16;
  const plotLeft = PAD + LEFT;
  const plotW = W - PAD - plotLeft;
  const cellW = plotW / nc;
  const gridTop = topY + COLH;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  cols.forEach((c, ci) => p.push(`<text x="${r(plotLeft + ci * cellW + cellW / 2)}" y="${r(gridTop - 8)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${labelCol}">${esc(c)}</text>`));
  rows.forEach((rw, ri) => {
    const y = gridTop + ri * CELL_H;
    p.push(`<text x="${plotLeft - 10}" y="${r(y + CELL_H / 2 + 4)}" text-anchor="end" font-size="${fs - 1}"${wOpt(spec)} fill="${labelCol}">${esc(rw)}</text>`);
    cols.forEach((c, ci) => {
      const v = Number((values[ri] || [])[ci]) || 0;
      const col = cellColor(v);
      const x = plotLeft + ci * cellW;
      p.push(`<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(cellW - 2)}" height="${CELL_H - 2}" rx="4" fill="${col}"/>`);
      if (showValues) p.push(`<text x="${r(x + cellW / 2)}" y="${r(y + CELL_H / 2 + 4)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${spec.textColor || contrastColor(col)}">${esc(fmt(v))}</text>`);
    });
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// Centered trapezoid (shared by funnel + pyramid): top edge width topW, bottom botW.
function trapezoidPath(cx, yTop, topW, yBot, botW) {
  return `M${r(cx - topW / 2)},${r(yTop)} L${r(cx + topW / 2)},${r(yTop)} `
       + `L${r(cx + botW / 2)},${r(yBot)} L${r(cx - botW / 2)},${r(yBot)} Z`;
}

// ── funnel — stages narrowing top→bottom ──────────────────────────────────────
// Its own `stages` array `{ label, value }`. Each stage a centered band whose width
// is proportional to its value, tapering into the next. Path/text only, no axis.
export function renderFunnel(spec) {
  const stages = Array.isArray(spec.stages) ? spec.stages : [];
  const n = Math.max(1, stages.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint = isDark ? '#475569' : '#94a3b8';
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';

  const PAD = 24, GAP = 6, BAND_H = 64;
  const topY = title ? 54 : 24;
  const W = spec.width || 600;
  const H = spec.height || topY + n * BAND_H + (n - 1) * GAP + 16;
  const plotW = W - PAD * 2;
  const cx = W / 2;
  const vals = stages.map((s) => Math.max(0, Number(s.value) || 0));
  const maxV = Math.max(1, ...vals);
  const top = vals[0] || 0;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(cx)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  stages.forEach((s, i) => {
    const yTop = topY + i * (BAND_H + GAP), yBot = yTop + BAND_H;
    const wTop = (vals[i] / maxV) * plotW;
    const wBot = ((i < n - 1 ? vals[i + 1] : vals[i]) / maxV) * plotW;
    const fill = s.color || palette[i % palette.length];
    const tc = spec.textColor || contrastColor(fill);
    const my = (yTop + yBot) / 2;
    const pct = top > 0 ? Math.round((vals[i] / top) * 100) : 0;
    p.push(`<path d="${trapezoidPath(cx, yTop, wTop, yBot, wBot)}" fill="${fill}"/>`);
    p.push(`<text x="${r(cx)}" y="${r(my - 2)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${tc}">${esc(s.label || '')}</text>`);
    p.push(`<text x="${r(cx)}" y="${r(my + 15)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${tc}">${esc(fmt(vals[i]) + u + '  ·  ' + pct + '%')}</text>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── pyramid — hierarchy levels ────────────────────────────────────────────────
// Its own `levels` array `{ title|label, value? }`. A triangle (apex on top) split
// into equal-height bands; each level a palette color, label centered.
export function renderPyramid(spec) {
  const levels = Array.isArray(spec.levels) ? spec.levels : [];
  const n = Math.max(1, levels.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24;
  const topY = title ? 54 : 24;
  const W = spec.width || 600;
  const totalH = spec.height ? (spec.height - topY - 16) : 300;
  const H = spec.height || topY + totalH + 16;
  const baseW = W - PAD * 2;
  const apexY = topY, cx = W / 2, bandH = totalH / n;
  const widthAt = (y) => ((y - apexY) / totalH) * baseW;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(cx)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  levels.forEach((lv, i) => {
    const yTop = apexY + i * bandH, yBot = apexY + (i + 1) * bandH;
    const fill = lv.color || palette[i % palette.length];
    const tc = spec.textColor || contrastColor(fill);
    const hasVal = lv.value !== undefined && lv.value !== null;
    const lbl = (lv.title || lv.label || '') + (hasVal ? '  ·  ' + fmt(Number(lv.value) || 0) : '');
    p.push(`<path d="${trapezoidPath(cx, yTop, widthAt(yTop), yBot, widthAt(yBot))}" fill="${fill}"/>`);
    p.push(`<text x="${r(cx)}" y="${r((yTop + yBot) / 2 + 4)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${tc}">${esc(lbl)}</text>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── quadrant — 2×2 matrix, items placed by two axes ───────────────────────────
// Its own shape: `items` `{ label, x, y }` (x/y in 0–1), plus `xAxis`/`yAxis`
// labels. A square plot split by a crosshair; each item a labeled dot.
export function renderQuadrant(spec) {
  const items = Array.isArray(spec.items) ? spec.items : [];
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(items.length, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const axisCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const gridCol = isDark ? '#334155' : '#e2e8f0';
  const faint = isDark ? '#475569' : '#94a3b8';
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

  const PAD = 24;
  const topY = title ? 54 : 30;
  const W = spec.width || 560, H = spec.height || 540;
  const plotTop = topY + 18;
  const S = Math.min(W - PAD * 2, H - plotTop - 46);
  const plotX = (W - S) / 2, plotBottom = plotTop + S;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  p.push(`<rect x="${r(plotX)}" y="${r(plotTop)}" width="${r(S)}" height="${r(S)}" rx="8" fill="none" stroke="${gridCol}" stroke-width="1"/>`);
  p.push(`<line x1="${r(plotX + S / 2)}" y1="${r(plotTop)}" x2="${r(plotX + S / 2)}" y2="${r(plotBottom)}" stroke="${gridCol}" stroke-width="1"/>`);
  p.push(`<line x1="${r(plotX)}" y1="${r(plotTop + S / 2)}" x2="${r(plotX + S)}" y2="${r(plotTop + S / 2)}" stroke="${gridCol}" stroke-width="1"/>`);
  if (spec.yAxis) p.push(`<text x="${r(plotX)}" y="${r(plotTop - 8)}" font-size="${fs}" ${wAttr(spec, 600)} fill="${axisCol}">${esc(spec.yAxis)} →</text>`);
  if (spec.xAxis) p.push(`<text x="${r(W / 2)}" y="${r(plotBottom + 28)}" text-anchor="middle" font-size="${fs}" ${wAttr(spec, 600)} fill="${axisCol}">${esc(spec.xAxis)} →</text>`);

  items.forEach((it, i) => {
    const x = plotX + clamp01(it.x) * S;
    const y = plotTop + (1 - clamp01(it.y)) * S;
    const c = it.color || palette[i % palette.length];
    const rightHalf = clamp01(it.x) > 0.82;
    p.push(`<circle cx="${r(x)}" cy="${r(y)}" r="6" fill="${c}"/>`);
    p.push(`<text x="${r(rightHalf ? x - 10 : x + 10)}" y="${r(y + 4)}" text-anchor="${rightHalf ? 'end' : 'start'}" font-size="${fs}"${wOpt(spec)} fill="${labelCol}">${esc(it.label || '')}</text>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── timeline — events along one line ──────────────────────────────────────────
// Its own `events` array `{ date?, label }`. A horizontal line with evenly spaced
// dots; date by the line, label alternating above/below to avoid crowding.
export function renderTimeline(spec) {
  const events = Array.isArray(spec.events) ? spec.events : [];
  const n = Math.max(1, events.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelTextCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const dateCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const lineCol = isDark ? '#475569' : '#cbd5e1';
  const faint = isDark ? '#475569' : '#94a3b8';
  const haloCol = transparent ? '#ffffff' : bg;

  const PAD = 44;
  const topY = title ? 54 : 24;
  const W = spec.width || 720, H = spec.height || 220;
  const lineY = topY + (H - topY) / 2;
  const plotW = W - PAD * 2;
  const xOf = (i) => n === 1 ? W / 2 : PAD + i * (plotW / (n - 1));

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  p.push(`<line x1="${PAD}" y1="${r(lineY)}" x2="${W - PAD}" y2="${r(lineY)}" stroke="${lineCol}" stroke-width="2"/>`);
  events.forEach((e, i) => {
    const x = xOf(i), c = e.color || palette[i % palette.length];
    const above = i % 2 === 0;
    p.push(`<circle cx="${r(x)}" cy="${r(lineY)}" r="6" fill="${c}" stroke="${haloCol}" stroke-width="3"/>`);
    if (above) {
      p.push(`<text x="${r(x)}" y="${r(lineY - 28)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelTextCol}">${esc(e.label || '')}</text>`);
      if (e.date) p.push(`<text x="${r(x)}" y="${r(lineY - 13)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${dateCol}">${esc(e.date)}</text>`);
    } else {
      if (e.date) p.push(`<text x="${r(x)}" y="${r(lineY + 20)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${dateCol}">${esc(e.date)}</text>`);
      p.push(`<text x="${r(x)}" y="${r(lineY + 37)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelTextCol}">${esc(e.label || '')}</text>`);
    }
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── venn — 2–3 overlapping sets with counts ───────────────────────────────────
// Its own `sets` array `{ label, value }` + optional `overlap` (2-set count).
// Fixed layout (2 side-by-side, 3 in a triangle); translucent circles so overlaps
// blend. Circles + text only — no new primitive.
export function renderVenn(spec) {
  const sets = Array.isArray(spec.sets) ? spec.sets : [];
  const ns = sets.length;
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(ns, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const textCol = txt(spec, isDark ? '#f1f5f9' : '#1a1a1a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const faint = isDark ? '#475569' : '#94a3b8';

  const topY = title ? 54 : 24;
  const W = spec.width || 600, H = spec.height || 460;
  const val = (i) => fmt(Number(sets[i] && sets[i].value) || 0);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  if (ns <= 2) {
    const R = 120, cy = topY + 40 + R;
    const cx1 = W / 2 - (ns === 2 ? 70 : 0), cx2 = W / 2 + 70;
    p.push(`<circle cx="${r(cx1)}" cy="${r(cy)}" r="${R}" fill="${(sets[0] && sets[0].color) || palette[0]}" fill-opacity="0.5"/>`);
    p.push(`<text x="${r(cx1)}" y="${r(cy - R - 12)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelCol}">${esc((sets[0] && sets[0].label) || '')}</text>`);
    if (ns === 2) {
      p.push(`<circle cx="${r(cx2)}" cy="${r(cy)}" r="${R}" fill="${(sets[1] && sets[1].color) || palette[1]}" fill-opacity="0.5"/>`);
      p.push(`<text x="${r(cx2)}" y="${r(cy - R - 12)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelCol}">${esc((sets[1] && sets[1].label) || '')}</text>`);
      p.push(`<text x="${r(cx1 - R * 0.45)}" y="${r(cy + 4)}" text-anchor="middle" font-size="${fs + 2}" ${wAttr(spec, 700)} fill="${textCol}">${val(0)}</text>`);
      p.push(`<text x="${r(cx2 + R * 0.45)}" y="${r(cy + 4)}" text-anchor="middle" font-size="${fs + 2}" ${wAttr(spec, 700)} fill="${textCol}">${val(1)}</text>`);
      if (spec.overlap !== undefined && spec.overlap !== null) p.push(`<text x="${r(W / 2)}" y="${r(cy + 4)}" text-anchor="middle" font-size="${fs + 2}" ${wAttr(spec, 700)} fill="${textCol}">${esc(fmt(Number(spec.overlap) || 0))}</text>`);
    } else if (ns === 1) {
      p.push(`<text x="${r(cx1)}" y="${r(cy + 4)}" text-anchor="middle" font-size="${fs + 2}" ${wAttr(spec, 700)} fill="${textCol}">${val(0)}</text>`);
    }
  } else {
    const R = 100, cx = W / 2, cyTop = topY + 28 + R * 0.6;
    const c = [[cx, cyTop], [cx - R * 0.78, cyTop + R * 0.98], [cx + R * 0.78, cyTop + R * 0.98]];
    for (let i = 0; i < 3; i++) p.push(`<circle cx="${r(c[i][0])}" cy="${r(c[i][1])}" r="${R}" fill="${(sets[i] && sets[i].color) || palette[i]}" fill-opacity="0.45"/>`);
    p.push(`<text x="${r(c[0][0])}" y="${r(c[0][1] - R - 8)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelCol}">${esc((sets[0].label || '') + '  ' + val(0))}</text>`);
    p.push(`<text x="${r(c[1][0] - R * 0.4)}" y="${r(c[1][1] + R + 18)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelCol}">${esc((sets[1].label || '') + '  ' + val(1))}</text>`);
    p.push(`<text x="${r(c[2][0] + R * 0.4)}" y="${r(c[2][1] + R + 18)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelCol}">${esc((sets[2].label || '') + '  ' + val(2))}</text>`);
  }

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── status-glyph primitive (Chunk 4) ─────────────────────────────────────────
// Drawn as vector paths (NOT font characters) so they're crisp at any size and
// always rasterize. Each draws centered at (cx,cy) with half-extent s.
function glyphCheck(cx, cy, s, col) {
  return `<path d="M${r(cx - s * 0.5)},${r(cy + s * 0.02)} L${r(cx - s * 0.12)},${r(cy + s * 0.42)} L${r(cx + s * 0.55)},${r(cy - s * 0.45)}" fill="none" stroke="${col}" stroke-width="${r(s * 0.26)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function glyphCross(cx, cy, s, col) {
  return `<path d="M${r(cx - s * 0.4)},${r(cy - s * 0.4)} L${r(cx + s * 0.4)},${r(cy + s * 0.4)} M${r(cx + s * 0.4)},${r(cy - s * 0.4)} L${r(cx - s * 0.4)},${r(cy + s * 0.4)}" fill="none" stroke="${col}" stroke-width="${r(s * 0.24)}" stroke-linecap="round"/>`;
}
function glyphDot(cx, cy, s, col) { return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(s * 0.36)}" fill="${col}"/>`; }
function glyphRing(cx, cy, s, col) { return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(s * 0.4)}" fill="none" stroke="${col}" stroke-width="${r(s * 0.18)}"/>`; }
function glyphDash(cx, cy, s, col) { return `<line x1="${r(cx - s * 0.4)}" y1="${r(cy)}" x2="${r(cx + s * 0.4)}" y2="${r(cy)}" stroke="${col}" stroke-width="${r(s * 0.2)}" stroke-linecap="round"/>`; }
// person pictogram (icon-array), top-left at (x, topY), height h.
function personGlyph(cx, topY, h, col) {
  const headR = h * 0.22, headCy = topY + headR;
  const bodyTop = headCy + headR * 1.2, bodyW = h * 0.64, bodyBot = topY + h;
  return `<circle cx="${r(cx)}" cy="${r(headCy)}" r="${r(headR)}" fill="${col}"/>`
       + `<path d="M${r(cx - bodyW / 2)},${r(bodyBot)} Q${r(cx - bodyW / 2)},${r(bodyTop)} ${r(cx)},${r(bodyTop)} Q${r(cx + bodyW / 2)},${r(bodyTop)} ${r(cx + bodyW / 2)},${r(bodyBot)} Z" fill="${col}"/>`;
}
// Map a matrix/checklist cell value to a glyph or text.
function statusCellSvg(val, cx, cy, s, fs, textCol) {
  if (val === true) return glyphCheck(cx, cy, s, '#059669');
  if (val === false) return glyphCross(cx, cy, s, '#94a3b8');
  const t = String(val == null ? '' : val).trim().toLowerCase();
  if (['yes', 'y', 'true', '✓', 'done', 'included'].includes(t)) return glyphCheck(cx, cy, s, '#059669');
  if (['no', 'n', 'false', '✗', 'x'].includes(t)) return glyphCross(cx, cy, s, '#94a3b8');
  if (['partial', '~', 'half', 'some', 'limited'].includes(t)) return glyphDot(cx, cy, s, '#d97706');
  if (['', '-', '–', 'na', 'n/a'].includes(t)) return glyphDash(cx, cy, s, '#cbd5e1');
  return `<text x="${r(cx)}" y="${r(cy + fs * 0.35)}" text-anchor="middle" font-size="${fs}" fill="${textCol}">${esc(String(val))}</text>`;
}

// ── comparison / feature matrix ───────────────────────────────────────────────
// Its own shape: `columns` (string[]) + `rows` `{ label, cells[] }`. Each cell is a
// boolean / status word (→ ✓/✗/dot/dash glyph) or plain text (→ value). Zebra rows.
export function renderMatrix(spec) {
  const columns = Array.isArray(spec.columns) ? spec.columns : [];
  const rows = Array.isArray(spec.rows) ? spec.rows : [];
  const nc = Math.max(1, columns.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const headCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const lineCol = isDark ? '#334155' : '#e2e8f0';
  const zebra = isDark ? '#1e293b' : '#f8fafc';
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24;
  const topY = title ? 54 : 24;
  const LEFTW = spec.labelWidth ? Number(spec.labelWidth) : 200;
  const HEAD = 38, ROWH = 40;
  const W = spec.width || 680;
  const H = spec.height || topY + HEAD + rows.length * ROWH + 16;
  const plotLeft = PAD + LEFTW;
  const cellW = (W - PAD - plotLeft) / nc;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  columns.forEach((c, ci) => p.push(`<text x="${r(plotLeft + ci * cellW + cellW / 2)}" y="${r(topY + HEAD - 14)}" text-anchor="middle" font-size="${fs}" ${wAttr(spec, 700)} fill="${headCol}">${esc(c)}</text>`));
  p.push(`<line x1="${PAD}" y1="${r(topY + HEAD)}" x2="${W - PAD}" y2="${r(topY + HEAD)}" stroke="${lineCol}" stroke-width="1"/>`);

  rows.forEach((row, ri) => {
    const y = topY + HEAD + ri * ROWH;
    if (ri % 2 === 1) p.push(`<rect x="${PAD}" y="${r(y)}" width="${r(W - PAD * 2)}" height="${ROWH}" fill="${zebra}"/>`);
    p.push(`<text x="${PAD}" y="${r(y + ROWH / 2 + 4)}" font-size="${fs}"${wOpt(spec)} fill="${labelCol}">${esc(row.label || '')}</text>`);
    const cells = Array.isArray(row.cells) ? row.cells : [];
    columns.forEach((c, ci) => {
      p.push(statusCellSvg(cells[ci], plotLeft + ci * cellW + cellW / 2, y + ROWH / 2, fs * 0.85, fs, labelCol));
    });
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── checklist / status list ───────────────────────────────────────────────────
// Its own `items` array `{ label, status }`. status → glyph: done ✓ (green),
// blocked ✗ (red), partial • (amber), else an empty ring (pending). Done items mute.
export function renderChecklist(spec) {
  const items = Array.isArray(spec.items) ? spec.items : [];
  const n = Math.max(1, items.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const doneCol = isDark ? '#64748b' : '#94a3b8';
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, ROWH = 38;
  const topY = title ? 54 : 24;
  const W = spec.width || 520;
  const H = spec.height || topY + n * ROWH + 12;
  const s = fs * 1.0, gx = PAD + 11;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${PAD}" y="33" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  items.forEach((it, i) => {
    const cy = topY + i * ROWH + ROWH / 2;
    const st = String(it.status || '').trim().toLowerCase();
    let glyph, lc = labelCol;
    if (['done', 'complete', 'completed', 'yes', 'true'].includes(st)) { glyph = glyphCheck(gx, cy, s, '#059669'); lc = doneCol; }
    else if (['blocked', 'fail', 'failed', 'no', 'cancelled'].includes(st)) { glyph = glyphCross(gx, cy, s, '#dc2626'); }
    else if (['partial', 'progress', 'in progress', 'wip', 'doing'].includes(st)) { glyph = glyphDot(gx, cy, s, '#d97706'); }
    else { glyph = glyphRing(gx, cy, s, '#cbd5e1'); }
    p.push(glyph);
    p.push(`<text x="${r(gx + s + 14)}" y="${r(cy + fs * 0.35)}" font-size="${fs + 1}"${wOpt(spec)} fill="${lc}">${esc(it.label || '')}</text>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── icon array / pictogram ────────────────────────────────────────────────────
// `total` person icons, the first `filled` colored, the rest faint — part-of-whole
// as people. `perRow` controls wrapping (default 10).
export function renderIconArray(spec) {
  const total = Math.max(1, Math.round(Number(spec.total) || 10));
  const filled = Math.max(0, Math.min(total, Math.round(Number(spec.filled) || 0)));
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const fillCol = spec.color || resolveFlatPalette(spec.palette || 'Clean Corporate', 1)[0];
  const emptyCol = isDark ? '#334155' : '#e2e8f0';
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, ICON = 30, GAP = 8;
  const topY = title ? 54 : 24;
  const perRow = Math.max(1, spec.perRow ? Number(spec.perRow) : Math.min(total, 10));
  const rowsN = Math.ceil(total / perRow);
  const W = spec.width || PAD * 2 + perRow * ICON + (perRow - 1) * GAP;
  const H = spec.height || topY + rowsN * (ICON + GAP) + 12;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${PAD}" y="33" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  for (let k = 0; k < total; k++) {
    const row = Math.floor(k / perRow), col = k % perRow;
    const x = PAD + col * (ICON + GAP), y = topY + row * (ICON + GAP);
    p.push(personGlyph(x + ICON / 2, y, ICON, k < filled ? fillCol : emptyCol));
  }

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── connector-line primitive (Chunk 6) ───────────────────────────────────────
// A straight horizontal connector from x1→x2 at height y, with a chevron arrowhead
// at the end (shows left→right flow). The one new primitive for step/process rows.
function connectorLine(x1, x2, y, col) {
  const ah = 5;
  return `<line x1="${r(x1)}" y1="${r(y)}" x2="${r(x2 - ah)}" y2="${r(y)}" stroke="${col}" stroke-width="2"/>`
       + `<path d="M${r(x2 - ah - 1)},${r(y - ah)} L${r(x2)},${r(y)} L${r(x2 - ah - 1)},${r(y + ah)}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ── step / process row ────────────────────────────────────────────────────────
// Its own `steps` array `{ label, description? }`. Numbered nodes left→right joined
// by connector arrows — a LINEAR flow (not a branching graph). Uses the connector
// primitive; no graph auto-layout (positions are computed directly).
export function renderSteps(spec) {
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const n = Math.max(1, steps.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const descCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const connCol = isDark ? '#475569' : '#cbd5e1';
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 52, R = 22;
  const topY = title ? 54 : 24;
  const W = spec.width || 720;
  const H = spec.height || topY + 150;
  const cy = topY + 36 + R;
  const xOf = (i) => n === 1 ? W / 2 : (PAD + R) + i * ((W - 2 * (PAD + R)) / (n - 1));

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  for (let i = 0; i < n - 1; i++) p.push(connectorLine(xOf(i) + R + 6, xOf(i + 1) - R - 6, cy, connCol));

  steps.forEach((st, i) => {
    const x = xOf(i), fill = st.color || palette[i % palette.length], tc = spec.textColor || contrastColor(fill);
    p.push(`<circle cx="${r(x)}" cy="${r(cy)}" r="${R}" fill="${fill}"/>`);
    p.push(`<text x="${r(x)}" y="${r(cy + 5)}" text-anchor="middle" font-size="${fs + 3}" ${wAttr(spec, 800)} fill="${tc}">${i + 1}</text>`);
    p.push(`<text x="${r(x)}" y="${r(cy + R + 24)}" text-anchor="middle" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${labelCol}">${esc(st.label || '')}</text>`);
    if (st.description) p.push(`<text x="${r(x)}" y="${r(cy + R + 42)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${descCol}">${esc(st.description)}</text>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── table — rows × columns of text / values ───────────────────────────────────
// Its own shape: `columns` (string[] header) + `rows` (array of cell arrays).
// Numbers right-align (and format), text left-aligns. Header + zebra rows. The
// general tabular type (matrix is the ✓/✗ variant). Rect/line/text only.
export function renderTable(spec) {
  const columns = Array.isArray(spec.columns) ? spec.columns : [];
  const rows = Array.isArray(spec.rows) ? spec.rows : [];
  const nc = Math.max(1, columns.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const headCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const cellCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const lineCol = isDark ? '#334155' : '#e2e8f0';
  const zebra = isDark ? '#1e293b' : '#f8fafc';
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, HEAD = 38, ROWH = 36;
  const topY = title ? 54 : 24;
  const W = spec.width || 680;
  const H = spec.height || topY + HEAD + rows.length * ROWH + 16;
  const colW = (W - PAD * 2) / nc;
  const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));
  const cellX = (ci, right) => right ? PAD + ci * colW + colW - 10 : PAD + ci * colW + 4;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  columns.forEach((c, ci) => {
    const right = ci > 0;
    p.push(`<text x="${r(cellX(ci, right))}" y="${r(topY + HEAD - 14)}" ${right ? 'text-anchor="end" ' : ''}font-size="${fs}" ${wAttr(spec, 700)} fill="${headCol}">${esc(c)}</text>`);
  });
  p.push(`<line x1="${PAD}" y1="${r(topY + HEAD)}" x2="${W - PAD}" y2="${r(topY + HEAD)}" stroke="${lineCol}" stroke-width="1"/>`);

  rows.forEach((row, ri) => {
    const y = topY + HEAD + ri * ROWH;
    if (ri % 2 === 1) p.push(`<rect x="${PAD}" y="${r(y)}" width="${r(W - PAD * 2)}" height="${ROWH}" fill="${zebra}"/>`);
    const cells = Array.isArray(row) ? row : [];
    for (let ci = 0; ci < nc; ci++) {
      const v = cells[ci];
      if (v === undefined || v === null || v === '') continue;
      const num = ci > 0 && isNum(v);
      const nv = Number(v);
      // Don't thousands-separate a year-like integer (a "2020" column shouldn't read "2,020").
      const yearLike = num && Number.isInteger(nv) && nv >= 1900 && nv <= 2100;
      const out = num ? (yearLike ? String(nv) : fmt(nv)) : String(v);
      p.push(`<text x="${r(cellX(ci, num))}" y="${r(y + ROWH / 2 + 4)}" ${num ? 'text-anchor="end" ' : ''}font-size="${fs}"${wOpt(spec)} fill="${cellCol}">${esc(out)}</text>`);
    }
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── gauge — radial dial (single value) ────────────────────────────────────────
// `value` on a `min`..`max` scale (default 0..100); a 180° arc band fills to value,
// the number sits in the center. Uses the shared arcPath; no axis/scale code.
export function renderGauge(spec) {
  const value = Number(spec.value) || 0;
  const min = spec.min != null ? Number(spec.min) : 0;
  const max = spec.max != null ? Number(spec.max) : 100;
  const t = Math.max(0, Math.min(1, (value - min) / ((max - min) || 1)));
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const accent = contrastFloor(spec.color || resolveFlatPalette(spec.palette || 'Clean Corporate', 1)[0], bg, transparent);
  const track = isDark ? '#334155' : '#e2e8f0';
  const valueCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24;
  const topY = title ? 50 : 20;
  const W = spec.width || 340, H = spec.height || 230;
  const rad = Math.min((W - PAD * 2) / 2, H - topY - 50);
  const cx = W / 2, cy = topY + rad + 6;
  const innerR = rad * 0.72;
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(cx)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${valueCol}">${esc(title)}</text>`);

  p.push(`<path d="${arcPath(cx, cy, rad, Math.PI, 2 * Math.PI, innerR)}" fill="${track}"/>`);
  if (t > 0) p.push(`<path d="${arcPath(cx, cy, rad, Math.PI, Math.PI + t * Math.PI, innerR)}" fill="${accent}"/>`);
  p.push(`<text x="${r(cx)}" y="${r(cy - 6)}" text-anchor="middle" font-size="${r(rad * 0.42)}" ${wAttr(spec, 800)} fill="${valueCol}">${esc(fmt(value) + u)}</text>`);
  if (spec.label) p.push(`<text x="${r(cx)}" y="${r(cy + 18)}" text-anchor="middle" font-size="${fs}"${wOpt(spec)} fill="${labelCol}">${esc(spec.label)}</text>`);
  p.push(`<text x="${r(cx - (rad + innerR) / 2)}" y="${r(cy + 16)}" text-anchor="middle" font-size="${fs - 2}" fill="${faint}">${esc(fmt(min))}</text>`);
  p.push(`<text x="${r(cx + (rad + innerR) / 2)}" y="${r(cy + 16)}" text-anchor="middle" font-size="${fs - 2}" fill="${faint}">${esc(fmt(max))}</text>`);

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── bullet — bullet graph (measure vs target on banded scale) ──────────────────
// `bars:[{label,value,target,max,bands:[b1,b2]}]`. Grey qualitative bands behind a
// thin measure bar, with a target tick. Richer than `progress`. Rect/line only.
export function renderBullet(spec) {
  const bars = Array.isArray(spec.bars) ? spec.bars : [];
  const n = Math.max(1, bars.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const measureCol = contrastFloor(resolveFlatPalette(spec.palette || 'Clean Corporate', 1)[0], bg, transparent);
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const tickCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const bandCols = isDark ? ['#1e293b', '#334155', '#475569'] : ['#eef2f6', '#dbe2ea', '#c3cedb'];
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, ROW_H = 50;
  const topY = title ? 54 : 24;
  const W = spec.width || 600;
  const H = spec.height || topY + n * ROW_H + 8;
  const trackW = W - PAD * 2;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${tickCol}">${esc(title)}</text>`);

  bars.forEach((b, i) => {
    const ry = topY + i * ROW_H;
    const val = Number(b.value) || 0, target = b.target != null ? Number(b.target) : null;
    const bands = Array.isArray(b.bands) ? b.bands.map(Number) : [];
    const max = b.max != null ? Number(b.max) : Math.max(val, target || 0, ...bands) * 1.1 || 1;
    const sx = (v) => PAD + Math.max(0, Math.min(1, v / max)) * trackW;
    const barY = ry + 22, barH = 16;
    p.push(`<text x="${PAD}" y="${r(ry + 13)}" font-size="${fs}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(b.label || '')}</text>`);
    p.push(`<text x="${W - PAD}" y="${r(ry + 13)}" text-anchor="end" font-size="${fs}"${wOpt(spec)} fill="${valCol}">${esc(fmt(val))}${target != null ? ' / ' + esc(fmt(target)) : ''}</text>`);
    // qualitative bands (light→dark)
    const edges = [0, ...bands, max];
    for (let k = 0; k < edges.length - 1; k++) {
      const x0 = sx(edges[k]), x1 = sx(edges[k + 1]);
      p.push(`<rect x="${r(x0)}" y="${r(barY)}" width="${r(Math.max(0, x1 - x0))}" height="${barH}" fill="${bandCols[Math.min(k, bandCols.length - 1)]}"/>`);
    }
    // measure bar (thin, centered)
    p.push(`<rect x="${PAD}" y="${r(barY + barH / 2 - 4)}" width="${r(sx(val) - PAD)}" height="8" rx="2" fill="${b.color || measureCol}"/>`);
    // target tick
    if (target != null) p.push(`<line x1="${r(sx(target))}" y1="${r(barY - 4)}" x2="${r(sx(target))}" y2="${r(barY + barH + 4)}" stroke="${tickCol}" stroke-width="2.5"/>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── calendar — year contribution grid (weeks × days) ──────────────────────────
// `year` + `days:{ "YYYY-MM-DD": n }`. Each day a cell colored light→dark by value
// on one palette hue. Weekday is pure arithmetic (Zeller) — NO Date/clock used.
export function renderCalendar(spec) {
  const days = (spec.days && typeof spec.days === 'object' && !Array.isArray(spec.days)) ? spec.days : {};
  const year = spec.year != null ? Number(spec.year) : 2025;
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#64748b');
  const empty = isDark ? '#1e293b' : '#ebedf0';
  const faint = isDark ? '#475569' : '#94a3b8';
  const baseHsl = hexToHsl(spec.color || resolveFlatPalette(spec.palette || 'Clean Corporate', 1)[0]);

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const mdays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const totalDays = isLeap ? 366 : 365;
  // Zeller's congruence → weekday of Jan 1 (0=Sun..6=Sat), no Date object.
  const Y = year - 1, K = Y % 100, J = Math.floor(Y / 100);
  const h = (1 + Math.floor(13 * 14 / 5) + K + Math.floor(K / 4) + Math.floor(J / 4) + 5 * J) % 7; // 0=Sat
  const startDow = (h + 6) % 7; // 0=Sun

  const doyOfMonth = (mo) => { let d = 0; for (let i = 0; i < mo; i++) d += mdays[i]; return d; }; // 0-based doy of month's day 1
  const valByDoy = {};
  let maxV = 0;
  for (const key in days) {
    const parts = String(key).split('-').map(Number);
    const mo = parts.length >= 3 ? parts[1] : parts[0];
    const da = parts.length >= 3 ? parts[2] : parts[1];
    if (!mo || !da) continue;
    const doy = doyOfMonth(mo - 1) + (da - 1);
    const v = Number(days[key]) || 0;
    valByDoy[doy] = v; if (v > maxV) maxV = v;
  }
  const cellColor = (v) => v <= 0 ? empty : hslToHex(baseHsl.h, Math.max(35, baseHsl.s), Math.max(0, Math.min(100, 86 - (maxV > 0 ? v / maxV : 0) * 50)));

  const PAD = 24, CELL = 11, GAP = 3, LEFTW = 30, TOPH = 18;
  const topY = title ? 50 : 20;
  const gridX = PAD + LEFTW, gridY = topY + TOPH;
  const weeks = Math.ceil((startDow + totalDays) / 7);
  const W = spec.width || gridX + weeks * (CELL + GAP) + PAD;
  const H = spec.height || gridY + 7 * (CELL + GAP) + 16;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${PAD}" y="33" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let mo = 0; mo < 12; mo++) {
    const col = Math.floor((startDow + doyOfMonth(mo)) / 7);
    p.push(`<text x="${r(gridX + col * (CELL + GAP))}" y="${r(topY + TOPH - 6)}" font-size="${fs - 3}" fill="${labelCol}">${MON[mo]}</text>`);
  }
  [['Mon', 1], ['Wed', 3], ['Fri', 5]].forEach(([lbl, row]) => p.push(`<text x="${r(PAD)}" y="${r(gridY + row * (CELL + GAP) + CELL)}" font-size="${fs - 3}" fill="${labelCol}">${lbl}</text>`));

  for (let doy = 0; doy < totalDays; doy++) {
    const idx = startDow + doy, col = Math.floor(idx / 7), row = idx % 7;
    const x = gridX + col * (CELL + GAP), y = gridY + row * (CELL + GAP);
    p.push(`<rect x="${r(x)}" y="${r(y)}" width="${CELL}" height="${CELL}" rx="2" fill="${cellColor(valByDoy[doy] || 0)}"/>`);
  }

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── leaderboard — ranked rows (rank + bar + value) ────────────────────────────
// `items:[{label,value}]`, auto-sorted descending and numbered. A ranked horizontal
// bar list. Rect/text only.
export function renderLeaderboard(spec) {
  const raw = Array.isArray(spec.items) ? spec.items : [];
  const items = raw.map((it) => ({ label: it.label || '', value: Number(it.value) || 0, color: it.color })).sort((a, b) => b.value - a.value);
  const n = Math.max(1, items.length);
  const title = spec.title || '';
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const rankCol = isDark ? '#64748b' : '#94a3b8';
  const track = isDark ? '#1e293b' : '#f1f5f9';
  const valCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const faint = isDark ? '#475569' : '#94a3b8';
  const u = spec.valueUnit ? ' ' + spec.valueUnit : '';

  const PAD = 24, ROW_H = 40, RANKW = 30, LABELW = 140, VALW = 70;
  const topY = title ? 54 : 24;
  const W = spec.width || 560;
  const H = spec.height || topY + n * ROW_H + 8;
  const barLeft = PAD + RANKW + LABELW, barRight = W - PAD - VALW;
  const maxV = Math.max(1, ...items.map((s) => s.value));

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  items.forEach((it, i) => {
    const cy = topY + i * ROW_H + ROW_H / 2;
    // A leaderboard ranks ONE metric — bars share a single accent (not the palette
    // cycle, which manufactured a semantic-looking red at rank 5). Per-item `color`
    // still overrides for themed decks.
    const fill = it.color || palette[0];
    const bw = (it.value / maxV) * (barRight - barLeft);
    p.push(`<text x="${PAD}" y="${r(cy + 5)}" font-size="${fs + 1}" ${wAttr(spec, 800)} fill="${rankCol}">${i + 1}</text>`);
    p.push(`<text x="${r(PAD + RANKW)}" y="${r(cy + 5)}" font-size="${fs}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(it.label)}</text>`);
    p.push(`<rect x="${r(barLeft)}" y="${r(cy - 8)}" width="${r(barRight - barLeft)}" height="16" rx="8" fill="${track}"/>`);
    if (bw > 0) p.push(`<rect x="${r(barLeft)}" y="${r(cy - 8)}" width="${r(Math.max(16, bw))}" height="16" rx="8" fill="${fill}"/>`);
    p.push(`<text x="${W - PAD}" y="${r(cy + 5)}" text-anchor="end" font-size="${fs}" ${wAttr(spec, 700)} fill="${valCol}">${esc(fmt(it.value) + u)}</text>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── callout — hero stat + caption + annotation ────────────────────────────────
export function renderCallout(spec) {
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const accent = contrastFloor(spec.color || resolveFlatPalette(spec.palette || 'Clean Corporate', 1)[0], bg, transparent);
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const capCol = txt(spec, isDark ? '#cbd5e1' : '#5b6270');
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 28, W = spec.width || 620, H = spec.height || 220;
  const topY = title ? 50 : 20;
  const valueStr = (spec.valuePrefix || '') + (spec.value != null ? fmt(spec.value) : '') + (spec.valueUnit || '');

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${PAD}" y="33" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  const by = topY + (H - topY) * 0.5;
  p.push(`<text x="${PAD}" y="${r(by)}" font-size="${r((H - topY) * 0.42)}" ${wAttr(spec, 800)} fill="${accent}">${esc(valueStr)}</text>`);
  if (spec.caption) p.push(`<text x="${PAD}" y="${r(by + (H - topY) * 0.22)}" font-size="${fs + 2}"${wOpt(spec)} fill="${capCol}">${esc(spec.caption)}</text>`);
  if (spec.note) {
    const nw = Math.round(String(spec.note).length * (fs * 0.62) + 22);
    const nx = W - PAD - nw, ny = topY + 12;
    p.push(`<line x1="${r(nx - 14)}" y1="${r(topY + 6)}" x2="${r(nx - 14)}" y2="${H - 20}" stroke="${faint}" stroke-opacity="0.5"/>`);
    p.push(`<rect x="${r(nx)}" y="${r(ny)}" width="${nw}" height="26" rx="8" fill="${accent}" fill-opacity="0.14"/>`);
    p.push(`<text x="${r(nx + nw / 2)}" y="${r(ny + 17)}" text-anchor="middle" font-size="${fs}" ${wAttr(spec, 600)} fill="${accent}">${esc(spec.note)}</text>`);
  }
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── ring — radial % toward a target ───────────────────────────────────────────
export function renderRing(spec) {
  const value = Number(spec.value) || 0;
  const target = spec.target != null ? Number(spec.target) : 100;
  const frac = Math.max(0, Math.min(1, target > 0 ? value / target : 0));
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const accent = contrastFloor(spec.color || resolveFlatPalette(spec.palette || 'Clean Corporate', 1)[0], bg, transparent);
  const track = isDark ? '#334155' : '#e2e8f0';
  const valueCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const faint = isDark ? '#475569' : '#94a3b8';

  const W = spec.width || 260, H = spec.height || 240;
  const topY = title ? 50 : 20;
  const cx = W / 2, cy = topY + (H - topY - 16) / 2;
  const R = Math.min(W - 40, H - topY - 40) / 2;
  const sw = Math.max(8, R * 0.26);
  const circ = 2 * Math.PI * R;
  const dash = frac * circ;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(cx)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${valueCol}">${esc(title)}</text>`);
  p.push(`<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(R)}" fill="none" stroke="${track}" stroke-width="${r(sw)}"/>`);
  if (dash > 0) p.push(`<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(R)}" fill="none" stroke="${accent}" stroke-width="${r(sw)}" stroke-linecap="round" stroke-dasharray="${r(dash)} ${r(circ - dash)}" transform="rotate(-90 ${r(cx)} ${r(cy)})"/>`);
  p.push(`<text x="${r(cx)}" y="${r(cy + R * 0.18)}" text-anchor="middle" font-size="${r(R * 0.5)}" ${wAttr(spec, 800)} fill="${valueCol}">${Math.round(frac * 100)}%</text>`);
  if (spec.label) p.push(`<text x="${r(cx)}" y="${r(cy + R + sw / 2 + 16)}" text-anchor="middle" font-size="${fs}"${wOpt(spec)} fill="${labelCol}">${esc(spec.label)}</text>`);
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── versus — two options mirrored side by side ────────────────────────────────
export function renderVersus(spec) {
  const sides = Array.isArray(spec.sides) ? spec.sides.slice(0, 2) : [];
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', 3);
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, GAP = 44, W = spec.width || 620, H = spec.height || 320;
  const topY = title ? 54 : 24;
  const colW = (W - PAD * 2 - GAP) / 2;
  const cols = [PAD, PAD + colW + GAP];

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  [0, 1].forEach((si) => {
    const side = sides[si] || {};
    const col = side.color || palette[si === 0 ? 0 : palette.length - 1];
    const x = cols[si];
    p.push(`<rect x="${r(x)}" y="${r(topY)}" width="${r(colW)}" height="${r(H - topY - 16)}" rx="12" fill="${col}" fill-opacity="0.10"/>`);
    p.push(`<text x="${r(x + colW / 2)}" y="${r(topY + 26)}" text-anchor="middle" font-size="${fs + 2}" ${wAttr(spec, 700)} fill="${col}">${esc(side.title || '')}</text>`);
    const items = Array.isArray(side.items) ? side.items : [];
    items.forEach((it, i) => {
      const iy = topY + 52 + i * 28;
      p.push(`<text x="${r(x + 16)}" y="${r(iy)}" font-size="${fs}"${wOpt(spec)} fill="${labelCol}">${esc(it.label || '')}</text>`);
      if (it.value != null) p.push(`<text x="${r(x + colW - 14)}" y="${r(iy)}" text-anchor="end" font-size="${fs}" ${wAttr(spec, 700)} fill="${col}">${esc(fmt(it.value))}</text>`);
    });
  });
  const mx = PAD + colW + GAP / 2, my = topY + (H - topY) / 2;
  p.push(`<circle cx="${r(mx)}" cy="${r(my)}" r="20" fill="${transparent ? '#ffffff' : bg}" stroke="${faint}" stroke-opacity="0.5"/>`);
  p.push(`<text x="${r(mx)}" y="${r(my + 5)}" text-anchor="middle" font-size="${fs}" ${wAttr(spec, 800)} fill="${faint}">VS</text>`);
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── gantt — tasks across a time row (own time layout, not the numeric axis) ────
export function renderGantt(spec) {
  const tasks = Array.isArray(spec.tasks) ? spec.tasks : [];
  const n = Math.max(1, tasks.length);
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const gridCol = isDark ? '#1e293b' : '#eceef3';
  const faint = isDark ? '#475569' : '#94a3b8';

  const starts = tasks.map((t) => Number(t.start) || 0);
  const ends = tasks.map((t) => Number(t.end) || 0);
  // Scale the axis to the actual span min(start)…max(end). (Was Math.min(0, …) — the
  // hard 0 floor crushed any non-zero-based timeline, e.g. years, against the right edge.)
  const lo = starts.length ? Math.min(...starts) : 0;
  const hi = ends.length ? Math.max(...ends) : 1;
  const PAD = 24, LABELW = spec.labelWidth ? Number(spec.labelWidth) : 110, HEAD = 18, ROWH = 32;
  const topY = title ? 54 : 22;
  const W = spec.width || 660, H = spec.height || topY + HEAD + n * ROWH + 16;
  const plotLeft = PAD + LABELW, plotW = W - PAD - plotLeft, gridTop = topY + HEAD;
  const xOf = (v) => plotLeft + ((v - lo) / ((hi - lo) || 1)) * plotW;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  for (let k = 0; k <= 4; k++) { const gx = plotLeft + (k / 4) * plotW; p.push(`<line x1="${r(gx)}" y1="${r(gridTop)}" x2="${r(gx)}" y2="${r(gridTop + n * ROWH)}" stroke="${gridCol}" stroke-width="1"/>`); }
  tasks.forEach((t, i) => {
    const y = gridTop + i * ROWH;
    const fill = t.color || palette[i % palette.length];
    p.push(`<text x="${PAD}" y="${r(y + ROWH / 2 + 4)}" font-size="${fs}"${wOpt(spec)} fill="${labelCol}">${esc(t.label || '')}</text>`);
    p.push(`<rect x="${r(xOf(Number(t.start) || 0))}" y="${r(y + 6)}" width="${r(Math.max(3, xOf(Number(t.end) || 0) - xOf(Number(t.start) || 0)))}" height="${ROWH - 12}" rx="5" fill="${fill}"/>`);
  });
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── waterfall — running total, step by step (own scale, not the shared axis) ───
export function renderWaterfall(spec) {
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const start = Number(spec.start) || 0;
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const catText = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const totalCol = isDark ? '#94a3b8' : '#1c2230';
  const faint = isDark ? '#475569' : '#94a3b8';
  const showValues = spec.showValues !== false;   // magnitudes ON by default — a waterfall is unreadable without them

  // running totals → floating segments, then a final Total bar from 0.
  let run = start;
  const segs = steps.map((s) => { const d = Number(s.value) || 0; const from = run; run += d; return { label: s.label || '', from, to: run, delta: d, color: s.color }; });
  segs.push({ label: spec.totalLabel || 'Total', from: 0, to: run, delta: run, isTotal: true });
  const N = Math.max(1, segs.length);
  const vals = segs.flatMap((s) => [s.from, s.to]).concat(0);
  const lo = Math.min(...vals), hi = Math.max(...vals, 1);

  const PAD = 24, GAP = 14, HEAD = title ? 54 : 24;
  const W = spec.width || 640, H = spec.height || 360;
  const plotW = W - PAD * 2, plotBottom = H - 44, plotTop = HEAD;
  const bandW = (plotW - GAP * (N - 1)) / N;
  const yOf = (v) => plotBottom - ((v - lo) / ((hi - lo) || 1)) * (plotBottom - plotTop);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  segs.forEach((s, i) => {
    const x = PAD + i * (bandW + GAP);
    const yTop = yOf(Math.max(s.from, s.to)), yBot = yOf(Math.min(s.from, s.to));
    const fill = s.isTotal ? totalCol : (s.color || (s.delta >= 0 ? '#059669' : '#dc2626'));
    p.push(`<rect x="${r(x)}" y="${r(yTop)}" width="${r(bandW)}" height="${r(Math.max(2, yBot - yTop))}" rx="3" fill="${fill}"/>`);
    if (i < segs.length - 1) { const yc = r(yOf(s.to)); p.push(`<line x1="${r(x + bandW)}" y1="${yc}" x2="${r(x + bandW + GAP)}" y2="${yc}" stroke="${faint}" stroke-dasharray="3 3"/>`); }
    if (showValues) {
      // Convention: label at the OUTER end of the float — increases (and the total)
      // above the bar, decreases below it.
      const vstr = s.isTotal ? fmt(s.to) : (s.delta >= 0 ? '+' : '') + fmt(s.delta);
      const vy = (s.isTotal || s.delta >= 0) ? yTop - 6 : yBot + 14;
      p.push(`<text x="${r(x + bandW / 2)}" y="${r(vy)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 700)} fill="${fill}">${esc(vstr)}</text>`);
    }
    p.push(`<text x="${r(x + bandW / 2)}" y="${H - 26}" text-anchor="middle" font-size="${fs - 2}"${wOpt(spec)} fill="${catText}">${esc(s.label)}</text>`);
  });
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── swimlane — lanes × phases grid of boxes ───────────────────────────────────
export function renderSwimlane(spec) {
  const lanes = Array.isArray(spec.lanes) ? spec.lanes : [];
  const phases = Array.isArray(spec.phases) ? spec.phases : [];
  const nl = Math.max(1, lanes.length), np = Math.max(1, phases.length);
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(nl, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const labelCol = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 24, LABELW = 100, HEAD = 22, LANEH = 50;
  const topY = title ? 54 : 22;
  const W = spec.width || 680, H = spec.height || topY + HEAD + nl * LANEH + 16;
  const plotLeft = PAD + LABELW, colW = (W - PAD - plotLeft) / np, gridTop = topY + HEAD;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  phases.forEach((ph, ci) => p.push(`<text x="${r(plotLeft + ci * colW + colW / 2)}" y="${r(topY + HEAD - 7)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(ph)}</text>`));
  lanes.forEach((lane, li) => {
    const y = gridTop + li * LANEH;
    const col = lane.color || palette[li % palette.length];
    p.push(`<rect x="${PAD}" y="${r(y + 4)}" width="${r(W - PAD * 2)}" height="${LANEH - 8}" rx="6" fill="${col}" fill-opacity="0.07"/>`);
    p.push(`<text x="${PAD + 8}" y="${r(y + LANEH / 2 + 4)}" font-size="${fs}" ${wAttr(spec, 600)} fill="${labelCol}">${esc(lane.label || '')}</text>`);
    (Array.isArray(lane.items) ? lane.items : []).forEach((it) => {
      const ci = Math.max(0, Math.min(np - 1, Number(it.phase) || 0));
      const bx = plotLeft + ci * colW;
      p.push(`<rect x="${r(bx + 6)}" y="${r(y + 12)}" width="${r(colW - 12)}" height="${LANEH - 24}" rx="5" fill="${it.color || col}"/>`);
      p.push(`<text x="${r(bx + colW / 2)}" y="${r(y + LANEH / 2 + 4)}" text-anchor="middle" font-size="${fs - 2}" fill="${contrastColor(it.color || col)}">${esc(it.label || '')}</text>`);
    });
  });
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── tierlist — ranked buckets (S/A/B…) holding chips ──────────────────────────
export function renderTierList(spec) {
  const tiers = Array.isArray(spec.tiers) ? spec.tiers : [];
  const n = Math.max(1, tiers.length);
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const palette = resolveFlatPalette(spec.palette || 'Clean Corporate', Math.max(n, 3));
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const chipBg = isDark ? '#334155' : '#e2e8f0';
  const chipTx = isDark ? '#e2e8f0' : '#334155';
  const faint = isDark ? '#475569' : '#94a3b8';

  const PAD = 16, LABELW = 56, ROWH = 48, GAP = 6;
  const topY = title ? 50 : 14;
  const W = spec.width || 560;

  // Chips WRAP to new lines inside their tier (never silently dropped — the old
  // behavior skipped any chip that didn't fit, leaving holes mid-ranking). A tier
  // with L lines is L*26 + (L-1)*6 + 22 tall — exactly ROWH (48) when L=1, so
  // single-line tier lists render byte-identically to the pre-wrap layout.
  const chipH = 26, chipGapX = 8, chipGapY = 6;
  const chipX0 = PAD + LABELW + 10, maxLineW = W - PAD - chipX0;
  const layout = tiers.map((t) => {
    const lines = [[]];
    (Array.isArray(t.items) ? t.items : []).forEach((it) => {
      let label = typeof it === 'string' ? it : (it && it.label) || '';
      let cw = Math.round(label.length * (fs * 0.6) + 18);
      if (cw > maxLineW) { // one chip wider than the whole row: shorten with an ellipsis, never drop
        const maxChars = Math.max(1, Math.floor((maxLineW - 18) / (fs * 0.6)) - 1);
        label = label.slice(0, maxChars) + '…';
        cw = Math.min(Math.round((maxChars + 1) * (fs * 0.6) + 18), maxLineW);
      }
      const cur = lines[lines.length - 1];
      const curW = cur.reduce((a, c) => a + c.cw + chipGapX, 0);
      if (cur.length && curW + cw > maxLineW) lines.push([]);
      lines[lines.length - 1].push({ label, cw });
    });
    return { lines, rowH: lines.length * chipH + (lines.length - 1) * chipGapY + 22 };
  });
  const H = spec.height || topY + Math.max(layout.reduce((a, l) => a + l.rowH + GAP, 0), ROWH + GAP) + 12;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${PAD}" y="31" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  let ty = topY;
  tiers.forEach((t, i) => {
    const y = ty;
    const { lines, rowH } = layout[i];
    const col = t.color || palette[i % palette.length];
    p.push(`<rect x="${PAD}" y="${r(y)}" width="${LABELW}" height="${rowH}" rx="6" fill="${col}"/>`);
    p.push(`<text x="${r(PAD + LABELW / 2)}" y="${r(y + rowH / 2 + 6)}" text-anchor="middle" font-size="${fs + 4}" ${wAttr(spec, 800)} fill="${contrastColor(col)}">${esc(t.label || '')}</text>`);
    lines.forEach((line, j) => {
      let cx = chipX0;
      const cy = y + 11 + j * (chipH + chipGapY);
      line.forEach(({ label, cw }) => {
        p.push(`<rect x="${r(cx)}" y="${r(cy)}" width="${cw}" height="26" rx="6" fill="${chipBg}"/>`);
        p.push(`<text x="${r(cx + cw / 2)}" y="${r(cy + 18)}" text-anchor="middle" font-size="${fs}"${wOpt(spec)} fill="${chipTx}">${esc(label)}</text>`);
        cx += cw + chipGapX;
      });
    });
    ty += rowH + GAP;
  });
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── swot — four labeled 2×2 cells, each a short bullet list ────────────────────
export function renderSwot(spec) {
  const cells = Array.isArray(spec.cells) ? spec.cells.slice(0, 4) : [];
  const bg = spec.background || '#ffffff';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const bodyCol = txt(spec, isDark ? '#cbd5e1' : '#5b6270');
  const faint = isDark ? '#475569' : '#94a3b8';
  const tints = ['#2e9e6b', '#d6543a', '#2563eb', '#C17817'];

  const PAD = 22, GAP = 14;
  const topY = title ? 52 : 20;
  const W = spec.width || 640, H = spec.height || 440;
  const cellW = (W - PAD * 2 - GAP) / 2, cellH = (H - topY - PAD - GAP) / 2;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  for (let i = 0; i < 4; i++) {
    const cell = cells[i] || {};
    const col = i % 2, row = Math.floor(i / 2);
    const x = PAD + col * (cellW + GAP), y = topY + row * (cellH + GAP);
    const tint = cell.color || tints[i];
    p.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(cellW)}" height="${r(cellH)}" rx="10" fill="${tint}" fill-opacity="0.12"/>`);
    p.push(`<text x="${r(x + 16)}" y="${r(y + 26)}" font-size="${fs + 1}" ${wAttr(spec, 700)} fill="${tint}">${esc(cell.title || '')}</text>`);
    (Array.isArray(cell.items) ? cell.items : []).forEach((it, k) => {
      const ly = y + 50 + k * 22;
      if (ly > y + cellH - 8) return;
      p.push(`<circle cx="${r(x + 20)}" cy="${r(ly - 4)}" r="2.5" fill="${tint}"/>`);
      p.push(`<text x="${r(x + 30)}" y="${r(ly)}" font-size="${fs}"${wOpt(spec)} fill="${bodyCol}">${esc(typeof it === 'string' ? it : (it && it.label) || '')}</text>`);
    });
  }
  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}

// ── dashboard (tiling / composition) ─────────────────────────────────────────
// The composition layer: arranges OTHER chart types into ONE image on a grid, so
// a whole dashboard rasterizes in a single pass (one nested SVG → one PNG). It is
// PURELY ADDITIVE — it never touches axis/scale code; it just calls renderSpec on
// each tile's chart and re-roots that self-contained <svg> into a positioned slot.
//   spec.tiles   — [{ chart:<any spec>, span?:[colspan,rowspan] }]  (colspan/rowspan default 1)
//   spec.layout  — { cols?, gap?, pad?, tileWidth?, tileHeight? }
// Each tile is a full spec an agent could already render on its own — zero new
// mental model. Board-level palette/font/background cascade to tiles that don't set
// their own; child watermarks are suppressed in favor of one board watermark.
// A greedy first-fit packer honors spans (a wide chart over 2 cols, a tall one over
// 2 rows). Robust by construction: an empty board draws a frame, a bad/nested-
// dashboard tile draws a muted error card instead of throwing the whole render.
export function renderDashboard(spec) {
  const tiles = (Array.isArray(spec.tiles) ? spec.tiles : []).filter((t) => t && t.chart);
  const n = tiles.length;
  const title = spec.title || '';
  const L = spec.layout || {};

  const cols = Math.max(1, Math.min(Number(L.cols) || Math.min(Math.max(n, 1), 3), 12));
  const gap = L.gap != null ? Number(L.gap) : 20;
  const PAD = L.pad != null ? Number(L.pad) : 24;
  const TILE_W = L.tileWidth != null ? Number(L.tileWidth) : 440;
  const TILE_H = L.tileHeight != null ? Number(L.tileHeight) : 300;

  // Greedy first-fit packer → placements {r,c,cs,rs}. Deterministic (data order).
  const occ = [];
  const taken = (rr, cc, cs, rs) => {
    for (let a = rr; a < rr + rs; a++) for (let b = cc; b < cc + cs; b++) if (occ[a] && occ[a][b]) return true;
    return false;
  };
  const mark = (rr, cc, cs, rs) => {
    for (let a = rr; a < rr + rs; a++) { occ[a] = occ[a] || []; for (let b = cc; b < cc + cs; b++) occ[a][b] = true; }
  };
  const placements = tiles.map((t) => {
    const sp = Array.isArray(t.span) ? t.span : [1, 1];
    const cs = Math.max(1, Math.min(Number(sp[0]) || 1, cols));
    const rs = Math.max(1, Math.min(Number(sp[1]) || 1, 8));
    for (let rr = 0; ; rr++) {
      for (let cc = 0; cc <= cols - cs; cc++) {
        if (!taken(rr, cc, cs, rs)) { mark(rr, cc, cs, rs); return { r: rr, c: cc, cs, rs }; }
      }
    }
  });
  const totalRows = Math.max(1, placements.reduce((m, p) => Math.max(m, p.r + p.rs), 0));

  const bg = spec.background || '#f1f5f9';
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : 13;
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const titleH = title ? 46 : 0;
  const surface = isDark ? '#1e293b' : '#ffffff';
  const border = isDark ? '#334155' : '#e2e8f0';
  const faint = isDark ? '#475569' : '#94a3b8';
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');

  const W = spec.width || PAD * 2 + cols * TILE_W + (cols - 1) * gap;
  const H = spec.height || PAD * 2 + titleH + totalRows * TILE_H + (totalRows - 1) * gap;
  const cellW = (W - PAD * 2 - gap * (cols - 1)) / cols;
  const cellH = (H - PAD * 2 - titleH - gap * (totalRows - 1)) / totalRows;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 7}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);

  if (!n) {
    p.push(`<text x="${r(W / 2)}" y="${r(H / 2)}" text-anchor="middle" font-size="${fs + 1}" fill="${faint}">Empty dashboard — add tiles</text>`);
  }

  tiles.forEach((t, i) => {
    const pl = placements[i];
    const x = PAD + pl.c * (cellW + gap);
    const y = PAD + titleH + pl.r * (cellH + gap);
    const w = pl.cs * cellW + (pl.cs - 1) * gap;
    const h = pl.rs * cellH + (pl.rs - 1) * gap;

    // card surface (rounded); the framed border is drawn AFTER the child so it
    // always reads, whatever the child paints.
    p.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="12" fill="${transparent ? 'none' : surface}"/>`);

    const chart = t.chart || {};
    if (chart.type === 'dashboard') {
      p.push(tileNote(x, y, w, h, faint, fs, 'Nested dashboards not supported'));
    } else {
      // Cascade board styling to tiles that don't set their own; one board watermark.
      const child = {
        ...chart,
        background: chart.background || surface,
        watermark: false,
        font: chart.font || spec.font,
        palette: chart.palette || spec.palette,
      };
      let svg;
      try { svg = renderSpec(child); } catch (e) {
        p.push(tileNote(x, y, w, h, faint, fs, 'Invalid tile: ' + e.message));
        p.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="12" fill="none" stroke="${border}" stroke-width="1"/>`);
        return;
      }
      const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const nw = vb ? +vb[1] : w, nh = vb ? +vb[2] : h;
      const inner = svg.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
      p.push(`<svg x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(nw)} ${r(nh)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`);
    }
    // framed border on top
    p.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="12" fill="none" stroke="${border}" stroke-width="1"/>`);
  });

  if (watermark) p.push(`<text x="${W - 10}" y="${H - 9}" text-anchor="end" font-size="9" fill="${faint}" opacity="0.6">slickfast.com</text>`);
  p.push(`</svg>`);
  return p.join('\n');
}
// A centered muted note filling a tile slot (empty / error / nested guard).
function tileNote(x, y, w, h, color, fs, msg) {
  return `<text x="${r(x + w / 2)}" y="${r(y + h / 2)}" text-anchor="middle" font-size="${fs}" fill="${color}">${esc(msg)}</text>`;
}

// ── the TYPE REGISTRY — the single source of truth for "what types exist" ──────
// GOLD-RULE: every agent-facing surface (MCP enum + tool description, openapi spec,
// SPEC.md) DERIVES the type list from here — none of them restate it. A new type is
// added in ONE place (a row here + its renderer + a `case` below); the surface
// drift-check (scripts/check-surfaces.mjs) fails if any surface falls out of sync.
//   needsData  — true: consumes data.labels + data.series. false: its own shape
//                (kpi = top-level fields, pieofpie = `pies`, cards = `cards`).
//   dataKey    — the alternate top-level input key for needsData:false types.
//   family     — the committed taxonomy slot (ENGINE-GUARDRAILS).
export const TYPES = [
  { type: 'bar',         family: 'comparison',   needsData: true,  summary: 'vertical bar chart' },
  { type: 'grouped',     family: 'comparison',   needsData: true,  summary: 'clustered bars (one per series per category)' },
  { type: 'stacked',     family: 'composition',  needsData: true,  summary: 'stacked bars (segments within each bar)' },
  { type: 'stacked100',  family: 'composition',  needsData: true,  summary: '100% stacked bars (each bar = 100%)' },
  { type: 'stackedh',    family: 'composition',  needsData: true,  summary: 'horizontal stacked bars' },
  { type: 'horizontal',  family: 'comparison',   needsData: true,  summary: 'horizontal bars (single series)' },
  { type: 'lollipop',    family: 'comparison',   needsData: true,  summary: 'lollipop chart' },
  { type: 'diverging',   family: 'deviation',    needsData: true,  summary: 'diverging bars around a zero line' },
  { type: 'line',        family: 'trend',        needsData: true,  summary: 'line chart' },
  { type: 'smooth',      family: 'trend',        needsData: true,  summary: 'smooth (curved) line' },
  { type: 'area',        family: 'trend',        needsData: true,  summary: 'area chart (filled line)' },
  { type: 'stepped',     family: 'trend',        needsData: true,  summary: 'stepped line' },
  { type: 'stackedArea', family: 'trend',        needsData: true,  summary: 'stacked area bands' },
  { type: 'difference',  family: 'deviation',    needsData: true,  summary: 'two lines with the gap shaded' },
  { type: 'slope',       family: 'change',       needsData: true,  summary: 'slopegraph (first vs last value)' },
  { type: 'pie',         family: 'composition',  needsData: true,  summary: 'pie chart' },
  { type: 'donut',       family: 'composition',  needsData: true,  summary: 'donut (pie with a center hole + total)' },
  { type: 'pieofpie',    family: 'composition',  needsData: false, dataKey: 'pies',  summary: 'nested drill-down pies (pie-of-pie)' },
  { type: 'kpi',         family: 'single-value', needsData: false, summary: 'single metric tile (label + value + delta)' },
  { type: 'cards',       family: 'layout',       needsData: false, dataKey: 'cards',  summary: 'a row/grid of stat cards (multi-KPI strip)' },
  { type: 'layers',      family: 'layout',       needsData: false, dataKey: 'layers', summary: 'labeled box-stack / layer diagram (e.g. a tech stack)' },
  { type: 'progress',    family: 'layout',       needsData: false, dataKey: 'bars',   summary: 'labeled progress / bullet bars toward a target' },
  { type: 'waffle',      family: 'layout',       needsData: false, dataKey: 'parts',  summary: 'waffle / dot grid (10×10, part-of-whole)' },
  { type: 'heatmap',     family: 'layout',       needsData: false, summary: 'heatmap grid (rows × columns, value → color)' },
  { type: 'funnel',      family: 'layout',       needsData: false, dataKey: 'stages', summary: 'funnel — stages narrowing top→bottom' },
  { type: 'pyramid',     family: 'layout',       needsData: false, dataKey: 'levels', summary: 'pyramid — hierarchy levels' },
  { type: 'quadrant',    family: 'layout',       needsData: false, dataKey: 'items',  summary: '2×2 matrix — items placed by two axes' },
  { type: 'timeline',    family: 'layout',       needsData: false, dataKey: 'events', summary: 'linear timeline — events along one line' },
  { type: 'venn',        family: 'layout',       needsData: false, dataKey: 'sets',   summary: 'venn — 2–3 overlapping sets with counts' },
  { type: 'matrix',      family: 'layout',       needsData: false, dataKey: 'rows',   summary: 'comparison / feature matrix (✓/✗/dot cells)' },
  { type: 'checklist',   family: 'layout',       needsData: false, dataKey: 'items',  summary: 'checklist / status list (done/pending/blocked)' },
  { type: 'iconarray',   family: 'layout',       needsData: false, summary: 'icon array / pictogram (N icons, M filled)' },
  { type: 'steps',       family: 'layout',       needsData: false, dataKey: 'steps',  summary: 'step / process row (numbered linear flow)' },
  { type: 'table',       family: 'layout',       needsData: false, dataKey: 'rows',   summary: 'data table (rows × columns of text / values)' },
  { type: 'gauge',       family: 'layout',       needsData: false, summary: 'radial gauge / dial (single value on a scale)' },
  { type: 'bullet',      family: 'layout',       needsData: false, dataKey: 'bars',   summary: 'bullet graph (measure vs target on banded scale)' },
  { type: 'calendar',    family: 'layout',       needsData: false, dataKey: 'days',   summary: 'calendar heatmap (year contribution grid)' },
  { type: 'leaderboard', family: 'layout',       needsData: false, dataKey: 'items',  summary: 'leaderboard (ranked rows: rank + bar + value)' },
  { type: 'callout',     family: 'layout',       needsData: false, summary: 'stat callout — hero number + caption + annotation' },
  { type: 'ring',        family: 'layout',       needsData: false, summary: 'progress ring — radial % toward a target' },
  { type: 'versus',      family: 'layout',       needsData: false, dataKey: 'sides', summary: 'versus — two options compared side by side' },
  { type: 'gantt',       family: 'layout',       needsData: false, dataKey: 'tasks', summary: 'gantt — tasks across a time row' },
  { type: 'waterfall',   family: 'layout',       needsData: false, dataKey: 'steps', summary: 'waterfall — running total, step by step' },
  { type: 'swimlane',    family: 'layout',       needsData: false, dataKey: 'lanes', summary: 'swimlane roadmap — lanes × phases grid' },
  { type: 'tierlist',    family: 'layout',       needsData: false, dataKey: 'tiers', summary: 'tier list — ranked buckets (S/A/B) of chips' },
  { type: 'swot',        family: 'layout',       needsData: false, dataKey: 'cells', summary: 'swot — four labeled 2×2 cells with bullet lists' },
  { type: 'dashboard',   family: 'layout',       needsData: false, dataKey: 'tiles', summary: 'dashboard — tile multiple charts into one image (grid + colspan/rowspan)' },
];
export const TYPE_NAMES = TYPES.map((t) => t.type);

// Which CONDITIONAL universal toggles each type actually honors. The universal panel
// (title/palette/background/font/size/textColor/valueUnit/watermark) applies to ALL
// types; these three are the ones that vary, so a type NOT listed here silently
// ignores them. Surfaced by describe_type and used by the MCP to WARN when a caller
// passes a toggle the type doesn't use (so a no-op flag is never silent). Audited
// against the renderers; keep in sync when a type starts/stops reading a toggle.
const _SV = ['showValues'], _SVT = ['showValues', 'showTotal'], _SVP = ['showValues', 'showPoints'];
export const TYPE_TOGGLES = {
  bar: _SVT, horizontal: _SVT, lollipop: _SVT,
  grouped: _SV, stacked: _SV, stacked100: _SV, stackedh: _SV, diverging: _SV, pie: _SV, donut: _SV, heatmap: _SV,
  line: _SVP, smooth: _SVP, area: _SVP, stepped: _SVP, stackedArea: _SVP, difference: _SVP,
  waterfall: _SV,
};
export const CONDITIONAL_TOGGLES = ['showValues', 'showTotal', 'showPoints'];

// Dispatch by chart type. Every `case` here must have a TYPES row (checked by
// scripts/check-surfaces.mjs). New types register in TYPES above, then here.
export function renderSpec(spec) {
  spec = applyPreset(spec);
  switch (spec.type) {
    case 'bar': return renderBar(spec);
    case 'grouped': return renderBarGrouped(spec);
    case 'stacked': case 'stacked100': return renderBarStacked(spec);
    case 'stackedh': return renderBarStackedH(spec);
    case 'horizontal': return renderBarH(spec);
    case 'diverging': return renderDiverging(spec);
    case 'lollipop': return renderLollipop(spec);
    case 'line': case 'smooth': case 'area': case 'stepped':
    case 'stackedArea': case 'stacked-area': case 'difference':
      return renderLine(spec);
    case 'slope': return renderSlope(spec);
    case 'pie': case 'donut': return renderPie(spec);
    case 'pieofpie': case 'piepie': return renderPieOfPie(spec);
    case 'kpi': return renderKpi(spec);
    case 'cards': return renderCards(spec);
    case 'layers': return renderLayers(spec);
    case 'progress': return renderProgress(spec);
    case 'waffle': return renderWaffle(spec);
    case 'heatmap': return renderHeatmap(spec);
    case 'funnel': return renderFunnel(spec);
    case 'pyramid': return renderPyramid(spec);
    case 'quadrant': return renderQuadrant(spec);
    case 'timeline': return renderTimeline(spec);
    case 'venn': return renderVenn(spec);
    case 'matrix': return renderMatrix(spec);
    case 'checklist': return renderChecklist(spec);
    case 'iconarray': return renderIconArray(spec);
    case 'steps': return renderSteps(spec);
    case 'table': return renderTable(spec);
    case 'gauge': return renderGauge(spec);
    case 'bullet': return renderBullet(spec);
    case 'calendar': return renderCalendar(spec);
    case 'leaderboard': return renderLeaderboard(spec);
    case 'callout': return renderCallout(spec);
    case 'ring': return renderRing(spec);
    case 'versus': return renderVersus(spec);
    case 'gantt': return renderGantt(spec);
    case 'waterfall': return renderWaterfall(spec);
    case 'swimlane': return renderSwimlane(spec);
    case 'tierlist': return renderTierList(spec);
    case 'swot': return renderSwot(spec);
    case 'dashboard': return renderDashboard(spec);
    default: throw new Error('render-core: unknown chart type "' + spec.type + '"');
  }
}
