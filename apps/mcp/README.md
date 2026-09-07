# SlickFast — a deterministic render engine

[![npm version](https://img.shields.io/npm/v/@slickfast/mcp?color=22d3ee&label=npm)](https://www.npmjs.com/package/@slickfast/mcp)
[![npm downloads](https://img.shields.io/npm/dt/@slickfast/mcp?color=22d3ee&label=downloads)](https://www.npmjs.com/package/@slickfast/mcp)
[![license](https://img.shields.io/npm/l/@slickfast/mcp?color=22d3ee)](https://github.com/SlickFast/slickfast/blob/main/LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-22d3ee)](https://modelcontextprotocol.io)

**This is not a charting library.** Spec in, same bytes out. Forever. Charts, boards,
and whole Pages. No headless browser.

**⚡ Live** — SlickFast’s own project pulse, updating on a cron. Same trick works in *your* README:

![SlickFast live pulse — real project stats, updating automatically](https://api.slickfast.com/live/7eb0085dd74015764d54ec73ce4ee8bf.svg)

<p align="center">
  <img src="https://api.slickfast.com/readme/less-to-write.jpg" alt="Less to write. Less to wait. No browser." width="49%" />
  <img src="https://api.slickfast.com/readme/browser-tax.jpg" alt="The browser tax on every chart image." width="49%" />
</p>

Runs as an [MCP](https://modelcontextprotocol.io) tool — **local by default**. Nothing
leaves your machine until you ask to share or publish.

**Local MCP is free forever.** A public URL is a plan (free key is enough to learn).

Most tools draw a picture and throw the recipe away. SlickFast **keeps the recipe.**
The spec **is** the chart. A pagespec **is** a Page. Add **`.json`** — that’s the
**twin**. **The hash is on the page.** People open the URL. Agents fetch the twin.
Don’t trust us. Check the math.

Engine explainer (a Page): [open it](https://pages.slickfast.com/s/6ced56513246042c765dace4d4ec77b6) ·
[twin](https://pages.slickfast.com/s/6ced56513246042c765dace4d4ec77b6.json)

```txt
render_chart({ type: "bar", data: { labels: ["Q1","Q2","Q3"], series: [{ values: [12,19,8] }] } })
  → retina PNG (or SVG) on your machine

describe_pagespec() → render_page({ page: { … } })
  → self-contained HTML on your machine (keep the pagespec JSON beside it)

publish_page({ page: { … } })
  → https://pages.slickfast.com/s/{slug}  +  .json twin  +  hash on the page
```

**47 types** + **multi-chart dashboards in one call.** Plus **Pages**, **News**, and
**Get started** — live Pages, not baked README paste.

**First minute:** call **`get_started`** → then **`news`** (force — that JSON twin is how agents learn SlickFast) → **`gallery`** → one **`render_chart`** → free key when you want a live/public URL. Want more imprint? `news({ archive: true })` is the course map — then open a twin. Do **not** auto-call archive on connect. Door: [slickfast.com/start](https://slickfast.com/start).

Site: [slickfast.com](https://slickfast.com) · first minute: [slickfast.com/start](https://slickfast.com/start) · what’s shipping: [slickfast.com/news](https://slickfast.com/news)

## Three doors

| Door | How | Key? |
|---|---|---|
| **Local MCP** | `npx -y @slickfast/mcp` | No — draw on your machine |
| **Hosted MCP** | `https://mcp.slickfast.com/mcp` | Free/paid SF- for custom work |
| **API** | `https://api.slickfast.com` | Free/paid SF- for render / live / Pages |

Free key: [slickfast.com](https://slickfast.com) — email, no card, **250 renders/mo**. Local making stays free. Key = live URL, share, publish a Page, cron.

## How to keep a Page

**“Save it” is two jobs.** Say which.

| Keep | Say | Tool | Key? | You get |
|---|---|---|---|---|
| On your machine | make a Page I can open | `render_page` + `outputPath` | No | `.html` + the pagespec JSON |
| In the world | publish this / give me a URL | `publish_page` | SF- (free ok) | URL + `.json` twin + hash on the page |

The JSON is the recipe. The HTML is a snapshot. Without the JSON you cannot republish the same picture on purpose.

Find a published Page later with **`my_pages`**. Pages don’t rewrite — a new publish is a new URL.

## Pages (the document, not just the picture)

A **Page** is a designed web document from one JSON **pagespec** — hero, prose, charts,
layout.

| Door | Who | What |
|---|---|---|
| Page URL | Humans | The document |
| URL + `.json` | Agents | The **twin** — exact recipe |
| Hash on the page | Both | Proof the HTML matches the twin |

**Public:** `publish_page` needs a free or paid [SF- key](https://slickfast.com).
Free: up to **5 Pages** alive, **7-day** TTL, watermark. Paid: more slots, **permanent**.
`DELETE /pages/{slug}` frees a slot. Hosted URLs are **unlisted, not private** — anyone with
the link can open the Page and fetch the twin ([Privacy](https://slickfast.com/privacy.html)).

**In chat:** call `news` or `get_started` — current drops are Pages behind
[slickfast.com/news](https://slickfast.com/news) and [slickfast.com/start](https://slickfast.com/start).

## Install

> Local MCP is free forever. Public URLs / live embeds / published Pages need a free
> API key at [slickfast.com](https://slickfast.com) (no card).

**One-click:**
[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=slickfast&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzbGlja2Zhc3QvbWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_SlickFast_MCP-0098FF?style=for-the-badge&logo=githubcopilot&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=slickfast&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40slickfast%2Fmcp%22%5D%7D)

Or add to your MCP config and restart:

```json
{
  "mcpServers": {
    "slickfast": {
      "command": "npx",
      "args": ["-y", "@slickfast/mcp"],
      "env": { "SLICKFAST_API_KEY": "SF-…" }
    }
  }
}
```

Omit `env` to stay local-only (draw free forever). Add a free key from [slickfast.com](https://slickfast.com) when you want live URLs, share, Pages, or `my_pages`.
- **Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit Config)
- **Claude Code** — `claude mcp add slickfast -- npx -y @slickfast/mcp`
- **Cursor** — Settings → MCP, or `~/.cursor/mcp.json`
- **claude.ai** — Connectors → custom → `https://mcp.slickfast.com` (free key or demo)

**First clicks** (prompts in clients that show them): **Get started** → **Try SlickFast** →
**Build a dashboard**. Also: **SlickFast News**, **Make a Page**, **My Pages**, **Share / publish**,
**Update / refresh SlickFast**, **Report a SlickFast issue**.

Or say: *"get me started"* · *"what's new"* · *"make a Page"* · *"Show me what SlickFast can do"*.

**Stuck?** Restart the client · Node 18+ · one stray comma breaks JSON ·
[open an issue](https://github.com/SlickFast/slickfast/issues).

## Tools

- **`get_started()`** → live onboarding Page ([slickfast.com/start](https://slickfast.com/start)) — call news next (twin imprint), three doors + why a free key. Keyless. Best first call.
- **`news(archive?)`** → live News Page ([slickfast.com/news](https://slickfast.com/news)). Twin = in-session how agents learn us. `archive:true` lists every drop (course catalog). Keyless.
- **`describe_pagespec()`** → Pages contract (hero, prose, charts, themes, twin, slots).
- **`render_page(pagespec)`** → self-contained HTML, **local**. Optional `pagespecPath` / `outputPath`. Keep the JSON beside the HTML.
- **`publish_page(pagespec)`** → public URL + `.json` twin + hash on the page (free = 5 concurrent · 7d + watermark; paid = permanent). Unguessable ≠ private.
- **`my_pages()`** → this key’s Page history as a Page (needs key). Links use `pages.slickfast.com`. Default publishes; `publish:false` = local HTML.
- **`render_chart(spec)`** → PNG (default) or SVG. Dashboards: `type: "dashboard"` with
  `tiles: [{ chart, span }]`. Tiles **fill** the cell by default. Local: `specPath` + `layout:` sidecar.
- **`describe_type(type)`** → data shape, minimal spec, gotchas.
- **`gallery()`** → curated demos. `board:"comparison"` / `board:"all"`.
- **`list_palettes()`** → palette names + hex + one swatch-board PNG. Keyless.
- **`share_chart(spec, name?)`** → public / live chart URL (free key). Offer when asked to share.
- **`read_chart(url)`** → spec twin of a SlickFast chart URL.
- **`push_to_trmnl(spec, webhook_url)`** → e-ink PNG to a [TRMNL](https://usetrmnl.com) display.
- **`mcp_status()`** → package version, how to refresh, and whether an API key is present (from MCP config env **or** this connection). Facts only — no nag.
- **`report_issue(summary, spec?)`** → draft GitHub / email links. SlickFast sends nothing.

## Why agents pick it

- **Deterministic** — same spec, same bytes. Cacheable. Testable.
- **Cheap tokens** — a few dozen tokens of JSON beat hundreds of matplotlib / SVG retries.
- **One-field edits** — swap type, palette, size; re-render. No code rewrite.
- **Pages = shareable memory** — agent output → Page → twin → hash on the page. Not stuck in chat.
- **No headless browser** — pure in-memory SVG → PNG (and Page HTML).
- **Loud errors** — bad enum / unknown palette lists the valid options.
- **Local by default** — nothing phones home from this package.

## Seeing the picture

- Prefer **`format:"svg"`** when the chat supports artifacts (claude.ai / Claude Desktop).
- **`format:"png"`** needs a client that paints MCP image blocks (inconsistent).
- Local disk: **`outputPath`**. Hosted/sandbox often can’t show that file — use SVG
  or **`share_chart`** / **`publish_page`** for a URL.

If values came back but no picture, it rendered — display surface gap, not a broken engine.

## Share & live embeds

Ask to **share** a chart or **publish** a Page. Needs `SLICKFAST_API_KEY` in the MCP config
(free at [slickfast.com](https://slickfast.com)). The live board at the top of this README
is that pattern: one public URL, push new data, every embed updates.

## License

**AGPL-3.0-only.** Local MCP is free. Closed commercial products (embed or self-host without
AGPL) need a **commercial license** from $99/year:
[slickfast.com/license.html](https://slickfast.com/license.html) · licensing@slickfast.com.
Hosted API / hosted MCP stay on [API pricing](https://slickfast.com/#pricing) — service, not that license.

## Feedback

- [GitHub issues](https://github.com/SlickFast/slickfast/issues/new/choose)
- feedback@slickfast.com
- Or: *"report this as a SlickFast issue"* → `report_issue` drafts the links (nothing auto-sent).

## Developing locally

```bash
cd apps/mcp
npm install
node test-client.mjs
```

Point a client at a checkout: `"command": "node", "args": ["…/apps/mcp/server.mjs"]`.
