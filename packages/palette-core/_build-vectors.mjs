// Shared vector builder — used by BOTH generate-golden.mjs (to write the contract)
// and palette-core.test.mjs (to verify the engine still matches it). Keeping one
// builder guarantees the generator and the test can never disagree.
import {
  hslToHex, hexToHsl, getLuminance, contrastColor,
  generateMonochromaticPalette, tierPalette,
  resolveFlatPalette, resolveNestedTheme,
  FLAT_PALETTES, NESTED_THEMES, tokens,
} from './palette-core.mjs';

const round = n => Math.round(n * 1e6) / 1e6;

export function buildVectors() {
  const vectors = {
    tokensVersion: tokens.version,
    conversions: {
      hslToHex: [[174, 60, 40], [0, 0, 0], [360, 100, 50], [210, 50, 75]].map(a => ({ in: a, out: hslToHex(...a) })),
      hexToHsl: ['#14B8A6', '#eab308', '#0A2540'].map(h => {
        const { h: hh, s, l } = hexToHsl(h);
        return { in: h, out: { h: round(hh), s: round(s), l: round(l) } };
      }),
      getLuminance: ['#ffffff', '#000000', '#14B8A6', '#eab308'].map(h => ({ in: h, out: round(getLuminance(h)) })),
      contrastColor: ['#ffffff', '#000000', '#14B8A6', '#fcd34d', '#0A2540'].map(h => ({ in: h, out: contrastColor(h) })),
      monochromatic: { in: [174, 50, 6], out: generateMonochromaticPalette(174, 50, 6) },
      tierPalette: { in: ['#14B8A6', 1, 4, { hueShift: 15, hueSpread: 25 }], out: tierPalette('#14B8A6', 1, 4, { hueShift: 15, hueSpread: 25 }) },
    },
    flatPalettes: {},
    nestedThemes: {},
  };

  for (const p of FLAT_PALETTES) {
    vectors.flatPalettes[p.name] = { 3: resolveFlatPalette(p.name, 3), 8: resolveFlatPalette(p.name, 8), 12: resolveFlatPalette(p.name, 12) };
  }
  for (const t of NESTED_THEMES) {
    vectors.nestedThemes[t.name] = {
      pie0_n3: resolveNestedTheme(t.name, 0, 3),
      pie0_n5: resolveNestedTheme(t.name, 0, 5),
      pie1_n3: resolveNestedTheme(t.name, 1, 3),
      pie2_n4: resolveNestedTheme(t.name, 2, 4),
    };
  }
  return vectors;
}
