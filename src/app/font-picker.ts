import { DEFAULT_FONTS, UNIVERSAL_FONTS } from '../data/default-fonts';
import { GOOGLE_FONT_NAMES } from '../data/google-fonts';

export type FontPickerOpts = {
  initial: string;
  allowNonUniversal: boolean;
  onChange: (font: string) => void;
};

export type FontPicker = {
  el: HTMLElement;
  getValue: () => string;
  setValue: (v: string) => void;
  cycle: (dir: number) => void;
  random: () => void;
  setAllowNonUniversal: (b: boolean) => void;
  isPortable: (name: string) => boolean;
};

// Fonts that are safe to use without an installed-locally requirement: either
// shipped with virtually every OS, or loaded via @font-face from Google Fonts
// (the export emits the corresponding stylesheet link).
const PORTABLE_FONTS: readonly string[] = [...UNIVERSAL_FONTS, ...GOOGLE_FONT_NAMES];
const PORTABLE_SET = new Set(PORTABLE_FONTS.map(f => f.toLowerCase()));

export function createFontPicker(opts: FontPickerOpts): FontPicker {
  let allowNonUniversal = opts.allowNonUniversal;
  let installedDefaults: string[] = [...DEFAULT_FONTS];
  let browsedAll: string[] | null = null;
  let fontList: string[] = computeFontList();

  function computeFontList(): string[] {
    if (!allowNonUniversal) return [...PORTABLE_FONTS];
    return browsedAll ?? installedDefaults;
  }
  let activeIdx = -1;
  let preBrowseValue = '';
  let clearedByBrowse = false;

  const root = document.createElement('div');
  root.className = 'combo';
  root.innerHTML = `
    <div class="combo-row">
      <input type="text" class="combo-input" autocomplete="off" spellcheck="false" />
      <button class="combo-toggle" type="button" title="Browse fonts">Browse ▾</button>
    </div>
    <div class="combo-dropdown"></div>
  `;
  const input = root.querySelector('.combo-input') as HTMLInputElement;
  const toggle = root.querySelector('.combo-toggle') as HTMLButtonElement;
  const dropdown = root.querySelector('.combo-dropdown') as HTMLDivElement;
  input.value = opts.initial;

  function renderDropdown(filter = '') {
    const q = filter.trim().toLowerCase();
    const matches = fontList.filter(f => f.toLowerCase().includes(q));
    dropdown.innerHTML = '';
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="combo-empty">No fonts match.</div>';
      activeIdx = -1;
      return;
    }
    matches.slice(0, 200).forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'combo-item' + (i === activeIdx ? ' active' : '');
      row.dataset.name = name;
      const sample = document.createElement('span');
      sample.className = 'sample';
      sample.textContent = `${name} — AaBb 123`;
      sample.style.fontFamily = `"${name}", system-ui`;
      row.appendChild(sample);
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        select(name);
      });
      dropdown.appendChild(row);
    });
  }

  function select(name: string) {
    input.value = name;
    clearedByBrowse = false;
    root.classList.remove('open');
    opts.onChange(name);
  }

  function cycle(dir: number) {
    if (fontList.length === 0) return;
    const current = input.value;
    let idx = fontList.indexOf(current);
    if (idx === -1) {
      idx = dir > 0 ? 0 : fontList.length - 1;
    } else {
      idx = ((idx + dir) % fontList.length + fontList.length) % fontList.length;
    }
    const name = fontList[idx];
    input.value = name;
    clearedByBrowse = false;
    opts.onChange(name);
  }

  function random() {
    if (fontList.length === 0) return;
    const current = input.value;
    let name = current;
    for (let i = 0; i < 8 && name === current; i++) {
      name = fontList[Math.floor(Math.random() * fontList.length)];
    }
    input.value = name;
    clearedByBrowse = false;
    opts.onChange(name);
  }

  input.addEventListener('focus', () => {
    root.classList.add('open');
    renderDropdown(input.value);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      root.classList.remove('open');
      if (clearedByBrowse && input.value === '') {
        input.value = preBrowseValue;
      }
      clearedByBrowse = false;
    }, 120);
  });
  input.addEventListener('input', () => {
    clearedByBrowse = false;
    renderDropdown(input.value);
    opts.onChange(input.value);
  });
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll<HTMLElement>('.combo-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(items.length - 1, activeIdx + 1);
      updateActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      updateActive(items);
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const name = items[activeIdx].dataset.name!;
      select(name);
    } else if (e.key === 'Escape') {
      if (clearedByBrowse) {
        input.value = preBrowseValue;
        clearedByBrowse = false;
      }
      root.classList.remove('open');
      input.blur();
    }
  });
  toggle.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    if (root.classList.contains('open')) {
      root.classList.remove('open');
      return;
    }
    if (allowNonUniversal) {
      const w = window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> };
      if (w.queryLocalFonts) {
        try {
          const fonts = await w.queryLocalFonts();
          browsedAll = [...new Set(fonts.map(f => f.family))].sort();
          fontList = computeFontList();
        } catch {
          // permission denied — fall through with current fontList
        }
      }
    }
    preBrowseValue = input.value;
    clearedByBrowse = true;
    input.value = '';
    root.classList.add('open');
    renderDropdown('');
    input.focus();
  });

  function updateActive(items: NodeListOf<HTMLElement>) {
    items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    items[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }

  // Width-comparison check: fonts not actually installed will resolve to the fallback width.
  function fontInstalled(family: string): boolean {
    const probe = 'mwiI@WMabc 0123';
    const c = document.createElement('canvas');
    const cx = c.getContext('2d')!;
    cx.font = `32px "${family}", monospace`;
    const w1 = cx.measureText(probe).width;
    cx.font = `32px monospace`;
    const wMono = cx.measureText(probe).width;
    cx.font = `32px "${family}", serif`;
    const w2 = cx.measureText(probe).width;
    cx.font = `32px serif`;
    const wSerif = cx.measureText(probe).width;
    return Math.abs(w1 - wMono) > 0.5 || Math.abs(w2 - wSerif) > 0.5;
  }

  document.fonts.ready.then(() => {
    installedDefaults = DEFAULT_FONTS.filter(fontInstalled);
    fontList = computeFontList();
  });

  function applyAllowState() {
    toggle.style.display = allowNonUniversal ? '' : 'none';
    if (!allowNonUniversal) browsedAll = null;
    fontList = computeFontList();
  }
  applyAllowState();

  return {
    el: root,
    getValue: () => input.value,
    setValue: (v: string) => { input.value = v; },
    cycle,
    random,
    setAllowNonUniversal: (b: boolean) => {
      allowNonUniversal = b;
      applyAllowState();
    },
    isPortable: (name: string) => PORTABLE_SET.has(name.trim().toLowerCase()),
  };
}
