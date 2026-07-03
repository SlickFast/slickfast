# templates/ — ready-made spec presets

Drop-in, polished specs for common use cases. Each is a complete `render_chart` spec built
on the **existing** engine types — copy one, swap your data, render. (These are presets, not
new chart types; new types are a separate, snapshot-locked effort.)

Grounded in what real dashboards ship (Grafana, Tremor, Geckoboard) per Cowork's research.

| Template | Type | Use case |
|---|---|---|
| `mrr-kpi.json` | kpi | Headline revenue metric with a positive delta |
| `churn-kpi.json` | kpi | Lower-is-better metric — uses `deltaGoodWhen:"down"` so a falling value reads green |
| `weekly-active-users.json` | area | Single-series growth trend |
| `revenue-by-plan.json` | stacked | Revenue split across plan tiers over time |
| `traffic-by-source.json` | donut | Parts-of-a-whole breakdown with a center total |
| `leaderboard.json` | horizontal | Ranked label + value (sales reps, top features, etc.) |

## How to use
1. Copy a template's JSON.
2. Replace `data` (and `label`/`value` for KPIs) with your numbers.
3. Optionally change `palette`, `title`, `background`, units.
4. Render via the `render_chart` MCP tool or the engine.

## Notes
- KPI templates show the delta-color rule both ways: `mrr-kpi` (up = good, green) and
  `churn-kpi` (down = good, green) — set `deltaGoodWhen` to match your metric.
- `leaderboard.json` uses plain counts. Currency *prefixes* (`$`) aren't honored on bar types
  yet (only kpi + pie/donut) — a small future engine improvement if leaderboards need `$`.
