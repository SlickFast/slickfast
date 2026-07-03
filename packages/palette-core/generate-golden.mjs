// Regenerates golden-vectors.json from the live engine.
// Run after any INTENTIONAL change to the math or tokens:  node generate-golden.mjs
// The committed golden-vectors.json is the contract every consumer (sites + API) must match.
import { writeFileSync } from 'node:fs';
import { buildVectors } from './_build-vectors.mjs';

const vectors = buildVectors();
writeFileSync(new URL('./golden-vectors.json', import.meta.url), JSON.stringify(vectors, null, 2) + '\n');
console.log('Wrote golden-vectors.json');
console.log('flat palettes:', Object.keys(vectors.flatPalettes).length, '| nested themes:', Object.keys(vectors.nestedThemes).length);
