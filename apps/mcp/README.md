# SlickFast — charts & dashboards for AI agents

**A tiny JSON spec in → a finished, retina-quality chart out. Milliseconds, a handful of
tokens, nothing leaves your machine.**

SlickFast is a **native SVG engine built for AI agents** — not a browser screenshotting a
webpage, not a plotting library an agent has to write code against. A pure
`spec → SVG → PNG` pipeline: **47 chart and information-design types** (bar, line, pie, KPI,
cards, funnel, gauge, heatmap, calendar, gantt, waterfall…), plus **entire multi-chart
dashboards tiled into one image in a single call**. It runs as an
[MCP](https://modelcontextprotocol.io) tool, so an agent hands it a spec and gets back a
finished PNG (or SVG).

```txt
render_chart({ type: "bar", data: { labels: ["Q1","Q2","Q3"], series: [{ values: [12,19,8] }] } })
  → a retina PNG, rendered on your machine
```

## Why agents (and the people paying for their tokens) pick SlickFast

- **Tokens are the real cost — a spec is nearly free.** An agent hand-writing SVG or
  matplotlib code burns hundreds to thousands of output tokens, then often retries when it
  doesn't render. A SlickFast spec is a few dozen tokens, and `{type, data}` alone is a
  finished, well-designed chart. A whole dashboard is **one tool call**, not ten renders
  and layout math.
- **Changes are one-field edits.** Swap `bar` → `line`, change a palette, resize for a
  slide: edit one key, re-render. The agent never rewrites code or reasons about a diff —
  which is what makes iteration with a human ("make it dark, bigger title") actually cheap.
- **No headless browser.** Most chart-to-image pipelines secretly spawn Puppeteer or
  Playwright — hundreds of MB, slow cold starts, flaky output. SlickFast renders pure
  in-memory, milliseconds per chart.
- **Native SVG, vector-first.** Output is a few KB of crisp-at-any-scale SVG (or retina PNG
  on demand) — small enough to cache, embed, or ship anywhere.
- **Deterministic — same spec, same chart, every time.** No randomness, no timestamps, no
  browser drift. Cacheable, testable, reproducible; zero flaky pixel diffs. Almost no
  charting tool can promise this — and it's exactly what a tool-calling agent needs.
- **Never throws garbage at the model.** Empty data, a bad tile, a filtered-to-nothing
  series → a clean, graceful frame, not a crash or a stack trace. A real mistake (unknown
  palette, bad enum) → a **loud error listing the valid options**, so the agent
  self-corrects in one step.
- **100% local & private.** Rendered and rasterized on your machine. Nothing is sent anywhere.

## Tools

- **`render_chart(spec)`** → the chart as a PNG image (default) or SVG (`format: "svg"`). For a
  dashboard, pass `type: "dashboard"` with `tiles: [{ chart, span }]` — each tile is a full spec
  of any other type, composited into one image in a single render.
- **`describe_type(type)`** → the exact data shape, a minimal working spec, and per-type
  gotchas. Call it first when you're unsure how to structure a type.
- **`gallery()`** → a curated demo gallery of example charts and dashboards — each as a
  rendered image plus its spec. Just ask *"show me a demo"* or *"what can you make?"*.
  `gallery({board:"comparison"})` tiles a whole family into one image; `board:"all"` shows
  every type across 6 boards.
- **`list_palettes()`** → every valid `palette` name, grouped into flat palettes and nested
  themes, with their colors. Ask *"what palettes are available?"*.
- **`report_issue(summary, spec?)`** → *"report this bug."* Formats a bug report and returns a
  prefilled GitHub-issue link and email link you click to send — SlickFast sends nothing itself.

## Install

Add to your MCP config and restart — it runs locally via `npx`, no clone or build needed:

```json
{ "mcpServers": { "slickfast": { "command": "npx", "args": ["-y", "@slickfast/mcp"] } } }
```

- **Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit Config)
- **Claude Code** — project `.mcp.json` at the workspace root
- **claude.ai** — connector settings

Then ask it to *"render a bar chart of last quarter's revenue"* or *"build a dashboard with an
MRR tile, a signups funnel, and a usage heatmap."*

## Seeing your charts (the reliable way to display them)

Rendering is always **local** — nothing leaves your machine. This section is purely about which
surface *displays* the result. `render_chart` returns two ways, and they differ a lot:

- **`format:"svg"` → the reliable inline path.** Returns SVG *text*. In a chat surface that supports
  **artifacts** (claude.ai, Claude Desktop), the agent **creates an artifact containing that SVG**
  and presents it — that's the display step; the SVG string in the tool result is not user-visible
  on its own. Ask for a chart and Claude does this — no config, no gymnastics.
- **`format:"png"` (default) → a base64 image block.** It only paints where the client renders MCP
  image blocks, which is **inconsistent across surfaces** — many chat UIs, and every coding/terminal
  view, don't. Don't depend on it for inline display.

**Other ways to get the picture:**
- **Share/embed anywhere** (Slack, email, a webpage) → the hosted **API** returns a public
  `…/chart.png?spec=…` URL that renders everywhere, independent of any MCP client.
- **Local stdio install** (the MCP shares your disk) → pass **`outputPath`** to write the PNG/SVG to
  disk and open the file. In a hosted/sandboxed MCP the process is filesystem-isolated (a saved file
  is invisible to you) — use the SVG-artifact path instead.

**If you asked for a chart and see nothing:** it *rendered* (the agent can read you the values) —
it's a *display*-surface gap, not a bug. Have the agent re-render with **`format:"svg"` into an
artifact**, or view it in a claude.ai / Claude Desktop chat. If the tool is missing or erroring
entirely, that's a connection problem — restart so the MCP server reconnects.

## Sharing a chart as a URL (hosted API)

Rendering is fully local and needs no network. Separately, SlickFast runs a **hosted API**
that turns a spec into a public `…/chart.png?spec=<url-encoded spec>` link — useful for
embedding, posting to Slack/X/email, or getting a chart into a surface that can't display a
local image (see the table above). The agent should **offer this only when you ask to share
or post** — it never auto-inserts links. Get an API key (free tier, no card) at
[slickfast.com](https://slickfast.com).

## License

**AGPL-3.0-only.** Free to use, self-host, and embed under the AGPL's terms (your friends
running it locally are completely unaffected). Building it into a **closed-source product
or a hosted service**? That needs the AGPL'd source opened — or a **commercial license**
from us instead. Write to feedback@slickfast.com for commercial terms.

## Feedback, bugs & feature requests

- **GitHub:** [SlickFast/slickfast](https://github.com/SlickFast/slickfast) — bug reports and
  feature requests via the [issue templates](https://github.com/SlickFast/slickfast/issues/new/choose).
- **Email:** feedback@slickfast.com
- Or ask your agent to *"report this as a SlickFast issue"* — the `report_issue` tool drafts
  the report (with the repro spec) for you. Nothing is ever sent automatically.

## Developing locally

Clone [the repo](https://github.com/SlickFast/slickfast), then from the package directory:

```bash
cd apps/mcp
npm install
node test-client.mjs   # spawns the server, calls render_chart, checks the output
```

To point an MCP client at a local checkout instead of the published package, use
`"command": "node", "args": ["<path-to-clone>/apps/mcp/server.mjs"]`.
