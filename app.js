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
function measureCharAspect() {
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d');
  const selectedFont = $('#fontFamily').value;
  const fontStack = selectedFont.startsWith('var(') ? 'ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace' : selectedFont;
  ctx.font = `20px ${fontStack}`; // Use larger size for better precision
  // Measure a string and divide by count to get average width
  const testStr = "އަހަރެން12345"; 
  const clusters = testStr.match(/[\u0780-\u07B1][\u07A6-\u07B0]*|./gu) || [];
  const totalW = ctx.measureText(testStr).width;
  const charW = totalW / clusters.length;
  const charH = 20; 
  return Math.round((charW / charH) * 100) / 100;
}

async function applyAutoAspect() {
  const selectedFont = $('#fontFamily').value;
  
  // Only try to load if it's a custom font (not a CSS variable)
  if (selectedFont && !selectedFont.startsWith('var(')) {
    try {
      const fontSpec = `20px "${selectedFont}"`;
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
  if (!val.startsWith('var(')) {
    $$('input[name=dir]').forEach(r => r.checked = (r.value === 'rtl'));
    $('#output').dir = 'rtl';
  } else {
    $$('input[name=dir]').forEach(r => r.checked = (r.value === 'ltr'));
    $('#output').dir = 'ltr';
  }
  await applyAutoAspect();
});

$$('input[name=dir]').forEach(r => r.addEventListener('change', () => {
  $('#output').dir = $('input[name=dir]:checked').value;
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

['invert','dither','grayBias','smartWrap','upperWords','bolden','edgeDir']
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

  if (!smart) {
    // Flow mode: stream clusters through every ink cell; spaces → filler
    // Regex for clusters: handle Thaana consonant + multiple marks, or any other char
    const clusterRegex = /[\u0780-\u07B1][\u07A6-\u07B0]*|[^\s]|./gu;
    const rawClusters = raw.match(clusterRegex) || [];
    const clusters = rawClusters.map(c => /\s/.test(c) ? filler : c);
    let p = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
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
      for (let x = 0; x < w; x++) {
        if (ink(y*w + x)) cells.push({ y, x });
      }
    }

    // Precompute per-cell: remaining contiguous run on the same row.
    // Walk backwards so each cell's run = 1 + successor's run if adjacent.
    for (let ci = cells.length - 1; ci >= 0; ci--) {
      const next = cells[ci + 1];
      if (next && next.y === cells[ci].y && next.x === cells[ci].x + 1) {
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
      if (
        ci < cells.length &&
        cells[ci].y === cells[ci - 1].y &&
        cells[ci].x === cells[ci - 1].x + 1
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

  const lines = grid.map(row => {
    // If RTL, reverse the row array so the browser's RTL flip restores the LTR image shape
    const processedRow = ($('input[name=dir]:checked')?.value === 'rtl') ? [...row].reverse() : row;
    return processedRow.join('').replace(/\s+$/, '');
  });
  return { grid, lines, text: lines.join('\n'), colors: outColors, width: outW, height: outH, colorMode };
}

// ---------- DOM rendering ----------

function render() {
  if (!state.img) return;
  const start = performance.now();
  const r = convert();
  if (!r) return;
  state.result = r;

  const out = $('#output');
  const fg = $('#fg').value, bg = $('#bg').value;
  const tracking = $('#tracking').value;
  const leading = $('#leading').value;
  out.style.setProperty('--fg-out', fg);
  out.style.setProperty('--tracking', tracking + 'px');
  out.style.setProperty('--leading', leading);
  $('.viewer').style.setProperty('--bg-out', bg);

  if (r.colorMode === 'image') {
    out.innerHTML = buildColoredHtml(r);
  } else if (r.colorMode === 'solid') {
    out.textContent = r.text;
    out.style.setProperty('--fg-out', fg);
  } else {
    out.textContent = r.text;
  }

  const dt = performance.now() - start;
  $('#stats').textContent = `${r.width} × ${r.height} chars · ${r.lines.length} rows · ${r.text.length.toLocaleString()} glyphs · ${dt.toFixed(0)}ms`;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function buildColoredHtml(r) {
  // collapse consecutive same-color runs to keep the DOM reasonable
  const fg = $('#fg').value;
  const isRtl = ($('input[name=dir]:checked')?.value === 'rtl');
  const out = [];
  for (let y = 0; y < r.height; y++) {
    let cur = null, buf = '';
    
    // Reverse logic for RTL to keep image LTR
    const rowChars = isRtl ? [...r.grid[y]].reverse() : r.grid[y];
    const rowColors = [];
    if (isRtl) {
      for (let x = r.width - 1; x >= 0; x--) rowColors.push(r.colors[y * r.width + x]);
    } else {
      for (let x = 0; x < r.width; x++) rowColors.push(r.colors[y * r.width + x]);
    }

    for (let x = 0; x < r.width; x++) {
      const c = rowColors[x] || fg;
      const ch = rowChars[x];
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
  $('#output').style.setProperty('--zoom', state.zoom);
  $('#zoomVal').textContent = state.zoom.toFixed(1) + '×';
}
$('#zoomIn').addEventListener('click', () => setZoom(state.zoom * 1.15));
$('#zoomOut').addEventListener('click', () => setZoom(state.zoom / 1.15));
$('#zoomFit').addEventListener('click', () => {
  if (!state.result) return;
  const viewer = $('#viewer');
  const avail = viewer.clientWidth - 40;
  const baseCharW = 10 * 0.6; // font-size 10px * 0.6 monospace aspect
  const target = avail / (state.result.width * baseCharW);
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
  const fg = $('#fg').value, bg = $('#bg').value;
  const body = (r.colorMode === 'image')
    ? buildColoredHtml(r)
    : escapeHtml(r.text);
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ASCII Art</title></head>
<body style="background:${bg};color:${fg};margin:0;padding:24px;">
<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;line-height:1;font-size:10px;margin:0;">${body}</pre>
</body></html>`;
  download('ascii-art.html', html, 'text/html;charset=utf-8');
});
$('#savePng').addEventListener('click', () => {
  if (!state.result) return;
  renderToPng(state.result);
});
$('#saveSvg').addEventListener('click', () => {
  if (!state.result) return;
  renderToSvg(state.result);
});

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderToPng(r) {
  const fontSize = 16;
  const charW = fontSize * 0.6;
  const lineH = fontSize * 1.0;
  const pad = 24;
  const cvs = document.createElement('canvas');
  const scale = 2; // retina
  cvs.width  = Math.ceil((r.width * charW + pad * 2) * scale);
  cvs.height = Math.ceil((r.height * lineH + pad * 2) * scale);
  const ctx = cvs.getContext('2d');
  ctx.scale(scale, scale);
  const fg = $('#fg').value, bg = $('#bg').value;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cvs.width/scale, cvs.height/scale);
  ctx.font = `${fontSize}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const ch = r.grid[y][x];
      if (ch === ' ') continue;
      ctx.fillStyle = (r.colorMode === 'image') ? r.colors[y*r.width + x] : fg;
      ctx.fillText(ch, pad + x * charW, pad + y * lineH);
    }
  }
  cvs.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ascii-art.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function renderToSvg(r) {
  const fontSize = 14;
  const charW = fontSize * 0.6;
  const lineH = fontSize * 1.0;
  const pad = 20;
  const W = Math.ceil(r.width * charW + pad * 2);
  const H = Math.ceil(r.height * lineH + pad * 2);
  const fg = $('#fg').value, bg = $('#bg').value;
  const lines = r.lines.map((line, y) => {
    const safe = escapeHtml(line);
    return `<text x="${pad}" y="${pad + (y+1) * lineH - 2}" xml:space="preserve">${safe}</text>`;
  }).join('\n');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <g fill="${fg}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${fontSize}" xml:space="preserve">
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
