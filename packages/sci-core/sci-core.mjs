// sci-core — scientific chart module. Same GOLD RULES as render-core: pure
// (spec) => SVG, no IO, no Date/Math.random. Same spec = same bytes.
// Color: palette-core only (GOLD-RULE 6). Scatter/errorbar/lineplot/barplot/
// survival/blandaltman/qq/volcano. boxplot/histogram are BACKLOGGED — unbuilt.

import { resolveFlatPalette, FLAT_PALETTES, NESTED_THEMES, getLuminance } from '../palette-core/palette-core.mjs';
import { resolveFont } from '../fonts/fonts.mjs';
import { esc, svgOpen, r, fmt, txt, wAttr, wOpt, applyPreset, niceScale, topRoundedBar, bottomRoundedBar, gridTheme } from './shell.mjs';
import { watermarkEl, registerRenderers } from '../render-core/render-core.mjs';
import { logScale, powerLabel, superscript, assertLogSafe } from './log-scale.mjs';
import { fitSeries, autoFitKind, sig, invNorm } from './fit-stats.mjs';

// Same row shape as render-core's TYPES — the composition layer merges these.
export const SCI_TYPES = [
  { type: 'scatter',  family: 'scientific', needsData: true, summary: 'scatter plot — x/y points, linear or log axes (semilog / log-log)' },
  { type: 'errorbar', family: 'scientific', needsData: true, summary: 'scatter with y-error whiskers (symmetric or asymmetric)' },
  { type: 'lineplot', family: 'scientific', needsData: true, summary: 'line plot on continuous or log axes — connected x/y points (growth curves, spectra)' },
  { type: 'barplot',  family: 'scientific', needsData: true, summary: 'scientific bar chart — categories × values, optional y-error whiskers, linear or log y' },
  { type: 'survival', family: 'scientific', needsData: true, summary: 'Kaplan–Meier survival curve — raw event times + censoring in, engine-computed estimator, censor ticks, median survival' },
  { type: 'blandaltman', family: 'scientific', needsData: true, summary: 'Bland–Altman agreement plot — two paired measurement series in, engine-computed bias + 95% limits of agreement' },
  { type: 'qq', family: 'scientific', needsData: true, summary: 'normal Q-Q plot — raw values in, sample vs theoretical normal quantiles with a quartile reference line (normality check)' },
  { type: 'volcano', family: 'scientific', needsData: false, summary: 'volcano plot — log2 fold-changes + raw p-values in, engine computes −log10(p), classifies up/down/not-significant, draws threshold lines' },
];
export const SCI_TYPE_NAMES = SCI_TYPES.map((t) => t.type);

export const POINT_CAP = 5000; // scatter/errorbar hard cap — fail loud, never truncate

const PALETTE_NAMES = [...new Set([...FLAT_PALETTES.map((p) => p.name), ...NESTED_THEMES.map((t) => t.name)])];

function sciBackground(spec) {
  return spec.background == null || spec.background === '' ? '#ffffff' : spec.background;
}

function sciPalette(spec, count) {
  const name = spec.palette || 'Clean Corporate';
  if (!PALETTE_NAMES.includes(name)) {
    throw new Error('sci-core: unknown palette "' + name + '". Valid: ' + PALETTE_NAMES.join(', '));
  }
  return resolveFlatPalette(name, Math.max(count, 2));
}

const SCALES = ['linear', 'semilog-x', 'semilog-y', 'loglog', 'log'];

// scale field → which axes are log. 'log' = every continuous axis (scatter → loglog).
function logAxes(spec) {
  const s = spec.scale || 'linear';
  if (!SCALES.includes(s)) {
    throw new Error('sci-core: unknown scale "' + s + '". Valid: linear, semilog-x, semilog-y, loglog, log');
  }
  return { logX: s === 'semilog-x' || s === 'loglog' || s === 'log',
           logY: s === 'semilog-y' || s === 'loglog' || s === 'log' };
}

// logBase (the on/off switch for base-2 axes): omit or 10 → classic decades,
// 2 → a labeled major gridline at every doubling. Only meaningful with a log
// scale — setting it on a linear chart fails loud instead of silently no-oping.
function resolveLogBase(spec, anyLog) {
  if (spec.logBase == null) return 10;
  const b = Number(spec.logBase);
  if (b !== 2 && b !== 10) throw new Error('sci-core: logBase must be 2 or 10, got ' + JSON.stringify(spec.logBase));
  if (!anyLog) throw new Error('sci-core: logBase is set but no axis is log — add scale (e.g. "semilog-y") or remove logBase');
  return b;
}

// Strict numeric parse — scientific integrity means NO coercion fabricating data:
// null/undefined/'' would coerce to 0 (a fake point), NaN/Infinity would emit
// broken SVG coordinates. All fail loud naming the series and point.
function nums(arr, axisName, seriesName) {
  return arr.map((raw, i) => {
    if (raw == null || raw === '') {
      throw new Error('sci-core: series "' + seriesName + '" point ' + i + ' has ' + axisName + ' = ' + raw + ' — missing values must be filtered out, not rendered.');
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      throw new Error('sci-core: series "' + seriesName + '" point ' + i + ' has non-numeric ' + axisName + ' = ' + (typeof raw === 'string' ? JSON.stringify(raw) : String(raw)));
    }
    return v;
  });
}

// yerr → { plus[i], minus[i] } accessors. Accepts: number (same ± everywhere),
// array (per-point ±), { plus:[], minus:[] } (asymmetric).
function errAccess(yerr, n, seriesName) {
  if (yerr == null) return null;
  if (typeof yerr === 'number') return { plus: () => yerr, minus: () => yerr };
  if (Array.isArray(yerr)) {
    if (yerr.length !== n) throw new Error('sci-core: series "' + seriesName + '" yerr has ' + yerr.length + ' entries for ' + n + ' points');
    return { plus: (i) => Number(yerr[i]) || 0, minus: (i) => Number(yerr[i]) || 0 };
  }
  if (yerr.plus && yerr.minus) {
    if (yerr.plus.length !== n || yerr.minus.length !== n) throw new Error('sci-core: series "' + seriesName + '" yerr.plus/minus must each have ' + n + ' entries');
    return { plus: (i) => Number(yerr.plus[i]) || 0, minus: (i) => Number(yerr.minus[i]) || 0 };
  }
  throw new Error('sci-core: yerr must be a number, an array, or { plus: [], minus: [] }');
}

// Continuous-axis model, shared by every sci renderer. Log → decade-snapped
// logScale with 10ⁿ majors + 2–9× minors; linear → "nice" scale anchored on 0,
// extended to whole steps on whichever sides the data occupies (signed axes get
// zeroP for the emphasized zero line).
function buildAxis(isLog, lo, hi, tickFormat, base = 10) {
  if (isLog) {
    const ls = logScale(lo, hi, base);
    // base 10 defaults to 10ⁿ power notation; base 2 defaults to PLAIN numbers —
    // "200, 400, 800" is what makes a viewer feel the doubling. tickFormat
    // ('power' | 'plain') overrides either way.
    const tf = tickFormat || (base === 2 ? 'plain' : 'power');
    const label = (n) => tf === 'plain' ? fmt(Math.pow(base, n)) : (base === 2 ? '2' + superscript(n) : powerLabel(n));
    return { pos: ls.pos, majors: ls.majors.map((mj) => ({ p: ls.pos(mj.v), text: label(mj.n) })), minors: ls.minors.map((mn) => ls.pos(mn.v)), zeroP: null };
  }
  const { step } = niceScale(Math.max(hi, -lo));
  const axisLo = lo < 0 ? Math.floor(lo / step) * step : 0;
  let axisHi = hi > 0 ? Math.ceil(hi / step) * step : 0;
  if (axisHi === axisLo) axisHi = axisLo + step;
  const span = axisHi - axisLo;
  const majors = [];
  for (let v = axisLo; v <= axisHi + 1e-9; v += step) {
    const vv = Math.abs(v) < step / 1e6 ? 0 : v;   // float accumulation → "−0" tick
    majors.push({ p: (vv - axisLo) / span, text: fmt(vv) });
  }
  return { pos: (v) => (v - axisLo) / span, majors, minors: [], zeroP: axisLo < 0 ? (0 - axisLo) / span : null };
}

// Reference lines — thresholds, limits of detection, targets. Each entry:
// { axis: 'y'|'x' (default 'y'), value, label?, color? }. Dashed, drawn above
// the grid and beneath the data; label sits at the line's end. Values on a log
// axis must be > 0 (fail loud, house rule).
function drawRefLines(p, spec, ctx) {
  const lines = spec.refLines;
  if (lines == null) return;
  if (!Array.isArray(lines)) throw new Error('sci-core: refLines must be an array of { axis, value, label }');
  const { M, plotW, plotH, AX, AY, logX, logY, fs, defColor } = ctx;
  lines.forEach((ln, i) => {
    if (ln == null || typeof ln !== 'object') throw new Error('sci-core: refLines[' + i + '] must be an object { axis, value, label }');
    const axis = ln.axis || 'y';
    if (axis !== 'x' && axis !== 'y') throw new Error('sci-core: refLines[' + i + '].axis must be "x" or "y", got "' + axis + '"');
    if (axis === 'x' && !AX) throw new Error('sci-core: refLines[' + i + '] — this type has a categorical x-axis; only axis "y" reference lines apply');
    const v = Number(ln.value);
    if (ln.value == null || !Number.isFinite(v)) throw new Error('sci-core: refLines[' + i + '].value must be a finite number, got ' + JSON.stringify(ln.value));
    const isLog = axis === 'y' ? logY : logX;
    if (isLog && !(v > 0)) throw new Error('sci-core: refLines[' + i + '] sits on a log ' + axis + '-axis — value must be > 0, got ' + v);
    const pos = axis === 'y' ? AY.pos(v) : AX.pos(v);
    if (pos < 0 || pos > 1) return;   // off-scale line → nothing to draw (data defines the window)
    const col = ln.color || defColor;
    const dashAttr = ln.dash === false ? '' : ' stroke-dasharray="7 4"';
    if (axis === 'y') {
      const y = r(M.top + plotH - pos * plotH);
      p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${col}" stroke-width="1.5"${dashAttr}/>`);
      if (ln.label) p.push(`<text x="${r(M.left + plotW - 6)}" y="${r(y - 5)}" text-anchor="end" font-size="${fs - 3}" font-weight="600" fill="${col}">${esc(ln.label)}</text>`);
    } else {
      const x = r(M.left + pos * plotW);
      p.push(`<line x1="${x}" y1="${M.top}" x2="${x}" y2="${r(M.top + plotH)}" stroke="${col}" stroke-width="1.5"${dashAttr}/>`);
      if (ln.label) p.push(`<text transform="translate(${r(x - 5)},${r(M.top + 8)}) rotate(90)" font-size="${fs - 3}" font-weight="600" fill="${col}">${esc(ln.label)}</text>`);
    }
  });
}

// ── scatter / errorbar / lineplot ─────────────────────────────────────────────
export function renderScatter(spec) {
  spec = applyPreset(spec);
  const isErrorbar = spec.type === 'errorbar';
  const lineOn = spec.line === true || spec.type === 'lineplot';
  const showPoints = spec.showPoints !== false;
  const errorStyle = spec.errorStyle || 'bars';
  if (!['bars', 'band'].includes(errorStyle)) {
    throw new Error('sci-core: errorStyle must be "bars" or "band", got "' + errorStyle + '"');
  }
  const W = spec.width || 800, H = spec.height || 450;
  const bg = sciBackground(spec);
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const series = (spec.data && spec.data.series) || [];
  const u = spec.valueUnit ? ' ' + String(spec.valueUnit).trim() : '';
  const pointR = spec.pointSize ? Number(spec.pointSize) : 3.5;
  const tickFormat = spec.tickFormat;
  const { logX, logY } = logAxes(spec);
  const logBase = resolveLogBase(spec, logX || logY);

  // Validate series shape + cap BEFORE any drawing (fail loud, never truncate).
  let totalPts = 0;
  const S = series.map((s, si) => {
    const name = s.name || ('Series ' + (si + 1));
    if (!Array.isArray(s.x) || !Array.isArray(s.y)) throw new Error('sci-core: scatter series "' + name + '" needs parallel x[] and y[] arrays');
    const x = nums(s.x, 'x', name), y = nums(s.y, 'y', name);
    if (x.length !== y.length) throw new Error('sci-core: series "' + name + '" has ' + x.length + ' x values but ' + y.length + ' y values');
    totalPts += x.length;
    const err = errAccess(s.yerr, x.length, name);
    if (isErrorbar && !err) throw new Error('sci-core: errorbar series "' + name + '" needs yerr (number, array, or { plus, minus })');
    return { name, x, y, err, color: s.color, line: s.line, points: s.points };
  });
  if (!S.length || totalPts === 0) throw new Error('sci-core: scatter needs at least one series with points');
  if (totalPts > POINT_CAP) {
    throw new Error('sci-core: ' + fmt(totalPts) + ' points exceeds the ' + fmt(POINT_CAP) +
      '-point cap — bin with histogram, or downsample before rendering.');
  }
  // Log safety, point-level context (error bounds must stay positive too).
  for (const s of S) {
    if (logX) assertLogSafe('x', s.name, s.x);
    if (logY) {
      assertLogSafe('y', s.name, s.y);
      if (s.err) assertLogSafe('y (lower error bound)', s.name, s.y.map((v, i) => v - s.err.minus(i)));
    }
  }

  const pal = sciPalette(spec, S.length);
  const colorOf = (s, i) => s.color || pal[i % pal.length];

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const { grid: gridCol, minorOp } = gridTheme(bg, transparent, isDark);
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const multi = S.length > 1;
  const xLabel = spec.xLabel || '', yLabel = spec.yLabel || '';
  const M = {
    left: 56 + (yLabel ? 20 : 0),
    right: 24,
    top: title ? 54 : 28,
    bottom: 46 + (xLabel ? 20 : 0) + (multi ? 18 : 0),
  };
  const plotW = W - M.left - M.right;
  // Residual panel (residuals: true, requires fit) — the main plot gives up the
  // bottom ~24% to a shared-x panel showing observed − fitted. With residuals
  // off, plotH is the full band and every byte matches the old output.
  const resOn = spec.residuals === true;
  if (resOn && !spec.fit) {
    throw new Error('sci-core: residuals: true needs a fit — set fit: true (or a fit kind) so there is a model to take residuals against');
  }
  const gapR = 14;
  const fullH = H - M.top - M.bottom;
  const resH = resOn ? Math.round(fullH * 0.24) : 0;
  const plotH = fullH - (resOn ? resH + gapR : 0);
  const resTop = M.top + plotH + gapR;
  const xTickY = M.top + fullH + 18;

  // Reference-line values stretch the axis window — an LOD line below the data
  // must be VISIBLE, not silently clipped. (On a log axis only positive ref
  // values widen the window; a non-positive one fails loud in drawRefLines.)
  const refVals = (axis, isLog) => (Array.isArray(spec.refLines) ? spec.refLines : [])
    .filter((l) => l && typeof l === 'object' && (l.axis || 'y') === axis)
    .map((l) => Number(l.value)).filter((v) => Number.isFinite(v) && (!isLog || v > 0));
  const allX = S.flatMap((s) => s.x).concat(refVals('x', logX));
  const allY0 = S.flatMap((s) => s.y);
  const yLoData = S.some((s) => s.err) ? Math.min(...S.flatMap((s) => s.err ? s.y.map((v, i) => v - s.err.minus(i)) : s.y)) : Math.min(...allY0);
  const yHiData = S.some((s) => s.err) ? Math.max(...S.flatMap((s) => s.err ? s.y.map((v, i) => v + s.err.plus(i)) : s.y)) : Math.max(...allY0);
  const refY = refVals('y', logY);
  const yLo = Math.min(yLoData, ...refY), yHi = Math.max(yHiData, ...refY);
  const AX = buildAxis(logX, Math.min(...allX), Math.max(...allX), tickFormat, logBase);
  const AY = buildAxis(logY, logY ? Math.max(yLo, Number.MIN_VALUE) : yLo, yHi, tickFormat, logBase);
  const px = (v) => M.left + AX.pos(v) * plotW;
  const py = (v) => M.top + plotH - AY.pos(v) * plotH;

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // Gridlines: minors first (faint, unlabeled — the log-axis signature), then
  // majors. Every gridline also gets a SPINE TICK — a short mark on the axis
  // line itself (longer at majors, shorter at minors), the journal signature:
  // on a log axis the ticks bunch toward each decade top right where the eye
  // checks, and they survive any background the gridlines struggle on.
  const xSpine = M.top + fullH;   // bottom edge (below the residual panel when present)
  const tickY = (y, len) => `<line x1="${r(M.left - len)}" y1="${y}" x2="${M.left}" y2="${y}" stroke="${axisText}" stroke-width="1"/>`;
  const tickX = (x, len) => `<line x1="${x}" y1="${r(xSpine)}" x2="${x}" y2="${r(xSpine + len)}" stroke="${axisText}" stroke-width="1"/>`;
  for (const mp of AY.minors) {
    const y = r(M.top + plotH - mp * plotH);
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1" stroke-opacity="${minorOp}"/>`);
    p.push(tickY(y, 3));
  }
  for (const mp of AX.minors) {
    const x = r(M.left + mp * plotW);
    p.push(`<line x1="${x}" y1="${M.top}" x2="${x}" y2="${r(M.top + plotH)}" stroke="${gridCol}" stroke-width="1" stroke-opacity="${minorOp}"/>`);
    p.push(tickX(x, 3));
  }
  for (const mj of AY.majors) {
    const y = r(M.top + plotH - mj.p * plotH);
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(tickY(y, 5.5));
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${esc(mj.text)}</text>`);
  }
  for (const mj of AX.majors) {
    const x = r(M.left + mj.p * plotW);
    p.push(`<line x1="${x}" y1="${M.top}" x2="${x}" y2="${r(M.top + plotH)}" stroke="${gridCol}" stroke-width="1"/>`);
    if (resOn) p.push(`<line x1="${x}" y1="${resTop}" x2="${x}" y2="${r(resTop + resH)}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(tickX(x, 5.5));
    p.push(`<text x="${x}" y="${r(xTickY)}" text-anchor="middle" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${esc(mj.text)}</text>`);
  }

  // Signed linear axis → emphasize the zero line (house diverging convention).
  if (AY.zeroP != null) {
    const y = r(M.top + plotH - AY.zeroP * plotH);
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${faint}" stroke-width="1.5"/>`);
  }
  if (AX.zeroP != null) {
    const x = r(M.left + AX.zeroP * plotW);
    p.push(`<line x1="${x}" y1="${M.top}" x2="${x}" y2="${r(M.top + plotH)}" stroke="${faint}" stroke-width="1.5"/>`);
  }

  // Error whiskers under their points: vertical line + horizontal caps.
  const capW = Math.max(4, pointR + 2);
  if (errorStyle === 'bars') S.forEach((s, si) => {
    if (!s.err) return;
    const col = colorOf(s, si);
    s.x.forEach((xv, i) => {
      const x = r(px(xv));
      const yTop = r(py(s.y[i] + s.err.plus(i))), yBot = r(py(s.y[i] - s.err.minus(i)));
      p.push(`<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="${col}" stroke-width="1.5"/>`);
      p.push(`<line x1="${r(x - capW)}" y1="${yTop}" x2="${r(x + capW)}" y2="${yTop}" stroke="${col}" stroke-width="1.5"/>`);
      p.push(`<line x1="${r(x - capW)}" y1="${yBot}" x2="${r(x + capW)}" y2="${yBot}" stroke="${col}" stroke-width="1.5"/>`);
    });
  });

  drawRefLines(p, spec, { M, plotW, plotH, AX, AY, logX, logY, fs, defColor: faint });

  // Error BANDS (errorStyle: 'band') — the mean ± SD ribbon journals use for
  // dense series: a translucent polygon from the upper error bound forward and
  // the lower bound back, drawn beneath fits/lines/points. Same yerr data and
  // the same log-positivity validation as whiskers; only the drawing changes.
  if (errorStyle === 'band') S.forEach((s, si) => {
    if (!s.err || s.x.length < 2) return;
    const col = colorOf(s, si);
    const upper = s.x.map((xv, i) => r(px(xv)) + ',' + r(py(s.y[i] + s.err.plus(i))));
    const lower = s.x.map((xv, i) => r(px(xv)) + ',' + r(py(s.y[i] - s.err.minus(i)))).reverse();
    p.push(`<path d="M${upper.join(' L')} L${lower.join(' L')} Z" fill="${col}" fill-opacity="0.15" stroke="none"/>`);
  });

  // Trend fits (fit: true|'linear'|'exponential'|'power'|'logarithmic') — computed
  // in-engine, drawn dashed under the data, annotated with equation + R² (and the
  // doubling/halving time for exponential fits — what a growth curve is FOR).
  const fits = [];
  if (spec.fit) {
    const kind = spec.fit === true || spec.fit === 'auto' ? autoFitKind(logX, logY) : spec.fit;
    S.forEach((s, si) => {
      const f = fitSeries(kind, s.x, s.y, s.name);
      fits.push({ si, f });
      const col = colorOf(s, si);
      const lo = Math.min(...s.x), hi = Math.max(...s.x);
      const N = 60;
      const yTop = M.top, yBot = M.top + plotH;
      const pts = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const xv = logX ? Math.pow(10, Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo))) : lo + t * (hi - lo);
        const yv = f.predict(xv);
        if (logY && !(yv > 0)) continue;
        const cy = py(yv);
        if (cy < yTop || cy > yBot) continue;   // fit curve exits the plot band → gap, never clip-lie
        pts.push([r(px(xv)), r(cy)]);
      }
      if (pts.length > 1) {
        const d = pts.map((pt, i) => (i ? 'L' : 'M') + pt[0] + ',' + pt[1]).join(' ');
        p.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4" stroke-opacity="0.85"/>`);
      }
    });
  }

  // Connecting lines (lineplot / line:true) — points joined in GIVEN order, never
  // sorted (a scientist's sweep order is data; silently re-sorting would lie).
  S.forEach((s, si) => {
    // Per-series override (series.line) beats the chart-level lineOn — lets one
    // chart mix raw points with a drawn model/reference curve.
    if (!(s.line != null ? s.line === true : lineOn)) return;
    if (s.x.length < 2) return;
    const col = colorOf(s, si);
    const d = s.x.map((xv, i) => (i ? 'L' : 'M') + r(px(xv)) + ',' + r(py(s.y[i]))).join(' ');
    p.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  });

  // Points on top.
  S.forEach((s, si) => {
    const sLine = s.line != null ? s.line === true : lineOn;
    if (!(s.points != null ? s.points === true : (showPoints || !sLine))) return;
    const col = colorOf(s, si);
    s.x.forEach((xv, i) => {
      p.push(`<circle cx="${r(px(xv))}" cy="${r(py(s.y[i]))}" r="${pointR}" fill="${col}" stroke="${transparent ? col : bg}" stroke-width="1.5"/>`);
    });
  });

  // Peak annotation (peaks: true → engine DETECTS local maxima and labels them
  // with their x position; peaks: [{x, label}] → snap manual labels to the
  // nearest data point). Auto-detection: strict local maximum, prominence over
  // the higher flanking valley ≥ 5% of the y-range (peakProminence overrides,
  // as a 0–1 fraction). Top 12 by prominence keep their labels (maxPeaks).
  if (spec.peaks != null && spec.peaks !== false) {
    const drawPeak = (xv, yv, label, col) => {
      const x = r(px(xv)), yTop = r(py(yv) - pointR - 4);
      p.push(`<line x1="${x}" y1="${yTop}" x2="${x}" y2="${r(Number(yTop) - 8)}" stroke="${col}" stroke-width="1.5"/>`);
      p.push(`<text x="${x}" y="${r(Number(yTop) - 13)}" text-anchor="middle" font-size="${fs - 3}" ${wAttr(spec, 600)} fill="${col}">${esc(label)}</text>`);
    };
    if (spec.peaks === true) {
      const frac = spec.peakProminence != null ? Number(spec.peakProminence) : 0.05;
      if (!(frac > 0 && frac <= 1)) throw new Error('sci-core: peakProminence must be a fraction in (0, 1], got ' + spec.peakProminence);
      const maxPeaks = spec.maxPeaks != null ? Number(spec.maxPeaks) : 12;
      S.forEach((s, si) => {
        const col = colorOf(s, si);
        const yMin = Math.min(...s.y), yMax = Math.max(...s.y);
        const minProm = (yMax - yMin) * frac;
        const found = [];
        for (let i = 1; i < s.y.length - 1; i++) {
          if (!(s.y[i] > s.y[i - 1] && s.y[i] >= s.y[i + 1])) continue;
          let l = i; while (l > 0 && s.y[l - 1] <= s.y[l]) l--;        // walk down the left flank
          let rr2 = i; while (rr2 < s.y.length - 1 && s.y[rr2 + 1] <= s.y[rr2]) rr2++;   // and the right
          const prom = s.y[i] - Math.max(s.y[l], s.y[rr2]);
          if (prom >= minProm) found.push({ i, prom });
        }
        found.sort((a, b) => b.prom - a.prom).slice(0, maxPeaks)
          .sort((a, b) => a.i - b.i)
          .forEach(({ i }) => drawPeak(s.x[i], s.y[i], sig(s.x[i]), col));
      });
    } else if (Array.isArray(spec.peaks)) {
      spec.peaks.forEach((pk, k) => {
        if (pk == null || typeof pk !== 'object') throw new Error('sci-core: peaks[' + k + '] must be { x, label }');
        const xv = Number(pk.x);
        if (!Number.isFinite(xv)) throw new Error('sci-core: peaks[' + k + '].x must be a finite number, got ' + JSON.stringify(pk.x));
        // Snap to the nearest data point of the first series that has one.
        let best = null;
        S.forEach((s, si) => s.x.forEach((sx, i) => {
          const d = Math.abs(sx - xv);
          if (!best || d < best.d) best = { d, s, si, i };
        }));
        drawPeak(best.s.x[best.i], best.s.y[best.i], pk.label != null ? String(pk.label) : sig(best.s.x[best.i]), colorOf(best.s, best.si));
      });
    } else {
      throw new Error('sci-core: peaks must be true (auto-detect) or an array of { x, label }, got ' + JSON.stringify(spec.peaks));
    }
  }

  // Residual panel: observed − fitted per point, in the space the regression ran
  // in (raw units for linear/logarithmic fits, ln units for exponential/power —
  // raw residuals on exponential data span decades and read as garbage).
  if (resOn && fits.length) {
    const inLn = fits[0].f.kind === 'exponential' || fits[0].f.kind === 'power';
    const space = inLn ? Math.log : (v) => v;
    const rows = fits.map(({ si, f }) => ({
      si, rv: S[si].x.map((xv, i) => space(S[si].y[i]) - space(f.predict(xv))),
    }));
    const mAbs = Math.max(1e-12, ...rows.flatMap((row) => row.rv.map(Math.abs)));
    const ry = (v) => resTop + resH / 2 - (v / mAbs) * (resH / 2 - 6);
    const zeroY = r(resTop + resH / 2);
    p.push(`<line x1="${M.left}" y1="${r(resTop)}" x2="${r(M.left + plotW)}" y2="${r(resTop)}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<line x1="${M.left}" y1="${r(resTop + resH)}" x2="${r(M.left + plotW)}" y2="${r(resTop + resH)}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<line x1="${M.left}" y1="${zeroY}" x2="${r(M.left + plotW)}" y2="${zeroY}" stroke="${faint}" stroke-width="1.5"/>`);
    p.push(`<text x="${M.left - 8}" y="${r(resTop + 9)}" text-anchor="end" font-size="${fs - 3}"${wOpt(spec)} fill="${axisText}">+${esc(sig(mAbs))}</text>`);
    p.push(`<text x="${M.left - 8}" y="${r(Number(zeroY) + 4)}" text-anchor="end" font-size="${fs - 3}"${wOpt(spec)} fill="${axisText}">0</text>`);
    p.push(`<text x="${M.left - 8}" y="${r(resTop + resH)}" text-anchor="end" font-size="${fs - 3}"${wOpt(spec)} fill="${axisText}">−${esc(sig(mAbs))}</text>`);
    p.push(`<text x="${M.left + 8}" y="${r(resTop + 12)}" font-size="${fs - 3}"${wOpt(spec)} fill="${axisText}">Residuals${inLn ? ' (ln units)' : ''}</text>`);
    rows.forEach(({ si, rv }) => {
      const col = colorOf(S[si], si);
      S[si].x.forEach((xv, i) => {
        p.push(`<circle cx="${r(px(xv))}" cy="${r(ry(rv[i]))}" r="2.5" fill="${col}" stroke="${transparent ? col : bg}" stroke-width="1"/>`);
      });
    });
  }

  // Axis titles.
  if (xLabel) p.push(`<text x="${r(M.left + plotW / 2)}" y="${r(M.top + fullH + 40)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(xLabel)}</text>`);
  if (yLabel) p.push(`<text transform="translate(16,${r(M.top + plotH / 2)}) rotate(-90)" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(yLabel + u)}</text>`);

  // Multi-series legend (house line-chart pattern: centered dots + names).
  if (multi) {
    const items = S.map((s, i) => ({ name: s.name, col: colorOf(s, i), hide: series[i] && series[i].legend === false }))
      .filter((it) => !it.hide);
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

  // Fit annotations, top-left inside the plot: equation · R² · doubling/halving.
  fits.forEach(({ si, f }, row) => {
    const s = S[si], col = colorOf(s, si);
    const sgn = (v) => (v < 0 ? '− ' + sig(-v) : '+ ' + sig(v));
    let eq;
    if (f.kind === 'linear') eq = 'y = ' + sig(f.b) + 'x ' + sgn(f.a);
    else if (f.kind === 'logarithmic') eq = 'y = ' + sig(f.a) + ' ' + sgn(f.b) + '·ln x';
    else if (f.kind === 'exponential') eq = 'y = ' + sig(f.a) + '·e^(' + sig(f.b) + 'x)';
    else eq = 'y = ' + sig(f.a) + '·x^' + sig(f.b);
    let extra = '';
    if (f.kind === 'exponential' && f.b > 0) extra = '   ·   ×2 every ' + sig(Math.LN2 / f.b);
    if (f.kind === 'exponential' && f.b < 0) extra = '   ·   ½ every ' + sig(Math.LN2 / -f.b);
    const label = (multi ? s.name + ':  ' : '') + eq + '   ·   R² = ' + f.r2.toFixed(3) + extra;
    p.push(`<text x="${M.left + 10}" y="${r(M.top + 16 + row * (fs + 5))}" font-size="${fs - 2}" ${wAttr(spec, 600)} fill="${col}">${esc(label)}</text>`);
  });

  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(watermarkEl(W, H));
  p.push(`</svg>`);
  return p.join('\n');
}

// ── barplot — the biology workhorse (categories × values, error bars, log y) ──
// Log-y bars draw from the axis floor (the bottom decade edge) — the standard
// journal convention; bar LENGTH is not meaningful on a log axis, position is.
export function renderBarSci(spec) {
  spec = applyPreset(spec);
  const W = spec.width || 800, H = spec.height || 450;
  const bg = sciBackground(spec);
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const u = spec.valueUnit ? ' ' + String(spec.valueUnit).trim() : '';
  const showValues = spec.showValues !== false;
  const tickFormat = spec.tickFormat;
  const scaleName = spec.scale || 'linear';
  if (!['linear', 'log'].includes(scaleName)) {
    throw new Error('sci-core: barplot scale must be "linear" or "log", got "' + scaleName + '"');
  }
  const logY = scaleName === 'log';

  const labels = (spec.data && spec.data.labels) || [];
  const s0 = spec.data && spec.data.series && spec.data.series[0];
  if (!labels.length || !s0 || !Array.isArray(s0.values)) {
    throw new Error('sci-core: barplot needs data.labels and data.series[0].values');
  }
  if (s0.values.length !== labels.length) {
    throw new Error('sci-core: barplot has ' + labels.length + ' labels but ' + s0.values.length + ' values');
  }
  const name = s0.name || 'Series 1';
  const vals = nums(s0.values, 'value', name);
  const err = errAccess(s0.yerr, vals.length, name);
  if (logY) {
    assertLogSafe('y', name, vals);
    if (err) assertLogSafe('y (lower error bound)', name, vals.map((v, i) => v - err.minus(i)));
  }

  const pal = sciPalette(spec, labels.length);
  const colorOf = (i) => (s0.colors && s0.colors[i]) || pal[i % pal.length];

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const { grid: gridCol, minorOp } = gridTheme(bg, transparent, isDark);
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const valText  = txt(spec, isDark ? '#e2e8f0' : '#334155');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const xLabel = spec.xLabel || '', yLabel = spec.yLabel || '';
  const M = { left: 56 + (yLabel ? 20 : 0), right: 24, top: title ? 54 : 28, bottom: 46 + (xLabel ? 20 : 0) };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const refY = (Array.isArray(spec.refLines) ? spec.refLines : [])
    .filter((l) => l && typeof l === 'object' && (l.axis || 'y') === 'y')
    .map((l) => Number(l.value)).filter((v) => Number.isFinite(v) && (!logY || v > 0));
  const lo = Math.min(...(err ? vals.map((v, i) => v - err.minus(i)) : vals), ...refY);
  const hi = Math.max(...(err ? vals.map((v, i) => v + err.plus(i)) : vals), ...refY);
  const logBase = resolveLogBase(spec, logY);
  const AY = buildAxis(logY, logY ? Math.max(lo, Number.MIN_VALUE) : lo, hi, tickFormat, logBase);
  const py = (v) => M.top + plotH - AY.pos(v) * plotH;
  const n = labels.length;
  const band = plotW / n;
  const bw = Math.min(band * 0.6, 64);

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  // Spine ticks (majors long, minors short) — the log-axis tell lives on the
  // axis line itself; see the scatter renderer's note.
  const tickY = (y, len) => `<line x1="${r(M.left - len)}" y1="${y}" x2="${M.left}" y2="${y}" stroke="${axisText}" stroke-width="1"/>`;
  for (const mp of AY.minors) {
    const y = r(M.top + plotH - mp * plotH);
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1" stroke-opacity="${minorOp}"/>`);
    p.push(tickY(y, 3));
  }
  for (const mj of AY.majors) {
    const y = r(M.top + plotH - mj.p * plotH);
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(tickY(y, 5.5));
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${esc(mj.text)}</text>`);
  }

  drawRefLines(p, spec, { M, plotW, plotH, AX: null, AY, logX: false, logY, fs, defColor: faint });

  // Bars grow from the baseline: log → the axis floor; linear → the zero line
  // (negative values hang below it, bottom-rounded, diverging-style).
  const basePos = logY ? 0 : (AY.zeroP != null ? AY.zeroP : 0);
  const baseY = M.top + plotH - basePos * plotH;
  if (AY.zeroP != null) {
    p.push(`<line x1="${M.left}" y1="${r(baseY)}" x2="${r(M.left + plotW)}" y2="${r(baseY)}" stroke="${faint}" stroke-width="1.5"/>`);
  }
  const capW = 6;
  labels.forEach((lab, i) => {
    const cx = M.left + band * i + band / 2;
    const x0 = cx - bw / 2;
    const v = vals[i];
    const yV = py(v);
    const up = yV <= baseY;
    const barPath = up
      ? topRoundedBar(x0, yV, bw, baseY - yV, 6)
      : bottomRoundedBar(x0, baseY, bw, yV - baseY, 6);
    p.push(`<path d="${barPath}" fill="${colorOf(i)}"/>`);
    if (err) {
      const yT = r(py(v + err.plus(i))), yB = r(py(v - err.minus(i)));
      p.push(`<line x1="${r(cx)}" y1="${yT}" x2="${r(cx)}" y2="${yB}" stroke="${catText}" stroke-width="1.5"/>`);
      p.push(`<line x1="${r(cx - capW)}" y1="${yT}" x2="${r(cx + capW)}" y2="${yT}" stroke="${catText}" stroke-width="1.5"/>`);
      p.push(`<line x1="${r(cx - capW)}" y1="${yB}" x2="${r(cx + capW)}" y2="${yB}" stroke="${catText}" stroke-width="1.5"/>`);
    }
    if (showValues) {
      const topMost = err ? py(v + err.plus(i)) : yV;
      const yLab = up ? r(topMost - 8) : r((err ? py(v - err.minus(i)) : yV) + fs);
      p.push(`<text x="${r(cx)}" y="${yLab}" text-anchor="middle" font-size="${fs - 2}" ${wAttr(spec, 600)} fill="${valText}">${esc(fmt(v) + u)}</text>`);
    }
    p.push(`<text x="${r(cx)}" y="${r(M.top + plotH + 18)}" text-anchor="middle" font-size="${fs - 1}"${wOpt(spec)} fill="${catText}">${esc(lab)}</text>`);
  });

  if (xLabel) p.push(`<text x="${r(M.left + plotW / 2)}" y="${r(M.top + plotH + 40)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(xLabel)}</text>`);
  if (yLabel) p.push(`<text transform="translate(16,${r(M.top + plotH / 2)}) rotate(-90)" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(yLabel + u)}</text>`);
  if (title) p.push(`<text x="${r(W / 2)}" y="33" text-anchor="middle" font-size="${fs + 5}" ${wAttr(spec, 700)} fill="${titleCol}">${esc(title)}</text>`);
  if (watermark) p.push(watermarkEl(W, H));
  p.push(`</svg>`);
  return p.join('\n');
}

// ── survival — Kaplan–Meier, computed FROM RAW EVENT DATA by the engine ──────
// Input per series: times[] (time to event or censoring, per subject) + events[]
// (1 = event occurred, 0 = censored; omit for "no censoring"). The engine sorts
// by time (that IS the estimator's method), walks the risk set, and draws the
// step curve with censor ticks. Median survival = first time S(t) ≤ 50%.
export function renderSurvival(spec) {
  spec = applyPreset(spec);
  const W = spec.width || 800, H = spec.height || 450;
  const bg = sciBackground(spec);
  const transparent = bg === 'transparent' || bg === 'none';
  const isDark = !transparent && getLuminance(bg) < 0.35;
  const fs = spec.fontSize ? Number(spec.fontSize) : Math.max(13, Math.round(13 * Math.sqrt(W * H) / 600));
  const font = resolveFont(spec);
  const watermark = spec.watermark !== false;
  const title = spec.title || '';
  const series = (spec.data && spec.data.series) || [];

  const S = series.map((s, si) => {
    const name = s.name || ('Series ' + (si + 1));
    if (!Array.isArray(s.times) || !s.times.length) throw new Error('sci-core: survival series "' + name + '" needs a times[] array (one entry per subject)');
    const times = nums(s.times, 'time', name);
    times.forEach((t, i) => { if (t < 0) throw new Error('sci-core: survival series "' + name + '" subject ' + i + ' has negative time ' + t); });
    let events;
    if (s.events == null) events = times.map(() => 1);
    else {
      if (!Array.isArray(s.events) || s.events.length !== times.length) throw new Error('sci-core: survival series "' + name + '" events[] must match times[] (' + times.length + ' subjects)');
      events = s.events.map((e, i) => {
        if (e !== 0 && e !== 1) throw new Error('sci-core: survival series "' + name + '" events[' + i + '] must be 1 (event) or 0 (censored), got ' + JSON.stringify(e));
        return e;
      });
    }
    // The KM walk: sort subjects by time; at each distinct event time, S *= 1 − d/n.
    const subj = times.map((t, i) => [t, events[i]]).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let n = subj.length, s01 = 1;
    const steps = [];       // [time, S after events at that time]
    const censors = [];     // [time, S at that moment] — tick marks
    let k = 0;
    while (k < subj.length) {
      const t = subj[k][0];
      let d = 0, c = 0;
      while (k < subj.length && subj[k][0] === t) { subj[k][1] === 1 ? d++ : c++; k++; }
      if (d > 0) { s01 *= 1 - d / n; steps.push([t, s01]); }
      if (c > 0) censors.push([t, s01]);
      n -= d + c;
    }
    const maxT = subj[subj.length - 1][0];
    const median = steps.find(([, sv]) => sv <= 0.5);
    return { name, steps, censors, maxT, median: median ? median[0] : null, color: s.color };
  });
  if (!S.length) throw new Error('sci-core: survival needs at least one series');

  const pal = sciPalette(spec, S.length);
  const colorOf = (s, i) => s.color || pal[i % pal.length];

  const axisText = txt(spec, isDark ? '#94a3b8' : '#64748b');
  const { grid: gridCol, minorOp } = gridTheme(bg, transparent, isDark);
  const catText  = txt(spec, isDark ? '#cbd5e1' : '#475569');
  const titleCol = txt(spec, isDark ? '#f1f5f9' : '#0f172a');
  const faint    = isDark ? '#475569' : '#94a3b8';

  const multi = S.length > 1;
  const xLabel = spec.xLabel || '', yLabel = spec.yLabel || 'Survival';
  const M = { left: 56 + 20, right: 24, top: title ? 54 : 28, bottom: 46 + (xLabel ? 20 : 0) + (multi ? 18 : 0) };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const maxT = Math.max(...S.map((s) => s.maxT));
  const AX = buildAxis(false, 0, maxT, 'power');
  const px = (t) => M.left + AX.pos(t) * plotW;
  const py = (sv) => M.top + (1 - sv) * plotH;   // y fixed 0..100%

  const p = [];
  p.push(svgOpen(W, H, font));
  if (!transparent) p.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

  for (let pc = 0; pc <= 100; pc += 25) {
    const y = r(py(pc / 100));
    p.push(`<line x1="${M.left}" y1="${y}" x2="${r(M.left + plotW)}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<line x1="${r(M.left - 5.5)}" y1="${y}" x2="${M.left}" y2="${y}" stroke="${axisText}" stroke-width="1"/>`);
    p.push(`<text x="${M.left - 8}" y="${r(y + 4)}" text-anchor="end" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${pc}%</text>`);
  }
  for (const mj of AX.majors) {
    const x = r(M.left + mj.p * plotW);
    p.push(`<line x1="${x}" y1="${M.top}" x2="${x}" y2="${r(M.top + plotH)}" stroke="${gridCol}" stroke-width="1"/>`);
    p.push(`<line x1="${x}" y1="${r(M.top + plotH)}" x2="${x}" y2="${r(M.top + plotH + 5.5)}" stroke="${axisText}" stroke-width="1"/>`);
    p.push(`<text x="${x}" y="${r(M.top + plotH + 18)}" text-anchor="middle" font-size="${fs - 2}"${wOpt(spec)} fill="${axisText}">${esc(mj.text)}</text>`);
  }
  // The 50% reference line — what the median annotation points at.
  p.push(`<line x1="${M.left}" y1="${r(py(0.5))}" x2="${r(M.left + plotW)}" y2="${r(py(0.5))}" stroke="${faint}" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.6"/>`);

  S.forEach((s, si) => {
    const col = colorOf(s, si);
    let d = `M${r(px(0))},${r(py(1))}`;
    let cur = 1;
    for (const [t, sv] of s.steps) { d += ` L${r(px(t))},${r(py(cur))} L${r(px(t))},${r(py(sv))}`; cur = sv; }
    d += ` L${r(px(s.maxT))},${r(py(cur))}`;
    p.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>`);
    for (const [t, sv] of s.censors) {
      p.push(`<line x1="${r(px(t))}" y1="${r(py(sv) - 5)}" x2="${r(px(t))}" y2="${r(py(sv) + 5)}" stroke="${col}" stroke-width="2"/>`);
    }
  });

  // Median annotations, top-right inside the plot.
  S.forEach((s, si) => {
    const col = colorOf(s, si);
    const label = (multi ? s.name + ':  ' : '') + (s.median != null ? 'median = ' + sig(s.median) : 'median not reached');
    p.push(`<text x="${r(M.left + plotW - 10)}" y="${r(M.top + 16 + si * (fs + 5))}" text-anchor="end" font-size="${fs - 2}" ${wAttr(spec, 600)} fill="${col}">${esc(label)}</text>`);
  });

  if (xLabel) p.push(`<text x="${r(M.left + plotW / 2)}" y="${r(M.top + plotH + 40)}" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(xLabel)}</text>`);
  p.push(`<text transform="translate(16,${r(M.top + plotH / 2)}) rotate(-90)" text-anchor="middle" font-size="${fs - 1}" ${wAttr(spec, 600)} fill="${catText}">${esc(yLabel)}</text>`);

  if (multi) {
    const items = S.map((s, i) => ({ name: s.name, col: colorOf(s, i) }));
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
  if (watermark) p.push(watermarkEl(W, H));
  p.push(`</svg>`);
  return p.join('\n');
}

// ── blandaltman — method-agreement plot, computed FROM PAIRED RAW VALUES ─────
// Two series of paired measurements (same subjects, two instruments/methods).
// The engine computes per pair: mean = (a+b)/2 (x), difference = a−b (y), then
// bias = mean(diff) and the 95% limits of agreement = bias ± 1.96·SD (sample
// SD, n−1 — the Bland–Altman convention). Drawn as a scatter with a SOLID bias
// line and DASHED limit lines, all labeled with their values. `fit: 'linear'`
// composes for a proportional-bias check.
export function renderBlandAltman(spec) {
  if (spec.scale && spec.scale !== 'linear') {
    throw new Error('sci-core: blandaltman is linear-only (the difference axis is signed) — remove scale, got "' + spec.scale + '"');
  }
  const series = (spec.data && spec.data.series) || [];
  if (series.length !== 2) throw new Error('sci-core: blandaltman needs exactly 2 series (the two methods), got ' + series.length);
  const [sa, sb] = series;
  const nameA = sa.name || 'Method A', nameB = sb.name || 'Method B';
  if (!Array.isArray(sa.values) || !Array.isArray(sb.values)) throw new Error('sci-core: blandaltman series need values[] arrays (paired measurements)');
  if (sa.values.length !== sb.values.length) throw new Error('sci-core: blandaltman series must be PAIRED — "' + nameA + '" has ' + sa.values.length + ' values, "' + nameB + '" has ' + sb.values.length);
  const a = nums(sa.values, 'value', nameA), b = nums(sb.values, 'value', nameB);
  const n = a.length;
  if (n < 3) throw new Error('sci-core: blandaltman needs at least 3 pairs for meaningful limits of agreement, got ' + n);

  const bgBA = sciBackground(spec);
  const darkBA = !(bgBA === 'transparent' || bgBA === 'none') && getLuminance(bgBA) < 0.35;
  const biasCol = spec.textColor || (darkBA ? '#e2e8f0' : '#334155');
  const means = a.map((v, i) => (v + b[i]) / 2);
  const diffs = a.map((v, i) => v - b[i]);
  const bias = diffs.reduce((s, d) => s + d, 0) / n;
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - bias) * (d - bias), 0) / (n - 1));
  const loaHi = bias + 1.96 * sd, loaLo = bias - 1.96 * sd;

  const derived = {
    ...spec,
    type: 'scatter',
    scale: 'linear',
    xLabel: spec.xLabel || ('Mean of ' + nameA + ' and ' + nameB),
    yLabel: spec.yLabel || ('Difference (' + nameA + ' − ' + nameB + ')'),
    data: { series: [{ name: 'Pairs', x: means, y: diffs, color: sa.color }] },
    refLines: [
      { value: loaHi, label: '+1.96 SD = ' + sig(loaHi) },
      // Ink-dark bias line so it never reads as a second zero line.
      { value: bias, label: 'bias = ' + sig(bias), dash: false, color: biasCol },
      { value: loaLo, label: '−1.96 SD = ' + sig(loaLo) },
      ...(Array.isArray(spec.refLines) ? spec.refLines : []),
    ],
  };
  return renderScatter(derived);
}

// ── qq — normal Q-Q plot, quantiles computed FROM RAW VALUES ─────────────────
// Sorted sample values (y) against theoretical normal quantiles (x) at Hazen
// plotting positions p = (i − 0.5)/n, via the deterministic probit. On-the-line
// = normal; curved tails = skew. Reference line through the quartile points
// (the R qqline convention — robust to tail outliers, unlike an LSQ fit).
export function renderQQ(spec) {
  if (spec.scale && spec.scale !== 'linear') {
    throw new Error('sci-core: qq is linear-only (z-quantiles are signed) — remove scale, got "' + spec.scale + '"');
  }
  const series = (spec.data && spec.data.series) || [];
  if (!series.length) throw new Error('sci-core: qq needs at least one series with raw values[]');
  // Resolve pair colors HERE so each reference line matches its data series
  // (letting the derived scatter cycle the palette would split the pairs).
  const qqPal = sciPalette(spec, series.length);
  const derivedSeries = [];
  series.forEach((s, si) => {
    const name = s.name || ('Series ' + (si + 1));
    const pairCol = s.color || qqPal[si % qqPal.length];
    if (!Array.isArray(s.values)) throw new Error('sci-core: qq series "' + name + '" needs a raw values[] array');
    const vals = nums(s.values, 'value', name);
    const n = vals.length;
    if (n < 3) throw new Error('sci-core: qq series "' + name + '" needs at least 3 values, got ' + n);
    const sorted = vals.slice().sort((a, b) => a - b);   // sorting IS the quantile method
    const z = sorted.map((_, i) => invNorm((i + 0.5) / n));
    derivedSeries.push({ name, x: z, y: sorted, color: pairCol, line: false, points: true });
    // Quartile reference line, extended across the sample's z-range.
    const q = (arr, pq) => {   // R-7 linear interpolation, same convention as the boxplot spec
      const h = (arr.length - 1) * pq, lo = Math.floor(h);
      return arr[lo] + (h - lo) * ((arr[Math.min(lo + 1, arr.length - 1)] ?? arr[lo]) - arr[lo]);
    };
    const q1 = q(sorted, 0.25), q3 = q(sorted, 0.75);
    const z1 = invNorm(0.25), z3 = invNorm(0.75);
    if (q3 !== q1) {
      const slope = (q3 - q1) / (z3 - z1), icpt = q1 - slope * z1;
      const zLo = z[0], zHi = z[n - 1];
      derivedSeries.push({ name: name + ' — normal ref', x: [zLo, zHi], y: [icpt + slope * zLo, icpt + slope * zHi],
        color: pairCol, line: true, points: false, legend: false });
    }
  });
  return renderScatter({
    ...spec,
    type: 'scatter',
    scale: 'linear',
    xLabel: spec.xLabel || 'Theoretical quantiles (z)',
    yLabel: spec.yLabel || 'Sample quantiles',
    data: { series: derivedSeries },
  });
}

// ── volcano — differential-expression plot, computed FROM RAW STATISTICS ─────
// Input: parallel arrays `fc` (log2 fold changes, signed) and `p` (raw p-values
// in (0, 1]). The engine computes −log10(p) for the y-axis and classifies every
// point against BOTH thresholds: |fc| ≥ fcThreshold (default 1 = two-fold) AND
// p ≤ pThreshold (default 0.05) → up (warm) / down (cool); everything else
// muted. Dashed threshold lines mark the significance box; legend carries the
// class counts. The genomics workhorse — typically thousands of points, capped
// by the standard 5,000-point rule.
export function renderVolcano(spec) {
  if (spec.scale && spec.scale !== 'linear') {
    throw new Error('sci-core: volcano axes are fixed (signed log2 FC vs −log10 p) — remove scale, got "' + spec.scale + '"');
  }
  if (!Array.isArray(spec.fc) || !Array.isArray(spec.p)) throw new Error('sci-core: volcano needs parallel fc[] (log2 fold changes) and p[] (raw p-values) arrays');
  if (spec.fc.length !== spec.p.length) throw new Error('sci-core: volcano fc[] has ' + spec.fc.length + ' entries but p[] has ' + spec.p.length);
  const fc = nums(spec.fc, 'fc', 'volcano');
  const pv = spec.p.map((raw, i) => {
    if (raw == null || raw === '') throw new Error('sci-core: volcano p[' + i + '] is ' + raw + ' — missing p-values must be filtered out');
    const v = Number(raw);
    if (!Number.isFinite(v) || !(v > 0) || v > 1) {
      throw new Error('sci-core: volcano p[' + i + '] = ' + JSON.stringify(raw) + ' — p-values must be in (0, 1] (p = 0 is not a probability; clamp tiny values upstream, e.g. to 1e-300)');
    }
    return v;
  });
  const fcT = spec.fcThreshold != null ? Number(spec.fcThreshold) : 1;
  const pT = spec.pThreshold != null ? Number(spec.pThreshold) : 0.05;
  if (!(fcT > 0)) throw new Error('sci-core: fcThreshold must be > 0, got ' + spec.fcThreshold);
  if (!(pT > 0 && pT < 1)) throw new Error('sci-core: pThreshold must be in (0, 1), got ' + spec.pThreshold);

  const y = pv.map((v) => -Math.log10(v));
  const yT = -Math.log10(pT);
  const up = { x: [], y: [] }, down = { x: [], y: [] }, ns = { x: [], y: [] };
  fc.forEach((f, i) => {
    const sig2 = y[i] >= yT && Math.abs(f) >= fcT;
    const bucket = sig2 ? (f > 0 ? up : down) : ns;
    bucket.x.push(f); bucket.y.push(y[i]);
  });

  const bgV = sciBackground(spec);
  const darkV = !(bgV === 'transparent' || bgV === 'none') && getLuminance(bgV) < 0.35;
  const upCol = darkV ? '#fb7185' : '#dc2626';
  const downCol = darkV ? '#38bdf8' : '#2563eb';
  const nsCol = darkV ? '#334155' : '#cbd5e1';
  const lineCol = darkV ? '#64748b' : '#94a3b8';

  const series = [];
  if (ns.x.length) series.push({ name: 'Not significant (' + fmt(ns.x.length) + ')', x: ns.x, y: ns.y, color: nsCol });
  if (down.x.length) series.push({ name: 'Down (' + fmt(down.x.length) + ')', x: down.x, y: down.y, color: downCol });
  if (up.x.length) series.push({ name: 'Up (' + fmt(up.x.length) + ')', x: up.x, y: up.y, color: upCol });

  return renderScatter({
    ...spec,
    type: 'scatter',
    scale: 'linear',
    pointSize: spec.pointSize != null ? spec.pointSize : 2.8,
    xLabel: spec.xLabel || 'log₂ fold change',
    yLabel: spec.yLabel || '−log₁₀ p',
    data: { series },
    refLines: [
      { value: yT, label: 'p = ' + sig(pT), color: lineCol },
      { axis: 'x', value: fcT, color: lineCol },
      { axis: 'x', value: -fcT, color: lineCol },
      ...(Array.isArray(spec.refLines) ? spec.refLines : []),
    ],
  });
}

// Dispatch — mirror of render-core's renderSpec, for the sci types only.
export function renderSciSpec(spec) {
  switch (spec.type) {
    case 'scatter': case 'errorbar': case 'lineplot': return renderScatter(spec);
    case 'barplot': return renderBarSci(spec);
    case 'survival': return renderSurvival(spec);
    case 'blandaltman': return renderBlandAltman(spec);
    case 'qq': return renderQQ(spec);
    case 'volcano': return renderVolcano(spec);
    default:
      throw new Error('sci-core: unknown type "' + spec.type + '". Valid: ' + SCI_TYPE_NAMES.join(', '));
  }
}

// Plug into renderSpec (the socket). Dashboard tiles and Pages go through
// renderSpec — without this, type:"scatter" is "unknown chart type".
// Built-ins cannot be overridden. Types stay off the 47 / gallery / MCP enum.
registerRenderers(Object.fromEntries(SCI_TYPE_NAMES.map((t) => [t, renderSciSpec])));
