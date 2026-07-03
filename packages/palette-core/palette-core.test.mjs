// Parity test: the engine must reproduce the committed golden-vectors.json exactly.
// Run:  node --test
//
// This is the anti-drift mechanism. The API repo (in any language) should port
// this same test: read golden-vectors.json, run its own implementation, assert
// equality. If every consumer passes, the design data can't silently diverge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVectors } from './_build-vectors.mjs';

const golden = JSON.parse(readFileSync(new URL('./golden-vectors.json', import.meta.url)));
const live = buildVectors();

test('engine output matches the committed golden vectors', () => {
  assert.deepEqual(live, golden);
});

test('all hex outputs are well-formed #rrggbb (guards the #e308-style bug)', () => {
  const hexes = [];
  const walk = v => {
    if (typeof v === 'string' && v.startsWith('#')) hexes.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(golden.flatPalettes);
  walk(golden.nestedThemes);
  walk(golden.conversions);
  for (const h of hexes) assert.match(h, /^#[0-9a-fA-F]{6}$/, `malformed hex: ${h}`);
  assert.ok(hexes.length > 100, 'expected many hex values under test');
});
