// Render every sample spec to an SVG, and act as the snapshot net for render-core.
//
//   node generate.mjs           # render each sample spec -> its .svg (golden + viewable)
//   node generate.mjs --check   # fail (exit 1) if any engine output drifted
//
// SVG is deterministic text, so a byte diff means the render changed. Check before
// & after every engine change — same discipline as the chart sites' golden net.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderSpec } from './render-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Each chart/KPI type gets a sample spec + a golden SVG. Add a line per new type.
const SAMPLES = [
  { spec: 'sample-spec.json',      out: 'sample-bar.svg' },
  { spec: 'sample-grouped-spec.json', out: 'sample-grouped.svg' },
  { spec: 'sample-stacked-spec.json', out: 'sample-stacked.svg' },
  { spec: 'sample-stacked100-spec.json', out: 'sample-stacked100.svg' },
  { spec: 'sample-stackedh-spec.json', out: 'sample-stackedh.svg' },
  { spec: 'sample-horizontal-spec.json', out: 'sample-horizontal.svg' },
  { spec: 'sample-diverging-spec.json', out: 'sample-diverging.svg' },
  { spec: 'sample-diverging-signed-spec.json', out: 'sample-diverging-signed.svg' },
  { spec: 'sample-lollipop-spec.json', out: 'sample-lollipop.svg' },
  { spec: 'sample-lollipop-mono-spec.json', out: 'sample-lollipop-mono.svg' },
  { spec: 'sample-line-spec.json', out: 'sample-line.svg' },
  { spec: 'sample-area-spec.json', out: 'sample-area.svg' },
  { spec: 'sample-smooth-spec.json', out: 'sample-smooth.svg' },
  { spec: 'sample-stackedarea-spec.json', out: 'sample-stackedarea.svg' },
  { spec: 'sample-difference-spec.json', out: 'sample-difference.svg' },
  { spec: 'sample-slope-spec.json', out: 'sample-slope.svg' },
  { spec: 'sample-pie-spec.json',  out: 'sample-pie.svg' },
  { spec: 'sample-donut-spec.json', out: 'sample-donut.svg' },
  { spec: 'sample-donut-portrait-spec.json', out: 'sample-donut-portrait.svg' },
  { spec: 'sample-pie-currency-spec.json', out: 'sample-pie-currency.svg' },
  { spec: 'sample-pieofpie-spec.json', out: 'sample-pieofpie.svg' },
  { spec: 'sample-pieofpieofpie-spec.json', out: 'sample-pieofpieofpie.svg' },
  { spec: 'sample-kpi-spec.json',  out: 'sample-kpi.svg' },
  { spec: 'sample-kpi-portrait-spec.json', out: 'sample-kpi-portrait.svg' },
  { spec: 'sample-kpi-down-spec.json', out: 'sample-kpi-down.svg' },
  { spec: 'sample-kpi-sparkline-spec.json', out: 'sample-kpi-sparkline.svg' },
  { spec: 'sample-cards-spec.json', out: 'sample-cards.svg' },
  { spec: 'sample-layers-spec.json', out: 'sample-layers.svg' },
  { spec: 'sample-progress-spec.json', out: 'sample-progress.svg' },
  { spec: 'sample-waffle-spec.json', out: 'sample-waffle.svg' },
  { spec: 'sample-heatmap-spec.json', out: 'sample-heatmap.svg' },
  { spec: 'sample-funnel-spec.json', out: 'sample-funnel.svg' },
  { spec: 'sample-pyramid-spec.json', out: 'sample-pyramid.svg' },
  { spec: 'sample-quadrant-spec.json', out: 'sample-quadrant.svg' },
  { spec: 'sample-timeline-spec.json', out: 'sample-timeline.svg' },
  { spec: 'sample-venn-spec.json', out: 'sample-venn.svg' },
  { spec: 'sample-matrix-spec.json', out: 'sample-matrix.svg' },
  { spec: 'sample-checklist-spec.json', out: 'sample-checklist.svg' },
  { spec: 'sample-iconarray-spec.json', out: 'sample-iconarray.svg' },
  { spec: 'sample-steps-spec.json', out: 'sample-steps.svg' },
  { spec: 'sample-table-spec.json', out: 'sample-table.svg' },
  { spec: 'sample-gauge-spec.json', out: 'sample-gauge.svg' },
  { spec: 'sample-bullet-spec.json', out: 'sample-bullet.svg' },
  { spec: 'sample-calendar-spec.json', out: 'sample-calendar.svg' },
  { spec: 'sample-leaderboard-spec.json', out: 'sample-leaderboard.svg' },
  { spec: 'sample-callout-spec.json', out: 'sample-callout.svg' },
  { spec: 'sample-ring-spec.json', out: 'sample-ring.svg' },
  { spec: 'sample-versus-spec.json', out: 'sample-versus.svg' },
  { spec: 'sample-gantt-spec.json', out: 'sample-gantt.svg' },
  { spec: 'sample-waterfall-spec.json', out: 'sample-waterfall.svg' },
  { spec: 'sample-swimlane-spec.json', out: 'sample-swimlane.svg' },
  { spec: 'sample-tierlist-spec.json', out: 'sample-tierlist.svg' },
  { spec: 'sample-swot-spec.json', out: 'sample-swot.svg' },
  { spec: 'sample-dashboard-spec.json', out: 'sample-dashboard.svg' },
  { spec: 'sample-textstyle-spec.json', out: 'sample-textstyle.svg' },
];

const check = process.argv.includes('--check');
let drift = false;

for (const s of SAMPLES) {
  const spec = JSON.parse(readFileSync(join(here, s.spec), 'utf8'));
  const svg = renderSpec(spec);
  const goldenPath = join(here, s.out);
  if (check) {
    let prev = null;
    try { prev = readFileSync(goldenPath, 'utf8'); } catch {}
    if (prev === null) { console.error(`✗ ${s.out}: no golden yet. Run without --check first.`); drift = true; continue; }
    if (prev.trim() !== svg.trim()) { console.error(`✗ ${s.out}: DRIFT — render output changed.`); drift = true; }
    else console.log(`✓ ${s.out}: matches golden.`);
  } else {
    writeFileSync(goldenPath, svg + '\n');
    console.log(`Wrote ${s.out} (${svg.length} bytes)`);
  }
}

if (check && drift) { console.error('Review the changed .svg; if intended, regenerate: node generate.mjs'); process.exit(1); }
if (check) console.log('✓ No drift — all samples match.');
