# Authoring premium nested palettes (pie-of-pie themes)

For Cowork (and any agent) adding new **premium color themes** for pie-of-pie charts.
Follow this and a new theme is live in one file edit — no engine code.

## Where themes live
`packages/palette-core/tokens.json` → the **`nestedThemes`** array. Add your theme
object there. render-core picks it up automatically (`resolveNestedTheme`). Select it
on any pie-of-pie with `spec.palette: "Your Theme Name"`.

## Two formats

**A. Inspired tiers — PREFERRED for premium.** Each pie gets its own hand-tuned triad:
```json
{ "name": "Your Theme", "tiers": [
  ["#aaaaaa", "#bbbbbb", "#cccccc"],   // Pie 1
  ["#dddddd", "#eeeeee", "#ffffff"],   // Pie 2
  ["#111111", "#222222", "#333333"]    // Pie 3
]}
```
More slices than colors → engine auto-pads with stepped lightness. More pies than
tiers → reuses the last tier.

**B. Generative — quick.** One root triad; child pies auto-derived (lighter, softer):
```json
{ "name": "Your Theme", "pie1": ["#aaaaaa", "#bbbbbb", "#cccccc"],
  "hueShift": 0, "hueSpread": 0, "dark": false }
```
`hueShift` rotates child hue per depth · `hueSpread` fans hue across a tier's slices
(Sequential Rainbow uses 15 / 25) · `dark:true` = theme intends a dark background.

## ⭐ The gold standard: Analogous Shift — point here
It's a `tiers` theme that works because it's a **continuous walk around the color
wheel** across all 9 colors:
- Tier 1: plum → crimson → coral
- Tier 2: orange → amber → yellow
- Tier 3: lime → mint → teal

Each tier is one *segment* of the spectrum, so the whole nested chart is a smooth
gradient. When in doubt, build like this.

## The 4 design principles — pick ONE per palette
1. **Tonal family** (Retro Editorial) — one mood, three depths: saturated → muted → pastel.
2. **Analogous sweep** (Analogous Shift) — neighbors on the wheel, advancing per tier. ← best.
3. **Repeated harmony** (Classic Triadic) — same harmony (a triad) each tier, desaturating with depth.
4. **Uniform register** (Sorbet Pastel) — one tonal register throughout (e.g. all pastel).

## Existing themes — don't reuse a name
The live list is whatever `list_palettes` returns (or `tokens.json`). As of this writing:
- **Flat palettes** (any chart): Clean Corporate (default) · Pastel · Vibrant · Monochrome · Cyberpunk · Analogous Shift
- **Nested themes** (pieofpie): Modern Corporate · Nordic Earth · Cyberpunk Glow (dark) · Sequential Rainbow · Retro Editorial · Classic Triadic · Sorbet Pastel · Analogous Shift
  (Clean Corporate / Pastel / Vibrant / Monochrome also resolve as nested.)

Pick a **new, unique, evocative** name — no duplicates of the above.

## Rules (non-negotiable)
- **Valid 6-digit hex only** (`#rrggbb`). No 3/4-digit, no malformed values — a stray
  `#e308` once shipped a broken color. Lowercase is fine.
- **3 colors per tier** (a 3-slice pie); extra slices auto-pad.
- **Tier 0 leads** — its FIRST color is the bridge anchor (the slice that drills down).
  Make it the strongest, most representative color.
- **Depth changes tone, not chaos** — child tiers must feel *related* (lighter/softer),
  never random.
- **Stay legible** — slice labels are auto white/dark by contrast; avoid mid-grays that
  fight both.
- **A nested palette = 3 triads that RELATE**, never 9 unrelated colors.

## How to test a new theme
```sh
node -e 'import("./packages/render-core/render-core.mjs").then(m=>{
  const svg=m.renderSpec({type:"pieofpie",palette:"Your Theme",pies:[
    {title:"Pie 1",labels:["A","B","C"],values:[60,30,10]},
    {title:"Pie 2",labels:["X","Y","Z"],values:[35,15,10]},
    {title:"Pie 3",labels:["P","Q","R"],values:[18,12,5]}]});
  require("fs").writeFileSync("/tmp/test.svg",svg);
})'
```
Open `/tmp/test.svg`. Check: tiers relate, the drill-down reads at a glance, labels are
legible, no broken colors.

## Reference
Full design-language analysis (why each palette works):
`slickfast-research/research/_misc/pieofpie-palette-design-language.md`.

## Pre-ship checklist
- [ ] One clear design principle (§ above)
- [ ] 3 valid 6-digit hexes per tier — `node scripts/check-palettes.mjs` passes
- [ ] Tier-0 first color is the strong anchor (the bridge slice that drills down)
- [ ] Tiers visibly relate — lighter/softer with depth, never random
- [ ] Labels readable on every color (avoid muddy mid-grays)
- [ ] Unique, evocative name (not in the existing set above)
- [ ] Rendered a test and it reads as a drill-down
