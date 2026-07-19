// raster — SVG → PNG, the only place real compute lives (the paid cost-center).
// Uses resvg (native, fast, NO headless browser).
//
// FONT NOTE (hardening 3/3): Inter (the engine default — every sample uses it) is
// VENDORED in packages/fonts/files. When those files are found on disk, they are
// the ONLY fonts loaded — system fonts off — so a PNG's bytes cannot depend on
// what the machine happens to have installed (Mac dev == Linux CI == production).
// When the files are absent (the esbuild-bundled MCP on an end-user machine ships
// dist only), we fall back to system fonts — exactly the pre-vendoring behavior.
// Pixel-exact brand/custom fonts remain the future custom-font engine's job.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

function vendoredFontFiles() {
  try {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../fonts/files');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.ttf') || f.endsWith('.otf'))
      .map((f) => join(dir, f));
  } catch {
    return []; // bundled dist / files not shipped — system fonts carry it
  }
}

const FONT_FILES = vendoredFontFiles();
const FONT = FONT_FILES.length
  ? { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' }
  : { loadSystemFonts: true };

/**
 * Rasterize an SVG string to a PNG Buffer.
 *   opts.scale  — pixel-density multiplier (default 2 = retina)
 *   opts.width  — exact output width in px (overrides scale)
 */
export function svgToPng(svg, opts = {}) {
  const fitTo = opts.width
    ? { mode: 'width', value: opts.width }
    : { mode: 'zoom', value: opts.scale || 2 };
  const resvg = new Resvg(svg, { fitTo, font: FONT });
  return resvg.render().asPng(); // Buffer
}
