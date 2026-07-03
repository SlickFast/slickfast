// Torture-fixture net — the deferred ENGINE-GUARDRAILS Rule 4 item.
//
//   node scripts/torture.mjs
//
// Runs EVERY registered type (via its EXAMPLES minimal spec) through a set of
// universal stress mutations and checks structural invariants automatically:
//   • render doesn't throw,
//   • no NaN / Infinity / undefined leaks into the SVG (math bugs from empty/edge data),
//   • the SVG still rasterizes in resvg (catches malformed output).
// Clipping / contrast still need human eyes — this nails the structural class so we
// stop finding it one user complaint at a time. Exit 1 if any case fails.

import { TYPES, renderSpec } from '../packages/render-core/render-core.mjs';
import { EXAMPLES } from '../packages/render-core/examples.mjs';
import { svgToPng } from '../packages/raster/raster.mjs';

// Deep-clone + replace text strings with a long run, to stress overflow/clipping.
// Skips structural/enum/color values so the mutation tests text, not config.
const SKIP_KEYS = new Set(['type', 'palette', 'background', 'font', 'format', 'status', 'date', 'valuePrefix', 'valueUnit', 'deltaUnit', 'deltaGoodWhen', 'curve', 'preset', 'ratio']);
const LONG = 'Quarterly enterprise revenue attainment versus the regional target baseline (FY)';
function longText(v, key) {
  if (typeof v === 'string') return (SKIP_KEYS.has(key) || v[0] === '#') ? v : LONG;
  if (Array.isArray(v)) return v.map((x) => longText(x, key));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = longText(v[k], k); return o; }
  return v;
}

const clone = (s) => JSON.parse(JSON.stringify(s));
function emptyData(spec) {
  const meta = TYPES.find((t) => t.type === spec.type);
  const s = clone(spec);
  if (meta && meta.dataKey && meta.dataKey !== 'data') s[meta.dataKey] = [];
  else if (meta && meta.needsData) s.data = { labels: [], series: [] };
  else return null; // no array to empty (e.g. kpi/gauge) — mutation N/A
  return s;
}

const MUTATIONS = [
  { name: 'baseline', fn: (s) => clone(s) },
  { name: 'long-text', fn: (s) => longText(clone(s)) },
  { name: 'dark-bg', fn: (s) => ({ ...clone(s), background: '#0f172a' }) },
  { name: 'transparent', fn: (s) => ({ ...clone(s), background: 'transparent' }) },
  { name: 'tiny-canvas', fn: (s) => ({ ...clone(s), width: 160, height: 120 }) },
  { name: 'huge-canvas', fn: (s) => ({ ...clone(s), width: 1600, height: 1000 }) },
  { name: 'empty-data', fn: (s) => emptyData(s) },
];

const failures = [];
let cases = 0;
for (const { type } of TYPES) {
  const base = EXAMPLES[type];
  for (const m of MUTATIONS) {
    const spec = m.fn(base);
    if (spec === null) continue; // mutation not applicable to this type
    cases++;
    let svg;
    try { svg = renderSpec(spec); }
    catch (e) { failures.push(`${type} / ${m.name}: THREW — ${e.message}`); continue; }
    const bad = svg.match(/NaN|Infinity|undefined/);
    if (bad) failures.push(`${type} / ${m.name}: "${bad[0]}" in SVG output`);
    try { svgToPng(svg); }
    catch (e) { failures.push(`${type} / ${m.name}: RASTER FAIL — ${e.code || e.message}`); }
  }
}

console.log(`Ran ${cases} torture cases across ${TYPES.length} types × ${MUTATIONS.length} mutations.`);
if (failures.length) {
  console.error(`\n✗ ${failures.length} structural failures:`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('✓ No structural failures (no throws, no NaN/Infinity/undefined, all rasterize). Clipping/contrast still need a visual pass.');
