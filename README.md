# SlickFast

**Charts & dashboards for AI agents. A tiny JSON spec in → a finished, retina-quality chart
out. Milliseconds, a handful of tokens, nothing leaves your machine.**

SlickFast is a **native SVG engine built for AI agents** — not a browser screenshotting a
webpage, not a plotting library an agent has to write code against. A pure
`spec → SVG → PNG` pipeline: **47 chart and information-design types** (bar, line, pie, KPI,
cards, funnel, gauge, heatmap, calendar, gantt, waterfall…), plus **entire multi-chart
dashboards tiled into one image in a single call**.

- **npm (MCP server):** [`@slickfast/mcp`](https://www.npmjs.com/package/@slickfast/mcp)
- **Website:** [slickfast.com](https://slickfast.com)
- **Bugs & feature requests:** [GitHub Issues](https://github.com/SlickFast/slickfast/issues)
- **Email:** feedback@slickfast.com

## This project's pulse — a LIVE chart, right here in the README

The dashboard below is **not a screenshot**. It's a SlickFast **live chart**: a permanent
image URL whose numbers update on their own. A scheduled job pushes fresh stats; every
visitor sees current data. [Live Charts](https://slickfast.com) — embed once, update forever.

![SlickFast live pulse — real project stats, updating automatically](https://api.slickfast.com/live/7eb0085dd74015764d54ec73ce4ee8bf.svg)

## Prove it yourself

Don't take the speed or determinism claims on faith — run the benchmark on your own machine:

```bash
git clone https://github.com/SlickFast/slickfast && cd slickfast
node scripts/bench.mjs
```

It renders all 47 chart types, times each, runs a 10,000-chart throughput burst, and
double-renders everything to verify byte-identical output. On an M1 Max: **median 15µs per
chart, ~140,000 renders/sec, 47/47 deterministic.** Your numbers are your numbers.

## Quick start (MCP)

**One-click:**
[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=slickfast&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzbGlja2Zhc3QvbWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_SlickFast_MCP-0098FF?style=for-the-badge&logo=githubcopilot&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=slickfast&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40slickfast%2Fmcp%22%5D%7D)


Add to your MCP client config (Claude Code, Claude Desktop, Cursor, …):

```json
{
  "mcpServers": {
    "slickfast": {
      "command": "npx",
      "args": ["-y", "@slickfast/mcp"]
    }
  }
}
```

Then ask your agent for a chart — or ask it to *"show me a SlickFast demo"* (the `gallery`
tool renders a curated showcase). Full tool documentation is in
[`apps/mcp/README.md`](apps/mcp/README.md).

## Why agents (and the people paying for their tokens) pick SlickFast

- **Tokens are the real cost — a spec is nearly free.** An agent hand-writing SVG or
  matplotlib code burns hundreds to thousands of output tokens, then often retries when it
  doesn't render. A SlickFast spec is a few dozen tokens, and `{type, data}` alone is a
  finished, well-designed chart. A whole dashboard is **one tool call**, not ten renders
  and layout math.
- **Changes are one-field edits.** Swap `bar` → `line`, change a palette, resize for a
  slide: edit one key, re-render — no code to rewrite, no diff to reason about.
- **No headless browser.** Most chart-to-image pipelines secretly spawn Puppeteer or
  Playwright — hundreds of MB, slow cold starts, flaky output. SlickFast renders pure
  in-memory, milliseconds per chart.
- **Native SVG, vector-first.** Output is a few KB of crisp-at-any-scale SVG (or retina PNG
  on demand) — small enough to cache, embed, or ship anywhere.
- **Deterministic — same spec, same chart, every time.** No randomness, no timestamps, no
  browser drift. Cacheable, testable, reproducible; zero flaky pixel diffs.
- **Graceful on empty data, loud on real mistakes.** Bad input gets a clear, listed-options
  error the agent can self-correct from; missing data gets a clean frame — never a stack
  trace at the model.
- **Local & private.** Rendering and rasterization happen on your machine.

## What's in this repo

| Path | What it is |
| --- | --- |
| `packages/render-core/` | The engine: pure `(spec) → SVG string`. All 47 types, the type registry, `SPEC.md` (the spec contract), examples, gallery, and the golden snapshot net. |
| `packages/palette-core/` | The color library: palettes, nested themes, WCAG contrast, tokens. |
| `packages/raster/` | SVG → PNG rasterization (resvg). |
| `packages/fonts/` | The swappable font layer. |
| `apps/mcp/` | The MCP server published as `@slickfast/mcp` — a thin surface over the engine. |
| `apps/api/` | The hosted HTTP API — [`API.md`](apps/api/API.md) is the how-to-call-it guide (no MCP needed: `curl`, `<img src>`, any language), [`openapi.yaml`](apps/api/openapi.yaml) the machine-readable contract. Live at `api.slickfast.com`; free tier at [slickfast.com](https://slickfast.com). |
| `scripts/` | The safety net: golden checks, registry-drift check, 323-case torture suite, palette hex check. |
| `templates/` | Ready-made spec presets. |

## Build & verify from source

```bash
cd apps/mcp && npm install && npm run build     # builds dist/index.js
cd ../../packages/raster && npm install          # native resvg binding (PNG)

# from the repo root — the full safety net:
node packages/render-core/generate.mjs --check   # golden snapshots (all types)
node scripts/check-surfaces.mjs                  # type-registry drift check
node scripts/torture.mjs                         # 323 empty/edge-case renders
node scripts/check-palettes.mjs                  # palette hex validation
```

The engine is pure and deterministic by contract: no IO, no `Date.now()`, no
`Math.random()` in drawing code, and **nothing ships without a snapshot test**.

## Contributing

- **Bug reports and feature requests are the best way to contribute** — please use the
  [issue templates](https://github.com/SlickFast/slickfast/issues/new/choose). The MCP's
  built-in `report_issue` tool writes a ready-to-paste report for you.
- Day-to-day development happens in an internal tree and releases are published here, so a
  PR may be ported in rather than merged directly — you'll be credited either way. For
  anything non-trivial, open an issue first so we can agree on the shape.

## License

[AGPL-3.0-only](LICENSE). You can use, self-host, and modify SlickFast freely; if you run a
modified version as a network service, the AGPL requires you to share your changes. For a
commercial license or the hosted API, see [slickfast.com](https://slickfast.com) or write to
feedback@slickfast.com.
