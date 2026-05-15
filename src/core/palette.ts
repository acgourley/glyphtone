// Pretext-based width measurement is disabled — see measureWidthsViaPretext below.
// import { prepareWithSegments } from '@chenglou/pretext';
import type { Glyph, Palette, WidthSource } from './types';

// Creates a small offscreen canvas. Caller-injectable so the core stays DOM-agnostic
// in principle, but defaults to the browser-side OffscreenCanvas.
type CanvasFactory = (w: number, h: number) => OffscreenCanvas;
const defaultCanvasFactory: CanvasFactory = (w, h) => new OffscreenCanvas(w, h);

export function measureGlyphPalette(
  chars: string,
  font: string,
  fontSize: number,
  canvasFactory: CanvasFactory = defaultCanvasFactory,
  widthSource: WidthSource = 'dom',
): Palette {
  // Segment by grapheme cluster, not codepoint — so 👍🏽 (👍 + skin-tone
  // modifier), flag sequences, family/profession ZWJ emoji, etc. stay together
  // as the single unit the browser will paint and measure.
  const seen = new Set<string>();
  const unique: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const { segment } of segmenter.segment(chars)) {
    if (!seen.has(segment)) {
      seen.add(segment);
      unique.push(segment);
    }
  }

  const cellW = Math.ceil(fontSize * 3);
  const cellH = Math.ceil(fontSize * 3);
  const measureCanvas = canvasFactory(cellW, cellH);
  const mctx = measureCanvas.getContext('2d', { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!mctx) throw new Error('Could not acquire 2D context for glyph measurement');
  mctx.font = font;
  mctx.textBaseline = 'top';

  // Measure widths via DOM probes. Canvas measureText disagrees with DOM
  // layout for glyphs that come from the fallback font (emoji, geometric
  // shapes, anything outside the primary font's coverage). Since the preview
  // and exported HTML both lay out text in a <pre>, we need DOM-truthful
  // widths. One batched append + one read pass = one forced reflow total.
  //
  // The `widthSource` option is currently a no-op — pretext is disabled.
  // See measureWidthsViaPretext below for context.
  void widthSource;
  const widths = measureWidthsViaDom(unique, font);

  const glyphs: Glyph[] = [];
  for (let i = 0; i < unique.length; i++) {
    const ch = unique[i];
    const width = widths[i] || fontSize * 0.5;

    mctx.fillStyle = 'white';
    mctx.fillRect(0, 0, cellW, cellH);
    mctx.fillStyle = 'black';
    mctx.fillText(ch, 0, fontSize * 0.2);

    const pxW = Math.max(1, Math.min(cellW, Math.ceil(width)));
    const pxH = Math.max(1, Math.min(cellH, Math.ceil(fontSize * 1.4)));
    const data = mctx.getImageData(0, 0, pxW, pxH).data;
    // Density = 1 - perceived luminance, averaged over the cell. Uses Rec.601
    // luma on all three channels so color emoji (painted in their native
    // colors, ignoring fillStyle) rank by how dark they actually look — not
    // just by red-channel coverage.
    let inkSum = 0;
    // Quadrant ink sums and pixel counts (TL, TR, BL, BR).
    const qInk = [0, 0, 0, 0];
    const qN = [0, 0, 0, 0];
    const halfW = pxW / 2;
    const halfH = pxH / 2;
    for (let py = 0; py < pxH; py++) {
      for (let px = 0; px < pxW; px++) {
        const off = (py * pxW + px) * 4;
        const luma = (0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2]) / 255;
        const ink = 1 - luma;
        inkSum += ink;
        const qi = (py < halfH ? 0 : 2) + (px < halfW ? 0 : 1);
        qInk[qi] += ink;
        qN[qi]++;
      }
    }
    const density = inkSum / (pxW * pxH);
    const qDens = qInk.map((s, i) => (qN[i] > 0 ? s / qN[i] : density));
    const quadrantSig: [number, number, number, number] = [
      qDens[0] - density,
      qDens[1] - density,
      qDens[2] - density,
      qDens[3] - density,
    ];
    glyphs.push({ char: ch, width, density, densityNorm: 0, quadrantSig });
  }

  const dMin = Math.min(...glyphs.map(g => g.density));
  const dMax = Math.max(...glyphs.map(g => g.density));
  const range = Math.max(1e-6, dMax - dMin);
  for (const g of glyphs) g.densityNorm = (g.density - dMin) / range;

  return { glyphs, font, fontSize };
}

function measureWidthsViaDom(chars: string[], font: string): number[] {
  // Measure in a hidden <pre> that matches the preview's relevant style flags
  // (white-space, kerning, ligatures, emoji presentation). Wrap each char in
  // its own <span> and read getBoundingClientRect() per span. Safari rounds
  // Range.getBoundingClientRect() widths in <pre>, so the older
  // cumulative-difference approach accumulated rounding error there; per-span
  // rects are reported at subpixel precision in every engine we tested.
  const probe = document.createElement('pre');
  probe.style.font = font;
  probe.style.fontKerning = 'none';
  probe.style.fontVariantLigatures = 'none';
  (probe.style as CSSStyleDeclaration & { fontVariantEmoji: string }).fontVariantEmoji = 'text';
  probe.style.margin = '0';
  probe.style.padding = '0';
  probe.style.position = 'absolute';
  probe.style.top = '0';
  probe.style.left = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.whiteSpace = 'pre';

  const spans = chars.map((ch) => {
    const s = document.createElement('span');
    s.textContent = ch;
    probe.appendChild(s);
    return s;
  });
  document.body.appendChild(probe);

  const widths = spans.map((s) => s.getBoundingClientRect().width);

  document.body.removeChild(probe);
  return widths;
}

// Pretext-based width measurement — disabled.
//
// We initially wired this up as an A/B option against the DOM probe, hoping
// pretext's canvas-based measurement would let the core work without touching
// the DOM. In practice the resulting rows misalign by enough to be visibly
// broken (Chrome: small but noticeable; Safari: ~25% off on some lines).
//
// Root cause is structural, not a pretext bug: pretext measures via
// canvas.measureText, but the preview and exported HTML render text into a
// <pre> where the BROWSER lays it out with native DOM text metrics. Canvas
// advances and DOM-rendered advances are close but not identical, and our
// algorithm needs pixel-precise per-glyph widths because it advances an
// x-cursor by `width` for every glyph to align each char to a specific source
// region. Per-glyph subpixel discrepancies compound across a row.
//
// Pretext's own demos sidestep this because they only use widths for
// line-breaking decisions (rough), not per-glyph positioning into a DOM that
// will re-lay-out the text. Different use case.
//
// What we tried before giving up:
//   - measureLineStats(..., 1e6): returns 0 for trailing 'space'-kind segments
//   - summing prepared.widths directly: still canvas-truthful, not DOM-truthful
//   - confirmed in Chrome that OffscreenCanvas and DOM-canvas measureText
//     agree, so the divergence is canvas-vs-DOM, not OffscreenCanvas-specific
//
// If we ever want to bring this back, the path forward is probably:
//   (a) compute a DOM/canvas calibration ratio per font (one DOM probe of a
//       reference string) and scale pretext widths by it — handles uniform
//       divergence but not per-glyph divergence (substituted glyphs, etc.)
//   (b) or, ditch the DOM-rendered <pre> output entirely and paint to canvas
//       only — then pretext widths are self-consistent with the rendering.
//
// Keeping the dead function and the `widthSource` plumbing so the option can
// be re-enabled by uncommenting the import + the branch in measureGlyphPalette.

// import { prepareWithSegments } from '@chenglou/pretext';
//
// function measureWidthsViaPretext(chars: string[], font: string, fontSize: number): number[] {
//   return chars.map(ch => {
//     const prepared = prepareWithSegments(ch, font);
//     let total = 0;
//     for (const w of prepared.widths) total += w;
//     return total || fontSize * 0.5;
//   });
// }

// Tight per-font line height based on actual ascent/descent of a tall + descending probe.
export function computeLineHeight(
  font: string,
  fontSize: number,
  canvasFactory: CanvasFactory = defaultCanvasFactory,
): number {
  const c = canvasFactory(2, 2);
  const cx = c.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!cx) return Math.ceil(fontSize);
  cx.font = font;
  cx.textBaseline = 'alphabetic';
  const m = cx.measureText('MgyjpqÉÅÇ@');
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.2;
  return Math.max(1, Math.ceil(ascent + descent));
}
