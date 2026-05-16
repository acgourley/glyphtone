export type Glyph = {
  char: string;
  width: number;
  density: number;       // raw 0..1 ink coverage
  densityNorm: number;   // normalized within the palette
  // Per-quadrant ink coverage minus overall density — a centered spatial
  // signature in roughly [-1, 1]. Order: TL, TR, BL, BR.
  quadrantSig: [number, number, number, number];
};

export type Palette = {
  glyphs: Glyph[];
  font: string;          // CSS font string used for measurement
  fontSize: number;
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
  invert?: boolean;
  weightByWidth?: boolean;
  // Mixes spatial-pattern matching into glyph selection. 0 = brightness
  // only (current behavior); higher values let glyphs whose ink lives in
  // the same corner/edge as the source's brightness pattern win out over
  // glyphs that are only a marginally better brightness match. Useful for
  // sets like "◤◥◢◣" where every glyph has the same overall density.
  spatialWeight?: number;
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
