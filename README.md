# SlickFast

**Charts & dashboards for AI agents.** A small JSON spec in → a polished, retina-quality
chart out — **47 chart and information-design types** (bar, line, pie, KPI, cards, funnel,
gauge, heatmap, calendar, gantt, waterfall…), plus **multiple charts tiled into a single
dashboard image in one call**. Deterministic, dependency-light, and 100% local.

- **npm (MCP server):** [`@slickfast/mcp`](https://www.npmjs.com/package/@slickfast/mcp)
- **Website:** [slickfast.com](https://slickfast.com)
- **Bugs & feature requests:** [GitHub Issues](https://github.com/SlickFast/slickfast/issues)
- **Email:** feedback@slickfast.com

## Quick start (MCP)

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

## Why agents like it

- **Deterministic — same spec, same bytes, forever.** No randomness, no timestamps, no
  headless-browser drift. Outputs are cacheable, testable, reproducible.
- **Graceful on empty data, loud on real mistakes.** Bad input gets a clear, listed-options
  error; missing data gets a clean frame — never a stack trace at the model.
- **Good-looking by default.** `{type, data}` alone renders a finished, well-designed chart.
- **Local & private.** Rendering and rasterization happen on your machine.

## What's in this repo

| Path | What it is |
| --- | --- |
| `packages/render-core/` | The engine: pure `(spec) → SVG string`. All 47 types, the type registry, `SPEC.md` (the spec contract), examples, gallery, and the golden snapshot net. |
| `packages/palette-core/` | The color library: palettes, nested themes, WCAG contrast, tokens. |
| `packages/raster/` | SVG → PNG rasterization (resvg). |
| `packages/fonts/` | The swappable font layer. |
| `apps/mcp/` | The MCP server published as `@slickfast/mcp` — a thin surface over the engine. |
| `apps/api/openapi.yaml` | The hosted HTTP API contract. |
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
