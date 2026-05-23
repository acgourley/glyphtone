export type Color = { r: number; g: number; b: number };

export type Glyph = {
  char: string;
  width: number;
  // RGB color the cell will look like when rendered in the final output —
  // i.e. the glyph painted onto the actual bg color with fillStyle=fg. Already
  // encodes ink coverage AND the fg/bg context, so there's no separate
  // "density" term. For a sparse glyph this is near-bg; for a dense glyph,
  // near-fg; for a color emoji, the emoji's native colors blended with bg.
  displayColor: Color;
  // Per-quadrant displayColor (TL, TR, BL, BR). Used for spatial matching —
  // e.g. a glyph whose top is bright matches a source whose top is bright.
  quadrantColors: [Color, Color, Color, Color];
};

export type Palette = {
  glyphs: Glyph[];
  font: string;          // CSS font string used for measurement
  fontSize: number;
  // bg/fg the palette was measured against — palette must be remeasured if
  // either changes, since they're baked into displayColor.
  background: string;
  foreground: string;
};

export type GlyphPlacement = {
  char: string;
  x: number;
  y: number;
  width: number;
  brightness: number;
  color: { r: number; g: number; b: number };
};

export type WidthSource = 'dom' | 'pretext';

export type GlyphtoneOptions = {
  source: ImageBitmap | HTMLImageElement | ImageData;
  target?: HTMLCanvasElement | OffscreenCanvas;
  // 'dom' (default): measure each glyph with a hidden <pre> + Range.
  // 'pretext': use @chenglou/pretext's measurement (canvas measureText with
  //   a per-font emoji-width correction). Provided for A/B comparison.
  widthSource?: WidthSource;
  font: string;          // CSS font string, e.g. "12px Georgia"
  chars: string;
  outWidth?: number;
  gamma?: number;
  contrast?: number;
  weightByWidth?: boolean;
  // Spatial-pattern matching: prefer glyphs whose per-quadrant brightness
  // pattern matches the source cell's per-quadrant brightness pattern. Useful
  // for charsets like "◤◥◢◣" where every glyph has the same overall density.
  spatialWeight?: number;
  // Color matching weight. Selection always compares glyph displayColor to
  // source pixel color; chromaWeight scales the chroma (hue/saturation)
  // component relative to luma. 0 = pure luma matching; 1 = chroma weighted
  // equally with luma; higher = chroma dominates. Has no effect for fully
  // monochrome charsets (no glyph has any chroma to match).
  chromaWeight?: number;
  dither?: boolean;
  background?: string;
  foreground?: string;
  glyphColor?: (p: GlyphPlacement) => string;
};

export type GlyphtoneResult = {
  glyphsPlaced: number;
  lineHeight: number;
  paletteSize: number;
  placements: GlyphPlacement[];
};
