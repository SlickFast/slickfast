# SlickFast — charts & dashboards for AI agents

SlickFast turns a small JSON spec into a polished, retina-quality chart — **47 chart and
information-design types** (bar, line, pie, KPI, cards, funnel, gauge, heatmap, calendar,
gantt, waterfall…), plus **multiple charts tiled into a single dashboard image in one call**.
It runs as an [MCP](https://modelcontextprotocol.io) tool, so an AI agent hands it a spec and
gets back a finished PNG (or SVG). Everything renders **locally** — nothing leaves your machine.

```txt
render_chart({ type: "bar", data: { labels: ["Q1","Q2","Q3"], series: [{ values: [12,19,8] }] } })
  → a retina PNG, rendered on your machine
```

## Why it's built for agents

- **Deterministic — same spec, same bytes, forever.** No randomness, no timestamps, no
  headless-browser drift. Outputs are **cacheable, testable, and reproducible**, with zero
  flaky pixel diffs. Almost no charting tool can promise this — and it's exactly what a
  tool-calling agent needs.
- **Never throws garbage at the model.** Empty data, a bad tile, a filtered-to-nothing series →
  a clean, graceful frame, not a crash or a stack trace. Reliability is a feature when the
  caller is an agent, not a human who can eyeball the error.
- **Fails loud on real mistakes.** An unknown palette or enum is *rejected* with a clear error
  listing the valid options — so the agent fixes it immediately instead of silently shipping the
  wrong-looking chart.
- **Good-looking by default.** A spec of just `{type, data}` renders a complete, well-designed
  chart; fonts, colors, palettes, and size are optional overrides.
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
  prefilled email link you click to send — SlickFast sends nothing itself.

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
  **artifacts** (claude.ai, Claude Desktop), the agent renders that SVG directly in an artifact and
  it **paints reliably**. Ask for a chart and Claude does this — no config, no gymnastics.
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
or post** — it never auto-inserts links. (The endpoint stays unadvertised during soft-launch.)

## License

**AGPL-3.0-only.** Free to use, self-host, and embed under the AGPL's terms (your friends
running it locally are completely unaffected). Building it into a **closed-source product
or a hosted service**? That needs the AGPL'd source opened — or a **commercial license**
from us instead. Reach out for commercial terms.

## Developing locally

Clone the repo, then from the package directory:

```bash
cd apps/mcp
npm install
node test-client.mjs   # spawns the server, calls render_chart, checks the output
```

To point an MCP client at a local checkout instead of the published package, use
`"command": "node", "args": ["<path-to-clone>/apps/mcp/server.mjs"]`.
