import "./styles.css";
import { renderGlyphtone, type GlyphtoneResult } from "../core";
import { CHAR_PRESETS } from "../data/char-presets";
import { createFontPicker } from "./font-picker";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "./settings-store";

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="layout">
    <div class="left-column">
      <aside class="controls">
        <h1>Glyphtone</h1>
        <p class="hint">A halftone made of glyphs. Drop an image anywhere to begin.</p>

        <label>Input Image</label>
        <input type="file" id="imageInput" accept="image/*" />
        <button class="secondary" id="loadExampleBtn" type="button">Load Example Image</button>

        <label>Font Family</label>
        <div id="fontPickerMount"></div>
        <div class="hint" id="fontHint">Type to filter, or click Browse ▾ to search all fonts.</div>

        <label>Font Size (px) <span class="value" id="fontSizeVal"></span></label>
        <input type="range" id="fontSize" min="6" max="48" />

        <label>Output Width (px) <span class="value" id="outWidthVal"></span></label>
        <input type="range" id="outWidth" min="200" max="2000" step="50" />

        <label>Character Set
          <select id="charPreset"></select>
        </label>
        <input type="text" id="chars" />
        <div class="hint">First & last chars matter most — typically a heavy glyph and a space.</div>

        <label>Gamma <span class="value" id="gammaVal"></span></label>
        <input type="range" id="gamma" min="0.3" max="3.0" step="0.05" />

        <label>Contrast <span class="value" id="contrastVal"></span></label>
        <input type="range" id="contrast" min="0.5" max="3.0" step="0.05" />

        <label class="checkrow"><input type="checkbox" id="invert" /> Invert</label>

        <div class="color-row">
          <label for="fgColor">Foreground</label>
          <input type="color" id="fgColor" />
          <span class="swatch-status" id="fgStatus"></span>
          <button class="clear" id="fgClear" type="button">Default</button>
        </div>
        <div class="color-row">
          <label for="bgColor">Background</label>
          <input type="color" id="bgColor" />
          <span class="swatch-status" id="bgStatus"></span>
          <button class="clear" id="bgClear" type="button">Default</button>
        </div>
        <div class="color-row">
          <button class="clear" id="swapColors" type="button" title="Swap foreground and background colors">⇅ Swap colors</button>
        </div>

        <!--
          Width-measurement selector is hidden because the only alternative
          (Pretext) is disabled — see src/core/palette.ts for context.
        <label>Width measurement
          <select id="widthSource">
            <option value="dom">DOM probe (default)</option>
            <option value="pretext">Pretext</option>
          </select>
        </label>
        <div class="hint">A/B test how glyph widths are measured. Affects layout of non-ASCII chars.</div>
        -->

        <button id="downloadBtn" type="button">Download PNG</button>
        <button class="secondary" id="exportHtmlBtn" type="button">Export HTML</button>
        <label>Animated HTML sweep: font size from
          <div class="anim-size-row">
            <input type="number" id="animFromSize" min="6" max="48" value="8" />
            <span>to</span>
            <input type="number" id="animToSize" min="6" max="48" value="24" />
            <span>px</span>
          </div>
        </label>
        <button class="secondary" id="exportAnimHtmlBtn" type="button">Export Animated HTML</button>
        <button class="secondary" id="resetBtn" type="button">Reset Settings</button>
        <div class="hint" id="status">Ready. Drop an image or use the file picker.</div>
      </aside>
    </div>
    <main class="preview" id="previewArea">
      <div class="drop-hint" id="dropHint">Drop image here, or paste from clipboard</div>
      <pre id="output" class="glyphtone-preview"></pre>
    </main>
  </div>
  <footer class="kbd-help">
    <kbd>←</kbd> <kbd>→</kbd> char set
    &nbsp;·&nbsp;
    <kbd>↑</kbd> <kbd>↓</kbd> font
    &nbsp;·&nbsp;
    <kbd>R</kbd> randomize
  </footer>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const output = $<HTMLPreElement>("output");
const previewArea = $("previewArea");
const dropHint = $("dropHint");
const status = $("status");

let settings = loadSettings();
let sourceImage: HTMLImageElement | null = null;

// ---------- font picker ----------

const picker = createFontPicker({
  initial: settings.fontFamily,
  onChange: (font) => {
    settings.fontFamily = font;
    persistAndRender();
  },
});
$("fontPickerMount").appendChild(picker.el);

// ---------- char preset dropdown ----------

const presetSel = $<HTMLSelectElement>("charPreset");
const customOpt = new Option("Custom…", "");
presetSel.add(customOpt);
for (const name of Object.keys(CHAR_PRESETS)) {
  presetSel.add(new Option(name, name));
}
function syncPresetToChars() {
  const match = Object.entries(CHAR_PRESETS).find(
    ([, v]) => v === settings.chars,
  );
  presetSel.value = match ? match[0] : "";
}
presetSel.addEventListener("change", () => {
  const v = CHAR_PRESETS[presetSel.value];
  if (v !== undefined) {
    settings.chars = v;
    ($("chars") as HTMLInputElement).value = v;
    persistAndRender();
  }
});

// Width-measurement selector wiring — disabled along with the UI control.
// const widthSourceSel = $<HTMLSelectElement>("widthSource");
// widthSourceSel.addEventListener("change", () => {
//   settings.widthSource = widthSourceSel.value as "dom" | "pretext";
//   persistAndRender();
// });

function applyPreset(name: string) {
  const v = CHAR_PRESETS[name];
  if (v === undefined) return;
  settings.chars = v;
  ($("chars") as HTMLInputElement).value = v;
  presetSel.value = name;
}

function cyclePreset(dir: number) {
  const names = Object.keys(CHAR_PRESETS);
  if (names.length === 0) return;
  const currentIdx = names.findIndex((n) => CHAR_PRESETS[n] === settings.chars);
  let next: number;
  if (currentIdx === -1) {
    next = dir > 0 ? 0 : names.length - 1;
  } else {
    next = (((currentIdx + dir) % names.length) + names.length) % names.length;
  }
  applyPreset(names[next]);
  persistAndRender();
}

function randomizePreset() {
  const names = Object.keys(CHAR_PRESETS);
  if (names.length === 0) return;
  const current = names.findIndex((n) => CHAR_PRESETS[n] === settings.chars);
  let next = current;
  for (let i = 0; i < 8 && next === current; i++) {
    next = Math.floor(Math.random() * names.length);
  }
  applyPreset(names[next]);
}

// ---------- bind range / text / checkbox controls ----------

type Binding = {
  el: HTMLInputElement;
  get: () => Settings[keyof Settings];
  set: (v: any) => void;
  valSpan?: HTMLElement;
  format?: (v: any) => string;
};

const bindings: Binding[] = [
  {
    el: $<HTMLInputElement>("fontSize"),
    get: () => settings.fontSize,
    set: (v) => (settings.fontSize = +v),
    valSpan: $("fontSizeVal"),
  },
  {
    el: $<HTMLInputElement>("outWidth"),
    get: () => settings.outWidth,
    set: (v) => (settings.outWidth = +v),
    valSpan: $("outWidthVal"),
  },
  {
    el: $<HTMLInputElement>("chars"),
    get: () => settings.chars,
    set: (v) => (settings.chars = String(v)),
  },
  {
    el: $<HTMLInputElement>("gamma"),
    get: () => settings.gamma,
    set: (v) => (settings.gamma = +v),
    valSpan: $("gammaVal"),
    format: (v) => Number(v).toFixed(2),
  },
  {
    el: $<HTMLInputElement>("contrast"),
    get: () => settings.contrast,
    set: (v) => (settings.contrast = +v),
    valSpan: $("contrastVal"),
    format: (v) => Number(v).toFixed(2),
  },
  {
    el: $<HTMLInputElement>("invert"),
    get: () => settings.invert,
    set: (v) => (settings.invert = !!v),
  },
];

function applySettingsToUI() {
  for (const b of bindings) {
    const v = b.get();
    if (b.el.type === "checkbox") {
      b.el.checked = !!v;
    } else {
      b.el.value = String(v);
    }
    if (b.valSpan) b.valSpan.textContent = b.format ? b.format(v) : String(v);
  }
  picker.setValue(settings.fontFamily);
  syncPresetToChars();
  syncDisplayPanelUI();
  // widthSourceSel.value = settings.widthSource;
}

for (const b of bindings) {
  b.el.addEventListener("input", () => {
    const v = b.el.type === "checkbox" ? b.el.checked : b.el.value;
    b.set(v);
    if (b.valSpan) b.valSpan.textContent = b.format ? b.format(v) : String(v);
    if (b.el.id === "chars") syncPresetToChars();
    persistAndRender();
  });
}

// ---------- color pickers ----------

const fgColorEl = $<HTMLInputElement>("fgColor");
const bgColorEl = $<HTMLInputElement>("bgColor");
const fgClearEl = $("fgClear");
const bgClearEl = $("bgClear");
const fgStatusEl = $("fgStatus");
const bgStatusEl = $("bgStatus");
const DEFAULT_FG = "#eeeeee";
const DEFAULT_BG = "#0d0d0d";

function effectiveFg(): string {
  return settings.customFg ?? DEFAULT_FG;
}
function effectiveBg(): string {
  return settings.customBg ?? DEFAULT_BG;
}

function syncDisplayPanelUI() {
  const fgVal = settings.customFg ?? effectiveFg();
  const bgVal = settings.customBg ?? effectiveBg();
  fgColorEl.value = fgVal;
  bgColorEl.value = bgVal;
  fgColorEl.classList.toggle("is-default", settings.customFg === null);
  bgColorEl.classList.toggle("is-default", settings.customBg === null);
  fgStatusEl.textContent =
    settings.customFg === null ? "default" : settings.customFg;
  bgStatusEl.textContent =
    settings.customBg === null ? "default" : settings.customBg;
  (fgClearEl as HTMLButtonElement).disabled = settings.customFg === null;
  (bgClearEl as HTMLButtonElement).disabled = settings.customBg === null;
}

fgColorEl.addEventListener("input", () => {
  settings.customFg = fgColorEl.value;
  syncDisplayPanelUI();
  persistAndRender();
});
bgColorEl.addEventListener("input", () => {
  settings.customBg = bgColorEl.value;
  syncDisplayPanelUI();
  persistAndRender();
});
fgClearEl.addEventListener("click", () => {
  settings.customFg = null;
  syncDisplayPanelUI();
  persistAndRender();
});
bgClearEl.addEventListener("click", () => {
  settings.customBg = null;
  syncDisplayPanelUI();
  persistAndRender();
});
$("swapColors").addEventListener("click", () => {
  const fg = effectiveFg();
  const bg = effectiveBg();
  settings.customFg = bg;
  settings.customBg = fg;
  syncDisplayPanelUI();
  persistAndRender();
});

let lastResult: GlyphtoneResult | null = null;
let lastFont = "";

// ---------- global keyboard shortcuts ----------

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    cyclePreset(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    cyclePreset(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    picker.cycle(-1);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    picker.cycle(1);
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    randomizePreset();
    picker.random();
    persistAndRender();
  }
});

// ---------- image loading (file input, drag-drop, paste) ----------

$<HTMLInputElement>("imageInput").addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadImageFile(file);
});

["dragenter", "dragover"].forEach((ev) =>
  previewArea.addEventListener(ev, (e) => {
    e.preventDefault();
    previewArea.classList.add("drag-active");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  previewArea.addEventListener(ev, (e) => {
    e.preventDefault();
    previewArea.classList.remove("drag-active");
  }),
);
previewArea.addEventListener("drop", (e) => {
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) loadImageFile(file);
});

window.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) loadImageFile(file);
      return;
    }
  }
});

async function loadImageFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => loadImageFromDataUrl(reader.result as string, true);
  reader.readAsDataURL(file);
}

function loadImageFromDataUrl(dataUrl: string, save: boolean) {
  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    dropHint.style.display = "none";
    if (save) {
      try {
        localStorage.setItem("glyphtone.image.v1", dataUrl);
      } catch {
        // quota exceeded — image too large to persist
      }
    }
    render();
  };
  img.onerror = () => {
    status.textContent = "Failed to decode image.";
  };
  img.src = dataUrl;
}

// ---------- render pipeline (debounced) ----------

let renderTimer: number | null = null;
function persistAndRender() {
  saveSettings(settings);
  if (renderTimer !== null) clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 60);
}

async function render() {
  if (!sourceImage) return;
  await document.fonts.ready;
  try {
    const t0 = performance.now();
    const font = `${settings.fontSize}px "${settings.fontFamily}", serif`;
    const result = renderGlyphtone({
      source: sourceImage,
      font,
      chars: settings.chars,
      outWidth: settings.outWidth,
      gamma: settings.gamma,
      contrast: settings.contrast,
      invert: settings.invert,
      background: effectiveBg(),
      foreground: effectiveFg(),
      // widthSource: settings.widthSource,
    });
    const t1 = performance.now();
    lastResult = result;
    lastFont = font;

    output.textContent = placementsToRows(result.placements).join("\n");
    output.style.fontSize = `${settings.fontSize}px`;
    output.style.fontFamily = `"${settings.fontFamily}", serif`;
    output.style.lineHeight = `${result.lineHeight}px`;
    output.style.color = effectiveFg();
    output.style.background = effectiveBg();

    status.textContent = `${result.paletteSize} glyphs measured, ${result.glyphsPlaced} placed (${(t1 - t0).toFixed(1)}ms).`;
  } catch (err) {
    status.textContent = "Render error: " + (err as Error).message;
    console.error(err);
  }
}

// Group placements into rows by y. The render algorithm advances x by each
// glyph's measured width and y by a constant lineHeight — that's just what
// the browser does when flowing a line of text, so we can dump each row as a
// plain string and let CSS layout reproduce the image.
function placementsToRows(placements: GlyphtoneResult["placements"]): string[] {
  const rows: string[] = [];
  let currentY = NaN;
  let buf = "";
  for (const p of placements) {
    if (p.y !== currentY) {
      if (buf) rows.push(buf);
      buf = "";
      currentY = p.y;
    }
    buf += p.char;
  }
  if (buf) rows.push(buf);
  return rows;
}

// ---------- buttons ----------

$("downloadBtn").addEventListener("click", () => {
  if (!sourceImage) {
    status.textContent = "Load an image first.";
    return;
  }
  const off = document.createElement("canvas");
  renderGlyphtone({
    source: sourceImage,
    target: off,
    font: `${settings.fontSize}px "${settings.fontFamily}", serif`,
    chars: settings.chars,
    outWidth: settings.outWidth,
    gamma: settings.gamma,
    contrast: settings.contrast,
    invert: settings.invert,
    background: effectiveBg(),
    foreground: effectiveFg(),
  });
  const url = off.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = "glyphtone.png";
  a.click();
});

$("exportHtmlBtn").addEventListener("click", () => {
  if (!lastResult || !sourceImage) {
    status.textContent = "Load an image first.";
    return;
  }
  const html = buildExportHtml();
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "glyphtone.html";
  a.click();
  URL.revokeObjectURL(url);
});

$("exportAnimHtmlBtn").addEventListener("click", () => {
  if (!sourceImage) {
    status.textContent = "Load an image first.";
    return;
  }
  const fromSize = parseInt(($<HTMLInputElement>("animFromSize")).value, 10);
  const toSize = parseInt(($<HTMLInputElement>("animToSize")).value, 10);
  if (isNaN(fromSize) || isNaN(toSize) || fromSize < 1 || toSize < 1) {
    status.textContent = "Enter valid font sizes.";
    return;
  }
  status.textContent = "Generating animated HTML…";
  // yield to the browser to paint the status message before the synchronous render loop
  setTimeout(() => {
    try {
      const html = buildAnimatedExportHtml(fromSize, toSize);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "glyphtone-animated.html";
      a.click();
      URL.revokeObjectURL(url);
      const frameCount = Math.abs(toSize - fromSize) + 1;
      status.textContent = `Exported ${frameCount} frames.`;
    } catch (err) {
      status.textContent = "Export error: " + (err as Error).message;
      console.error(err);
    }
  }, 0);
});

function buildAnimatedExportHtml(fromSize: number, toSize: number): string {
  const bg = effectiveBg();
  const fg = effectiveFg();
  const step = fromSize <= toSize ? 1 : -1;
  const frames: string[] = [];
  for (let size = fromSize; step > 0 ? size <= toSize : size >= toSize; size += step) {
    const font = `${size}px "${settings.fontFamily}", serif`;
    const result = renderGlyphtone({
      source: sourceImage!,
      font,
      chars: settings.chars,
      outWidth: settings.outWidth,
      gamma: settings.gamma,
      contrast: settings.contrast,
      invert: settings.invert,
      background: bg,
      foreground: fg,
    });
    const text = placementsToRows(result.placements).map(escapeHtml).join("\n");
    frames.push(
      `<pre class="glyphtone-frame" style="font-size:${size}px;line-height:${result.lineHeight}px">${text}</pre>`,
    );
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Glyphtone Animated</title>
<style>
  html, body { margin: 0; background: ${bg}; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  /*
    Each frame is a plain-text glyph halftone at a different font size.
    The animation script below cycles through them — adjust the interval (ms)
    or the idx increment direction to change speed or sweep direction.
  */
  .glyphtone-frame {
    font-family: "${settings.fontFamily}", serif;
    color: ${fg};
    background: ${bg};
    margin: 0;
    padding: 0;
    white-space: pre;
    font-kerning: none;
    font-variant-ligatures: none;
    font-variant-emoji: text;
    display: none;
  }
  .glyphtone-frame.active { display: block; }
</style>
</head>
<body>
${frames.join("\n")}
<script>
(function () {
  var frames = document.querySelectorAll('.glyphtone-frame');
  var idx = 0;
  var dir = 1;
  frames[idx].classList.add('active');
  setInterval(function () {
    frames[idx].classList.remove('active');
    idx += dir;
    if (idx >= frames.length - 1) dir = -1;
    if (idx <= 0) dir = 1;
    frames[idx].classList.add('active');
  }, 100);
}());
</script>
</body>
</html>
`;
}

function buildExportHtml(): string {
  const text = placementsToRows(lastResult!.placements).map(escapeHtml).join("\n");
  const bg = effectiveBg();
  const fg = effectiveFg();
  const lineHeight = lastResult!.lineHeight;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Glyphtone</title>
<style>
  html, body { margin: 0; background: ${bg}; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  /*
    The image below is plain text — the browser's own text layout reproduces it
    because each row is a string of glyphs whose widths sum to the intended row
    width. font-kerning/ligatures are disabled so adjacent glyphs don't shift.
  */
  pre.glyphtone {
    font: ${lastFont};
    line-height: ${lineHeight}px;
    color: ${fg};
    background: ${bg};
    margin: 0;
    padding: 0;
    white-space: pre;
    font-kerning: none;
    font-variant-ligatures: none;
    font-variant-emoji: text;
  }
</style>
</head>
<body>
<pre class="glyphtone">${text}</pre>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

$("resetBtn").addEventListener("click", () => {
  settings = { ...DEFAULT_SETTINGS };
  applySettingsToUI();
  persistAndRender();
});

function loadExampleImage(showError: boolean) {
  return fetch("/examples/shannon.jpg")
    .then((r) => r.blob())
    .then((blob) =>
      loadImageFile(new File([blob], "shannon.jpg", { type: "image/jpeg" })),
    )
    .catch(() => {
      if (showError) status.textContent = "Could not load example image.";
    });
}

$("loadExampleBtn").addEventListener("click", () => loadExampleImage(true));

// ---------- boot ----------

applySettingsToUI();

const savedImage = localStorage.getItem("glyphtone.image.v1");
if (savedImage) {
  loadImageFromDataUrl(savedImage, false);
} else {
  loadExampleImage(false);
}
