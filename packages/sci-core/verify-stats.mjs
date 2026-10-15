// verify-stats — CORRECTNESS harness for sci-core's in-engine statistics.
// The goldens prove determinism (same input → same bytes). THIS proves the numbers
// are RIGHT: hand-computed exact references + published constants, no dependencies.
// Run: node verify-stats.mjs   (exit 1 on any failure)
import { renderSciSpec } from './sci-core.mjs';
import { invNorm, sig } from './fit-stats.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const texts = (svg) => [...svg.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]);

// ── 1. Bland–Altman: bias, ±1.96·SD(n−1) — exact hand arithmetic ─────────────
// A=[10,12,14,16,18], B=[11,11,15,15,19] → diffs=[-1,1,-1,1,-1]
// bias = -1/5 = -0.2 ; SD = sqrt( (4·(±0.8,±1.2)²)/4 ) = sqrt(1.2)
console.log('Bland–Altman (exact reference)');
{
  const bias = -0.2, sd = Math.sqrt(1.2);
  const hi = bias + 1.96 * sd, lo = bias - 1.96 * sd;
  const svg = renderSciSpec({ type: 'blandaltman', data: { series: [{ name: 'A', values: [10, 12, 14, 16, 18] }, { name: 'B', values: [11, 11, 15, 15, 19] }] } });
  const t = texts(svg).join(' | ');
  ok('bias label = sig(-0.2)', t.includes('bias = ' + sig(bias)), `wanted "bias = ${sig(bias)}" in: ${t.slice(0, 200)}`);
  ok('+1.96 SD label exact', t.includes('+1.96 SD = ' + sig(hi)), `wanted "${sig(hi)}"`);
  ok('−1.96 SD label exact', t.includes('−1.96 SD = ' + sig(lo)), `wanted "${sig(lo)}"`);
}

// ── 2. Kaplan–Meier: hand-computed product-limit + median convention ─────────
// times=[6,7,10,15,19,25], events=[1,0,1,1,0,1]:
// S: 6→5/6=.8333 · 7 censored · 10→×3/4=.625 · 15→×2/3=.41667 · 25→0
// median = smallest t with S(t) ≤ 0.5  → 15
console.log('Kaplan–Meier (hand-computed steps)');
{
  const svg = renderSciSpec({ type: 'survival', data: { series: [{ name: 'g', times: [6, 7, 10, 15, 19, 25], events: [1, 0, 1, 1, 0, 1] }] } });
  const t = texts(svg).join(' | ');
  ok('median = 15', /median[^|]*15/i.test(t), `median text in: ${t.match(/[^|]*median[^|]*/i) || 'NO MEDIAN LABEL'}`);
}
// edge: S hits EXACTLY 0.5 — standard convention: median = smallest t with S ≤ 0.5
// times=[1,2,3,4] all events: S = .75, .50, .25, 0 → median = 2 (NOT 3)
{
  const svg = renderSciSpec({ type: 'survival', data: { series: [{ name: 'g', times: [1, 2, 3, 4] }] } });
  const t = texts(svg).join(' | ');
  ok('median at exact S=0.5 → 2 (≤ convention)', /median[^|]*\b2\b/i.test(t), `got: ${t.match(/[^|]*median[^|]*/i)}`);
}

// ── 3. invNorm (probit) vs published constants ────────────────────────────────
console.log('invNorm vs published constants (tol 2e-3)');
{
  const anchors = [[0.5, 0], [0.975, 1.959964], [0.025, -1.959964], [0.995, 2.575829], [0.9, 1.281552], [0.1, -1.281552], [0.75, 0.674490]];
  let maxErr = 0;
  for (const [p, z] of anchors) {
    const got = invNorm(p);
    maxErr = Math.max(maxErr, Math.abs(got - z));
    ok(`Φ⁻¹(${p}) ≈ ${z}`, near(got, z, 2e-3), `got ${got}`);
  }
  console.log(`  (max abs error across anchors: ${maxErr.toExponential(2)})`);
  ok('symmetry: Φ⁻¹(p) = −Φ⁻¹(1−p) to 1e-12', near(invNorm(0.31) + invNorm(0.69), 0, 1e-12), `sum=${invNorm(0.31) + invNorm(0.69)}`);
}

// ── 4. Q-Q Hazen positions — engine formula components, published z values ────
// n=4 → positions .125/.375/.625/.875 → z ≈ ∓1.150349, ∓0.318639 (symmetric)
console.log('Q-Q (Hazen (i−0.5)/n, documented convention)');
{
  const z = [0.125, 0.375, 0.625, 0.875].map(invNorm);
  ok('z(.125) ≈ −1.150349', near(z[0], -1.150349, 2e-3), `got ${z[0]}`);
  ok('z(.375) ≈ −0.318639', near(z[1], -0.318639, 2e-3), `got ${z[1]}`);
  ok('exact antisymmetry of positions', near(z[0] + z[3], 0, 1e-12) && near(z[1] + z[2], 0, 1e-12));
  const svg = renderSciSpec({ type: 'qq', data: { series: [{ name: 's', values: [3, 1, 4, 2] }] } });
  ok('qq renders on raw values', svg.includes('Theoretical quantiles'), 'missing axis label');
}

// ── 5. Volcano: −log10 arithmetic + threshold line ────────────────────────────
console.log('Volcano (−log10, thresholds)');
{
  ok('−log10(0.05) = 1.30103', near(-Math.log10(0.05), 1.30103, 1e-5));
  const svg = renderSciSpec({ type: 'volcano', fc: [2, -0.1, -3, 0.2], p: [0.001, 0.5, 0.0001, 0.04] });
  const t = texts(svg).join(' | ');
  ok('volcano renders with fixed axes', t.includes('fold change'), t.slice(0, 120));
}

// ── 6. Log axis ticks: exact decade set ───────────────────────────────────────
console.log('Log ticks (semilog-y, 1 → 1e6)');
{
  const svg = renderSciSpec({ type: 'scatter', scale: 'semilog-y', data: { series: [{ name: 's', x: [1, 2], y: [1, 1000000] }] } });
  const t = texts(svg);
  for (const tick of ['10⁰', '10¹', '10²', '10³', '10⁴', '10⁵', '10⁶']) {
    ok(`tick ${tick} present`, t.some((x) => x.trim() === tick));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
