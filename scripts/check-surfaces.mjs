// Surface drift check — enforces the TYPE REGISTRY gold rule.
//
//   node scripts/check-surfaces.mjs
//
// The render-core TYPES registry is the single source of truth for "what types
// exist." Every agent-facing surface must stay in sync with it, or a new type
// ships half-exposed (renders in the engine but an agent can't discover or call
// it). This fails (exit 1) if, for any registered type:
//   • render-core's renderSpec() has no `case` to dispatch it, or
//   • the API openapi.yaml ChartType enum omits it, or
//   • SPEC.md (the agent-facing contract) never mentions it.
// It also flags a renderSpec `case` that has no TYPES row (minus known aliases).
//
// The MCP server (apps/mcp/server.mjs) DERIVES its enum + description from TYPES
// at runtime, so it cannot drift by construction — we only assert it still imports
// the registry rather than restating the list.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TYPES, TYPE_NAMES, renderSpec } from '../packages/render-core/render-core.mjs';
import { EXAMPLES } from '../packages/render-core/examples.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const engineSrc = read('packages/render-core/render-core.mjs');
const specMd = read('packages/render-core/SPEC.md');
const openapi = read('apps/api/openapi.yaml');
const mcpSrc = read('apps/mcp/server.mjs');

// renderSpec dispatch cases (alias cases that intentionally have no TYPES row).
const ALIAS_CASES = new Set(['stacked-area', 'piepie']);
const caseTypes = [...engineSrc.matchAll(/case '([a-zA-Z0-9-]+)':/g)].map((m) => m[1]);
const openapiEnum = (openapi.match(/ChartType:[\s\S]*?enum:\s*\[([^\]]+)\]/) || [])[1] || '';
const openapiSet = new Set(openapiEnum.split(',').map((s) => s.trim()));

const errors = [];

for (const { type } of TYPES) {
  if (!caseTypes.includes(type)) errors.push(`renderSpec() has no \`case '${type}'\` — registered type is not dispatchable.`);
  if (!openapiSet.has(type)) errors.push(`openapi.yaml ChartType enum is missing "${type}".`);
  if (!specMd.includes('`' + type + '`') && !specMd.includes('"' + type + '"')) errors.push(`SPEC.md never documents type "${type}".`);
  // describe_type needs a minimal example per type — and it must actually render.
  if (!EXAMPLES[type]) errors.push(`examples.mjs has no minimal spec for "${type}" (describe_type would return null).`);
  else { try { const svg = renderSpec(EXAMPLES[type]); if (!svg.startsWith('<svg')) errors.push(`EXAMPLES["${type}"] did not render an SVG.`); } catch (e) { errors.push(`EXAMPLES["${type}"] threw on render: ${e.message}`); } }
}

// Reverse: a dispatch case with no registry row (excluding known aliases).
for (const c of caseTypes) {
  if (!TYPE_NAMES.includes(c) && !ALIAS_CASES.has(c)) errors.push(`renderSpec() dispatches "${c}" but it has no TYPES row (add one, or add it to ALIAS_CASES).`);
}

// The MCP surface must DERIVE, never restate.
if (!/TYPE_NAMES/.test(mcpSrc)) errors.push('apps/mcp/server.mjs does not reference TYPE_NAMES — it must derive its enum from the registry, not restate the type list.');

// Every needsData:false type declares a `dataKey` (its top-level input array, e.g.
// cards→cards, funnel→stages, dashboard→tiles). The MCP enum auto-derives, but the
// render_chart inputSchema is hand-authored — if a dataKey isn't an actual zod field
// there, the SDK STRIPS it from the agent's call and the type renders empty with no
// error (the dashboard/tiles silent no-op). Assert each dataKey is a real schema field.
const seenKeys = new Set();
for (const { type, dataKey } of TYPES) {
  if (!dataKey || seenKeys.has(dataKey)) continue;
  seenKeys.add(dataKey);
  if (!new RegExp('\\b' + dataKey + ':\\s*z\\.').test(mcpSrc))
    errors.push(`apps/mcp/server.mjs inputSchema has no \`${dataKey}: z.…\` field, but type "${type}" needs it (dataKey) — an agent's "${dataKey}" would be silently dropped and the chart would render empty.`);
}

if (errors.length) {
  console.error(`✗ surface drift (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ surfaces in sync — all ${TYPES.length} types dispatchable, in openapi.yaml, documented in SPEC.md, and have a rendering example for describe_type.`);
