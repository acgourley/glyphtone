// Runtime detection of glyphs missing from a font.
//
// The browser falls back per-glyph when the primary font lacks a codepoint.
// In glyphtone that means the row containing the substituted glyph picks up
// the fallback font's metrics (ascent/descent), which can blow out the line
// box — CSS line-height is a minimum for the inline strut, not a cap. The
// result is rows of visibly different heights even though we set a fixed
// line-height in px.
//
// Detection strategy: measure each char twice on canvas, once with
// `"<family>", monospace` and once with `"<family>", serif`. If the font
// owns the glyph, both measurements resolve to the same primary face and
// widths match. If the font lacks it, each fallback is a different engine
// font with (almost always) different widths.
//
// Edge case: both fallbacks happen to render the missing glyph at the same
// width. Rare for the proportional fonts glyphtone targets — accepted.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function findMissingGlyphs(
  family: string,
  fontSize: number,
  chars: string,
): string[] {
  const c = document.createElement('canvas');
  const cx = c.getContext('2d');
  if (!cx) return [];

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const { segment } of segmenter.segment(chars)) {
    if (seen.has(segment)) continue;
    const cp = segment.codePointAt(0);
    // Skip whitespace and control chars — they don't render visible glyphs.
    if (cp === undefined || cp === 0x20 || cp === 0xa0 || cp < 0x20) continue;
    seen.add(segment);
    unique.push(segment);
  }

  cx.font = `${fontSize}px "${family}", monospace`;
  const widthsMono = unique.map(ch => cx.measureText(ch).width);
  cx.font = `${fontSize}px "${family}", serif`;
  const widthsSerif = unique.map(ch => cx.measureText(ch).width);

  const missing: string[] = [];
  for (let i = 0; i < unique.length; i++) {
    if (Math.abs(widthsMono[i] - widthsSerif[i]) > 0.5) {
      missing.push(unique[i]);
    }
  }
  return missing;
}
