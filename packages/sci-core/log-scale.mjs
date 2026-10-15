// sci-core log scale — pure math, no drawing. The renderers turn pos() into pixels.
//
// The furniture scientists' eyes require lives in `majors` (10ⁿ decade edges) and
// `minors` (2–9× inside each decade, the lines that bunch toward the decade top).
// Same GOLD RULES as render-core: no IO, no Date, no random. Same input = same output.

// Unicode superscript exponent: 3 → "³", -2 → "⁻²" (for 10ⁿ tick labels).
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function superscript(n) {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}

// Power-notation tick label: n → "10³". n = 0 still reads "10⁰" — the uniform
// ladder IS the signal; mixing "1" into "10⁻¹ 1 10¹" breaks the eye's pattern.
export function powerLabel(n) { return '10' + superscript(n); }

export const MAX_DECADES = 12;   // base 10: > this is a unit bug (nm vs m), not data
export const MAX_DOUBLINGS = 24; // base 2: past ~16M× dynamic range, use base 10

// logScale(min, max, base) → domain snapped OUT to whole powers of the base +
// tick positions. base 10 (default): decade majors + the 2–9× minors. base 2:
// a major at EVERY DOUBLING — the ladder that makes ×2 data look as nonlinear
// as it is — and no minors (the rungs are dense enough on their own).
// min/max must be positive finite numbers (callers fail loud BEFORE calling
// this, with point-level context; this guard is the backstop).
export function logScale(min, max, base = 10) {
  if (base !== 10 && base !== 2) {
    throw new Error('sci-core: logBase must be 10 or 2, got ' + base);
  }
  if (!(min > 0) || !(max > 0) || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('sci-core: log scale needs positive finite bounds, got ' + min + '..' + max);
  }
  if (min > max) { const t = min; min = max; max = t; }
  const lg = base === 2 ? Math.log2 : Math.log10;
  let d0 = Math.floor(lg(min));
  let d1 = Math.ceil(lg(max));
  // d0 === d1 (single value sitting exactly on a power) must widen to a full
  // step so the axis has extent.
  if (d0 === d1) d1 = d0 + 1;
  const maxSpan = base === 2 ? MAX_DOUBLINGS : MAX_DECADES;
  if (d1 - d0 > maxSpan) {
    throw new Error(base === 2
      ? 'sci-core: data spans ' + (d1 - d0) + ' doublings (max ' + MAX_DOUBLINGS + ') — that dynamic range wants logBase 10.'
      : 'sci-core: data spans ' + (d1 - d0) + ' decades (max ' + MAX_DECADES + ') — check units; a meters-vs-nanometers mixup looks exactly like this.');
  }
  const span = d1 - d0;
  const pos = (v) => (lg(v) - d0) / span;
  const majors = [];
  for (let n = d0; n <= d1; n++) majors.push({ v: Math.pow(base, n), n });
  const minors = [];
  if (base === 10) {
    for (let n = d0; n < d1; n++) for (let m = 2; m <= 9; m++) minors.push({ v: m * Math.pow(10, n) });
  }
  return { d0, d1, pos, majors, minors };
}

// Fail-loud scan used by renderers before building a log axis: every value on a
// log axis must be > 0. Returns nothing; throws naming series/index/value with the fix.
export function assertLogSafe(axisName, seriesName, values) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!(v > 0) || !Number.isFinite(v)) {
      throw new Error('sci-core: ' + axisName + ' is log-scaled but series "' + seriesName +
        '" point ' + i + ' has ' + axisName + ' = ' + v +
        ' — log of zero/negative is undefined. Use a linear scale, or filter these points.');
    }
  }
}
