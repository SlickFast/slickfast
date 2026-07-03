// fonts — SlickFast's font layer. A swappable design dimension, exactly like the
// color library (palette-core): the spec names a font, the engine resolves it.
//
// TODAY: named CSS font stacks. `resolveFont(spec)` is the single entry point.
// FUTURE (the custom-font engine): this package grows to register brand/uploaded
// fonts — emitting @font-face for the SVG path and embedding the actual font files
// for the raster path (PNG → Discord / Telegram / Slack), where the viewer's
// machine won't have the font. Every surface keeps calling resolveFont; only this
// file gets smarter. Nothing downstream changes.

export const FONTS = {
  Inter:     "Inter, system-ui, -apple-system, sans-serif",
  System:    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  Serif:     "Georgia, 'Times New Roman', serif",
  Mono:      "'JetBrains Mono', 'SF Mono', Menlo, monospace",
  Rounded:   "'Nunito', 'Segoe UI', system-ui, sans-serif",
  Condensed: "'Roboto Condensed', 'Arial Narrow', sans-serif",
};
export const DEFAULT_FONT = FONTS.Inter;

/**
 * Resolve a spec's font to a CSS font stack.
 *   spec.fontFamily — a raw CSS stack, used as-is (full control / future custom fonts)
 *   spec.font       — a named font from FONTS
 *   otherwise       — the default (Inter)
 */
export function resolveFont(spec = {}) {
  if (spec.fontFamily) return spec.fontFamily;
  if (spec.font && FONTS[spec.font]) return FONTS[spec.font];
  return DEFAULT_FONT;
}
