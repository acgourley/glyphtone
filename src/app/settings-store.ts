const KEY = 'glyphtone.settings.v1';

export type Settings = {
  fontFamily: string;
  fontSize: number;
  outWidth: number;
  chars: string;
  gamma: number;
  contrast: number;
  invert: boolean;
  dither: boolean;
  customFg: string | null;
  customBg: string | null;
  widthSource: 'dom' | 'pretext';
};

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: 'Times New Roman',
  fontSize: 12,
  outWidth: 900,
  chars: '∑∏∫∆∇∂∞∩∪⊂⊃∈· ',
  gamma: 1.0,
  contrast: 1.0,
  invert: true,
  dither: false,
  customFg: null,
  customBg: null,
  widthSource: 'dom',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let saveTimer: number | null = null;
export function saveSettings(s: Settings) {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    saveTimer = null;
  }, 200);
}
