// Palette hex validator — every color in tokens.json must be a valid 6-digit hex.
//
//   node scripts/check-palettes.mjs
//
// The palette guide warns that a stray `#e308` once shipped a broken color. This nails
// that class of bug: it fails (exit 1) if any flat-palette color or nested-theme tier/
// pie1 color isn't exactly `#rrggbb`. Cheap insurance for a hand-edited JSON of colors.

import { FLAT_PALETTES, NESTED_THEMES } from '../packages/palette-core/palette-core.mjs';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const errors = [];
let checked = 0;

const check = (color, where) => {
  checked++;
  if (typeof color !== 'string' || !HEX6.test(color)) errors.push(`${where}: "${color}" is not a 6-digit hex (#rrggbb).`);
};

for (const p of FLAT_PALETTES) {
  if (!Array.isArray(p.colors) || !p.colors.length) errors.push(`flat "${p.name}" has no colors array.`);
  (p.colors || []).forEach((c, i) => check(c, `flat "${p.name}"[${i}]`));
}
for (const t of NESTED_THEMES) {
  if (t.tiers) t.tiers.forEach((tier, ti) => (tier || []).forEach((c, ci) => check(c, `nested "${t.name}" tier ${ti}[${ci}]`)));
  else if (t.pie1) t.pie1.forEach((c, i) => check(c, `nested "${t.name}" pie1[${i}]`));
  else errors.push(`nested "${t.name}" has neither tiers nor pie1.`);
}

if (errors.length) {
  console.error(`✗ palette hex check (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ palettes valid — all ${checked} colors across ${FLAT_PALETTES.length} flat + ${NESTED_THEMES.length} nested are 6-digit hex.`);
