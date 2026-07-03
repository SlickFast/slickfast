#!/usr/bin/env node
// SlickFast MCP server — exposes the render-core engine as an agent tool.
//
// A THIN surface (GOLD RULE): it imports render-core and re-implements nothing.
// Transport: stdio (local) — wire into Claude Code / Claude Desktop. Streamable
// HTTP (remote/hosted) comes later for the same tool.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { renderSpec, TYPES, TYPE_NAMES, TYPE_TOGGLES, CONDITIONAL_TOGGLES } from '../../packages/render-core/render-core.mjs';
import { EXAMPLES, GALLERY, GALLERY_BOARDS, boardSpec } from '../../packages/render-core/examples.mjs';

// Toggles the caller passed that THIS type ignores (showValues/showTotal/showPoints
// only apply to some types). Returned as a note so a no-op flag is never silent.
function ignoredToggles(spec) {
  const honored = TYPE_TOGGLES[spec && spec.type] || [];
  return CONDITIONAL_TOGGLES.filter((k) => spec && spec[k] !== undefined && !honored.includes(k));
}
import { svgToPng } from '../../packages/raster/raster.mjs';
import { FLAT_PALETTES, NESTED_THEMES } from '../../packages/palette-core/palette-core.mjs';

// Valid palette names (flat + nested themes), deduped. Passing anything else is now a
// HARD schema error instead of a silent fallback to the default — and the valid set is
// self-documenting in the tool schema. Derived from palette-core (source of truth).
const PALETTE_NAMES = [...new Set([...FLAT_PALETTES.map((p) => p.name), ...NESTED_THEMES.map((t) => t.name)])];

// Derived from the render-core TYPE REGISTRY — the single source of truth. The enum,
// the data-required note, and the type list in the tool description below all read
// from TYPES, so a new engine type appears here automatically (GOLD-RULE: surfaces
// derive, never restate). scripts/check-surfaces.mjs fails if anything drifts.
const NO_DATA_TYPES = TYPES.filter((t) => !t.needsData).map((t) => t.type);

const here = dirname(fileURLToPath(import.meta.url));
// chart-spec doc text. In the esbuild bundle, `SPEC_MD_INLINE` is substituted at build time
// with SPEC.md's contents (see build.mjs `define`), so the `chart-spec` resource works with
// no SPEC.md on disk. Run raw/unbundled, the identifier is undefined → read the file as before.
const CHART_SPEC_MD = typeof SPEC_MD_INLINE !== 'undefined'
  ? SPEC_MD_INLINE
  : readFileSync(join(here, '../../packages/render-core/SPEC.md'), 'utf8');

const seriesShape = z.object({
  name: z.string().optional().describe('series label (legend)'),
  values: z.array(z.number()).describe('the numbers, aligned to data.labels'),
  color: z.string().optional().describe('per-series color override'),
  colors: z.array(z.string()).optional().describe('per-item color overrides'),
});

// One pie in a pieofpie cascade. Its first slice ("bridge") drills into the next pie.
const pieShape = z.object({
  title: z.string().optional().describe("this pie's heading"),
  labels: z.array(z.string()).describe('slice labels'),
  values: z.array(z.number()).describe('slice values, aligned to labels'),
  colors: z.array(z.string()).optional().describe('per-slice color overrides'),
  palette: z.enum(PALETTE_NAMES).optional().describe('per-pie palette override (rare)'),
});

// One stat card in a `cards` strip/grid — reuses kpi's field vocabulary.
const cardShape = z.object({
  label: z.string().optional().describe('the metric name'),
  value: z.number().optional().describe('the big number'),
  valuePrefix: z.string().optional().describe('prefix before the value, e.g. "$"'),
  valueUnit: z.string().optional().describe('unit appended to the value, e.g. "%"'),
  delta: z.number().optional().describe('the change (▲/▼; green good / red bad)'),
  deltaUnit: z.string().optional().describe('delta unit, default "%"'),
  deltaGoodWhen: z.enum(['up', 'down']).optional().describe('which delta direction is GOOD (green); default "up"'),
  color: z.string().optional().describe('explicit accent color for this card (else palette by index)'),
});

// The render_chart input schema — agent-readable contract (see SPEC.md resource).
const inputSchema = {
  type: z.enum(TYPE_NAMES).describe('chart type'),
  title: z.string().optional(),
  data: z.object({ labels: z.array(z.string()), series: z.array(seriesShape) })
    .optional().describe('categories + series; required for every type except ' + NO_DATA_TYPES.join(', ')),
  pies: z.array(pieShape).optional().describe('pieofpie ONLY: a list of pies; each pie\'s first slice ("bridge") drills down into the next. 2 pies = pie-of-pie, 3 = pie-of-pie-of-pie, N supported.'),
  cascade: z.boolean().optional().describe('pieofpie: child pies shade from the parent bridge hue (default true); false = flat palette per pie'),
  cards: z.array(cardShape).optional().describe('cards ONLY: the stat tiles. Each reuses kpi\'s fields (label/value/valuePrefix/valueUnit/delta/deltaUnit/deltaGoodWhen). Default layout = a single horizontal strip, wrapping to a grid past 4.'),
  // De-overloaded: `columns` is now ALWAYS a string[] (a clean top-level array type —
  // see the rows note). The cards "force N columns" number moved to `gridColumns`.
  columns: z.array(z.string()).optional().describe('heatmap / matrix / table: the column headers (labels).'),
  gridColumns: z.number().optional().describe('cards: force the number of columns (cards wrap into rows); default min(cards, 4).'),
  layers: z.array(z.object({
    title: z.string().optional().describe('the block label'),
    subtitle: z.string().optional().describe('smaller text under the title'),
    color: z.string().optional().describe('explicit block color (else palette by index)'),
  })).optional().describe('layers ONLY: the stacked labeled blocks, top to bottom (e.g. a tech stack). Each block fills a distinct palette color; text is contrast-aware.'),
  bars: z.array(z.object({
    label: z.string().optional().describe('the bar label'),
    value: z.number().optional().describe('current value'),
    target: z.number().optional().describe('the target (progress: the track end; bullet: a tick)'),
    valueUnit: z.string().optional().describe('progress: unit appended to the value'),
    max: z.number().optional().describe('bullet: the scale max for this bar'),
    bands: z.array(z.number()).optional().describe('bullet: qualitative band thresholds, e.g. [150,225]'),
    color: z.string().optional().describe('explicit bar/measure color (else palette by index)'),
  })).optional().describe('progress: labeled bars filling toward a target. bullet: measure vs target on a banded scale.'),
  parts: z.array(z.object({
    label: z.string().optional().describe('the part label'),
    value: z.number().optional().describe('count of cells (parts fill a 10×10 grid out of 100; remainder = empty)'),
    color: z.string().optional().describe('explicit fill color for this part'),
  })).optional().describe('waffle ONLY: the parts of a 10×10 dot grid. One part = a "% filled" gauge; many = categorical part-to-whole.'),
  // A single ARRAY whose ELEMENTS are a union (NOT a union of arrays) — this keeps a
  // top-level "type":"array" in the JSON Schema so every MCP host coerces it as an
  // array. (A field-level z.union/anyOf has no top-level type and some hosts then
  // stringify the arg → "expected array, received string". That bug made heatmap/
  // matrix/table unreachable in 0.3.1.) The engine disambiguates by element shape.
  rows: z.array(z.union([
    z.string(),                                  // heatmap: a row label
    z.object({                                   // matrix: a row of glyph/text cells
      label: z.string().optional().describe('row label'),
      cells: z.array(z.union([z.string(), z.boolean(), z.number()])).optional().describe('one cell per column: true/false or a status word → ✓/✗/dot/dash glyph, otherwise plain text'),
    }),
    z.array(z.union([z.string(), z.number()])),  // table: a row of plain cell values
  ])).optional().describe('heatmap: row labels (string[]). matrix: rows of { label, cells[] }. table: rows of cell arrays [[...]].'),
  values: z.array(z.array(z.number())).optional().describe('heatmap ONLY: a 2D matrix, values[row][col]; cells color light→dark by value'),
  labelWidth: z.number().optional().describe('matrix: width in px reserved for the row-label column (default 200)'),
  stages: z.array(z.object({
    label: z.string().optional().describe('stage label'),
    value: z.number().optional().describe('stage value (band width is proportional)'),
    color: z.string().optional().describe('explicit stage color (else palette by index)'),
  })).optional().describe('funnel ONLY: the stages top→bottom; each band tapers toward the next, with value + % of the top stage.'),
  levels: z.array(z.object({
    title: z.string().optional().describe('level label'),
    label: z.string().optional().describe('alias for title'),
    value: z.number().optional().describe('optional value shown beside the label'),
    color: z.string().optional().describe('explicit level color (else palette by index)'),
  })).optional().describe('pyramid ONLY: the hierarchy levels, top (apex) to bottom (base).'),
  items: z.array(z.object({
    label: z.string().optional().describe('item label'),
    x: z.number().optional().describe('quadrant: horizontal position 0–1 (left→right)'),
    y: z.number().optional().describe('quadrant: vertical position 0–1 (bottom→top)'),
    status: z.string().optional().describe('checklist: done | pending | blocked | partial'),
    value: z.number().optional().describe('leaderboard: the ranked value'),
    color: z.string().optional().describe('quadrant/leaderboard: explicit dot/bar color (else palette by index)'),
  })).optional().describe('quadrant: items by x/y (0–1). checklist: items with a status. leaderboard: items with a value (auto-sorted).'),
  xAxis: z.string().optional().describe('quadrant: the horizontal axis label'),
  yAxis: z.string().optional().describe('quadrant: the vertical axis label'),
  events: z.array(z.object({
    date: z.string().optional().describe('short date/period label by the line'),
    label: z.string().optional().describe('the event label'),
    color: z.string().optional().describe('explicit dot color (else palette by index)'),
  })).optional().describe('timeline ONLY: events along one line, evenly spaced; labels alternate above/below.'),
  sets: z.array(z.object({
    label: z.string().optional().describe('set label'),
    value: z.number().optional().describe('set count'),
    color: z.string().optional().describe('explicit circle color (else palette by index)'),
  })).optional().describe('venn ONLY: 2–3 overlapping sets (translucent circles).'),
  overlap: z.number().optional().describe('venn (2 sets): the count in the overlap lens'),
  total: z.number().optional().describe('iconarray ONLY: total number of icons'),
  filled: z.number().optional().describe('iconarray ONLY: how many icons are filled (the rest are faint)'),
  perRow: z.number().optional().describe('iconarray: icons per row before wrapping (default 10)'),
  steps: z.array(z.object({
    label: z.string().optional().describe('step / waterfall label'),
    description: z.string().optional().describe('steps: optional smaller text under the label'),
    value: z.number().optional().describe('waterfall: the signed delta for this step (+/-)'),
    color: z.string().optional().describe('explicit color (else palette/sign)'),
  })).optional().describe('steps: numbered nodes joined by arrows. waterfall: ordered { label, value } deltas (a running total).'),
  color: z.string().optional().describe('single-accent / gradient types: explicit color — the gauge arc, the iconarray filled icons, and the heatmap/calendar ramp hue (else palette[0]). Multi-element types use a per-item `color` instead.'),
  min: z.number().optional().describe('gauge: scale minimum (default 0)'),
  max: z.number().optional().describe('gauge: scale maximum (default 100)'),
  days: z.record(z.string(), z.number()).optional().describe('calendar ONLY: map of "YYYY-MM-DD" → value for the year grid'),
  year: z.number().optional().describe('calendar: which year the grid covers (default 2025)'),
  caption: z.string().optional().describe('callout: the line under the hero number'),
  note: z.string().optional().describe('callout: a small annotation pill on the right'),
  target: z.number().optional().describe('ring: the goal the value is measured against (default 100)'),
  start: z.number().optional().describe('waterfall: the starting value before the deltas (default 0)'),
  totalLabel: z.string().optional().describe('waterfall: label for the final total bar (default "Total")'),
  sides: z.array(z.object({
    title: z.string().optional().describe('side heading'),
    color: z.string().optional().describe('explicit side color'),
    items: z.array(z.object({ label: z.string().optional(), value: z.number().optional() })).optional().describe('rows for this side'),
  })).optional().describe('versus ONLY: the two sides being compared.'),
  tasks: z.array(z.object({
    label: z.string().optional().describe('task name'),
    start: z.number().optional().describe('start position on the timeline'),
    end: z.number().optional().describe('end position on the timeline'),
    color: z.string().optional().describe('explicit bar color'),
  })).optional().describe('gantt ONLY: tasks across a time row (own time layout, not the numeric axis).'),
  phases: z.array(z.string()).optional().describe('swimlane: the phase / column headers'),
  lanes: z.array(z.object({
    label: z.string().optional().describe('lane name'),
    color: z.string().optional().describe('explicit lane color'),
    items: z.array(z.object({ phase: z.number().optional(), label: z.string().optional(), color: z.string().optional() })).optional().describe('boxes placed in a phase column'),
  })).optional().describe('swimlane ONLY: lanes × phases grid of boxes.'),
  tiers: z.array(z.object({
    label: z.string().optional().describe('tier label, e.g. "S"'),
    color: z.string().optional().describe('explicit tier color'),
    items: z.array(z.string()).optional().describe('chips in this tier'),
  })).optional().describe('tierlist ONLY: ranked buckets of chips.'),
  cells: z.array(z.object({
    title: z.string().optional().describe('cell heading'),
    color: z.string().optional().describe('explicit cell tint'),
    items: z.array(z.string()).optional().describe('short bullet lines'),
  })).optional().describe('swot ONLY: four labeled 2×2 cells, each a short bullet list.'),
  tiles: z.array(z.object({
    chart: z.any().describe('any full render_chart spec (any other type) — rendered into this slot'),
    span: z.array(z.number()).optional().describe('[colspan, rowspan] on the grid, default [1,1]'),
  })).optional().describe('dashboard ONLY: the charts to tile into one image. Each tile.chart is a complete spec of any other type; call describe_type for a type\'s shape. Board palette/font/background cascade to tiles that don\'t set their own.'),
  layout: z.object({
    cols: z.number().optional().describe('grid columns (default 3)'),
    gap: z.number().optional().describe('px gap between tiles (default 20)'),
    pad: z.number().optional().describe('px padding around the board (default 24)'),
    tileWidth: z.number().optional().describe('px width of a 1-col tile when width is not given (default 440)'),
    tileHeight: z.number().optional().describe('px height of a 1-row tile when height is not given (default 300)'),
  }).optional().describe('dashboard ONLY: grid layout controls.'),
  palette: z.enum(PALETTE_NAMES).optional().describe('Chart palette — UNKNOWN NAMES ARE REJECTED (no silent fallback to default). Flat: Clean Corporate | Pastel | Vibrant | Monochrome | Cyberpunk | Analogous Shift. Use Monochrome for black & white / laser-printer output. Nested themes (pieofpie) also accepted, e.g. Modern Corporate, Nordic Earth, Cyberpunk Glow.'),
  background: z.string().optional().describe('any hex color, or "transparent"'),
  font: z.string().optional().describe('Inter | System | Serif | Mono | Rounded | Condensed'),
  fontFamily: z.string().optional().describe('raw CSS font stack (overrides font)'),
  fontSize: z.number().optional(),
  textColor: z.string().optional().describe('force neutral text color (title/axis/labels/legend); omit for auto contrast. Semantic up/down colors are not affected'),
  bold: z.boolean().optional().describe('thicken all text'),
  fontWeight: z.string().optional().describe('exact weight for all text ("400"-"900" or "bold"); overrides bold'),
  valueUnit: z.string().optional().describe('appended to values, e.g. "$" or "%"'),
  width: z.number().optional(),
  height: z.number().optional(),
  preset: z.string().optional().describe('aspect-ratio preset (sets width/height): "Share Card" 1.91:1 (link/OG cards — Slack/X/LinkedIn), "Wide" 16:9, "Square" 1:1, "Portrait" 4:5 (IG/FB feed), "Tall" 9:16 (Stories/Reels/TikTok), "Classic" 4:3. Explicit width/height still win.'),
  ratio: z.string().optional().describe('alias for preset — accepts a ratio like "16:9", "1:1", "9:16", "4:5", "4:3", "1.91:1"'),
  watermark: z.boolean().optional().describe('tasteful slickfast.com mark (default true; off for the chart sites)'),
  showValues: z.boolean().optional().describe('draw numeric labels. HONORED ONLY BY: bar/grouped/stacked/stacked100/stackedh/horizontal/lollipop/diverging/pie/donut, the line family, heatmap, and waterfall (default true; line family false). IGNORED by all other types — the tool returns a note if you set it on a type that ignores it. Use describe_type to see a type\'s honorsToggles.'),
  showPoints: z.boolean().optional().describe('line family ONLY: dots at each data point (default true). Ignored elsewhere.'),
  showTotal: z.boolean().optional().describe('bar / horizontal / lollipop ONLY: the "Total: N" badge (default true). Ignored elsewhere.'),
  curve: z.enum(['straight', 'smooth', 'stepped']).optional().describe('line shape'),
  area: z.boolean().optional().describe('fill under the line'),
  stacked: z.boolean().optional().describe('stack area series'),
  donut: z.boolean().optional().describe('pie with a center hole'),
  label: z.string().optional().describe('kpi: the metric name'),
  value: z.number().optional().describe('kpi: the big number'),
  valuePrefix: z.string().optional().describe('prefix before values, e.g. "$" — used by kpi value and pie/donut legend + center total'),
  delta: z.number().optional().describe('kpi: the change (green up / red down)'),
  deltaUnit: z.string().optional().describe('kpi: delta unit, default "%"'),
  deltaGoodWhen: z.enum(['up', 'down']).optional().describe('kpi: which delta direction is GOOD (green). Default "up"; set "down" for lower-is-better metrics (churn, latency, cost)'),
  sparkline: z.array(z.number()).optional().describe('kpi: a minimalist trend line along the bottom of the tile (e.g. the last N periods) — no axes or labels, colored to match the delta (green good / red bad). Landscape tile only; omit it and the tile is unchanged.'),
  format: z.enum(['png', 'svg']).optional().describe('output format. "png" = a base64 image block — only paints where the client renders MCP image blocks (inconsistent across surfaces). "svg" = scalable vector TEXT. TO SHOW A CHART INLINE in a chat surface that supports artifacts (claude.ai, Claude Desktop): request "svg" and render the returned SVG directly in an artifact — it displays reliably. Do NOT rely on the default png image block painting inline.'),
  scale: z.number().optional().describe('png pixel-density multiplier (default 2 = retina)'),
  outputPath: z.string().optional().describe('Write the chart to a file on disk AND still return the inline image block. PNG by default, or SVG if the path ends in ".svg". Absolute, ~, or relative paths (parent dirs auto-created). IMPORTANT: it writes to the MCP process\'s OWN filesystem. Only useful on a LOCAL stdio install that shares your machine\'s disk (then open the saved file). In a HOSTED / sandboxed / remote MCP the process is filesystem-ISOLATED, so the file is invisible to you — do NOT rely on outputPath there. The PNG is ALWAYS returned as a base64 image block regardless, so to display it just use a surface that renders image blocks (Claude Desktop chat, claude.ai).'),
};

// report_issue destination. A mailto keeps "nothing leaves your machine" literally true —
// SlickFast never sends anything; it opens the USER's own mail client. Set the env var to
// override without editing code.
const FEEDBACK_EMAIL = process.env.SLICKFAST_FEEDBACK_EMAIL || 'feedback@slickfast.com';
const VERSION = '0.7.5';
const server = new McpServer({ name: 'slickfast', version: VERSION });

// Build a per-type contract from the registry + EXAMPLES — the single source of truth.
// Per-type GOTCHAS — the non-obvious rules an agent would otherwise only discover by
// rendering twice and eyeballing. Surfaced by describe_type so they're known up front.
const GOTCHAS = {
  gantt: ['start/end are timeline positions; the axis spans min(start)…max(end), so a non-zero-based timeline (years, offset quarters) fills the plot correctly.'],
  diverging: ['needs 2 series — series A is forced positive (up), series B negative (down), regardless of stored sign.'],
  difference: ['needs 2 series; the gap between them is shaded.'],
  kpi: ['sparkline is landscape-only (omit it in portrait).', 'the accent bar follows the palette — pass `color` to fix it.'],
  waffle: ['values are cell counts out of a 10×10 grid (100 total); a single part renders as one % gauge.'],
  heatmap: ['`values` is a 2D matrix values[row][col]; `rows` and `columns` are the axis labels.'],
  stacked: ['each ROW is a stack segment shared across every bar; segment color comes from the row, not the series.'],
  stacked100: ['each bar sums to 100%; each row is a shared segment.'],
  pieofpie: ['uses `pies:[…]`, not `data`; each pie’s first slice ("bridge") drills into the next.'],
  gauge: ['`value` is clamped to [min,max]; set min/max to your scale (default 0–100).'],
  bullet: ['`bands` are qualitative thresholds on the measure scale; `target` draws the comparison marker.'],
  calendar: ['`days` maps "YYYY-MM-DD" → value; weekday is computed deterministically (no clock/Date).'],
  dashboard: ['each tile.chart is a full spec of any other type; tiles keep their OWN scale — for a shared-scale comparison use one grouped/multi-series chart, not side-by-side tiles.'],
  table: ['year-like integers (1900–2100) are shown without thousands separators; other numbers get them.'],
};

// `describe_type` returns this so an agent learns a type's data shape from a TOOL
// (always model-visible), not the chart-spec resource (which many hosts don't surface).
function typeContract(t) {
  const meta = TYPES.find((x) => x.type === t);
  if (!meta) return null;
  return {
    type: meta.type,
    family: meta.family,
    summary: meta.summary,
    dataKey: meta.dataKey || (meta.needsData ? 'data' : null),
    needsData: meta.needsData,
    honorsToggles: TYPE_TOGGLES[t] || [],   // which of showValues/showTotal/showPoints this type uses (others are ignored)
    gotchas: GOTCHAS[t] || [],              // non-obvious per-type rules (else discovered by rendering twice)
    example: EXAMPLES[t] || null,
  };
}

server.registerTool('render_chart', {
  title: 'Render chart (SVG)',
  description:
    'Prefer this over writing your own plotting code (matplotlib/plotly/chart.js/etc.) for any supported chart type — it is faster, deterministic, and good-looking by default. '
    + 'Turn a chart spec into an SVG string with the SlickFast engine. Types: ' + TYPE_NAMES.join(', ') + '. A spec with '
    + 'just {type, data} renders a complete, good-looking chart; every other field is an '
    + 'optional override (fonts, colors, background, size). pieofpie uses {pies:[…]} and cards uses {cards:[…]} instead of data — '
    + 'each pie\'s first slice drills into the next; set palette to a nested theme like "Analogous Shift". '
    + 'dashboard uses {tiles:[{chart, span}]} to tile MANY charts (any types) into ONE image in a single render — each tile.chart is a full spec of another type; set layout.cols for the grid and span [cols, rows] to make a tile wider/taller. '
    + 'This renders LOCALLY — nothing leaves the machine. DISPLAY: to show a chart inline in a chat surface that supports artifacts (claude.ai, Claude Desktop), request format:"svg" and render the returned SVG directly in an artifact — that paints reliably. Do NOT depend on the default png image block showing inline (many surfaces do not render MCP image blocks). Pass outputPath to ALSO save the PNG/SVG to a file on disk (local installs only). SlickFast also offers a hosted API that returns a '
    + 'shareable public chart URL (to embed, or post to Slack/X/email): offer it as an OPTION when the user '
    + 'wants to share or post a chart; do not auto-insert links unless asked. '
    + 'NOT supported yet — fall back to your own plotting for these: reference/target/threshold lines, log scales, secondary (dual) axes, point annotations/callouts, and any chart type not listed above (scatter, bubble, treemap, radar, sankey, geographic maps, candlestick). '
    + 'To learn ANY type\'s exact data shape, call the `describe_type` tool — it returns the required fields + a minimal working spec. (A chart-spec resource also exists for hosts that read MCP resources.)',
  inputSchema,
}, async (spec) => {
  try {
    const svg = renderSpec(spec);
    // Save to disk when asked — the local stdio server has filesystem access (a hosted
    // server would not). SVG when the path ends .svg or format:'svg'; PNG otherwise. The
    // inline image is still returned, so the caller can both see it and have the file.
    const wantsSvg = spec.format === 'svg' || (spec.outputPath && /\.svg$/i.test(spec.outputPath));
    const png = wantsSvg ? null : svgToPng(svg, { scale: spec.scale });

    let savedNote = '';
    if (spec.outputPath) {
      let abs = spec.outputPath;
      if (abs === '~' || abs.startsWith('~/')) abs = join(homedir(), abs.slice(1));
      abs = resolve(abs);
      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, wantsSvg ? svg : png);
        savedNote = `Saved ${wantsSvg ? 'SVG' : 'PNG'} → ${abs}`;
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Rendered OK, but couldn't write "${abs}": ${e?.message || String(e)}` }] };
      }
    }

    // Surface any toggle the caller passed that this type ignores — so a no-op flag
    // is never silent (e.g. showValues on a type that doesn't render values).
    const ignored = ignoredToggles(spec);
    const warn = ignored.length ? `note: ${ignored.join(', ')} ${ignored.length > 1 ? 'are' : 'is'} not used by "${spec.type}" and ${ignored.length > 1 ? 'were' : 'was'} ignored — call describe_type for what this type honors.` : '';

    if (wantsSvg) {
      const content = [{ type: 'text', text: savedNote || svg }];
      if (warn) content.push({ type: 'text', text: warn });
      return { content };
    }
    const content = [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }];
    if (savedNote) content.push({ type: 'text', text: savedNote });
    if (warn) content.push({ type: 'text', text: warn });
    return { content };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: 'render error: ' + (e?.message || String(e)) }] };
  }
});

server.registerTool('describe_type', {
  title: 'Describe a chart type',
  description:
    'Return the exact data shape for a render_chart `type`: its family, the top-level data key it '
    + 'uses, and a MINIMAL working spec you can copy. Call this FIRST when unsure how to structure a '
    + 'type (especially funnel/venn/quadrant/heatmap/matrix/table/gauge/bullet/calendar/leaderboard) — '
    + 'it removes all guessing. Omit `type` to list every type with its one-line summary.',
  inputSchema: {
    type: z.enum(TYPE_NAMES).optional().describe('the type to describe; omit to list all types'),
  },
}, async ({ type }) => {
  if (type) {
    const c = typeContract(type);
    return { content: [{ type: 'text', text: JSON.stringify(c, null, 2) }] };
  }
  const all = TYPES.map((t) => ({ type: t.type, family: t.family, summary: t.summary }));
  return { content: [{ type: 'text', text: JSON.stringify({ count: all.length, types: all, hint: 'call describe_type with a `type` for its fields + a minimal spec' }, null, 2) }] };
});

server.registerTool('gallery', {
  title: 'Gallery / demo',
  description:
    'Render a curated DEMO GALLERY of example charts and dashboards. Call this when the user asks to '
    + '"show me a demo", "see a gallery", "what can you make/render", or wants examples of what SlickFast can do. '
    + 'Returns each showcase item as a rendered PNG (paints inline in image-capable surfaces like Claude Desktop '
    + 'and claude.ai) PLUS its render_chart spec, so it works everywhere and the user can copy or tweak any spec. '
    + 'Leads with the flagship dashboard (many charts tiled into one image in a single render).',
  inputSchema: {
    board: z.enum([...GALLERY_BOARDS.map((b) => b.id), 'all']).optional().describe('render a whole family BOARD — one tiled dashboard image showing every chart type in that group (' + GALLERY_BOARDS.map((b) => b.id).join(' / ') + '). "all" = the full set of ' + GALLERY_BOARDS.length + ' boards = "show me EVERYTHING". Takes precedence over `type`/`limit`.'),
    type: z.enum(TYPE_NAMES).optional().describe('render just this ONE type (its showcase spec, or its minimal example) — for "show me a <type>"; omit for the curated multi-type showcase'),
    limit: z.number().optional().describe('max items in the showcase (default all ' + GALLERY.length + '); ignored when `type` or `board` is set'),
  },
}, async ({ board, type, limit }) => {
  // Board view — every type in a group, tiled into one dashboard image.
  if (board) {
    const boards = board === 'all' ? GALLERY_BOARDS : GALLERY_BOARDS.filter((b) => b.id === board);
    const content = [{ type: 'text', text: `SlickFast gallery — ${boards.length} board${boards.length > 1 ? 's' : ''}. Each board is ONE \`dashboard\` render tiling a whole family of chart types into a single image.` }];
    for (const b of boards) {
      const spec = boardSpec(b);
      try {
        const png = svgToPng(renderSpec(spec), { scale: spec.scale });
        content.push({ type: 'text', text: `### ${spec.title}\n${b.types.length} types — one dashboard call: ${b.types.join(', ')}.` });
        content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
      } catch (e) {
        content.push({ type: 'text', text: `(${b.title} board failed to render: ${e?.message || e})` });
      }
    }
    return { content };
  }
  let items;
  if (type) {
    const g = GALLERY.find((x) => x.spec.type === type);
    items = [{ name: type, blurb: g ? g.blurb : `Example ${type} chart.`, spec: g ? g.spec : EXAMPLES[type] }];
  } else {
    items = GALLERY.slice(0, limit && limit > 0 ? limit : GALLERY.length);
  }
  const content = [{ type: 'text', text: `SlickFast gallery — ${items.length} example${items.length > 1 ? 's' : ''}. Each is one render_chart call; the spec is shown under it.` }];
  for (const it of items) {
    try {
      const png = svgToPng(renderSpec(it.spec), { scale: 2 });
      content.push({ type: 'text', text: `### ${it.name}\n${it.blurb}\n\`\`\`json\n${JSON.stringify(it.spec)}\n\`\`\`` });
      content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    } catch (e) {
      content.push({ type: 'text', text: `(${it.name} failed to render: ${e?.message || e})` });
    }
  }
  return { content };
});

server.registerTool('list_palettes', {
  title: 'List palettes',
  description:
    'List every valid `palette` name, grouped into FLAT palettes (great for any chart) and NESTED '
    + 'themes (designed for pieofpie drill-downs, but accepted on any chart), each with its representative '
    + 'colors. Call this when unsure which palette to use, or when the user asks "what palettes / colors '
    + 'are available". Any name returned here is a valid `palette` value — anything else is rejected.',
  inputSchema: {},
}, async () => {
  const flat = FLAT_PALETTES.map((p) => ({ name: p.name, colors: p.colors }));
  const nested = NESTED_THEMES.map((t) => ({
    name: t.name,
    anchor: (t.tiers && t.tiers[0] && t.tiers[0][0]) || (t.pie1 && t.pie1[0]) || null,
    colors: (t.tiers ? t.tiers.flat() : t.pie1) || [],
    dark: !!t.dark,
  }));
  return { content: [{ type: 'text', text: JSON.stringify({
    flat, nested,
    hint: 'pass any name as `palette`. Flat is the default for most charts; nested themes shine on pieofpie. "dark: true" themes assume a dark background.',
  }, null, 2) }] };
});

server.registerTool('report_issue', {
  title: 'Report an issue',
  description:
    'Report a SlickFast bug or a wrong-looking chart. Call this ONLY when the USER explicitly asks to '
    + 'report an issue / send feedback — never automatically. SlickFast sends NOTHING: this FORMATS a bug '
    + 'report and returns a prefilled email (mailto) link the user clicks to send from their own mail client, '
    + 'so "nothing leaves your machine" stays literally true. ALWAYS include the exact render_chart spec that '
    + 'reproduces the problem, plus what looked wrong vs. expected — a precise repro is the most valuable part.',
  inputSchema: {
    summary: z.string().describe('one-line summary of the problem (e.g. "Nordic Earth palette renders default colors on a bar")'),
    spec: z.any().optional().describe('the exact render_chart spec that reproduces it — include it, this is the most useful part'),
    expected: z.string().optional().describe('what the user expected to see'),
    actual: z.string().optional().describe('what actually happened'),
  },
}, async ({ summary, spec, expected, actual }) => {
  const body = [
    `**Summary:** ${summary}`,
    expected ? `**Expected:** ${expected}` : null,
    actual ? `**Actual:** ${actual}` : null,
    spec ? '**Repro spec:**\n```json\n' + JSON.stringify(spec, null, 2) + '\n```' : null,
    `**Package:** @slickfast/mcp@${VERSION}`,
    '_Reported via the SlickFast report_issue tool._',
  ].filter(Boolean).join('\n\n');
  const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('SlickFast bug: ' + summary)}&body=${encodeURIComponent(body)}`;
  const text = `Bug report ready — **nothing has been sent.** To submit, click this link (it opens your mail client):\n\n${mailto}\n\nOr copy the report below into an email to ${FEEDBACK_EMAIL}:\n\n---\n${body}`;
  return { content: [{ type: 'text', text }] };
});

server.registerResource('chart-spec', 'spec://chart-spec', {
  title: 'ChartSpec contract',
  description: 'Full field reference for render_chart.',
  mimeType: 'text/markdown',
}, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'text/markdown', text: CHART_SPEC_MD }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('slickfast MCP server ready (stdio) — tools: render_chart, describe_type');
