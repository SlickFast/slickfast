// Bundle the MCP into one self-contained file. The engine (render-core, palette-core,
// fonts, raster) is inlined; only npm deps (resvg, MCP SDK, zod) stay external.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Inline the chart-spec doc into the bundle so the `chart-spec` MCP resource works with no
// SPEC.md on disk — esbuild substitutes the `SPEC_MD_INLINE` identifier in server.mjs.
const specMd = readFileSync(join(here, '../../packages/render-core/SPEC.md'), 'utf8');

await build({
  entryPoints: ['server.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'dist/index.js',
  define: { SPEC_MD_INLINE: JSON.stringify(specMd) },
});

// Prepend the shebang on line 1 (must be first for `npx` to run it).
const out = readFileSync('dist/index.js', 'utf8').replace(/^#!.*\n/, '');
writeFileSync('dist/index.js', '#!/usr/bin/env node\n' + out);
console.log('built dist/index.js (with shebang on line 1)');
