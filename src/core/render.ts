import type {
  GlyphPlacement,
  GlyphtoneOptions,
  GlyphtoneResult,
} from './types';
import { measureGlyphPalette, computeLineHeight } from './palette';
import { buildIntegralImage, averageOver } from './integral-image';

export function renderGlyphtone(opts: GlyphtoneOptions): GlyphtoneResult {
  const {
    source,
    target,
    font,
    chars,
    gamma = 1.0,
    contrast = 1.0,
    invert = false,
    weightByWidth = true,
    background = '#0d0d0d',
    foreground = '#eee',
    glyphColor,
    spatialWeight = 2,
    chromaWeight = 0,
    dither = false,
  } = opts;

  const fontSize = extractFontSizePx(font);

  const sourceData = toImageData(source);
  const sourceW = sourceData.width;
  const sourceH = sourceData.height;

  const outW = opts.outWidth ?? target?.width ?? sourceW;
  const aspect = sourceH / sourceW;
  const outH = Math.round(outW * aspect);

  const palette = measureGlyphPalette(chars, font, fontSize, undefined, opts.widthSource);
  if (palette.glyphs.length === 0) {
    return { glyphsPlaced: 0, lineHeight: 0, paletteSize: 0, placements: [] };
  }

  const includeColor = !!glyphColor || chromaWeight > 0;
  const integral = buildIntegralImage(sourceData, includeColor);
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

  const targetForBrightness = (b: number): number => {
    let v = (b - 0.5) * contrast + 0.5;
    v = Math.max(0, Math.min(1, v));
    v = Math.pow(v, gamma);
    return invert ? v : 1 - v;
  };

  // The lowest-density glyph (typically space) is the "blank" — it should
  // remain a candidate even when its measured width exceeds the row's
  // remaining room, otherwise narrow non-space chars get chosen against
  // dark regions at the right margin just because they fit.
  const blankGlyph = palette.glyphs.reduce((a, b) => (a.densityNorm <= b.densityNorm ? a : b));

  // Floyd-Steinberg error buffers in output-pixel space (current and next row).
  const errCur = dither ? new Float32Array(outW + 2) : null;
  const errNext = dither ? new Float32Array(outW + 2) : null;

  let glyphsPlaced = 0;
  for (let y = 0; y + lineHeight <= outH; y += lineHeight) {
    let x = 0;
    while (x < outW) {
      // Accumulated dither error at this cell's x position.
      const accErr = errCur ? errCur[Math.min(Math.round(x), outW + 1)] : 0;

      let best = null;
      let bestErr = Infinity;
      let bestAdjTgt = 0;
      // When spatial matching is on, also probe the 4 quadrants of the cell
      // and form a centered signature comparable to each glyph's quadrantSig.
      // We compute these once per (x, candWidth) pair — but cand.width varies,
      // so we cache by probe rectangle rather than by candidate.
      let lastProbeRight = -1;
      let cellSigTL = 0, cellSigTR = 0, cellSigBL = 0, cellSigBR = 0;
      let cellOverallB = 0;
      let cellR = 0, cellG = 0, cellB = 0;
      let lastChromaProbeRight = -1;
      for (const cand of palette.glyphs) {
        const fits = x + cand.width <= outW + 0.5;
        if (!fits && cand !== blankGlyph) continue;
        const probeRight = weightByWidth ? x + cand.width : x + fontSize * 0.4;
        const x0 = x * sx;
        const y0 = y * sy;
        const x1 = probeRight * sx;
        const y1 = (y + lineHeight) * sy;
        const b = averageOver(integral.luminance, x0, y0, x1, y1);
        const rawTgt = targetForBrightness(b);
        const adjTgt = dither ? Math.max(0, Math.min(1, rawTgt + accErr)) : rawTgt;
        let err = Math.abs(cand.densityNorm - adjTgt);
        if (spatialWeight > 0) {
          if (probeRight !== lastProbeRight) {
            const xm = (x0 + x1) / 2;
            const ym = (y0 + y1) / 2;
            const bTL = averageOver(integral.luminance, x0, y0, xm, ym);
            const bTR = averageOver(integral.luminance, xm, y0, x1, ym);
            const bBL = averageOver(integral.luminance, x0, ym, xm, y1);
            const bBR = averageOver(integral.luminance, xm, ym, x1, y1);
            cellOverallB = b;
            // Source "ink" = invert ? b : 1 - b. Centered signature is
            // (ink_q - ink_overall), which simplifies to the same expression
            // with or without invert (the 1-... cancels in the difference,
            // and a sign flip happens; align with glyph sig which is
            // ink-based, so we want sign of (1 - b_q) - (1 - b) = b - b_q
            // when invert=false, and (b_q - b) when invert=true).
            const sign = invert ? 1 : -1;
            cellSigTL = sign * (bTL - cellOverallB);
            cellSigTR = sign * (bTR - cellOverallB);
            cellSigBL = sign * (bBL - cellOverallB);
            cellSigBR = sign * (bBR - cellOverallB);
            lastProbeRight = probeRight;
          }
          const dTL = cand.quadrantSig[0] - cellSigTL;
          const dTR = cand.quadrantSig[1] - cellSigTR;
          const dBL = cand.quadrantSig[2] - cellSigBL;
          const dBR = cand.quadrantSig[3] - cellSigBR;
          const spatialErr = (dTL * dTL + dTR * dTR + dBL * dBL + dBR * dBR) / 4;
          err += spatialWeight * spatialErr;
        }
        if (chromaWeight > 0 && integral.red && integral.green && integral.blue) {
          if (probeRight !== lastChromaProbeRight) {
            const x0c = x * sx;
            const y0c = y * sy;
            const x1c = probeRight * sx;
            const y1c = (y + lineHeight) * sy;
            cellR = averageOver(integral.red, x0c, y0c, x1c, y1c);
            cellG = averageOver(integral.green, x0c, y0c, x1c, y1c);
            cellB = averageOver(integral.blue, x0c, y0c, x1c, y1c);
            lastChromaProbeRight = probeRight;
          }
          // Compare chroma DIRECTION (cosine), not magnitude. We want a faintly
          // green source pixel (small chroma magnitude, green-ish direction) to
          // match a saturated 💚 (large magnitude, same direction) — magnitude
          // distance would instead prefer monochrome glyphs whose tiny chroma
          // magnitude matches the source's tiny magnitude better. Luma drops
          // out via (channel - Y); density already handles brightness.
          const cellY = 0.299 * cellR + 0.587 * cellG + 0.114 * cellB;
          const gY = 0.299 * cand.avgColor.r + 0.587 * cand.avgColor.g + 0.114 * cand.avgColor.b;
          const ccR = cellR - cellY, ccG = cellG - cellY, ccBl = cellB - cellY;
          const gcR = cand.avgColor.r - gY, gcG = cand.avgColor.g - gY, gcB = cand.avgColor.b - gY;
          const cellMag = Math.sqrt(ccR * ccR + ccG * ccG + ccBl * ccBl);
          const candMag = Math.sqrt(gcR * gcR + gcG * gcG + gcB * gcB);
          // Two regimes:
          //   - "Colored" regime (both have meaningful chroma): direction-only
          //     comparison via cosine — magnitudes don't matter, so a faint
          //     green cell still matches saturated 💚. Glyphs with the wrong
          //     hue are heavily penalized.
          //   - "Neutral" regime (at least one side has weak chroma):
          //     penalize by the larger magnitude — a saturated glyph in a
          //     near-gray cell, or a gray glyph in a saturated cell, both get
          //     a magnitude-proportional penalty.
          // We blend smoothly between regimes by the *weaker* magnitude so a
          // faintly-tinted "white" (cellMag tiny) doesn't trigger direction
          // matching against any saturated glyph that happens to point the
          // right way.
          let colorErr = 0; // direction mismatch, defined when both have chroma
          if (cellMag > 1e-6 && candMag > 1e-6) {
            const cos = (ccR * gcR + ccG * gcG + ccBl * gcB) / (cellMag * candMag);
            colorErr = (1 - cos) / 2; // [0,1]: 0 same hue, 1 opposite
          } else {
            colorErr = 1; // one side has no direction — treat as full mismatch
          }
          const neutralErr = Math.max(cellMag, candMag); // mag of whichever side is colored
          // SAT_THRESH ~= where chroma starts to feel "colored" vs "tinted gray".
          // 0.05 is roughly the chroma magnitude of a pale pastel.
          const SAT_THRESH = 0.05;
          const t = Math.min(1, Math.min(cellMag, candMag) / SAT_THRESH);
          const chromaErr = (1 - t) * neutralErr + t * colorErr;
          err += chromaWeight * chromaErr;
        }
        if (err < bestErr) {
          bestErr = err;
          best = cand;
          bestAdjTgt = adjTgt;
        }
      }
      if (!best) break;
      // If the blank won but doesn't fit, end the row — the background
      // already shows what a trailing space would look like.
      if (best === blankGlyph && x + best.width > outW + 0.5) break;

      // Distribute Floyd-Steinberg quantization error to neighboring cells.
      if (errCur && errNext) {
        const quantErr = bestAdjTgt - best.densityNorm;
        const xi = Math.round(x);
        const xr = Math.round(x + best.width);   // right neighbor
        const xl = Math.max(0, Math.round(x - best.width)); // bottom-left neighbor
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

    // Advance dither buffers: next row's accumulated error becomes current.
    if (errCur && errNext) {
      errCur.set(errNext);
      errNext.fill(0);
    }
  }

  return { glyphsPlaced, lineHeight, paletteSize: palette.glyphs.length, placements };
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
