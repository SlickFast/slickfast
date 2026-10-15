// sci-goldens — the sci-core regression net, same habit as everything else:
//   node packages/sci-core/golden/generate.mjs --check   before AND after a change
//   node packages/sci-core/golden/generate.mjs           regenerate (intended change)
// Baseline stores the FULL SVG per spec — the engine is deterministic, so any byte
// drift is a real change. Empty --check pass = nothing else broke.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderSciSpec } from '../sci-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'baseline.json');

// One fixed spec per behavior worth pinning. Add a row when a type/mode lands.
const SPECS = {
  'scatter-linear': { type: 'scatter', title: 'Linear', xLabel: 'x', yLabel: 'y',
    data: { series: [{ name: 'S', x: [1, 2, 3, 4, 5], y: [2, 3, 5, 8, 13] }] } },
  'scatter-semilog-y': { type: 'scatter', scale: 'semilog-y', title: 'Semilog',
    xLabel: 'Time (min)', yLabel: 'CFU/mL',
    data: { series: [{ name: 'Culture', x: [0, 30, 60, 90, 120], y: [100, 800, 6400, 51200, 409600] }] } },
  'scatter-loglog-multi': { type: 'scatter', scale: 'loglog', palette: 'Vibrant',
    data: { series: [
      { name: 'A', x: [0.1, 1, 10, 100], y: [1, 10, 100, 1000] },
      { name: 'B', x: [0.1, 1, 10, 100], y: [5, 25, 125, 625] } ] } },
  'scatter-semilog-x-logfit': { type: 'scatter', scale: 'semilog-x', fit: true,
    data: { series: [{ name: 'Dose', x: [0.1, 1, 10, 100, 1000], y: [5, 21, 38, 52, 68] }] } },
  'scatter-log-plain-ticks': { type: 'scatter', scale: 'log', tickFormat: 'plain',
    data: { series: [{ x: [1, 10, 100], y: [1, 10, 100] }] } },
  'scatter-signed-linear': { type: 'scatter', xLabel: 'ΔT (°C)',
    data: { series: [{ name: 'Sample', x: [-20, -10, 0, 10], y: [-5, 2, 8, 20] }] } },
  'errorbar-asymmetric': { type: 'errorbar', scale: 'semilog-y',
    data: { series: [{ name: 'Assay', x: [1, 2, 3], y: [10, 100, 1000],
      yerr: { plus: [5, 50, 500], minus: [2, 20, 200] } }] } },
  'errorbar-dark-bg': { type: 'errorbar', background: '#0f172a', title: 'Dark',
    data: { series: [{ x: [1, 2, 3], y: [4, 5, 6], yerr: 0.5 }] } },
  'lineplot-semilog': { type: 'lineplot', scale: 'semilog-y', title: 'Growth',
    data: { series: [{ name: 'Culture', x: [0, 30, 60, 90, 120], y: [100, 800, 6400, 51200, 409600] }] } },
  'lineplot-no-points': { type: 'lineplot', showPoints: false,
    data: { series: [{ x: [1, 2, 3, 4], y: [2, 5, 3, 8] }] } },
  'barplot-log-yerr': { type: 'barplot', scale: 'log', yLabel: 'Titer',
    data: { labels: ['WT', 'ΔrecA', 'ΔlexA'], series: [{ name: 'Assay', values: [50000, 320, 4100], yerr: [8000, 60, 900] }] } },
  'barplot-signed': { type: 'barplot', valueUnit: 'kJ/mol',
    data: { labels: ['R1', 'R2', 'R3'], series: [{ values: [-42, 18, -7], yerr: 3 }] } },
  'fit-exponential-doubling': { type: 'lineplot', scale: 'semilog-y', fit: true,
    data: { series: [{ name: 'C', x: [0, 20, 40, 60, 80, 100], y: [100, 200, 400, 800, 1600, 3200] }] } },
  'fit-power-loglog': { type: 'scatter', scale: 'loglog', fit: true, palette: 'Vibrant',
    data: { series: [{ x: [1, 10, 100, 1000], y: [3, 16.9, 94.9, 533.4] }] } },
  'fit-linear-noisy': { type: 'scatter', fit: 'linear',
    data: { series: [{ x: [1, 2, 3, 4, 5], y: [2.1, 3.9, 6.2, 7.8, 10.1] }] } },
  'band-semilog': { type: 'lineplot', scale: 'semilog-y', errorStyle: 'band',
    data: { series: [{ name: 'Mean ± SD', x: [0, 1, 2, 3], y: [10, 100, 1000, 10000],
      yerr: { plus: [5, 50, 500, 5000], minus: [3, 30, 300, 3000] } }] } },
  'residuals-exponential': { type: 'scatter', scale: 'semilog-y', fit: true, residuals: true,
    data: { series: [{ name: 'C', x: [0, 20, 40, 60, 80, 100], y: [100, 205, 395, 810, 1620, 3150] }] } },
  'reflines-lod': { type: 'lineplot', scale: 'semilog-y', refLines: [
      { value: 50, label: 'LOD' }, { value: 200, label: 'LOQ', color: '#d97706' }],
    data: { series: [{ name: 'Assay', x: [0, 30, 60, 90], y: [100, 800, 6400, 51200] }] } },
  'blandaltman-basic': { type: 'blandaltman', title: 'Agreement',
    data: { series: [
      { name: 'Lab', values: [11, 22, 33, 41, 55, 62, 74, 88] },
      { name: 'POC', values: [10, 20, 30, 44, 52, 66, 71, 90] } ] } },
  'qq-normal': { type: 'qq', title: 'Normality check',
    data: { series: [{ name: 'Assay', values: [4.9, 5.3, 5.1, 4.7, 5.0, 5.2, 4.8, 5.4, 5.0, 4.6, 5.1, 4.9] }] } },
  'peaks-auto': { type: 'lineplot', showPoints: false, peaks: true,
    data: { series: [{ name: 'Trace', x: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      y: [1, 2, 9, 2, 1, 3, 14, 3, 1] }] } },
  'volcano-basic': { type: 'volcano', fc: [-2.5, -1.2, -0.4, 0.1, 0.8, 1.4, 3.1],
    p: [0.001, 0.03, 0.4, 0.9, 0.06, 0.008, 1e-8] },
  'volcano-cyberpunk-glow': { type: 'volcano', palette: 'Cyberpunk Glow', title: 'Dark',
    fc: [-2.5, -1.2, -0.4, 0.1, 0.8, 1.4, 3.1], p: [0.001, 0.03, 0.4, 0.9, 0.06, 0.008, 1e-8] },
  'lineplot-cyberpunk-glow': { type: 'lineplot', scale: 'semilog-y', palette: 'Cyberpunk Glow',
    data: { series: [{ name: 'A', x: [0, 1, 2, 3], y: [10, 100, 1000, 10000] }] } },
  'logbase2-plain': { type: 'lineplot', scale: 'semilog-y', logBase: 2,
    data: { series: [{ name: 'C', x: [0, 1, 2, 3, 4, 5], y: [100, 200, 400, 800, 1600, 3200] }] } },
  'logbase2-power': { type: 'scatter', scale: 'loglog', logBase: 2, tickFormat: 'power',
    data: { series: [{ x: [1, 4, 16, 64], y: [2, 8, 32, 128] }] } },
  'survival-two-arm': { type: 'survival', title: 'KM', xLabel: 'Days',
    data: { series: [
      { name: 'Control', times: [3, 5, 7, 9, 11, 14, 15, 18, 21, 24], events: [1, 1, 1, 0, 1, 1, 1, 1, 0, 1] },
      { name: 'Treated', times: [6, 10, 14, 17, 20, 24, 24, 24, 24, 24], events: [1, 1, 0, 1, 1, 0, 0, 0, 0, 0] } ] } },
};

const render = () => Object.fromEntries(Object.entries(SPECS).map(([k, s]) => [k, renderSciSpec(s)]));

if (process.argv.includes('--check')) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const now = render();
  const drifted = Object.keys(SPECS).filter((k) => base[k] !== now[k]);
  const missing = Object.keys(SPECS).filter((k) => !(k in base));
  if (drifted.length || missing.length) {
    for (const k of drifted) console.error('DRIFT: ' + k);
    for (const k of missing) console.error('MISSING from baseline: ' + k);
    process.exit(1);
  }
  console.log('sci-goldens: all ' + Object.keys(SPECS).length + ' clean');
} else {
  writeFileSync(BASELINE, JSON.stringify(render(), null, 1));
  console.log('sci-goldens: baseline regenerated (' + Object.keys(SPECS).length + ' specs)');
}
