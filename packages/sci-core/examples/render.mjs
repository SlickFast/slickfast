// Render every *.json spec in this folder to SVG next to it.
//   node packages/sci-core/examples/render.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSciSpec } from '../sci-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here).filter((n) => n.endsWith('.json'))) {
  const svg = renderSciSpec(JSON.parse(readFileSync(join(here, f), 'utf8')));
  writeFileSync(join(here, f.replace(/\.json$/, '.svg')), svg);
  console.log(f, '→', f.replace(/\.json$/, '.svg'), `(${svg.length} bytes)`);
}
