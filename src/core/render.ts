import type {
  Glyph,
  GlyphPlacement,
  GlyphtoneOptions,
  GlyphtoneResult,
} from './types';
import { measureGlyphPalette, computeLineHeight } from './palette';
import { buildIntegralImage, averageOver } from './integral-image';

const LUMA_R = 0.299, LUMA_G = 0.587, LUMA_B = 0.114;
const lumaOf = (r: number, g: number, b: number) => LUMA_R * r + LUMA_G * g + LUMA_B * b;

export function renderGlyphtone(opts: GlyphtoneOptions): GlyphtoneResult {
  const {
    source,
    target,
    font,
    chars,
    gamma = 1.0,
    contrast = 1.0,
    weightByWidth = true,
    background = '#0d0d0d',
    foreground = '#eee',
    glyphColor,
    spatialWeight = 2,
    chromaWeight = 2.5,
    dither = false,
  } = opts;

  const fontSize = extractFontSizePx(font);

  const sourceData = toImageData(source);
  const sourceW = sourceData.width;
  const sourceH = sourceData.height;

  const outW = opts.outWidth ?? target?.width ?? sourceW;
  const aspect = sourceH / sourceW;
  const outH = Math.round(outW * aspect);

  const palette = measureGlyphPalette(
    chars, font, fontSize, background, foreground, undefined, opts.widthSource,
  );
  if (palette.glyphs.length === 0) {
    return { glyphsPlaced: 0, lineHeight: 0, paletteSize: 0, placements: [] };
  }

  // Always build R/G/B integrals now — color is the matching primary, not optional.
  const integral = buildIntegralImage(sourceData, true);
  const lineHeight = computeLineHeight(font, fontSize);
  const placements: GlyphPlacement[] = [];

  let ctx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;
  if (target) {
    target.width = outW;
    target.height = outH;
    ctx = target.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('Could not acquire 2D context on target canvas');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, outW, outH);
    ctx.font = font;
    ctx.textBaseline = 'top';
    ctx.fillStyle = foreground;
  }

  const sx = sourceW / outW;
  const sy = sourceH / outH;

  // Glyph palette covers some subrange of [0, 1] luma — e.g. for dark-fg on
  // light-bg, the densest glyph might only reach luma 0.3 (it's bg + ink, not
  // pure ink). Without remapping, all source pixels below 0.3 collapse onto
  // the single densest glyph and the dark end of the image looks flat. Stretch
  // source luma to the palette's actual range so the full ramp of glyphs gets
  // used. Equivalent to the old density-normalization step but now derived
  // from actual displayed luma so fg/bg are baked in.
  let palLumaMin = Infinity, palLumaMax = -Infinity;
  for (const g of palette.glyphs) {
    const l = lumaOf(g.displayColor.r, g.displayColor.g, g.displayColor.b);
    if (l < palLumaMin) palLumaMin = l;
    if (l > palLumaMax) palLumaMax = l;
  }
  const palLumaSpan = palLumaMax - palLumaMin;

  // Tone-map a single channel by contrast/gamma. Brightness direction is
  // implicit in each glyph's displayColor (which already encodes the fg/bg
  // context), so we don't flip anything here.
  const toneChannel = (c: number): number => {
    let v = (c - 0.5) * contrast + 0.5;
    v = Math.max(0, Math.min(1, v));
    return Math.pow(v, gamma);
  };

  // "Blank" glyph = the one whose displayColor is closest to the bg color. It
  // stays in the candidate pool even when its width exceeds remaining row
  // room, so trailing space at the right margin doesn't get filled with a
  // narrow non-space glyph that fits but reads worse than empty bg.
  const bgRgb = parseHexColor(background);
  const blankGlyph = palette.glyphs.reduce((a, b) =>
    colorDist2(a.displayColor, bgRgb) <= colorDist2(b.displayColor, bgRgb) ? a : b);

  // Floyd-Steinberg error in luma space (single buffer per row, current + next).
  const errCur = dither ? new Float32Array(outW + 2) : null;
  const errNext = dither ? new Float32Array(outW + 2) : null;

  let glyphsPlaced = 0;
  for (let y = 0; y + lineHeight <= outH; y += lineHeight) {
    let x = 0;
    while (x < outW) {
      const accErr = errCur ? errCur[Math.min(Math.round(x), outW + 1)] : 0;

      let best: Glyph | null = null;
      let bestErr = Infinity;
      let bestSourceLuma = 0;

      // Cache by probe rectangle (varies with cand.width).
      let lastProbeRight = -1;
      let cellR = 0, cellG = 0, cellB = 0, cellLuma = 0;
      let cellQLumaTL = 0, cellQLumaTR = 0, cellQLumaBL = 0, cellQLumaBR = 0;

      for (const cand of palette.glyphs) {
        const fits = x + cand.width <= outW + 0.5;
        if (!fits && cand !== blankGlyph) continue;
        const probeRight = weightByWidth ? x + cand.width : x + fontSize * 0.4;
        const x0 = x * sx;
        const y0 = y * sy;
        const x1 = probeRight * sx;
        const y1 = (y + lineHeight) * sy;

        if (probeRight !== lastProbeRight) {
          // Sample the source cell once per probe rect, in RGB. Tone map each
          // channel; luma is derived from the toned RGB so contrast/gamma
          // affect chroma matching the same way they affect luma matching.
          const rRaw = averageOver(integral.red!, x0, y0, x1, y1);
          const gRaw = averageOver(integral.green!, x0, y0, x1, y1);
          const bRaw = averageOver(integral.blue!, x0, y0, x1, y1);
          cellR = toneChannel(rRaw);
          cellG = toneChannel(gRaw);
          cellB = toneChannel(bRaw);
          cellLuma = lumaOf(cellR, cellG, cellB);
          if (spatialWeight > 0) {
            const xm = (x0 + x1) / 2;
            const ym = (y0 + y1) / 2;
            cellQLumaTL = lumaOfChannels(integral, x0, y0, xm, ym, toneChannel);
            cellQLumaTR = lumaOfChannels(integral, xm, y0, x1, ym, toneChannel);
            cellQLumaBL = lumaOfChannels(integral, x0, ym, xm, y1, toneChannel);
            cellQLumaBR = lumaOfChannels(integral, xm, ym, x1, y1, toneChannel);
          }
          lastProbeRight = probeRight;
        }

        const gR = cand.displayColor.r;
        const gG = cand.displayColor.g;
        const gB = cand.displayColor.b;
        const gLuma = lumaOf(gR, gG, gB);

        // Remap source luma into the palette's luma range so dark pixels can
        // reach the densest glyph and bright pixels can reach space, even when
        // the palette covers only a subrange of [0, 1]. Chroma stays in the
        // source's original space — hue match doesn't depend on luma stretch.
        const mappedSrcLuma = palLumaMin + cellLuma * palLumaSpan;
        const adjSrcLuma = dither ? Math.max(0, Math.min(1, mappedSrcLuma + accErr)) : mappedSrcLuma;
        const dLuma = adjSrcLuma - gLuma;
        let err = dLuma * dLuma;

        if (chromaWeight > 0) {
          // Chroma vector = (channel - luma); compare source chroma to glyph
          // chroma. Magnitudes are meaningful now because the glyph's chroma
          // is what it'll actually DISPLAY as — a 💚 on dark bg has small
          // chroma (washed out), matching a dimly green source pixel; on
          // bright bg it has tiny chroma, matching a faintly green pixel. We
          // don't need the cosine/magnitude gymnastics anymore.
          const sChR = cellR - cellLuma, sChG = cellG - cellLuma, sChB = cellB - cellLuma;
          const gChR = gR - gLuma, gChG = gG - gLuma, gChB = gB - gLuma;
          const dR = sChR - gChR, dG = sChG - gChG, dB = sChB - gChB;
          const chromaErr = (dR * dR + dG * dG + dB * dB) / 3;
          err += chromaWeight * chromaErr;
        }

        if (spatialWeight > 0) {
          // Per-quadrant brightness pattern match. Centered signatures so the
          // overall brightness cancels out — we're matching the SHAPE of the
          // brightness distribution, not its mean (which the luma term covers).
          const gqTL = lumaOf(cand.quadrantColors[0].r, cand.quadrantColors[0].g, cand.quadrantColors[0].b);
          const gqTR = lumaOf(cand.quadrantColors[1].r, cand.quadrantColors[1].g, cand.quadrantColors[1].b);
          const gqBL = lumaOf(cand.quadrantColors[2].r, cand.quadrantColors[2].g, cand.quadrantColors[2].b);
          const gqBR = lumaOf(cand.quadrantColors[3].r, cand.quadrantColors[3].g, cand.quadrantColors[3].b);
          const dTL = (gqTL - gLuma) - (cellQLumaTL - cellLuma);
          const dTR = (gqTR - gLuma) - (cellQLumaTR - cellLuma);
          const dBL = (gqBL - gLuma) - (cellQLumaBL - cellLuma);
          const dBR = (gqBR - gLuma) - (cellQLumaBR - cellLuma);
          const spatialErr = (dTL * dTL + dTR * dTR + dBL * dBL + dBR * dBR) / 4;
          err += spatialWeight * spatialErr;
        }

        if (err < bestErr) {
          bestErr = err;
          best = cand;
          bestSourceLuma = adjSrcLuma;
        }
      }
      if (!best) break;
      if (best === blankGlyph && x + best.width > outW + 0.5) break;

      // Distribute luma quantization error to neighboring cells.
      if (errCur && errNext) {
        const gLuma = lumaOf(best.displayColor.r, best.displayColor.g, best.displayColor.b);
        const quantErr = bestSourceLuma - gLuma;
        const xi = Math.round(x);
        const xr = Math.round(x + best.width);
        const xl = Math.max(0, Math.round(x - best.width));
        if (xr <= outW + 1) errCur[xr] += quantErr * 7 / 16;
        if (xl <= outW + 1) errNext[xl] += quantErr * 3 / 16;
        if (xi <= outW + 1) errNext[xi] += quantErr * 5 / 16;
        if (xr <= outW + 1) errNext[xr] += quantErr * 1 / 16;
      }

      const placement = makePlacement(best, x, y, integral, sx, sy, lineHeight);
      placements.push(placement);
      if (ctx) {
        if (glyphColor) {
          ctx.fillStyle = glyphColor(placement);
        }
        ctx.fillText(best.char, x, y);
      }
      x += best.width;
      glyphsPlaced++;
    }

    if (errCur && errNext) {
      errCur.set(errNext);
      errNext.fill(0);
    }
  }

  return { glyphsPlaced, lineHeight, paletteSize: palette.glyphs.length, placements };
}

function lumaOfChannels(
  integral: ReturnType<typeof buildIntegralImage>,
  x0: number, y0: number, x1: number, y1: number,
  tone: (c: number) => number,
): number {
  const r = tone(averageOver(integral.red!, x0, y0, x1, y1));
  const g = tone(averageOver(integral.green!, x0, y0, x1, y1));
  const b = tone(averageOver(integral.blue!, x0, y0, x1, y1));
  return lumaOf(r, g, b);
}

function colorDist2(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const dR = a.r - b.r, dG = a.g - b.g, dB = a.b - b.b;
  return dR * dR + dG * dG + dB * dB;
}

function parseHexColor(css: string): { r: number; g: number; b: number } {
  // Supports #rgb, #rrggbb. Anything else falls back to black — callers always
  // pass the resolved color from the picker, so we don't need full CSS parsing.
  const m = css.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    const h = m[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16) / 255,
        g: parseInt(h[1] + h[1], 16) / 255,
        b: parseInt(h[2] + h[2], 16) / 255,
      };
    }
    if (h.length >= 6) {
      return {
        r: parseInt(h.slice(0, 2), 16) / 255,
        g: parseInt(h.slice(2, 4), 16) / 255,
        b: parseInt(h.slice(4, 6), 16) / 255,
      };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

function makePlacement(
  glyph: { char: string; width: number },
  x: number,
  y: number,
  integral: ReturnType<typeof buildIntegralImage>,
  sx: number,
  sy: number,
  lineHeight: number,
): GlyphPlacement {
  const xs = x * sx;
  const ys = y * sy;
  const xe = (x + glyph.width) * sx;
  const ye = (y + lineHeight) * sy;
  const brightness = averageOver(integral.luminance, xs, ys, xe, ye);
  const color = integral.red && integral.green && integral.blue
    ? {
        r: Math.round(averageOver(integral.red, xs, ys, xe, ye) * 255),
        g: Math.round(averageOver(integral.green, xs, ys, xe, ye) * 255),
        b: Math.round(averageOver(integral.blue, xs, ys, xe, ye) * 255),
      }
    : { r: 0, g: 0, b: 0 };
  return { char: glyph.char, x, y, width: glyph.width, brightness, color };
}

function toImageData(source: ImageBitmap | HTMLImageElement | ImageData): ImageData {
  if (source instanceof ImageData) return source;
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const c = new OffscreenCanvas(w, h);
  const cx = c.getContext('2d');
  if (!cx) throw new Error('Could not acquire 2D context to read source image');
  cx.drawImage(source as CanvasImageSource, 0, 0);
  return cx.getImageData(0, 0, w, h);
}

function extractFontSizePx(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]) : 12;
}
