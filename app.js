'use strict';

// Any uncaught error is shown on-screen so nothing fails silently.
window.addEventListener('error', e => showError('JS error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', e => showError('Promise error: ' + (e.reason && e.reason.message || e.reason)));
function showError(msg) {
  let bar = document.getElementById('errbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'errbar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7f1d1d;color:#fff;padding:8px 14px;font:12px ui-monospace,monospace;z-index:9999;white-space:pre-wrap;';
    document.body.appendChild(bar);
  }
  bar.textContent = msg;
  console.error(msg);
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  img: null,
  zoom: 1,
  result: null,
};

// ---------- Auto aspect detection ----------
// Measures the real rendered width/height of a monospace character
// using a hidden canvas with the same font as #output.
// This gives a pixel-perfect ratio so images aren't distorted.
// Preview renders at this fontSize — measure at same size so aspect is self-consistent.
const PREVIEW_FONT_SIZE = 14;
// Must match --mono-default in CSS; canvas doesn't resolve CSS variables.
const MONO_STACK = 'ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace';

function measureCharAspect() {
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d');
  const selectedFont = $('#fontFamily').value;
  const fontStack = selectedFont.startsWith('var(') ? MONO_STACK : selectedFont;
  // Measure at the same fontSize the preview renders — keeps aspect self-calibrated.
  ctx.font = `${PREVIEW_FONT_SIZE}px ${fontStack}`;
  // Wide ASCII run for stable advance width; avoid variable-width Unicode here.
  const charW = ctx.measureText('M'.repeat(20)).width / 20;
  return Math.round((charW / PREVIEW_FONT_SIZE) * 100) / 100;
}

async function applyAutoAspect() {
  const selectedFont = $('#fontFamily').value;
  
  // Only try to load if it's a custom font (not a CSS variable)
  if (selectedFont && !selectedFont.startsWith('var(')) {
    try {
      const fontSpec = `${PREVIEW_FONT_SIZE}px "${selectedFont}"`;
      // Check if font is already loaded
      if (!document.fonts.check(fontSpec)) {
        console.log('Loading font:', selectedFont);
        await Promise.race([
          document.fonts.load(fontSpec),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Font load timeout')), 3000))
        ]);
      }
    } catch (e) {
      console.warn('Font load problem:', selectedFont, e.message);
      // Don't show the error to user as a red bar, just log it
    }
  }
  
  try {
    const measured = measureCharAspect();
    if (!measured || isNaN(measured) || measured <= 0) {
      console.warn('Invalid aspect measurement, using fallback');
      return;
    }
    
    const slider = $('#aspect');
    const out = $('#aspectOut');
    const clamped = Math.max(+slider.min, Math.min(+slider.max, measured));
    slider.value = clamped;
    out.textContent = clamped.toFixed(2);
    schedule();
  } catch (e) {
    console.error('Measurement error:', e);
  }
}

$('#fontFamily').addEventListener('change', async () => {
  const val = $('#fontFamily').value;
  document.documentElement.style.setProperty('--mono', val);
  // Auto-switch direction for Dhivehi fonts
  if (!val.startsWith('var(') && !val.startsWith('Custom_')) {
    $$('input[name=dir]').forEach(r => r.checked = (r.value === 'rtl'));
  } else if (!val.startsWith('Custom_')) {
    $$('input[name=dir]').forEach(r => r.checked = (r.value === 'ltr'));
  }
  await applyAutoAspect();
});

$('#uploadFontBtn').addEventListener('click', () => $('#fontUpload').click());
$('#fontUpload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const nameParts = file.name.split('.');
  const ext = nameParts.pop().toLowerCase();
  const baseName = nameParts.join('_').replace(/[^a-zA-Z0-9_]/g, '') || 'CustomFont';
  const fontName = `Custom_${baseName}_${Date.now()}`;
  
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target.result;
    
    // Inject @font-face style
    const style = document.createElement('style');
    const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : 'truetype';
    style.textContent = `@font-face { font-family: '${fontName}'; src: url(${dataUrl}) format('${format}'); }`;
    document.head.appendChild(style);
    
    // Ensure font loads
    try {
      const font = new FontFace(fontName, `url(${dataUrl})`);
      await font.load();
      document.fonts.add(font);
    } catch(err) {
      console.warn("Could not pre-load font via FontFace API, but CSS is injected.", err);
    }
    
    // Add to UI
    const group = $('#customFonts');
    group.hidden = false;
    const opt = document.createElement('option');
    opt.value = fontName;
    opt.textContent = file.name;
    group.appendChild(opt);
    
    // Select and apply
    $('#fontFamily').value = fontName;
    $('#fontFamily').dispatchEvent(new Event('change'));
  };
  reader.readAsDataURL(file);
});

$$('input[name=dir]').forEach(r => r.addEventListener('change', () => {
  schedule();
}));

let pending;
function schedule() {
  if (pending) cancelAnimationFrame(pending);
  pending = requestAnimationFrame(render);
}

// ---------- UI wiring ----------

function bindRange(id, outId, fmt = (v) => v) {
  const el = $('#' + id), out = $('#' + outId);
  const sync = () => { out.textContent = fmt(el.value); schedule(); };
  el.addEventListener('input', sync);
  sync();
}
bindRange('width', 'widthOut');
bindRange('aspect', 'aspectOut', v => (+v).toFixed(2));
bindRange('glitch', 'glitchOut');
bindRange('glitchFreq', 'glitchFreqOut', v => (+v).toFixed(2));
bindRange('glitchSeed', 'glitchSeedOut');

// Set aspect from real font metrics immediately, before first render
applyAutoAspect().then(() => schedule());
// Allow user to snap back to auto-detected value at any time
$('#aspectAuto').addEventListener('click', () => { applyAutoAspect(); });
bindRange('brightness', 'brightnessOut', v => (+v).toFixed(2));
bindRange('contrast', 'contrastOut', v => (+v).toFixed(2));
bindRange('gamma', 'gammaOut', v => (+v).toFixed(2));
bindRange('wordThreshold', 'wordThresholdOut', v => (+v).toFixed(2));
bindRange('edgeThreshold', 'edgeThresholdOut', v => (+v).toFixed(2));
bindRange('mixedEdge', 'mixedEdgeOut', v => (+v).toFixed(2));
bindRange('mixedFill', 'mixedFillOut', v => (+v).toFixed(2));
bindRange('tracking', 'trackingOut', v => (+v).toFixed(1) + 'px');
bindRange('leading', 'leadingOut', v => (+v).toFixed(2));

['invert','dither','grayBias','smartWrap','upperWords','bolden','edgeDir','bgTransparent']
  .forEach(id => $('#' + id).addEventListener('change', schedule));
['ramp','words','mixedWords','edgeChar','filler','blockSet','fg','bg']
  .forEach(id => $('#' + id).addEventListener('input', schedule));
$('#source').addEventListener('change', schedule);

$$('input[name=mode]').forEach(r => r.addEventListener('change', () => {
  const mode = $('input[name=mode]:checked').value;
  $$('.mode-opts').forEach(el => el.hidden = el.dataset.mode !== mode);
  schedule();
}));
$$('input[name=color]').forEach(r => r.addEventListener('change', schedule));

$$('.presets button').forEach(b => b.addEventListener('click', () => {
  $('#ramp').value = b.dataset.ramp;
  schedule();
}));

// ---------- Image loading ----------

function setStatus(msg, isErr) {
  const el = $('#stats');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? '#fca5a5' : '';
}

function loadFile(file) {
  if (!file) { setStatus('no file selected', true); return; }
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)) {
    setStatus(`not an image: ${file.type || file.name}`, true);
    return;
  }
  setStatus(`loading ${file.name} (${(file.size/1024).toFixed(0)} KB)…`);
  const r = new FileReader();
  r.onerror = () => setStatus('FileReader error: ' + (r.error && r.error.message || 'unknown'), true);
  r.onload = e => loadSrc(e.target.result, file.name);
  r.readAsDataURL(file);
}

function loadSrc(src, label) {
  const img = new Image();
  // Only set crossOrigin for external http(s) URLs — setting it on data:/blob:
  // URLs breaks the load in some browsers.
  if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
  img.onload = () => {
    state.img = img;
    try { $('#thumb').src = src; } catch {}
    $('#imgInfo').textContent = `${img.width} × ${img.height}${label ? ' · ' + label : ''}`;
    $('#thumbWrap').hidden = false;
    setStatus(`loaded: ${img.width} × ${img.height}`);
    schedule();
  };
  img.onerror = (e) => {
    setStatus('image failed to decode (bad file or blocked by browser)', true);
    console.error('image load error', e, src.slice(0, 100));
  };
  img.src = src;
}

const fileInput = $('#file');
fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) loadFile(f);
  e.target.value = '';
});
$('#pickBtn').addEventListener('click', () => fileInput.click());
const drop = $('#drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('drag');
  loadFile(e.dataTransfer.files[0]);
});
window.addEventListener('paste', e => {
  if (!e.clipboardData) return;
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) { loadFile(item.getAsFile()); break; }
  }
});
$('#loadUrl').addEventListener('click', () => {
  const u = $('#url').value.trim();
  if (u) loadSrc(u);
});
$('#clearImg').addEventListener('click', () => {
  state.img = null;
  $('#thumbWrap').hidden = true;
  $('#output').textContent = '';
  $('#stats').textContent = 'load an image to begin';
});

// ---------- Core conversion ----------

// Find the bounding box of the image's actual content so we can crop out
// transparent padding (very common for emblem PNGs). Uses a lightweight
// low-res scan of the alpha channel.
function getContentBBox(img) {
  const probe = document.createElement('canvas');
  const maxDim = 400;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  probe.width = Math.max(1, Math.round(img.width * scale));
  probe.height = Math.max(1, Math.round(img.height * scale));
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.clearRect(0, 0, probe.width, probe.height);
  pctx.drawImage(img, 0, 0, probe.width, probe.height);
  const d = pctx.getImageData(0, 0, probe.width, probe.height).data;

  let anyAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 250) { anyAlpha = true; break; }
  }

  let minX = probe.width, minY = probe.height, maxX = -1, maxY = -1;
  for (let y = 0; y < probe.height; y++) {
    for (let x = 0; x < probe.width; x++) {
      const i = (y * probe.width + x) * 4;
      const a = d[i+3];
      const r = d[i], g = d[i+1], b = d[i+2];
      // "content" = non-transparent pixel, OR (no alpha) non-white pixel
      const isContent = anyAlpha
        ? a > 16
        : !(r > 245 && g > 245 && b > 245);
      if (isContent) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: img.width, h: img.height, hasAlpha: anyAlpha };
  // Scale back to source coords, with a 2px margin
  return {
    x: Math.max(0, Math.floor(minX / scale) - 2),
    y: Math.max(0, Math.floor(minY / scale) - 2),
    w: Math.min(img.width  - Math.floor(minX / scale), Math.ceil((maxX - minX + 1) / scale) + 4),
    h: Math.min(img.height - Math.floor(minY / scale), Math.ceil((maxY - minY + 1) / scale) + 4),
    hasAlpha: anyAlpha,
  };
}

function sampleImage() {
  const width = +$('#width').value;
  const aspect = +$('#aspect').value;
  const img = state.img;

  // Crop to content bounding box. Cached on the image object.
  if (!img._bbox) img._bbox = getContentBBox(img);
  const bb = img._bbox;

  const charH = Math.max(1, Math.round((bb.h / bb.w) * width * aspect));

  const canvas = $('#work');
  canvas.width = width;
  canvas.height = charH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, width, charH);
  // Only draw the cropped region, scaled into the target grid
  ctx.drawImage(img, bb.x, bb.y, bb.w, bb.h, 0, 0, width, charH);
  const imageData = ctx.getImageData(0, 0, width, charH);

  return { imageData, width, height: charH, hasAlpha: bb.hasAlpha };
}

function buildBrightnessGrid(imageData, width, height, hasAlpha) {
  const brightness = +$('#brightness').value;
  const contrast = +$('#contrast').value;
  const gamma = +$('#gamma').value;
  const invert = $('#invert').checked;
  const dither = $('#dither').checked;
  const bias = $('#grayBias').checked;

  // "shape source" resolves how we decide which cells are ink.
  // - luma: classic brightness-based (darker pixel = more ink)
  // - alpha: opaque = ink, transparent = empty (perfect for white emblem on transparent bg)
  // - both: both have to agree (dark AND opaque = ink)
  // - auto: alpha if image has transparency, else luma
  let source = $('#source').value;
  if (source === 'auto') source = hasAlpha ? 'alpha' : 'luma';

  const n = width * height;
  const bright = new Float32Array(n);
  const colors = new Array(n);
  const d = imageData.data;

  for (let i = 0; i < n; i++) {
    const r = d[i*4], g = d[i*4+1], b = d[i*4+2], a = d[i*4+3];
    // Display color for image-color mode — transparent pixels fall back to fg so they're not invisible.
    colors[i] = a > 8 ? `rgb(${r},${g},${b})` : '';
    const aN = a / 255;

    let y;
    if (source === 'alpha') {
      // opaque → 0 (dark/ink), transparent → 1 (light/empty)
      y = 1 - aN;
    } else {
      const luma = bias
        ? (0.299*r + 0.587*g + 0.114*b) / 255
        : Math.sqrt((0.299*r*r + 0.587*g*g + 0.114*b*b)) / 255;
      if (source === 'both') {
        // Combine: pixel counts as ink only if it's both opaque AND dark.
        // y is "lightness" (1 = empty). max(1-alpha, luma) -> if either is light, the cell is light.
        y = Math.max(1 - aN, luma);
      } else {
        // luma over white for transparency
        y = luma * aN + (1 - aN);
      }
    }

    // gamma
    y = Math.pow(Math.max(1e-4, y), 1/gamma);
    // contrast + brightness
    y = (y - 0.5) * (1 + contrast) + 0.5 + brightness;
    y = Math.max(0, Math.min(1, y));
    if (invert) y = 1 - y;
    bright[i] = y;
  }

  if (dither) floydSteinberg(bright, width, height, 8);
  return { bright, colors };
}

function floydSteinberg(arr, w, h, levels) {
  const q = levels - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y*w + x;
      const old = arr[i];
      const nw = Math.round(old * q) / q;
      arr[i] = nw;
      const err = old - nw;
      if (x+1 < w)           arr[i+1]     = clip(arr[i+1]     + err * 7/16);
      if (y+1 < h && x > 0)  arr[i+w-1]   = clip(arr[i+w-1]   + err * 3/16);
      if (y+1 < h)           arr[i+w]     = clip(arr[i+w]     + err * 5/16);
      if (y+1 < h && x+1<w)  arr[i+w+1]   = clip(arr[i+w+1]   + err * 1/16);
    }
  }
}
const clip = v => v < 0 ? 0 : v > 1 ? 1 : v;

function sobel(bright, w, h) {
  const edges = new Float32Array(w * h);
  const dirs = new Float32Array(w * h); // angle in radians, 0 for no edge
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const g = (dx, dy) => bright[(y+dy)*w + (x+dx)];
      const gx = -g(-1,-1) - 2*g(-1,0) - g(-1,1) + g(1,-1) + 2*g(1,0) + g(1,1);
      const gy = -g(-1,-1) - 2*g(0,-1) - g(1,-1) + g(-1,1) + 2*g(0,1) + g(1,1);
      const i = y*w + x;
      edges[i] = Math.sqrt(gx*gx + gy*gy);
      dirs[i] = Math.atan2(gy, gx);
    }
  }
  return { edges, dirs };
}

function dirChar(angle) {
  // quantise angle to one of 4 characters
  let a = angle * 180 / Math.PI;
  a = ((a % 180) + 180) % 180; // 0..180
  if (a < 22.5 || a >= 157.5) return '-';
  if (a < 67.5) return '\\';
  if (a < 112.5) return '|';
  return '/';
}

// ---------- Mode renderers ----------

function renderRamp(bright, w, h, grid) {
  const ramp = $('#ramp').value || ' .:-=+*#%@';
  const L = ramp.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y*w + x;
      // dark = first char of ramp; we interpret ramp as "dark → light"
      const idx = Math.min(L-1, Math.max(0, Math.floor((1 - bright[i]) * L)));
      grid[y][x] = ramp[idx];
    }
  }
}

function renderBlocks(bright, w, h, grid) {
  const set = $('#blockSet').value;
  if (set === 'shades') {
    const chars = [' ', '░', '▒', '▓', '█'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      grid[y][x] = chars[Math.min(chars.length-1, Math.floor((1 - bright[i]) * chars.length))];
    }
  } else if (set === 'half') {
    // Pair two rows into one using ▀ (top), ▄ (bottom), █ (both), space (none)
    // Adjust: output height halves
    const newH = Math.floor(h / 2);
    grid.length = newH;
    for (let y = 0; y < newH; y++) grid[y] = new Array(w);
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < w; x++) {
        const top = bright[(2*y)*w + x] < 0.5;
        const bot = bright[(2*y+1)*w + x] < 0.5;
        grid[y][x] = top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
      }
    }
  } else if (set === 'quad') {
    // 2x2 cells → one quadrant char
    const newW = Math.floor(w / 2), newH = Math.floor(h / 2);
    grid.length = newH;
    for (let y = 0; y < newH; y++) grid[y] = new Array(newW);
    const chars = ['▘','▝','▖','▗','▀','▚','▌','▙','▐','▞','▄','▟','▛','▜','█',' '];
    // 4-bit index: TL TR BL BR
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const tl = bright[(2*y)*w + 2*x] < 0.5 ? 1 : 0;
        const tr = bright[(2*y)*w + 2*x+1] < 0.5 ? 1 : 0;
        const bl = bright[(2*y+1)*w + 2*x] < 0.5 ? 1 : 0;
        const br = bright[(2*y+1)*w + 2*x+1] < 0.5 ? 1 : 0;
        const idx = (tl<<3) | (tr<<2) | (bl<<1) | br;
        // map idx → char. standard mapping:
        const map = {
          0b0000: ' ', 0b1000: '▘', 0b0100: '▝', 0b0010: '▖', 0b0001: '▗',
          0b1100: '▀', 0b0011: '▄', 0b1010: '▌', 0b0101: '▐',
          0b1001: '▚', 0b0110: '▞',
          0b1110: '▛', 0b1101: '▜', 0b1011: '▙', 0b0111: '▟',
          0b1111: '█',
        };
        grid[y][x] = map[idx];
      }
    }
  } else if (set === 'braille') {
    // 2 wide × 4 tall cells → braille
    const newW = Math.floor(w / 2), newH = Math.floor(h / 4);
    grid.length = newH;
    for (let y = 0; y < newH; y++) grid[y] = new Array(newW);
    // Braille dot bit positions (Unicode):
    // col0: 0,1,2,6  col1: 3,4,5,7
    const bits = [
      [0, 3], // row 0
      [1, 4], // row 1
      [2, 5], // row 2
      [6, 7], // row 3
    ];
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        let v = 0;
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const b = bright[(4*y+dy)*w + (2*x+dx)] < 0.5;
            if (b) v |= (1 << bits[dy][dx]);
          }
        }
        grid[y][x] = String.fromCharCode(0x2800 + v);
      }
    }
  }
}

function renderWords(bright, w, h, grid) {
  let raw = $('#words').value.trim() || 'WORDS';
  if ($('#upperWords').checked) raw = raw.toUpperCase();
  const smart = $('#smartWrap').checked;
  const useDepth = $('#bolden').checked;
  const threshold = +$('#wordThreshold').value;
  const ramp = $('#ramp').value || ' .:-=+*#%@';
  const filler = ($('#filler').value || '·')[0];

  const ink = (i) => bright[i] < threshold;

  // Pre-fill grid with spaces
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      grid[y][x] = ' ';

  const isRtl = ($('input[name=dir]:checked')?.value === 'rtl');

  if (!smart) {
    // Flow mode: stream clusters through every ink cell; spaces → filler
    // Regex for clusters: handle Thaana consonant + multiple marks, or any other char
    const clusterRegex = /[\u0780-\u07B1][\u07A6-\u07B0]*|[^\s]|./gu;
    const rawClusters = raw.match(clusterRegex) || [];
    const clusters = rawClusters.map(c => /\s/.test(c) ? filler : c);
    let p = 0;
    for (let y = 0; y < h; y++) {
      for (let x = isRtl ? w - 1 : 0; isRtl ? x >= 0 : x < w; isRtl ? x-- : x++) {
        if (!ink(y*w + x)) continue;
        grid[y][x] = clusters[p % clusters.length];
        p++;
      }
    }
  } else {
    // Smart mode: collect ALL ink cells globally (reading order), then
    // tile words continuously through them.
    const words = raw.split(/\s+/).filter(Boolean).map(word => {
      const clusterRegex = /[\u0780-\u07B1][\u07A6-\u07B0]*|./gu;
      return word.match(clusterRegex) || [];
    });
    if (!words.length) return;

    // Build flat list of all ink cells in reading order
    const cells = []; // each entry: { y, x, rowRun } — rowRun = how many contiguous same-row cells from this one
    for (let y = 0; y < h; y++) {
      for (let x = isRtl ? w - 1 : 0; isRtl ? x >= 0 : x < w; isRtl ? x-- : x++) {
        if (ink(y*w + x)) cells.push({ y, x });
      }
    }

    // Precompute per-cell: remaining contiguous run on the same row.
    // Walk backwards so each cell's run = 1 + successor's run if adjacent.
    for (let ci = cells.length - 1; ci >= 0; ci--) {
      const next = cells[ci + 1];
      const nextX = isRtl ? cells[ci].x - 1 : cells[ci].x + 1;
      if (next && next.y === cells[ci].y && next.x === nextX) {
        cells[ci].run = 1 + next.run;
      } else {
        cells[ci].run = 1;
      }
    }

    // Precompute shortest word to avoid infinite loops on tiny runs
    const shortestWord = Math.min(...words.map(s => s.length));

    let ci = 0;  // cell index
    let wi = 0;  // word index (cycles), only advances on successful placement

    while (ci < cells.length) {
      const runAvail = cells[ci].run;

      // If even the shortest word won't fit this run, fill it with filler and move on
      if (shortestWord > runAvail) {
        const end = ci + runAvail;
        for (let k = ci; k < end && k < cells.length; k++) {
          grid[cells[k].y][cells[k].x] = filler;
        }
        ci = end;
        continue;
      }

      const word = words[wi % words.length];
      const wlen = word.length;

      if (wlen > runAvail) {
        // This specific word doesn't fit — try the next word instead
        wi++;
        continue;
      }

      // Place the word and advance the word index
      for (let k = 0; k < wlen; k++) {
        grid[cells[ci + k].y][cells[ci + k].x] = word[k];
      }
      ci += wlen;
      wi++;

      // Insert filler separator if the very next cell is contiguous on same row
      const nextX = isRtl ? cells[ci - 1].x - 1 : cells[ci - 1].x + 1;
      if (
        ci < cells.length &&
        cells[ci].y === cells[ci - 1].y &&
        cells[ci].x === nextX
      ) {
        grid[cells[ci].y][cells[ci].x] = filler;
        ci++;
      }
    }
  }

  // Optional depth shading: very dark ink cells get the heaviest ramp char
  if (useDepth) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x] === ' ') continue;
        if (bright[y*w + x] < 0.12) grid[y][x] = ramp[0];
      }
    }
  }
}

function renderEdges(bright, w, h, grid) {
  const { edges, dirs } = sobel(bright, w, h);
  const thr = +$('#edgeThreshold').value;
  const fallback = ($('#edgeChar').value || '#')[0];
  const directional = $('#edgeDir').checked;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y*w + x;
      if (edges[i] > thr) {
        grid[y][x] = directional ? dirChar(dirs[i]) : fallback;
      } else {
        grid[y][x] = ' ';
      }
    }
  }
}

function renderMixed(bright, w, h, grid) {
  const { edges, dirs } = sobel(bright, w, h);
  const thr = +$('#mixedEdge').value;
  const fillThr = +$('#mixedFill').value;
  let raw = $('#mixedWords').value.trim() || 'ascii';
  if ($('#upperWords').checked) raw = raw.toUpperCase();
  const chars = Array.from(raw).map(c => /\s/.test(c) ? '·' : c);
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y*w + x;
      if (edges[i] > thr) {
        grid[y][x] = dirChar(dirs[i]);
      } else if (bright[i] < fillThr) {
        grid[y][x] = chars[p % chars.length]; p++;
      } else {
        grid[y][x] = ' ';
      }
    }
  }
}

// ---------- Pipeline ----------

function convert() {
  if (!state.img) return null;
  const sampled = sampleImage();
  const { imageData, width, height, hasAlpha } = sampled;
  const { bright, colors } = buildBrightnessGrid(imageData, width, height, hasAlpha);
  const mode = $('input[name=mode]:checked').value;
  const colorMode = $('input[name=color]:checked').value;

  let grid = new Array(height);
  for (let y = 0; y < height; y++) grid[y] = new Array(width);

  if (mode === 'ramp') renderRamp(bright, width, height, grid);
  else if (mode === 'blocks') renderBlocks(bright, width, height, grid);
  else if (mode === 'words') renderWords(bright, width, height, grid);
  else if (mode === 'edges') renderEdges(bright, width, height, grid);
  else if (mode === 'mixed') renderMixed(bright, width, height, grid);

  // resolve final width/height (blocks can shrink grid)
  const outH = grid.length;
  const outW = grid[0] ? grid[0].length : width;

  // Sampled colors need to be remapped if grid shrunk (block modes)
  let outColors = colors;
  if (outW !== width || outH !== height) {
    outColors = new Array(outW * outH);
    const sx = width / outW, sy = height / outH;
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const oi = Math.min(height-1, Math.floor(y * sy)) * width + Math.min(width-1, Math.floor(x * sx));
        outColors[y*outW + x] = colors[oi];
      }
    }
  }

  const glitchIntensity = parseInt($('#glitch').value);
  const glitchFreq = parseFloat($('#glitchFreq').value);
  const glitchSeed = parseInt($('#glitchSeed').value);
  
  if (glitchIntensity > 0) {
    for (let y = 0; y < outH; y++) {
      // Create organic wave-like chunks
      const wave1 = Math.sin(y * glitchFreq + glitchSeed) * Math.cos(y * (glitchFreq * 0.3) + glitchSeed * 2.1);
      
      // Seeded random for sharp jagged tearing within chunks
      const seed = y * 1337 + glitchIntensity + glitchSeed * 997;
      const r = Math.abs(Math.sin(seed)) * 10000;
      const rnd = r - Math.floor(r);
      
      let shift = 0;
      if (Math.abs(wave1) > 0.3) {
        shift = Math.floor(wave1 * glitchIntensity);
        // Add random sharp noise
        if (rnd < 0.4) {
          shift += Math.floor((rnd * 2 - 1) * (glitchIntensity / 2));
        }
      }
      
      if (shift !== 0) {
        const oldRow = [...grid[y]];
        for (let x = 0; x < outW; x++) {
          let nx = x - shift;
          grid[y][x] = (nx >= 0 && nx < outW) ? oldRow[nx] : ' ';
        }
        if (colorMode === 'image') {
          const oldRowColors = outColors.slice(y * outW, (y + 1) * outW);
          for (let x = 0; x < outW; x++) {
            let nx = x - shift;
            outColors[y * outW + x] = (nx >= 0 && nx < outW) ? oldRowColors[nx] : null;
          }
        }
      }
    }
  }

  const lines = grid.map(row => {
    let s = row.join('').replace(/\s+$/, '');
    // Insert Unicode Left-to-Right Override (LRO) to prevent Bidi from ruining ASCII art in text editors
    return '\u202D' + s + '\u202C';
  });
  return { grid, lines, text: lines.join('\n'), colors: outColors, width: outW, height: outH, colorMode };
}

// ---------- DOM rendering ----------

function renderCanvasPreview(r, cvs) {
  const fontSize = PREVIEW_FONT_SIZE;
  const aspect = parseFloat($('#aspect').value);
  const leading = parseFloat($('#leading').value);
  const tracking = parseFloat($('#tracking').value);
  
  const fg = $('#fg').value;
  const fontVal = $('#fontFamily').value;
  const fontStack = fontVal.startsWith('var(') ? MONO_STACK : fontVal;
  
  // Measure actual advance width at this fontSize — pixel-accurate for current font/size.
  const ctx_m = document.createElement('canvas').getContext('2d');
  ctx_m.font = `${fontSize}px ${fontStack}`;
  const charW = ctx_m.measureText('M'.repeat(20)).width / 20;
  const lineH = fontSize * leading;
  
  const W = Math.ceil(r.width * (charW + tracking));
  const H = Math.ceil(r.height * lineH);
  
  const scale = window.devicePixelRatio || 2;
  cvs.width = W * scale;
  cvs.height = H * scale;
  cvs.style.width = `${W}px`;
  cvs.style.height = `${H}px`;
  
  const ctx = cvs.getContext('2d');
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, W, H);
  
  ctx.font = `${fontSize}px ${fontStack}`;
  ctx.textBaseline = 'top';
  
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const ch = r.grid[y][x];
      if (ch === ' ' || !ch) continue;
      ctx.fillStyle = (r.colorMode === 'image') ? r.colors[y*r.width + x] : fg;
      ctx.fillText(ch, x * (charW + tracking), y * lineH);
    }
  }
}

function render() {
  if (!state.img) return;
  const start = performance.now();
  const r = convert();
  if (!r) return;
  state.result = r;

  const out = $('#output');
  const isTransparent = $('#bgTransparent').checked;
  const bg = isTransparent ? 'transparent' : $('#bg').value;
  const tracking = $('#tracking').value;
  const leading = $('#leading').value;
  
  out.style.setProperty('--tracking', tracking + 'px');
  out.style.setProperty('--leading', leading);
  $('.viewer').style.setProperty('--bg-out', bg);

  // Render to canvas for perfect geometric alignment
  renderCanvasPreview(r, $('#outputCanvas'));
  
  // Fill invisible text for selection/copying
  out.textContent = r.text;

  const dt = performance.now() - start;
  $('#stats').textContent = `${r.width} × ${r.height} chars · ${r.lines.length} rows · ${r.text.length.toLocaleString()} glyphs · ${dt.toFixed(0)}ms`;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function buildColoredHtml(r) {
  // collapse consecutive same-color runs to keep the DOM reasonable
  const fg = $('#fg').value;
  const out = [];
  for (let y = 0; y < r.height; y++) {
    let cur = null, buf = '';
    
    for (let x = 0; x < r.width; x++) {
      const c = r.colors[y*r.width + x] || fg;
      const ch = r.grid[y][x];
      if (c !== cur) {
        if (buf) out.push(`<span style="color:${cur}">${escapeHtml(buf)}</span>`);
        cur = c; buf = ch;
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(`<span style="color:${cur}">${escapeHtml(buf)}</span>`);
    out.push('\n');
  }
  return out.join('');
}

// ---------- Zoom ----------

function setZoom(z) {
  state.zoom = Math.max(0.25, Math.min(4, z));
  $('#outputContainer').style.setProperty('--zoom', state.zoom);
  $('#zoomVal').textContent = state.zoom.toFixed(1) + '×';
}
$('#zoomIn').addEventListener('click', () => setZoom(state.zoom * 1.15));
$('#zoomOut').addEventListener('click', () => setZoom(state.zoom / 1.15));
$('#zoomFit').addEventListener('click', () => {
  if (!state.result) return;
  const viewer = $('#viewer');
  const avail = viewer.clientWidth - 40;
  
  // Calculate width based on the actual charW math
  const aspect = parseFloat($('#aspect').value);
  const tracking = parseFloat($('#tracking').value);
  // Use measured charW to match renderCanvasPreview exactly.
  const fontVal_z = $('#fontFamily').value;
  const fontStack_z = fontVal_z.startsWith('var(') ? MONO_STACK : fontVal_z;
  const ctx_z = document.createElement('canvas').getContext('2d');
  ctx_z.font = `${PREVIEW_FONT_SIZE}px ${fontStack_z}`;
  const charW = ctx_z.measureText('M'.repeat(20)).width / 20;
  const totalW = state.result.width * (charW + tracking);
  
  const target = avail / totalW;
  setZoom(target);
});
$('#viewer').addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1/1.1));
}, { passive: false });
setZoom(1);

// ---------- Export ----------

$('#copy').addEventListener('click', async () => {
  if (!state.result) return;
  try {
    await navigator.clipboard.writeText(state.result.text);
    flash($('#copy'), 'copied ✓');
  } catch {
    flash($('#copy'), 'copy failed');
  }
});
$('#saveTxt').addEventListener('click', () => {
  if (!state.result) return;
  download('ascii-art.txt', state.result.text, 'text/plain;charset=utf-8');
});
$('#saveHtml').addEventListener('click', () => {
  if (!state.result) return;
  const r = state.result;
  const isTransparent = $('#bgTransparent').checked;
  const fg = $('#fg').value, bg = isTransparent ? 'transparent' : $('#bg').value;
  const fontVal = $('#fontFamily').value;
  const tracking = $('#tracking').value + 'px';
  const leading = $('#leading').value;
  
  // Extract font-face rules from style.css to include in export
  const fontFaces = Array.from(document.styleSheets[0].cssRules)
    .filter(rule => rule.type === CSSRule.FONT_FACE_RULE)
    .map(rule => rule.cssText)
    .join('\n');

  const body = (r.colorMode === 'image')
    ? buildColoredHtml(r)
    : escapeHtml(r.text);
    
  const isRtl = ($('input[name=dir]:checked')?.value === 'rtl');
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ASCII Art</title>
<style>
${fontFaces}
body { background:${bg}; color:${fg}; margin:0; padding:24px; display:flex; justify-content:center; }
pre { 
  font-family: ${fontVal.startsWith('var(') ? MONO_STACK : fontVal}; 
  line-height: ${leading}; 
  letter-spacing: ${tracking}; 
  font-size: 10px; margin: 0; white-space: pre; 
  direction: ltr;
  unicode-bidi: bidi-override;
  font-variant-ligatures: none;
  font-feature-settings: "kern" 0, "calt" 0, "liga" 0;
}
</style></head>
<body><pre>${body}</pre></body></html>`;
  download('ascii-art.html', html, 'text/html;charset=utf-8');
});
$('#savePng').addEventListener('click', () => {
  if (!state.result) return;
  renderToPng(state.result);
});
$('#saveSvg').addEventListener('click', async () => {
  if (!state.result) return;
  const isOutline = $('#svgOutlines').checked;
  if (isOutline) {
    const btn = $('#saveSvg');
    const prev = btn.textContent;
    btn.textContent = 'processing...';
    try {
      await renderToSvgOutlines(state.result);
    } catch(e) {
      console.error(e);
      alert("Failed to create outlines: " + e.message);
    }
    btn.textContent = prev;
  } else {
    renderToSvg(state.result);
  }
});

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderToPng(r) {
  const fontSize = 24; // base size for crisp PNG
  const aspect = parseFloat($('#aspect').value);
  const charW = fontSize * aspect;
  const leading = parseFloat($('#leading').value);
  const lineH = fontSize * leading;
  const tracking = parseFloat($('#tracking').value);
  const pad = 40;
  
  const cvs = document.createElement('canvas');
  const scale = 2; // retina
  cvs.width  = Math.ceil((r.width * (charW + tracking) + pad * 2) * scale);
  cvs.height = Math.ceil((r.height * lineH + pad * 2) * scale);
  const ctx = cvs.getContext('2d');
  ctx.scale(scale, scale);
  
  const isTransparent = $('#bgTransparent').checked;
  const fg = $('#fg').value, bg = $('#bg').value;
  
  if (!isTransparent) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cvs.width/scale, cvs.height/scale);
  }
  
  const fontVal = $('#fontFamily').value;
  const fontStack = fontVal.startsWith('var(') ? MONO_STACK : fontVal;
  ctx.font = `${fontSize}px ${fontStack}`;
  ctx.textBaseline = 'top';
  
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const ch = r.grid[y][x];
      if (ch === ' ' || !ch) continue;
      ctx.fillStyle = (r.colorMode === 'image') ? r.colors[y*r.width + x] : fg;
      ctx.fillText(ch, pad + x * (charW + tracking), pad + y * lineH);
    }
  }
  
  cvs.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ascii-art.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
  return bytes.buffer;
}

async function renderToSvgOutlines(r) {
  const fontVal = $('#fontFamily').value;
  if (fontVal.startsWith('var(')) {
    alert("Cannot create outlines for default system fonts. Please select a Dhivehi font or upload a custom font.");
    return;
  }
  
  if (typeof opentype === 'undefined') {
    alert("opentype.js is still loading. Please try again in a few seconds.");
    return;
  }
  
  let fontBase64 = null;
  const sheets = Array.from(document.styleSheets);
  for (const sheet of sheets) {
    try {
      const rules = Array.from(sheet.cssRules);
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const fontFamily = rule.style.fontFamily.replace(/['"]/g, '');
          if (fontFamily === fontVal) {
            const src = rule.style.src;
            const match = src.match(/url\(['"]?data:font\/[^;]+;base64,([^'"]+)['"]?\)/);
            if (match) fontBase64 = match[1];
          }
        }
      }
    } catch(e) {}
  }
  
  if (!fontBase64) {
    alert("Could not extract font data for outlines. Ensure the font is fully loaded.");
    return;
  }
  
  const buffer = base64ToArrayBuffer(fontBase64);
  const font = opentype.parse(buffer);
  
  const fontSize = 14;
  
  const fontVal_z = $('#fontFamily').value;
  const fontStack_z = fontVal_z.startsWith('var(') ? MONO_STACK : fontVal_z;
  const ctx_z = document.createElement('canvas').getContext('2d');
  ctx_z.font = `${PREVIEW_FONT_SIZE}px ${fontStack_z}`;
  const charW = ctx_z.measureText('M'.repeat(20)).width / 20;

  const leading = parseFloat($('#leading').value);
  const lineH = fontSize * leading;
  const tracking = parseFloat($('#tracking').value);
  const pad = 20;
  
  const W = Math.ceil(r.width * (charW + tracking) + pad * 2);
  const H = Math.ceil(r.height * lineH + pad * 2);
  const isTransparent = $('#bgTransparent').checked;
  const fg = $('#fg').value, bg = $('#bg').value;
  
  const paths = [];
  const scale = 1 / font.unitsPerEm * fontSize;
  const baselineOffset = font.ascender * scale;
  
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const ch = r.grid[y][x];
      if (ch === ' ' || !ch) continue;
      
      const px = pad + x * (charW + tracking);
      const py = pad + y * lineH + baselineOffset;
      
      const color = (r.colorMode === 'image') ? r.colors[y*r.width + x] : fg;
      const path = font.getPath(ch, px, py, fontSize);
      path.fill = color;
      paths.push(path.toSVG());
    }
  }
  
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${!isTransparent ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}
  <g>
${paths.join('\n')}
  </g>
</svg>`;
  download('ascii-art-outlines.svg', svg, 'image/svg+xml;charset=utf-8');
}

function renderToSvg(r) {
  const fontSize = 14;
  const aspect = parseFloat($('#aspect').value);
  const charW = fontSize * aspect;
  const leading = parseFloat($('#leading').value);
  const lineH = fontSize * leading;
  const tracking = parseFloat($('#tracking').value);
  const pad = 20;
  
  const W = Math.ceil(r.width * (charW + tracking) + pad * 2);
  const H = Math.ceil(r.height * lineH + pad * 2);
  const isTransparent = $('#bgTransparent').checked;
  const fg = $('#fg').value, bg = $('#bg').value;
  
  const fontVal = $('#fontFamily').value;
  const fontStack = fontVal.startsWith('var(') ? '"Courier New", Courier, monospace' : fontVal;

  const fontFaces = Array.from(document.styleSheets)
    .flatMap(sheet => {
      try { return Array.from(sheet.cssRules); } catch(e) { return []; }
    })
    .filter(rule => rule.type === CSSRule.FONT_FACE_RULE)
    .map(rule => rule.cssText)
    .join('\n');

  const lines = r.lines.map((line, y) => {
    // line already contains LRO/PDF from convert(), but we also apply SVG attributes to be absolutely sure
    const safe = escapeHtml(line);
    return `<text x="${pad}" y="${pad + (y+1) * lineH - 2}" xml:space="preserve" direction="ltr" unicode-bidi="bidi-override" letter-spacing="${tracking}">${safe}</text>`;
  }).join('\n');
  
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      ${fontFaces}
      text { font-variant-ligatures: none; font-feature-settings: "kern" 0, "calt" 0, "liga" 0; }
    </style>
  </defs>
  ${!isTransparent ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}
  <g fill="${fg}" font-family="${fontStack}, monospace" font-size="${fontSize}" xml:space="preserve">
${lines}
  </g>
</svg>`;
  download('ascii-art.svg', svg, 'image/svg+xml;charset=utf-8');
}

function flash(btn, txt) {
  const prev = btn.textContent;
  btn.textContent = txt;
  setTimeout(() => { btn.textContent = prev; }, 1100);
}

// ---------- Demo boot ----------

function demo() {
  const c = document.createElement('canvas');
  c.width = 420; c.height = 420;
  const ctx = c.getContext('2d');
  // soft gradient disc
  const g = ctx.createRadialGradient(210, 210, 20, 210, 210, 210);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(0.55, '#f97316');
  g.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 420, 420);
  // emblem star
  ctx.translate(210, 210);
  ctx.fillStyle = '#0b0b0e';
  ctx.beginPath();
  const pts = 5, outer = 150, inner = 65;
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (pts*2)) * Math.PI * 2 - Math.PI/2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  loadSrc(c.toDataURL());
}
demo();
