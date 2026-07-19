#!/usr/bin/env node
// SlickFast benchmark — prove the speed claims on YOUR machine.
//
//   node scripts/bench.mjs
//
// Renders every built-in chart type + full dashboards, times each, runs a
// 10,000-render throughput burst, and double-renders everything to verify
// byte-identical (deterministic) output. Zero dependencies for the SVG laps.
// The PNG lap needs the rasterizer: `cd packages/raster && npm install`
// (skipped gracefully if absent). Numbers vary by hardware — the point is
// that they're YOUR numbers, not our marketing.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { renderSpec } from '../packages/render-core/render-core.mjs';
import { EXAMPLES, GALLERY_BOARDS, boardSpec } from '../packages/render-core/examples.mjs';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const hash = (s) => createHash('sha256').update(s).digest('hex');
const ms = (x) => x >= 1 ? x.toFixed(2) + 'ms' : (x * 1000).toFixed(0) + 'µs';

console.log('SlickFast bench — spec in, SVG out, no browser.');
console.log(`machine: ${cpus()[0]?.model?.trim() || 'unknown'} · node ${process.version}\n`);

// ── warm-up (untimed): let the JIT settle so we measure the engine, not startup
for (const spec of Object.values(EXAMPLES)) renderSpec(spec);

// ── lap 1: every chart type, median of 5 timed renders each ──────────────────
console.log('── per-type render time (SVG, median of 5) ' + '─'.repeat(24));
const results = [];
for (const [type, spec] of Object.entries(EXAMPLES)) {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    renderSpec(spec);
    times.push(performance.now() - t0);
  }
  results.push([type, median(times)]);
}
for (let i = 0; i < results.length; i += 4) {
  console.log('  ' + results.slice(i, i + 4).map(([t, m]) => `${t} ${ms(m)}`.padEnd(22)).join(''));
}
const allMedian = median(results.map(([, m]) => m));
console.log(`\n  median across all ${results.length} types: ${ms(allMedian)} per chart\n`);

// ── lap 2: full dashboards (many charts tiled into ONE render) ───────────────
console.log('── dashboards (many charts → one image, one render) ' + '─'.repeat(15));
for (const b of GALLERY_BOARDS) {
  const spec = boardSpec(b);
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    renderSpec(spec);
    times.push(performance.now() - t0);
  }
  console.log(`  ${b.title.padEnd(20)} ${String(b.types.length).padStart(2)} charts tiled → ${ms(median(times))}`);
}

// ── lap 3: throughput burst — 10,000 charts, straight line ───────────────────
const BURST = 10_000;
const barSpec = EXAMPLES.bar;
const t0 = performance.now();
for (let i = 0; i < BURST; i++) renderSpec(barSpec);
const burstS = (performance.now() - t0) / 1000;
console.log(`\n── throughput ${'─'.repeat(53)}`);
console.log(`  ${BURST.toLocaleString()} bar charts in ${burstS.toFixed(2)}s → ~${Math.round(BURST / burstS).toLocaleString()} renders/sec on this machine\n`);

// ── lap 4: determinism — render everything twice, byte-compare ───────────────
let identical = 0, total = 0;
for (const spec of Object.values(EXAMPLES)) {
  total++;
  if (hash(renderSpec(spec)) === hash(renderSpec(spec))) identical++;
}
console.log(`── determinism ${'─'.repeat(52)}`);
console.log(`  ${identical}/${total} chart types byte-identical across repeat renders ${identical === total ? '✓' : '✗ DRIFT'}\n`);

// ── lap 5 (optional): PNG rasterization — the honest heavier step ────────────
try {
  const { svgToPng } = await import('../packages/raster/raster.mjs');
  const png = () => { const t = performance.now(); svgToPng(renderSpec(barSpec), { scale: 2 }); return performance.now() - t; };
  png(); // warm
  const times = [png(), png(), png()];
  console.log(`── PNG rasterization (the raster step is the heavy one) ${'─'.repeat(10)}`);
  console.log(`  retina PNG (scale 2): ${ms(median(times))} per chart — SVG is the ms-fast path; PNG is for when you need pixels\n`);
} catch {
  console.log('── PNG lap skipped (run `npm install` in packages/raster to include it)\n');
}

// ── finale: render THESE RESULTS as a SlickFast chart ────────────────────────
const top = [...results].sort((a, b) => b[1] - a[1]).slice(0, 10).reverse();
const finaleSpec = {
  type: 'horizontal', title: `SlickFast bench — 10 slowest types, µs per render (median across all: ${ms(allMedian)})`,
  background: '#0d1522', palette: 'Vibrant', showValues: true,
  data: { labels: top.map(([t]) => t), series: [{ values: top.map(([, m]) => Math.round(m * 1000)) }] },
};
const tF = performance.now();
const finaleSvg = renderSpec(finaleSpec);
const finaleMs = performance.now() - tF;
writeFileSync(new URL('../bench-results.svg', import.meta.url), finaleSvg);
console.log(`── finale ${'─'.repeat(57)}`);
console.log(`  this chart of the results was rendered by the engine in ${ms(finaleMs)} → bench-results.svg`);
