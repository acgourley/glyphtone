// Curated set of Google Fonts considered "portable enough" — popular families
// (unlikely to be unpublished), OFL/Apache-licensed, spanning the major
// classifications so the picker has design range without 30 lookalike sans.
//
// Selection criteria:
//   1. Popular enough on Google Fonts that hosting is essentially permanent.
//   2. One representative per family (regular weight only).
//   3. Buckets covered: sans-serif, serif, monospace, display, handwriting,
//      plus one math-specialist family.
//
// Per-glyph coverage is detected at runtime via canvas width-divergence
// (see font-coverage.ts) — no need to hand-annotate Unicode subsets here.

export type GoogleFont = {
  name: string;
  category: 'sans-serif' | 'serif' | 'monospace' | 'display' | 'handwriting' | 'math';
};

export const GOOGLE_FONTS: readonly GoogleFont[] = [
  { name: 'Inter',            category: 'sans-serif'  },
  { name: 'Roboto',           category: 'sans-serif'  },
  { name: 'Noto Sans',        category: 'sans-serif'  },
  { name: 'Lora',             category: 'serif'       },
  { name: 'Merriweather',     category: 'serif'       },
  { name: 'Noto Serif',       category: 'serif'       },
  { name: 'JetBrains Mono',   category: 'monospace'   },
  { name: 'Fira Code',        category: 'monospace'   },
  { name: 'Source Code Pro',  category: 'monospace'   },
  { name: 'IBM Plex Mono',    category: 'monospace'   },
  { name: 'Bebas Neue',       category: 'display'     },
  { name: 'Playfair Display', category: 'display'     },
  { name: 'Caveat',           category: 'handwriting' },
  { name: 'Pacifico',         category: 'handwriting' },
  { name: 'Noto Sans Math',   category: 'math'        },
];

export const GOOGLE_FONT_NAMES: readonly string[] = GOOGLE_FONTS.map(f => f.name);

const GOOGLE_FONT_BY_NAME = new Map(GOOGLE_FONTS.map(f => [f.name.toLowerCase(), f]));
export function findGoogleFont(name: string): GoogleFont | undefined {
  return GOOGLE_FONT_BY_NAME.get(name.trim().toLowerCase());
}

export function buildGoogleFontsHref(fonts: readonly GoogleFont[] = GOOGLE_FONTS): string {
  const families = fonts
    .map(f => 'family=' + f.name.replace(/ /g, '+') + ':wght@400')
    .join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

