# SlickFast Chart API

Turn a chart **spec** (one JSON object) into an image — send the spec, get back a PNG or SVG.
Same engine as the `@slickfast/mcp` tool and the chart sites, just over HTTP.

> **Canonical & current.** This file matches the live API (`apps/api/server.mjs`). It supersedes
> the older drafts in the research repo, which describe a `/chart?type=…` design the API never
> shipped — ignore those.

- **Base URL :** `https://api.slickfast.com`
  
- **The spec is everything.** Every chart type, field, and option is documented in the
  **ChartSpec contract** → [`../../packages/render-core/SPEC.md`](../../packages/render-core/SPEC.md)
  (the MCP serves the same doc as its `chart-spec` resource). This page covers only the HTTP
  envelope around it.
- **Deterministic:** the same spec always renders the same chart — responses are cached `immutable`.

## Authentication

Every render call needs an API key — the free tier (250 renders/month, no card) issues one at
checkout. Send it any of three ways:

```
Authorization: Bearer <key>     # preferred
X-API-Key: <key>                # alternative header
?key=<key>                      # GET only — for embeddable chart URLs
```

Server-side: keys are verified with Polar (the billing provider) and each successful render
reports one usage event against your quota. If the billing provider is briefly unreachable the
API **fails open** — your renders never break because of a billing hiccup. Keyless calls get a
403 with instructions once the gate is armed (`POLAR_ACCESS_TOKEN` + `POLAR_ORG_ID` env).

## Endpoints

### `POST /render`
Body = a JSON chart spec, with optional `"format": "png" | "svg"` (default `png`).

```bash
curl -X POST "$BASE/render" \
  -H 'content-type: application/json' \
  -d '{"type":"bar","data":{"labels":["A","B","C"],"series":[{"values":[10,20,15]}]}}' \
  --output chart.png
```

### `GET /chart.png?spec=<url-encoded JSON>`
The whole spec encoded into the URL → `image/png`. The URL *is* the chart — perfect for `<img src>`.

```bash
SPEC='{"type":"pie","data":{"labels":["A","B","C"],"series":[{"values":[45,30,25]}]}}'
curl "$BASE/chart.png?spec=$(jq -rn --arg s "$SPEC" '$s|@uri')" --output chart.png
```

Optional `&preset=` / `&ratio=` sets the aspect ratio without editing the spec
(`Share Card`, `Wide`, `Square`, `Portrait`, `Tall`, `Classic`, or a bare ratio like `16:9`).

### `GET /chart.svg?spec=<url-encoded JSON>`
Same as `/chart.png` but returns `image/svg+xml` — the browser renders it (resolution-independent,
tiny, near-zero server cost). Best for live web embeds.

### `GET /` · `GET /health`
`/` returns a usage JSON (endpoints + an example spec); `/health` returns `ok`. Both always open.

## Formats

- **PNG** (default) — raster; what social cards / `<img>` need. `scale` (default 2) sets pixel density.
- **SVG** — vector; the browser rasterizes it. Set via `"format":"svg"` (POST) or the `.svg` endpoint.

## Limits & errors

| Code | Meaning |
|---|---|
| `200` | image (`image/png` or `image/svg+xml`) |
| `400` | spec isn't valid JSON, isn't an object, has no `type`, fails to render, or GET `?spec=` is over **16 KB** (use `POST /render`) |
| `403` | API key required (when metering is enabled) |
| `404` | unknown route |

POST body cap: **1 MB**. GET `?spec=` cap: **16 KB**.

## Other languages

**JavaScript (fetch):**
```js
const res = await fetch(`${BASE}/render`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'bar', data: { labels: ['A','B'], series: [{ values: [10,20] }] } }),
});
const png = Buffer.from(await res.arrayBuffer());
```

**Python (requests):**
```python
import requests
r = requests.post(f"{BASE}/render", json={
    "type": "bar",
    "data": {"labels": ["A", "B"], "series": [{"values": [10, 20]}]},
})
open("chart.png", "wb").write(r.content)
```

## The spec contract (the other 80%)

This page is just the HTTP envelope. **Every type, field, and option** lives in
[`../../packages/render-core/SPEC.md`](../../packages/render-core/SPEC.md) — the single source of
truth. A spec with only `{type, data}` renders a complete, good-looking chart; everything else is
an optional override.
