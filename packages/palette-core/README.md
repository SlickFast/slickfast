# palette-core

The shared **color engine + design tokens** for the data-viz family
(BarGraphFast, PieChartFast, future sites) **and** the rendering API.

This is the asset — the palettes, the color math, the cascade logic — extracted
once from the refined PieChartFast site so it never has to be re-derived or
copy-pasted again. It is intentionally **DOM-free, framework-free, and
dependency-free** so it can run in a browser, in Node, or be re-implemented in
another language for the API.

## The two tiers

**Tier 1 — `tokens.json` (data).** Language-agnostic JSON: the named flat
palettes, the nested Pie-of-Pie themes, and the `rampConfig` tunables for the
generative math. Any consumer in any language reads this file verbatim. There is
no second copy — the sites and the API all point at this one.

**Tier 2 — `palette-core.mjs` (math).** ~40 lines of pure functions: HSL
conversions, WCAG luminance + contrast text color, and the three generators
(`generateMonochromaticPalette`, `tierPalette`, `generateTierPaletteWithFallback`)
plus the token-aware resolvers. Ported verbatim from the live pie site, so the
site can adopt this module with zero visual change.

## The contract: `golden-vectors.json`

The anti-drift mechanism. It is the engine's output for a fixed set of inputs
(every palette at 3/8/12 colors, every nested theme across pie tiers, plus raw
conversion samples). **Every consumer must reproduce it exactly.**

- The JS sites import `palette-core.mjs` directly — same code, automatically in sync.
- **The API repo** (its own repo, possibly another language) re-implements the
  Tier-2 math, then ports `palette-core.test.mjs`: read `golden-vectors.json`,
  run its own implementation, assert equality. Green = parity proven. This is how
  two repos stay in lockstep **without sharing code**.

If you intentionally change the math or tokens:
`npm run golden` to regenerate, review the diff, commit. `npm test` must pass.

## Public API

```js
import {
  resolveFlatPalette,    // (name, count) -> [hex]   flat palette, scales past 8 via fallback
  resolveNestedTheme,    // (themeName, pieIndex, count, rootHexOverride?) -> [hex]  Pie-of-Pie cascade
  contrastColor,         // (hex) -> '#1a1a1a' | '#ffffff'   label text color
  hexToHsl, hslToHex, getLuminance,            // primitives
  generateMonochromaticPalette, tierPalette,   // generators
  FLAT_PALETTES, NESTED_THEMES, tokens,        // the loaded design data
} from '@bargraphfast/palette-core';

resolveFlatPalette('Pastel', 12);           // 8 curated + 4 generated, no repeats
resolveNestedTheme('Modern Corporate', 1, 3); // Pie 2's tier, derived from the root teal
contrastColor('#0A2540');                    // '#ffffff'
```

## Bug fixed during extraction

The pie site's `Vibrant` nested theme had a malformed hex `#e308` (4 chars). It is
corrected here to `#eab308`. The `well-formed #rrggbb` test now guards the whole
token set against this class of typo.

## Files

| File | Role |
|------|------|
| `tokens.json` | Tier 1 — design data (palettes, themes, ramp config) |
| `palette-core.mjs` | Tier 2 — the pure color engine + resolvers |
| `golden-vectors.json` | The cross-consumer parity contract |
| `palette-core.test.mjs` | `node --test` — asserts engine == contract |
| `_build-vectors.mjs` | Shared builder used by the generator and the test |
| `generate-golden.mjs` | Regenerates the contract after intentional changes |

## Next steps (not done yet)

1. **Backport** into BarGraphFast — replace its duplicated `PALETTES` const and
   crude `pal[(i+4)%len]` logic with `resolveFlatPalette`, killing the existing
   drift and giving the bar site proper color scaling.
2. **Adopt** in PieChartFast — swap its inline engine for this module (outputs are
   identical by construction, so no visual change).
3. **Consume** in the API repo — port the math + the parity test against
   `golden-vectors.json`.
