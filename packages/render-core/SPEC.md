# ChartSpec — the render-core contract (the API/MCP input)

One JSON object (a **spec**) goes in; one **SVG string** comes out, via
`renderSpec(spec)`. This document is the contract an agent (or the MCP tool) follows
to produce a chart. It is written agent-first: **a spec with only `type` + `data`
renders a complete, good-looking chart** — every other field is an optional override.

```js
import { renderSpec } from './render-core.mjs';
const svg = renderSpec({ type: 'bar', data: { labels: ['A','B','C'], series: [{ values: [10, 20, 15] }] } });
```

## When to use this — and when to fall back

**Prefer `render_chart` for any supported type** (see "Chart types" below) over
hand-writing plotting code (matplotlib, plotly, chart.js). It's faster, deterministic,
and good-looking with just `{type, data}`. Pass `outputPath` when the user wants the
file saved to disk.

**Fall back to your own plotting only for what this engine does not do yet:**
- **Chart types not listed below** — scatter, bubble, heatmap, treemap, radar, sankey,
  geographic maps, candlestick, gantt.
- **Reference / target / threshold lines, log scales, secondary (dual) axes, and point
  annotations / callouts** — on the roadmap, not available today.
- **Interactivity, animation, hover tooltips** — output is a static SVG/PNG.

## Universal fields (every chart type honors these)

| field | type | default | what it does |
|---|---|---|---|
| `type` | string | — (required) | which chart: `"bar"`, `"line"`, `"kpi"` (more coming) |
| `title` | string | `""` | heading drawn at the top |
| `width` | number | per type | SVG width in px |
| `height` | number | per type | SVG height in px |
| `preset` / `ratio` | string | — | aspect-ratio preset → sets width/height (explicit `width`/`height` win). `Share Card` 1.91:1 (1200×630, link/OG cards), `Wide` 16:9 (1280×720), `Square` 1:1 (1080×1080), `Portrait` 4:5 (1080×1350), `Tall` 9:16 (1080×1920), `Classic` 4:3 (1200×900). `ratio` also accepts the bare ratio string (`"16:9"`, `"9:16"`, …) |
| `background` | string | `"#ffffff"` | any hex color, or `"transparent"` for no fill (overlays/exports) |
| `palette` | string | `"Clean Corporate"` | named palette: `Clean Corporate`, `Pastel`, `Vibrant`, `Monochrome`, `Cyberpunk`, `Analogous Shift`. Pick **`Monochrome`** when the chart will be **printed in black & white / on a laser printer** — it's a single-hue grey ramp that stays legible without color (other palettes can render as indistinct greys when printed). |
| `font` | string | `"Inter"` | a named font: `Inter`, `System`, `Serif`, `Mono`, `Rounded`, `Condensed` |
| `fontFamily` | string | — | a raw CSS font stack (overrides `font`; full control / future custom fonts) |
| `fontSize` | number | `13` | base text size; other text scales from it |
| `textColor` | string | auto | force a color for the **neutral** text (title, axis, category, value, legend, pie slice labels). Omit it and the engine auto-picks black/white for contrast. Semantic colors (green ▲ / red ▼ deltas & gaps) stay meaningful. |
| `bold` | boolean | `false` | thicken every text element |
| `fontWeight` | string | — | exact weight for all text (`"400"`–`"900"` or `"bold"`); overrides `bold` |
| `valueUnit` | string | `""` | appended to values, e.g. `"$"`, `"%"`, `"ms"` |
| `showValues` | boolean | `true`* | draw the numeric labels. **Only some types honor it** — the numeric charts (bar/grouped/stacked/horizontal/lollipop/diverging/pie/donut), the line family, `heatmap`, and `waterfall`. On every other type it is **ignored** (they show or omit values inherently). *Default is `true` except the line family (`false`, to avoid clutter). Call `describe_type` for a type's `honorsToggles`. |
| `watermark` | boolean | `true` | tasteful "slickfast.com" mark. **Set `false` for the chart sites / paid output.** |

**Readability is automatic:** text colors are chosen from the background's luminance
(via palette-core), so labels stay legible on light *or* dark backgrounds.

## Data shape

```json
"data": {
  "labels": ["North", "South", "East"],
  "series": [
    { "name": "Revenue", "values": [420, 310, 530], "colors": ["#2563eb", "#7c3aed", "#059669"] }
  ]
}
```

- `labels` — the categories (x-axis).
- `series[].values` — the numbers, aligned to `labels`.
- `series[].colors` — **optional** explicit per-item colors. If omitted, colors come
  from `palette`. (Used when a user has customized individual bars.)
- `series[].name` — optional label for the series.

## Chart types

### `bar` — vertical bar chart
Default size `800 × 450`. Uses `data.series[0]`. Each bar a palette color (or its
explicit `colors[i]`), top-rounded, with value + category labels and "nice" axis numbers.

| extra field | type | default | does |
|---|---|---|---|
| `showTotal` | boolean | `true` | "Total: N" badge, top-right |

Minimal: `{ "type": "bar", "data": { "labels": ["A","B"], "series": [{ "values": [10,20] }] } }`

### `grouped` — clustered bar chart (one bar per series in each category)
Default size `800 × 450`. The `data.labels` are the **groups** (categories); each
`data.series` entry is a bar that repeats inside every group. **Color = series
identity:** one solid palette color per series (A=palette[0], B=palette[mid], extras
spread), the same color in every group — never rainbow-within-a-series. A centered
legend names the series. Best read with ≤ 4 series.

Minimal: `{ "type": "grouped", "data": { "labels": ["Q1","Q2"], "series": [{ "name":"2023","values":[42,55] }, { "name":"2024","values":[52,48] }] } }`

### `stacked` — stacked bar chart (segments stack within each category)
Default size `800 × 450`. Each `data.labels` entry is a bar; each `data.series` entry
is a **segment** stacked inside every bar, with a distinct palette color used
consistently across all bars. Inside each segment, two labels: the **name pinned to the
top**, the **value to the bottom** (contrast-aware text — dark on light fills, white on
dark). Thin segments hide the name but keep the value. Only the top segment's outer edge
is rounded; joins stay flush. A centered legend names the segments.

Minimal: `{ "type": "stacked", "data": { "labels": ["Q1","Q2"], "series": [{ "name":"Core","values":[30,35] }, { "name":"Add-ons","values":[18,20] }] } }`

### `stacked100` — 100% stacked bar (each bar normalized to 100%)
Same as `stacked`, but every bar fills the full height and each segment shows its
**share of that bar** as an integer percent. Percentages use largest-remainder
rounding so every bar sums to **exactly 100** (never 99/101). Best for comparing
*mix* across categories rather than absolute totals.

Minimal: `{ "type": "stacked100", "data": { "labels": ["Q1","Q2"], "series": [{ "name":"Core","values":[30,35] }, { "name":"Add-ons","values":[18,20] }] } }`

### `stackedh` — horizontal stacked bar
Same data model as `stacked`, transposed: bars run left→right, one row per
`data.labels` entry, segments stack horizontally. The last segment rounds its right
edge; joins stay flush. Segment name + value sit centered in each segment (value-only
when narrow); a centered legend names the segments. Good when category labels are long.

Minimal: `{ "type": "stackedh", "data": { "labels": ["Eng","Sales"], "series": [{ "name":"Salaries","values":[120,90] }, { "name":"Tools","values":[40,25] }] } }`

### `horizontal` — horizontal bar (single series)
Default size `800 × 450`. One row per `data.labels` entry; each bar its own palette
color by index (or its explicit `colors[i]`), value at the bar end, "Total: N" badge
top-right. Best when labels are long or there are many categories.

Minimal: `{ "type": "horizontal", "data": { "labels": ["US","India"], "series": [{ "values": [820,610] }] } }`

### `diverging` — diverging bar (around a zero line)
Default size `800 × 450`. **Two modes, chosen by series count:**
- **Two series** → opposing bars: **Series A forced up, Series B forced down** (both
  abs-valued), one solid color each (A=palette[0], B=palette[mid]); a centered legend
  names both. Great for sentiment (agree/disagree), inflow/outflow.
- **One series** → classic **signed** diverging: each value plotted by its own sign
  (**positive up, negative down**), a single color, a single-name legend, and signed
  value labels (e.g. `-3` below the zero line).

The zero line is emphasized; down-bar labels sit below their bars.

Minimal (two-series): `{ "type": "diverging", "data": { "labels": ["A","B"], "series": [{ "name":"Agree","values":[62,48] }, { "name":"Disagree","values":[38,52] }] } }`

Minimal (signed): `{ "type": "diverging", "data": { "labels": ["Q1","Q2","Q3"], "series": [{ "name":"Net flow","values":[5,-3,8] }] } }`

### `lollipop` — lollipop chart (single series)
Default size `800 × 450`. One stem + dot per `data.labels` entry, each its own palette
color by index (or explicit `colors[i]`), value above the dot, category below, "Total: N"
badge top-right. A lighter-weight alternative to `bar` when the bars would feel heavy.

Minimal: `{ "type": "lollipop", "data": { "labels": ["A","B","C"], "series": [{ "values": [78,64,52] }] } }`

### `line` — line chart (single or multi-series)
Default size `800 × 450`. One line per `data.series` entry, each a palette color
(or its own `color`), with points and a centered legend when there's more than one
series. "Nice" axis numbers; points span edge-to-edge.

| extra field | type | default | does |
|---|---|---|---|
| `curve` | string | `"straight"` | line shape: `"straight"`, `"smooth"` (curved), `"stepped"` |
| `area` | boolean | `false` | fill the region under each line (translucent) |
| `showPoints` | boolean | `true` | dots at each data point |
| `showValues` | boolean | `false` | numbers above each point (off by default — lines get crowded) |
| series `color` | string | palette | per-line color override |

**Type shortcuts:** `type: "smooth"`, `"area"`, `"stepped"` map to `line` with the
matching option set — `{type:"area"}` ≡ `{type:"line", area:true}`. Also:
- `type: "stackedArea"` — every series stacks cumulatively, filled bands + legend.
- `type: "difference"` — exactly two series; shades the gap between them and labels
  the gap value at each point (green where series 1 leads, red where it trails).
- `type: "slope"` — a slopegraph: each series' first vs last value, connected by a
  straight line, with the end value + change labeled (green up / red down).

Minimal: `{ "type": "line", "data": { "labels": ["Jan","Feb","Mar"], "series": [{ "name": "Users", "values": [120,190,170] }] } }`

### `pie` / `donut` — proportion of a whole
Default size `640 × 420`. One series; each label+value is a slice, colored from the
palette (or explicit `colors`). Percentage labels sit inside slices ≥ 6%; a legend
(label · value) runs down the right. `donut` adds a center hole with the **total** in
the middle.

Minimal: `{ "type": "pie", "data": { "labels": ["A","B","C"], "series": [{ "values": [45,30,25] }] } }`

### `pieofpie` — nested drill-down pies (pie-of-pie, pie-of-pie-of-pie, N-tier)
Default size `920 × 460`. A row of pies where each pie's **first slice (the "bridge")**
explodes toward the next pie and breaks down into it, joined by two connector lines.
2 pies = pie-of-pie, 3 = pie-of-pie-of-pie, N supported; each pie is 75% the size of the
one before. Donut by default. Each pie gets a **`name · value` legend beneath it**
(honoring `valuePrefix`/`valueUnit`) so slices are identifiable; the slices themselves
keep their `%` labels.

Uses **`pies`** (not `data`): an array of `{ title?, labels[], values[], colors?, palette? }`.
Slice index 0 of each pie is the bridge into the next pie.

| extra field | type | default | does |
|---|---|---|---|
| `pies` | array | — (required) | the pies; pie[i] slice 0 drills into pie[i+1] |
| `donut` | boolean | `true` | center hole on each pie (`false` = solid pies) |
| `cascade` | boolean | `true` | child pies shade from the parent bridge hue; `false` = flat palette per pie |
| `palette` | string | `"Clean Corporate"` | a **nested theme** (below) — drives the whole cascade |

**Nested themes** (premium color cascades, set via `palette`):
- *Inspired tiers* (hand-tuned per-pie triads): `Analogous Shift` (showcase — a spectrum
  walk), `Retro Editorial`, `Classic Triadic`, `Sorbet Pastel`.
- *Generative* (children derived from the root hue): `Modern Corporate`, `Nordic Earth`,
  `Cyberpunk Glow`, `Sequential Rainbow`, plus classics `Clean Corporate`, `Pastel`,
  `Vibrant`, `Monochrome`. (Authoring new ones: `palette-core/AUTHORING-PALETTES.md`.)

Minimal: `{ "type": "pieofpie", "palette": "Analogous Shift", "pies": [ { "labels": ["Enterprise","SMB","Other"], "values": [60,30,10] }, { "labels": ["US","EU","APAC"], "values": [35,15,10] } ] }`

### `kpi` — single metric tile (the exec-snapshot building block)
Default size `340 × 180`. A card: label + big value + colored delta pill + palette accent.

| extra field | type | default | does |
|---|---|---|---|
| `label` | string | `""` | the metric name (top) |
| `value` | number | — | the big number |
| `valuePrefix` | string | `""` | e.g. `"$"` before the value |
| `delta` | number | none | the change; renders a pill — ▲ if positive, ▼ if negative |
| `deltaUnit` | string | `"%"` | unit on the delta |
| `deltaGoodWhen` | string | `"up"` | which direction is GOOD (green). Set `"down"` for lower-is-better metrics (churn, latency, cost) — the arrow still shows real direction, only the color flips |
| `sparkline` | number[] | none | a minimalist trend line along the bottom (e.g. the last N periods) — no axes/labels, colored to match the delta (green good / red bad). Needs ≥ 2 points; **landscape tile only**. Omit it and the tile is byte-identical. |

Minimal: `{ "type": "kpi", "label": "MRR", "value": 128400, "valuePrefix": "$", "delta": 12.4 }`

With a sparkline: `{ "type": "kpi", "label": "MRR", "value": 128400, "valuePrefix": "$", "delta": 12.4, "sparkline": [98,104,101,112,118,121,128] }`

### `cards` — a row/grid of stat cards (the multi-KPI dashboard strip)
A set of KPI tiles in one image — for an exec snapshot of several metrics at once.
Uses its own **`cards`** array (not `data`): each entry is one card, reusing the **same
fields as `kpi`**. Each card's accent cycles the palette by index; the delta pill follows
the same good/bad coloring (▲/▼ shows real direction, color shows good-or-bad). Layout is a
**bounded computed grid**: by default a single horizontal strip, wrapping to a grid once there
are more than 4 cards. Size auto-fits the grid unless you set `width`/`height`.

| field | type | default | does |
|---|---|---|---|
| `cards` | array | — (required) | the tiles; each: `label`, `value`, `valuePrefix`, `valueUnit`, `delta`, `deltaUnit`, `deltaGoodWhen` (same meaning as `kpi`) |
| `gridColumns` | number | min(cards, 4) | force the number of columns; cards wrap into rows |

Minimal: `{ "type": "cards", "cards": [ { "label": "MRR", "value": 128400, "valuePrefix": "$", "delta": 12.4 }, { "label": "Active users", "value": 8210, "delta": 3.1 }, { "label": "Churn", "value": 2.4, "valueUnit": "%", "delta": 0.6, "deltaGoodWhen": "down" } ] }`

### `layers` — labeled box-stack / layer diagram
A vertical stack of labeled blocks — a structure/architecture picture (e.g. a tech
stack, a hierarchy of tiers), **not** a stacked bar (no values, no axis). Uses its own
**`layers`** array (not `data`): each entry is `{ title, subtitle? }`, drawn top→bottom
as an equal-height rounded block. Each block fills a distinct palette color, cycling the
palette; the title (and optional subtitle) sit centered with **contrast-aware text**
(dark on light fills, white on dark). Inherits every universal field.

| field | type | default | does |
|---|---|---|---|
| `layers` | array | — (required) | the blocks, top to bottom; each: `title`, optional `subtitle` |

Minimal: `{ "type": "layers", "layers": [ { "title": "Application", "subtitle": "React + TypeScript" }, { "title": "API", "subtitle": "Node + Hono" }, { "title": "Engine", "subtitle": "render-core (pure SVG)" }, { "title": "Infra", "subtitle": "Railway + Docker" } ] }`

### `progress` — labeled progress / bullet bars
Labeled horizontal bars filling toward a target — for "how far along" readouts. Uses
its own **`bars`** array: each `{ label, value, target?, valueUnit? }`. The track end IS
the target, so the fill = `value / target`; the label shows `value / target`. With **no
`target`**, `value` is read as a percent (0–100) and the track end is 100%. Each bar a
palette color by index. Inherits every universal field.

| field | type | default | does |
|---|---|---|---|
| `bars` | array | — (required) | the bars; each: `label`, `value`, optional `target`, optional `valueUnit` |

Minimal: `{ "type": "progress", "bars": [ { "label": "Q1 revenue", "value": 82, "target": 100 }, { "label": "Signups", "value": 1240, "target": 2000 }, { "label": "Uptime", "value": 99.2, "valueUnit": "%" } ] }`

### `waffle` — waffle / dot grid
A 10×10 grid of cells showing part-of-whole — friendlier than a pie for "% complete" or
a simple mix. Uses its own **`parts`** array `{ label, value, color? }`: parts fill the
100 cells proportionally (largest-remainder rounding keeps the count exact). If the parts
sum to **less than 100**, the remainder are **empty track cells** — so **one part** is a
"% filled" gauge, and **several parts** is categorical part-to-whole. A `label · value`
legend sits beside the grid.

| field | type | default | does |
|---|---|---|---|
| `parts` | array | — (required) | the filled groups; each: `label`, `value` (cell count), optional `color` |

Minimal: `{ "type": "waffle", "parts": [ { "label": "Enterprise", "value": 45 }, { "label": "SMB", "value": 30 }, { "label": "Other", "value": 15 } ] }`

### `heatmap` — colored grid (rows × columns)
A grid of cells colored by value (light → dark on a single palette hue) — for "intensity
across two dimensions" (e.g. activity by day × hour). Uses its own 2D shape: **`rows`**
(row labels), **`columns`** (column labels), and **`values`** — a matrix where
`values[row][col]` is the cell value. Cell value text is contrast-aware; `showValues:false`
hides the numbers.

| field | type | default | does |
|---|---|---|---|
| `rows` | string[] | — (required) | row labels (one per matrix row) |
| `columns` | string[] | — (required) | column labels (one per matrix column) |
| `values` | number[][] | — (required) | the matrix, `values[row][col]` |

Minimal: `{ "type": "heatmap", "rows": ["Mon","Tue","Wed"], "columns": ["9a","12p","3p","6p"], "values": [[2,5,8,3],[1,4,9,6],[0,3,7,2]] }`

### `funnel` — stages narrowing top→bottom
A conversion/drop-off funnel. Uses its own **`stages`** array `{ label, value }`: each
stage is a centered band whose width is proportional to its value, tapering into the
next. Each band shows the label, the value, and its **% of the top stage**. Palette
color per stage; band text is contrast-aware.

| field | type | default | does |
|---|---|---|---|
| `stages` | array | — (required) | the stages top→bottom; each: `label`, `value` |

Minimal: `{ "type": "funnel", "stages": [ { "label": "Visitors", "value": 12000 }, { "label": "Signups", "value": 4200 }, { "label": "Trials", "value": 1800 }, { "label": "Paid", "value": 640 } ] }`

### `pyramid` — hierarchy levels
A triangle (apex on top) split into equal-height bands — for layered hierarchies
(Maslow-style, org tiers, strategy levels). Uses its own **`levels`** array
`{ title, value? }` (`label` is accepted as an alias for `title`). Each level a palette
color, label centered with contrast-aware text; `value` is shown beside the label if set.

| field | type | default | does |
|---|---|---|---|
| `levels` | array | — (required) | the levels, apex→base; each: `title`, optional `value` |

Minimal: `{ "type": "pyramid", "levels": [ { "title": "Vision" }, { "title": "Strategy" }, { "title": "Execution" }, { "title": "Operations" } ] }`

### `quadrant` — 2×2 matrix
Items placed by two dimensions (effort/impact, reach/ease, etc.). Uses its own **`items`**
array `{ label, x, y }` with `x`/`y` in **0–1** (x left→right, y bottom→top), plus
**`xAxis`** and **`yAxis`** labels. A square plot is split by a crosshair into four
quadrants; each item is a labeled dot (palette color by index).

| field | type | default | does |
|---|---|---|---|
| `items` | array | — (required) | the items; each: `label`, `x` (0–1), `y` (0–1) |
| `xAxis` | string | `""` | horizontal axis label |
| `yAxis` | string | `""` | vertical axis label |

Minimal: `{ "type": "quadrant", "xAxis": "Effort", "yAxis": "Impact", "items": [ { "label": "Quick win", "x": 0.2, "y": 0.8 }, { "label": "Big bet", "x": 0.8, "y": 0.9 }, { "label": "Time sink", "x": 0.8, "y": 0.2 } ] }`

### `timeline` — events along one line
A linear timeline. Uses its own **`events`** array `{ date?, label }`: events sit evenly
spaced along a horizontal line, the date by the line and the label **alternating
above/below** so they don't crowd. Keep labels short.

| field | type | default | does |
|---|---|---|---|
| `events` | array | — (required) | the events in order; each: optional `date`, `label` |

Minimal: `{ "type": "timeline", "events": [ { "date": "Q1", "label": "Launch" }, { "date": "Q2", "label": "Series A" }, { "date": "Q3", "label": "100k users" }, { "date": "Q4", "label": "Profitable" } ] }`

### `venn` — 2–3 overlapping sets
Overlapping translucent circles for set relationships. Uses its own **`sets`** array
`{ label, value }` (2 or 3 sets; fixed layout — 2 side-by-side, 3 in a triangle) plus an
optional **`overlap`** count (2-set), shown in the lens. Each circle is labeled with its
value.

| field | type | default | does |
|---|---|---|---|
| `sets` | array | — (required) | 2–3 sets; each: `label`, `value` |
| `overlap` | number | — | (2 sets) the count shared by both, drawn in the overlap |

Minimal: `{ "type": "venn", "sets": [ { "label": "Design", "value": 120 }, { "label": "Engineering", "value": 160 } ], "overlap": 40 }`

### `matrix` — comparison / feature matrix
A rows × columns table of ✓/✗ (the pricing/feature-comparison look). Uses its own shape:
**`columns`** (string[]) + **`rows`** `{ label, cells[] }` (one cell per column). Each cell is
a **boolean** or **status word** → a glyph (`true`/`"yes"` ✓ green, `false`/`"no"` ✗ grey,
`"partial"` • amber, `""`/`"-"` dash), or any other string → rendered as **text** (e.g. a
plan limit). Rows zebra-stripe for readability. `labelWidth` sets the row-label column width.

| field | type | default | does |
|---|---|---|---|
| `columns` | string[] | — (required) | the column headers |
| `rows` | array | — (required) | each: `label`, `cells[]` (boolean / status word / text, aligned to columns) |
| `labelWidth` | number | `200` | px reserved for the row-label column |

Minimal: `{ "type": "matrix", "columns": ["Free","Pro","Enterprise"], "rows": [ { "label": "SSO / SAML", "cells": [false,false,true] }, { "label": "API access", "cells": [false,true,true] }, { "label": "Priority support", "cells": [false,"partial",true] }, { "label": "Seats", "cells": ["1","10","Unlimited"] } ] }`

### `checklist` — checklist / status list
A vertical list of items each with a status glyph — for run-of-show / readiness lists. Uses
its own **`items`** array `{ label, status }`: **`done`** ✓ (green, label mutes), **`blocked`**
✗ (red), **`partial`** • (amber), anything else (or `pending`) → an empty ring.

| field | type | default | does |
|---|---|---|---|
| `items` | array | — (required) | each: `label`, `status` (`done`/`pending`/`blocked`/`partial`) |

Minimal: `{ "type": "checklist", "title": "Launch checklist", "items": [ { "label": "Domain transferred", "status": "done" }, { "label": "API deployed", "status": "done" }, { "label": "Load testing", "status": "pending" }, { "label": "Billing live", "status": "blocked" } ] }`

### `iconarray` — icon array / pictogram
`total` person icons with the first `filled` colored and the rest faint — a friendly
part-of-whole ("7 of 10 teams onboarded"). `perRow` controls wrapping.

| field | type | default | does |
|---|---|---|---|
| `total` | number | `10` | total icons |
| `filled` | number | `0` | how many are filled (the rest faint) |
| `perRow` | number | `min(total,10)` | icons per row before wrapping |

Minimal: `{ "type": "iconarray", "title": "Teams onboarded (7/10)", "total": 10, "filled": 7 }`

### `steps` — step / process row
Numbered nodes left→right joined by connector arrows — a **linear** process flow (not a
branching graph). Uses its own **`steps`** array `{ label, description? }`: each step is a
numbered palette circle with its label (and optional description) beneath. Positions are
computed directly; no graph layout.

| field | type | default | does |
|---|---|---|---|
| `steps` | array | — (required) | the steps in order; each: `label`, optional `description` |

Minimal: `{ "type": "steps", "steps": [ { "label": "Sign up" }, { "label": "Connect data" }, { "label": "Build chart" }, { "label": "Share" } ] }`

### `table` — data table (rows × columns)
A plain tabular grid of text/values (the general tabular type; `matrix` is the ✓/✗ variant).
Uses its own shape: **`columns`** (string[] header) + **`rows`** (an array of **cell arrays**).
Numbers right-align and format with thousands separators; text left-aligns. Header rule +
zebra rows.

| field | type | default | does |
|---|---|---|---|
| `columns` | string[] | — (required) | the header cells |
| `rows` | array | — (required) | each row is an array of cells (string or number), aligned to columns |

Minimal: `{ "type": "table", "columns": ["Region","Q1","Q2","Q3"], "rows": [ ["North",420,510,480], ["South",310,290,350], ["East",530,560,600] ] }`

### `gauge` — radial dial (single value)
A 180° dial showing one value on a `min`..`max` scale — for "how full / how far" readouts. The
arc band fills to the value; the number sits in the center with `min`/`max` at the ends.

| field | type | default | does |
|---|---|---|---|
| `value` | number | — (required) | the value to show |
| `min` | number | `0` | scale minimum |
| `max` | number | `100` | scale maximum |
| `label` | string | `""` | caption under the value |
| `valueUnit` | string | `""` | appended to the value |

Minimal: `{ "type": "gauge", "label": "CPU load", "value": 72, "valueUnit": "%" }`

### `bullet` — bullet graph
A compact measure-vs-target gauge (Stephen Few style): a thin measure bar over grey
qualitative bands, with a target tick — richer than `progress`. Uses its own **`bars`** array
`{ label, value, target, max, bands }`, where `bands` are the threshold edges (e.g. `[150,225]`)
that shade the background into qualitative ranges.

| field | type | default | does |
|---|---|---|---|
| `bars` | array | — (required) | each: `label`, `value`, optional `target` (tick), `max` (scale), `bands` (range edges) |

Minimal: `{ "type": "bullet", "bars": [ { "label": "Revenue", "value": 275, "target": 250, "max": 300, "bands": [150,225] }, { "label": "Profit", "value": 82, "target": 100, "max": 120, "bands": [60,90] } ] }`

### `calendar` — calendar heatmap (year grid)
A GitHub-style contribution grid: weeks across, days down, each day a cell colored light→dark by
value on one palette hue. Uses **`days`** — a map of `"YYYY-MM-DD" → value` — plus **`year`**.
Weekday placement is computed arithmetically (no clock), so it's fully deterministic.

| field | type | default | does |
|---|---|---|---|
| `days` | object | — (required) | `"YYYY-MM-DD"` → number (the value for that day) |
| `year` | number | `2025` | which year the grid covers (sets leap year + start weekday) |

Minimal: `{ "type": "calendar", "title": "Activity", "year": 2025, "days": { "2025-01-06": 3, "2025-03-14": 8, "2025-07-21": 5 } }`

### `leaderboard` — ranked rows
A ranked list: each row is rank # + label + a bar (∝ value) + the value, **auto-sorted
descending**. Uses its own **`items`** array `{ label, value }`.

| field | type | default | does |
|---|---|---|---|
| `items` | array | — (required) | each: `label`, `value` (sorted high→low, numbered) |

Minimal: `{ "type": "leaderboard", "title": "Top regions", "items": [ { "label": "North", "value": 530 }, { "label": "South", "value": 480 }, { "label": "East", "value": 610 }, { "label": "West", "value": 390 } ] }`

### `callout` — hero stat + caption + annotation
An editorial single-stat: a big `value` (with `valuePrefix`/`valueUnit`), a `caption` line under
it, and an optional `note` pill on the right. The reports/social cousin of `kpi`.
| field | type | does |
|---|---|---|
| `value` | number | the hero number |
| `caption` | string | the line under it |
| `note` | string | optional annotation pill |

Minimal: `{ "type": "callout", "value": 3.4, "valueUnit": "×", "caption": "faster than last quarter", "note": "vs Q1" }`

### `ring` — radial % toward a target
A compact donut-arc badge showing `value / target` as a percent in the center.
| field | type | does |
|---|---|---|
| `value` | number | current value |
| `target` | number | the goal (default 100) |
| `label` | string | optional caption below |

Minimal: `{ "type": "ring", "value": 70, "target": 100, "label": "Goal" }`

### `versus` — two options compared
Two mirrored columns with a VS badge between. Uses **`sides`** (exactly two): each `{ title, items[] }`,
each item `{ label, value? }`.

Minimal: `{ "type": "versus", "sides": [ { "title": "Plan A", "items": [ { "label": "Price", "value": 9 } ] }, { "title": "Plan B", "items": [ { "label": "Price", "value": 29 } ] } ] }`

### `gantt` — tasks across a time row
Schedule bars on a **self-contained** time layout (NOT the numeric axis). Uses **`tasks`**:
each `{ label, start, end }` (positions on the timeline).

Minimal: `{ "type": "gantt", "tasks": [ { "label": "Design", "start": 0, "end": 3 }, { "label": "Build", "start": 2, "end": 7 } ] }`

### `waterfall` — running total, step by step
Floating bars showing how a `start` becomes an end through signed deltas, with a final total bar.
Uses **`steps`** `{ label, value }` (value = the signed delta); up green, down red, total dark.
**Each bar is labeled with its magnitude** (the signed delta above increases, below decreases;
the total above its bar) — on by default; set `showValues:false` to hide them (the bars +
connectors remain). Dashed connectors carry the running total bar-to-bar. **`label` is the step
NAME only** — the engine renders the number for you, so don't embed the value in the label text.

Minimal: `{ "type": "waterfall", "start": 0, "steps": [ { "label": "Q1", "value": 50 }, { "label": "Q2", "value": 30 }, { "label": "Q3", "value": -20 } ] }`

### `swimlane` — lanes × phases roadmap
A bounded grid: **`phases`** (column headers) × **`lanes`** (rows), each lane's `items` placed in a
`phase` column. Distinct from a routed flowchart.

Minimal: `{ "type": "swimlane", "phases": ["Q1","Q2","Q3"], "lanes": [ { "label": "Eng", "items": [ { "phase": 0, "label": "API" }, { "phase": 2, "label": "v2" } ] } ] }`

### `tierlist` — ranked buckets of chips
S/A/B-style rows: each tier a colored label box + its `items` as chips. Uses **`tiers`** `{ label, color?, items[] }`.

Minimal: `{ "type": "tierlist", "tiers": [ { "label": "S", "items": ["Bar","Line"] }, { "label": "A", "items": ["Pie"] } ] }`

### `swot` — four labeled 2×2 cells
Four tinted cells, each a heading + a short bullet list (single-line items). Uses **`cells`** (up to 4)
`{ title, items[] }`.

Minimal: `{ "type": "swot", "cells": [ { "title": "Strengths", "items": ["Fast","Cheap"] }, { "title": "Weaknesses", "items": ["New brand"] }, { "title": "Opportunities", "items": ["AI demand"] }, { "title": "Threats", "items": ["Incumbents"] } ] }`

### `dashboard` — tile many charts into one image
The composition layer: lays out **other charts** on a grid and rasterizes them in a single pass
(one nested SVG → one PNG). Uses **`tiles`** `{ chart, span? }` — each `chart` is a **complete spec
of any other type** (the same object you'd render standalone), and `span` is `[colspan, rowspan]`
(default `[1,1]`). Optional **`layout`** `{ cols?, gap?, pad?, tileWidth?, tileHeight? }` (cols
default 3). Board-level `title`, `palette`, `font`, and `background` cascade to any tile that
doesn't set its own; per-tile watermarks are suppressed in favor of one board watermark. A wide
chart can span two columns, a tall one two rows. Each tile keeps its OWN scale — a mixed dashboard
needs that; to compare the SAME metric on one shared scale, use a single grouped/multi-series chart
(or separate boards), not side-by-side tiles.

Minimal: `{ "type": "dashboard", "layout": { "cols": 2 }, "tiles": [ { "chart": { "type": "kpi", "label": "Revenue", "value": 128400, "valuePrefix": "$", "delta": 12.4 } }, { "chart": { "type": "bar", "data": { "labels": ["A","B","C"], "series": [ { "name": "Sales", "values": [8,5,3] } ] } } } ] }`

## What an agent can change (the levers)

- **Fonts** → `fontFamily`, `fontSize`
- **Colors** → `palette` (a named set) for the whole chart, or `data.series[].colors` for exact
  per-item control. The info-design types take **explicit per-element color** the same way: add a
  `color` to any element object — `cards[].color`, `layers[].color`, `bars[].color` (progress/
  bullet), `stages[].color`, `levels[].color`, `items[].color` (quadrant/leaderboard),
  `events[].color`, `sets[].color`, `steps[].color`, `parts[].color` (waffle). The single-accent /
  gradient types take a **top-level `color`** — the `gauge` arc, `iconarray` filled icons, and the
  `heatmap`/`calendar` ramp hue. Omit it and color comes from the palette (contrast-aware text
  adapts to whatever fill you choose). (`matrix`/`checklist` glyphs stay semantic — no override.)
- **Background** → `background` (any hex, or `"transparent"`)
- **Size / aspect** → `width`, `height`
- **Branding** → `watermark` (off for the sites, on for free-tier API output)

## Rules for the engine (and any agent generating specs)

- **Deterministic:** the same spec always produces the exact same SVG bytes. No
  randomness, no time. Safe to cache and snapshot-test.
- **Defaults are good:** never require a field that has a sensible default. Emit the
  smallest spec that expresses the intent; the engine makes it beautiful.
- **Unknown `type` is an error** — only documented types render.

## Roadmap
More chart types (line, area, stacked, pie, …) register in `renderSpec`; each inherits
every universal field above and gets its own row here. This document becomes a formal
JSON Schema when the MCP server is built, so the `render_chart` tool can validate specs
and an LLM can read the field contract directly.
