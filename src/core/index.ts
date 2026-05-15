// Public API surface for the future glyphtone-core library.
// Nothing in this directory may touch `document` or `window` directly —
// all DOM dependencies are passed in via options.

export { renderGlyphtone } from './render';
export { measureGlyphPalette } from './palette';
export type {
  Glyph,
  Palette,
  GlyphPlacement,
  GlyphtoneOptions,
  GlyphtoneResult,
} from './types';
