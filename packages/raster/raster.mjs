// raster — SVG → PNG, the only place real compute lives (the paid cost-center).
// Uses resvg (native, fast, NO headless browser).
//
// FONT NOTE: PNG text needs the font installed on the rendering machine. v1 loads
// system fonts (clean sans-serif fallback). Pixel-exact brand/Inter/custom fonts
// in PNG = the future custom-font engine's job (embed the font files for resvg).

import { Resvg } from '@resvg/resvg-js';

/**
 * Rasterize an SVG string to a PNG Buffer.
 *   opts.scale  — pixel-density multiplier (default 2 = retina)
 *   opts.width  — exact output width in px (overrides scale)
 */
export function svgToPng(svg, opts = {}) {
  const fitTo = opts.width
    ? { mode: 'width', value: opts.width }
    : { mode: 'zoom', value: opts.scale || 2 };
  const resvg = new Resvg(svg, { fitTo, font: { loadSystemFonts: true } });
  return resvg.render().asPng(); // Buffer
}
