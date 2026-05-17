// Families that ship (or fall back well) across Windows, macOS, iOS, Android,
// and the major Linux distros. Picking from this set means an exported HTML
// will look essentially the same for the viewer as it did for the author —
// no @font-face required.
export const UNIVERSAL_FONTS: readonly string[] = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Times',
  'Georgia',
  'Courier New',
  'Courier',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
];

export const DEFAULT_FONTS: readonly string[] = [
  'Arial', 'Arial Black', 'Helvetica', 'Helvetica Neue',
  'Times New Roman', 'Times', 'Georgia', 'Palatino', 'Palatino Linotype',
  'Garamond', 'Baskerville', 'Didot', 'Bodoni 72',
  'Courier New', 'Courier', 'Monaco', 'Menlo', 'Consolas',
  'Verdana', 'Tahoma', 'Trebuchet MS', 'Lucida Grande', 'Lucida Sans',
  'Impact', 'Charcoal', 'Gill Sans', 'Optima', 'Futura', 'Avenir', 'Avenir Next',
  'Comic Sans MS', 'Brush Script MT', 'Marker Felt', 'Chalkduster',
  'Snell Roundhand', 'Zapfino', 'Apple Chancery', 'Bradley Hand',
  'Hoefler Text', 'American Typewriter', 'Big Caslon', 'Copperplate',
  'Papyrus', 'Herculanum', 'Trattatello',
  'Andale Mono', 'PT Sans', 'PT Serif',
  'Cochin', 'Iowan Old Style', 'Skia', 'Phosphate',
];
