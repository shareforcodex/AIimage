import { History } from './history.js';
import { Viewport } from './viewport.js';
import { CropMarquee } from './crop.js';
import { blur, sharpen, applyLevels as fxLevels, applyCurves as fxCurves } from './filters.js';
import { saveState, loadState, debounce } from './storage.js';
import { ObjectsManager } from './objects.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
// Offscreen document (image space)
const doc = document.createElement('canvas');
const dctx = doc.getContext('2d', { willReadFrequently: true });

const fileInput = document.getElementById('fileInput');
const presetSelect = document.getElementById('presetSelect');
const customW = document.getElementById('customW');
const customH = document.getElementById('customH');
const applySizeBtn = document.getElementById('applySizeBtn');

const brightness = document.getElementById('brightness');
const contrast = document.getElementById('contrast');
const saturation = document.getElementById('saturation');
const applyAdjustBtn = document.getElementById('applyAdjustBtn');

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

const rotateL = document.getElementById('rotateL');
const rotateR = document.getElementById('rotateR');
const flipH = document.getElementById('flipH');
const flipV = document.getElementById('flipV');

const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomResetBtn = document.getElementById('zoomReset');

const brushToggle = document.getElementById('brushToggle');
const brushColor = document.getElementById('brushColor');
const brushSize = document.getElementById('brushSize');
const clearCanvas = document.getElementById('clearCanvas');

const cropToggle = document.getElementById('cropToggle');
const applyCropBtn = document.getElementById('applyCrop');
const filterBlurBtn = document.getElementById('filterBlur');
const filterSharpenBtn = document.getElementById('filterSharpen');
const levelsBlack = document.getElementById('levelsBlack');
const levelsGamma = document.getElementById('levelsGamma');
const levelsWhite = document.getElementById('levelsWhite');
const applyLevelsBtn = document.getElementById('applyLevels');
const curvesPreset = document.getElementById('curvesPreset');
const applyCurvesBtn = document.getElementById('applyCurves');
const exportBtn = document.getElementById('exportBtn');
const keepAspect = document.getElementById('keepAspect');

// Text tools
const textContent = document.getElementById('textContent');
const textColor = document.getElementById('textColor');
const textSize = document.getElementById('textSize');
const textSizeVal = document.getElementById('textSizeVal');
const textBold = document.getElementById('textBold');
const textFont = document.getElementById('textFont');
const addTextBtn = document.getElementById('addTextBtn');
const drawMode = document.getElementById('drawMode');

const history = new History(50);
let isDrawing = false;
let lastPoint = null;
let isPanning = false;
let spaceKey = false;
let drawTarget = null; // null | { type:'doc' } | { type:'object', id:number, before:any }

const viewport = new Viewport();
const crop = new CropMarquee();
const objects = new ObjectsManager();

// Improve usability on touch/small screens by enlarging handles
function isCoarsePointer() {
  try {
    return (
      (window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches)) ||
      (navigator.maxTouchPoints || 0) > 0
    );
  } catch (_) { return (navigator.maxTouchPoints || 0) > 0; }
}
function desiredHandleSize() {
  const smallViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 768;
  const coarse = isCoarsePointer();
  const base = 20; // default desktop size
  const touchSize = 40; // larger, easier to hit
  let size = (coarse || smallViewport) ? touchSize : base;
  // Slight bump on very high DPR screens for comfort
  const dpr = window.devicePixelRatio || 1;
  if (size >= touchSize && dpr > 2) size = Math.round(size * 1.1);
  return size;
}
function applyHandleSize() {
  const hs = desiredHandleSize();
  crop.handleSize = hs;
  objects.handleSize = hs;
}
applyHandleSize();
window.addEventListener('resize', () => { applyHandleSize(); render(); });

const persist = debounce(() => saveState(doc, { scale: viewport.scale, tx: viewport.tx, ty: viewport.ty }, objects), 300);

// Objects action history (for undo/redo of move/resize/crop/add)
const objHistory = { undo: [], redo: [] };
let objActionStart = null; // deep clone of item before modification

function cloneItem(it) {
  const c = document.createElement('canvas');
  c.width = it.canvas.width; c.height = it.canvas.height;
  c.getContext('2d').drawImage(it.canvas, 0, 0);
  return { id: it.id, canvas: c, x: it.x, y: it.y, w: it.w, h: it.h, sx: it.sx, sy: it.sy, sw: it.sw, sh: it.sh };
}

function cloneAllItems() {
  return objects.items.map(cloneItem);
}

function doObjUndo() {
  const act = objHistory.undo.pop();
  if (!act) return;
  if (act.type === 'add') {
    objects.removeById(act.item.id);
    objHistory.redo.push({ type: 'add', item: act.item });
  } else if (act.type === 'modify') {
    objects.setFromData(act.id, act.before);
    objHistory.redo.push({ type: 'modify', id: act.id, before: act.before, after: act.after });
  } else if (act.type === 'replace') {
    // Replace entire collection
    objects.items = [];
    objects.selectedId = null;
    objects.nextId = 1;
    for (const data of act.before) objects.addFromData(data);
    objHistory.redo.push({ type: 'replace', before: act.before, after: act.after });
  }
}

function doObjRedo() {
  const act = objHistory.redo.pop();
  if (!act) return;
  if (act.type === 'add') {
    objects.addFromData(act.item);
    objHistory.undo.push({ type: 'add', item: act.item });
  } else if (act.type === 'modify') {
    objects.setFromData(act.id, act.after);
    objHistory.undo.push({ type: 'modify', id: act.id, before: act.before, after: act.after });
  } else if (act.type === 'replace') {
    objects.items = [];
    objects.selectedId = null;
    objects.nextId = 1;
    for (const data of act.after) objects.addFromData(data);
    objHistory.undo.push({ type: 'replace', before: act.before, after: act.after });
  }
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  viewport.apply(ctx);
  ctx.drawImage(doc, 0, 0);
  objects.draw(ctx);
  ctx.restore();
  // Draw document boundary
  ctx.save();
  viewport.apply(ctx);
  ctx.strokeStyle = '#5a5a5a';
  ctx.lineWidth = 1 / viewport.scale;
  ctx.setLineDash([4 / viewport.scale, 4 / viewport.scale]);
  ctx.strokeRect(0.5 / viewport.scale, 0.5 / viewport.scale, doc.width - 1 / viewport.scale, doc.height - 1 / viewport.scale);
  ctx.setLineDash([]);
  ctx.restore();
  crop.draw(ctx, viewport, canvas);
  objects.drawSelection(ctx, viewport);
  updateStatus();
}

function snapshot() {
  try {
    const data = dctx.getImageData(0, 0, doc.width, doc.height);
    history.push(data);
    updateUndoRedoState();
    persist();
  } catch (e) {
    console.warn('Snapshot failed:', e);
  }
}

function restore(imageData) {
  if (!imageData) return;
  doc.width = imageData.width; doc.height = imageData.height;
  dctx.putImageData(imageData, 0, 0);
  canvas.width = doc.width; canvas.height = doc.height;
  viewport.reset(doc.width, doc.height, canvas.width, canvas.height);
  crop.setToDocument(doc.width, doc.height);
  updateUndoRedoState();
  render();
}

function updateUndoRedoState() {
  const canObjUndo = objHistory.undo.length > 0;
  const canObjRedo = objHistory.redo.length > 0;
  undoBtn.disabled = !(history.canUndo() || canObjUndo);
  redoBtn.disabled = !(history.canRedo() || canObjRedo);
}

function fitAndDrawImage(img) {
  const cw = doc.width, ch = doc.height;
  const scale = Math.min(cw / img.width, ch / img.height);
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);
  const dx = Math.floor((cw - dw) / 2);
  const dy = Math.floor((ch - dh) / 2);
  dctx.clearRect(0, 0, cw, ch);
  dctx.drawImage(img, dx, dy, dw, dh);
  render();
}

function setCanvasSize(w, h, preserve = true) {
  w = clampInt(w, 64, 4096);
  h = clampInt(h, 64, 4096);
  if (preserve) {
    const prev = dctx.getImageData(0, 0, doc.width, doc.height);
    const tmp = document.createElement('canvas');
    tmp.width = prev.width; tmp.height = prev.height;
    tmp.getContext('2d').putImageData(prev, 0, 0);
    doc.width = w; doc.height = h;
    canvas.width = w; canvas.height = h;
    viewport.reset(doc.width, doc.height, canvas.width, canvas.height);
    dctx.clearRect(0, 0, w, h);
    fitAndDrawImage(tmp);
  } else {
    doc.width = w; doc.height = h;
    canvas.width = w; canvas.height = h;
    dctx.clearRect(0, 0, w, h);
    viewport.reset(doc.width, doc.height, canvas.width, canvas.height);
    render();
  }
  snapshot();
  updateStatus();
}

function clampInt(n, min, max) {
  n = Math.round(Number(n) || 0);
  return Math.max(min, Math.min(max, n));
}

// Image loading
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  // Place each image as an object, centered; for the first image on empty doc, fit canvas size
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = url; });
    URL.revokeObjectURL(url);
    // Create canvas for the image at original size
    const tmp = document.createElement('canvas');
    tmp.width = img.width; tmp.height = img.height;
    tmp.getContext('2d').drawImage(img, 0, 0);
    // Position at current viewport top-left in image coords
    const tl = viewport.canvasToImage({ x: 0, y: 0 });
    objects.addImageBitmap(tmp, { x: Math.round(tl.x), y: Math.round(tl.y) });
  }
  render();
  persist();
});

function isCanvasBlank() {
  const data = dctx.getImageData(0, 0, doc.width, doc.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}

function bestFitSize(w, h) {
  const maxSide = 1536;
  const scale = Math.min(maxSide / w, maxSide / h, 1);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// Presets and custom size
presetSelect.addEventListener('change', () => {
  if (!presetSelect.value) return;
  const [w, h] = presetSelect.value.split('x').map(Number);
  setCanvasSize(w, h);
});
applySizeBtn.addEventListener('click', () => {
  const w = Number(customW.value);
  const h = Number(customH.value);
  if (w && h) setCanvasSize(w, h);
});

// Undo/Redo
undoBtn.addEventListener('click', () => { restore(history.undo()); doObjUndo(); render(); persist(); updateUndoRedoState(); });
redoBtn.addEventListener('click', () => { restore(history.redo()); doObjRedo(); render(); persist(); updateUndoRedoState(); });

window.addEventListener('keydown', (e) => {
  const z = e.key.toLowerCase() === 'z';
  const y = e.key.toLowerCase() === 'y';
  const mod = e.metaKey || e.ctrlKey;
  if (mod && z && !e.shiftKey) { e.preventDefault(); undoBtn.click(); }
  if (mod && (e.shiftKey && z || y)) { e.preventDefault(); redoBtn.click(); }
});

// Adjustments
applyAdjustBtn.addEventListener('click', () => {
  const b = Number(brightness.value) || 0;
  const c = Number(contrast.value) || 0;
  const s = Number(saturation.value) || 0;
  applyAdjustments({ brightness: b, contrast: c, saturation: s });
  brightness.value = '0'; contrast.value = '0'; saturation.value = '0';
});

function applyAdjustments({ brightness = 0, contrast = 0, saturation = 0 }) {
  const img = dctx.getImageData(0, 0, doc.width, doc.height);
  const data = img.data;
  const bOff = (brightness / 100) * 255;
  const cFactor = (259 * (contrast + 100)) / (255 * (100 - contrast));
  const sFactor = (saturation / 100) + 1;
  const sInv = 1 - sFactor;
  const R = 0.2126, G = 0.7152, B = 0.0722;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    r = clampByte(cFactor * (r - 128) + 128 + bOff);
    g = clampByte(cFactor * (g - 128) + 128 + bOff);
    b = clampByte(cFactor * (b - 128) + 128 + bOff);
    const lum = (R * r + G * g + B * b);
    r = clampByte(lum * sInv + r * sFactor);
    g = clampByte(lum * sInv + g * sFactor);
    b = clampByte(lum * sInv + b * sFactor);
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  dctx.putImageData(img, 0, 0);
  render();
  snapshot();
}

function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// Transforms
rotateL.addEventListener('click', () => rotate(-90));
rotateR.addEventListener('click', () => rotate(90));
flipH.addEventListener('click', () => flip(true, false));
flipV.addEventListener('click', () => flip(false, true));

function rotate(deg) {
  const rad = (deg * Math.PI) / 180;
  const src = dctx.getImageData(0, 0, doc.width, doc.height);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = src.width; srcCanvas.height = src.height;
  srcCanvas.getContext('2d').putImageData(src, 0, 0);
  if (Math.abs(deg) === 90 || Math.abs(deg) === 270) {
    doc.width = src.height; doc.height = src.width;
    canvas.width = doc.width; canvas.height = doc.height;
  } else if (Math.abs(deg) === 180) {
    doc.width = src.width; doc.height = src.height;
    canvas.width = doc.width; canvas.height = doc.height;
  }
  dctx.save();
  dctx.clearRect(0, 0, doc.width, doc.height);
  dctx.translate(doc.width / 2, doc.height / 2);
  dctx.rotate(rad);
  dctx.drawImage(srcCanvas, -src.width / 2, -src.height / 2);
  dctx.restore();
  viewport.reset(doc.width, doc.height, canvas.width, canvas.height);
  render();
  snapshot();
}

function flip(horizontal, vertical) {
  const src = dctx.getImageData(0, 0, doc.width, doc.height);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = src.width; srcCanvas.height = src.height;
  srcCanvas.getContext('2d').putImageData(src, 0, 0);
  dctx.save();
  dctx.clearRect(0, 0, doc.width, doc.height);
  dctx.translate(horizontal ? doc.width : 0, vertical ? doc.height : 0);
  dctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  dctx.drawImage(srcCanvas, 0, 0);
  dctx.restore();
  render();
  snapshot();
}

// Brush toggle
brushToggle.addEventListener('click', () => {
  const active = brushToggle.getAttribute('aria-pressed') === 'true';
  brushToggle.setAttribute('aria-pressed', String(!active));
  if (!active) {
    if (cropToggle) cropToggle.setAttribute('aria-pressed', 'false');
    crop.active = false;
    // Turning Brush on should disable Add/Draw mode to avoid conflicts
    if (drawMode) drawMode.checked = false;
    render();
  }
});

// Draw Mode toggle in Add menu: disable Brush when enabled
if (drawMode) {
  drawMode.addEventListener('change', () => {
    if (drawMode.checked) {
      brushToggle.setAttribute('aria-pressed', 'false');
    }
  });
}

function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}
function getImagePoint(e) {
  const cpt = getCanvasPoint(e);
  return viewport.canvasToImage(cpt);
}

function drawLine(a, b) {
  const useText = !!(drawMode && drawMode.checked);
  const color = useText ? (textColor && textColor.value) || '#ffffff' : brushColor.value;
  const width = useText ? Math.max(1, Number((textSize && textSize.value) || 1)) : Number(brushSize.value);

  // If drawing on an object, map points into object canvas space and draw there.
  if (drawTarget && drawTarget.type === 'object') {
    const it = objects.getById(drawTarget.id);
    if (!it) return;
    const ctx2 = it.canvas.getContext('2d');
    // Map image-space point -> object canvas pixel
    const mapPt = (p) => {
      const tx = (p.x - it.x) / it.w;
      const ty = (p.y - it.y) / it.h;
      const sx = it.sx + tx * it.sw;
      const sy = it.sy + ty * it.sh;
      return { x: sx, y: sy };
    };
    const p1 = mapPt(a);
    const p2 = mapPt(b);
    const scaleX = it.sw / Math.max(1, it.w);
    const scaleY = it.sh / Math.max(1, it.h);
    const lw = Math.max(1, width * ((scaleX + scaleY) / 2));
    ctx2.strokeStyle = color;
    ctx2.lineWidth = lw;
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';
    ctx2.beginPath();
    ctx2.moveTo(p1.x, p1.y);
    ctx2.lineTo(p2.x, p2.y);
    ctx2.stroke();
    render();
    return;
  }

  // Default: draw on background document
  dctx.strokeStyle = color;
  dctx.lineWidth = width;
  dctx.lineCap = 'round';
  dctx.lineJoin = 'round';
  dctx.beginPath();
  dctx.moveTo(a.x, a.y);
  dctx.lineTo(b.x, b.y);
  dctx.stroke();
  render();
}

// Pointer interactions
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const isBrush = (brushToggle.getAttribute('aria-pressed') === 'true') || (drawMode && drawMode.checked);
  const isCrop = (cropToggle && cropToggle.getAttribute('aria-pressed') === 'true') && crop.active;
  if (isCrop) {
    const ip = getImagePoint(e);
    const mode = crop.hitTest(ip) || 'move';
    crop.beginDrag(mode, ip);
    return;
  }
  if (spaceKey || e.button === 1) {
    isPanning = true;
    lastPoint = getCanvasPoint(e);
    return;
  }
  // Objects interactions if not brush
  if (!isBrush) {
    const ip = getImagePoint(e);
    const acted = objects.beginInteraction(ip);
    if (acted) {
      // capture starting state for history
      const sel = objects.selected;
      if (sel) objActionStart = cloneItem(sel);
      render();
      return;
    }
  }
  if (isBrush) {
    isDrawing = true;
    lastPoint = getImagePoint(e);
    // Decide draw target: topmost object under pointer, otherwise background doc
    const hitId = objects.hitTest(lastPoint);
    if (hitId) {
      const it = objects.getById(hitId);
      if (it) {
        drawTarget = { type: 'object', id: hitId, before: cloneItem(it) };
      } else {
        drawTarget = { type: 'doc' };
      }
    } else {
      drawTarget = { type: 'doc' };
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (crop.drag) {
    const ip = getImagePoint(e);
    crop.updateDrag(ip, { x: 0, y: 0, w: doc.width, h: doc.height });
    render();
    return;
  }
  if (isPanning) {
    const p = getCanvasPoint(e);
    viewport.panBy(p.x - lastPoint.x, p.y - lastPoint.y);
    lastPoint = p;
    render();
    return;
  }
  if (objects.drag) {
    const ip = getImagePoint(e);
    if (objects.updateInteraction(ip)) render();
    return;
  }
  if (!isDrawing) return;
  const p = getImagePoint(e);
  drawLine(lastPoint, p);
  lastPoint = p;
});
function endStroke() {
  if (isDrawing) {
    isDrawing = false; lastPoint = null;
    if (drawTarget && drawTarget.type === 'object') {
      const it = objects.getById(drawTarget.id);
      if (it && drawTarget.before) {
        const after = cloneItem(it);
        objHistory.undo.push({ type: 'modify', id: it.id, before: drawTarget.before, after });
        objHistory.redo.length = 0; updateUndoRedoState();
        persist();
      }
    } else {
      // Background raster changed
      snapshot();
    }
    drawTarget = null;
  }
  if (isPanning) { isPanning = false; }
  if (crop.drag) { crop.endDrag(); }
  if (objects.drag) {
    objects.endInteraction();
    const sel = objects.selected;
    if (sel && objActionStart && sel.id === objActionStart.id) {
      const after = cloneItem(sel);
      objHistory.undo.push({ type: 'modify', id: sel.id, before: objActionStart, after });
      objHistory.redo.length = 0; // clear redo on new action
      updateUndoRedoState();
    }
    objActionStart = null;
    persist();
  }
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

clearCanvas.addEventListener('click', () => {
  // Capture state for undo (objects + background)
  const beforeObjects = cloneAllItems();
  // Clear background and remove all objects
  dctx.clearRect(0, 0, doc.width, doc.height);
  objects.items = [];
  objects.selectedId = null;
  objects.nextId = 1;
  // Record replace action for object history and clear redo stack
  objHistory.undo.push({ type: 'replace', before: beforeObjects, after: [] });
  objHistory.redo.length = 0;
  // Push raster snapshot too so background can undo
  render();
  snapshot();
  persist();
  updateUndoRedoState();
});

// Zoom controls
function updateZoomLabel() { if (zoomResetBtn) zoomResetBtn.textContent = `${Math.round(viewport.scale * 100)}%`; }
if (zoomInBtn) zoomInBtn.addEventListener('click', () => { viewport.zoomAt(1.2, canvas.width / 2, canvas.height / 2); updateZoomLabel(); render(); });
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { viewport.zoomAt(1 / 1.2, canvas.width / 2, canvas.height / 2); updateZoomLabel(); render(); });
if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { viewport.reset(doc.width, doc.height, canvas.width, canvas.height); updateZoomLabel(); render(); });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const cpt = getCanvasPoint(e);
  if (e.ctrlKey) {
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    viewport.zoomAt(factor, cpt.x, cpt.y);
    updateZoomLabel();
    render();
  } else {
    viewport.panBy(-e.deltaX, -e.deltaY);
    render();
  }
}, { passive: false });

// Space to pan
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { spaceKey = true; e.preventDefault(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceKey = false; } });

// Pinch-to-zoom via two pointers
const touches = new Map();
let pinchStart = null;
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touches.set(e.pointerId, getCanvasPoint(e)); });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') return;
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, getCanvasPoint(e));
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!pinchStart) pinchStart = { lastDist: dist };
    const factor = dist / (pinchStart.lastDist || dist);
    pinchStart.lastDist = dist;
    viewport.zoomAt(factor, mid.x, mid.y);
    updateZoomLabel();
    render();
  }
});
canvas.addEventListener('pointerup', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinchStart = null; });
canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinchStart = null; });

// Crop controls (optional if present)
if (cropToggle) cropToggle.addEventListener('click', () => {
  const active = cropToggle.getAttribute('aria-pressed') === 'true';
  const next = !active;
  cropToggle.setAttribute('aria-pressed', String(next));
  crop.toggle(next);
  if (next) {
    brushToggle.setAttribute('aria-pressed', 'false');
    crop.setToDocument(doc.width, doc.height);
  }
  render();
});
if (applyCropBtn) applyCropBtn.addEventListener('click', () => {
  if (!crop.active) return;
  const { x, y, w, h } = crop.rect;
  if (w < 1 || h < 1) return;
  // Render full scene (doc + objects) to temp, then slice crop rect
  const tmp = document.createElement('canvas');
  tmp.width = doc.width; tmp.height = doc.height;
  const tctx = tmp.getContext('2d');
  tctx.clearRect(0, 0, tmp.width, tmp.height);
  tctx.drawImage(doc, 0, 0);
  for (const it of objects.items) tctx.drawImage(it.canvas, it.x, it.y, it.w, it.h);

  const cut = document.createElement('canvas');
  cut.width = w; cut.height = h;
  const cctx = cut.getContext('2d');
  cctx.drawImage(tmp, x, y, w, h, 0, 0, w, h);

  const id = objects.addImageBitmap(cut, { x, y });
  objects.selectedId = id;
  // record add action for undo
  const it = objects.getById(id);
  if (it) {
    objHistory.undo.push({ type: 'add', item: cloneItem(it) });
    objHistory.redo.length = 0;
    updateUndoRedoState();
  }
  crop.toggle(false);
  if (cropToggle) cropToggle.setAttribute('aria-pressed', 'false');
  render();
  persist();
});

// Filters
filterBlurBtn.addEventListener('click', () => { blur(dctx); render(); snapshot(); });
filterSharpenBtn.addEventListener('click', () => { sharpen(dctx); render(); snapshot(); });
applyLevelsBtn.addEventListener('click', () => {
  const black = Number(levelsBlack.value) || 0;
  const gamma = (Number(levelsGamma.value) || 100) / 100;
  const white = Number(levelsWhite.value) || 255;
  fxLevels(dctx, { black, gamma, white });
  render();
  snapshot();
});
applyCurvesBtn.addEventListener('click', () => {
  fxCurves(dctx, curvesPreset.value);
  render();
  snapshot();
});

// Initialize
(async () => {
  doc.width = canvas.width; doc.height = canvas.height;
  viewport.reset(doc.width, doc.height, canvas.width, canvas.height);
  const restored = await loadState(doc, dctx);
  if (restored) {
    canvas.width = doc.width; canvas.height = doc.height;
    if (restored.view) {
      viewport.scale = restored.view.scale || 1;
      viewport.tx = restored.view.tx || 0;
      viewport.ty = restored.view.ty || 0;
    } else {
      viewport.reset(doc.width, doc.height, canvas.width, canvas.height);
    }
    if (restored.objects && restored.objects.length) {
      await objects.load(restored.objects);
    }
    crop.setToDocument(doc.width, doc.height);
    render();
    snapshot();
  } else {
    dctx.clearRect(0, 0, doc.width, doc.height);
    render();
    snapshot();
  }
  updateZoomLabel();
  updateStatus();
})();

// Menubar behavior: only one open at a time, close on item click
const menus = Array.from(document.querySelectorAll('.menubar .menu'));
for (const m of menus) {
  m.addEventListener('toggle', () => {
    if (m.open) {
      for (const other of menus) if (other !== m && other.open) other.open = false;
    }
  });
}

// Settings
if (keepAspect) {
  objects.keepAspect = !!keepAspect.checked;
  keepAspect.addEventListener('change', () => {
    objects.keepAspect = !!keepAspect.checked;
  });
}

// Export composite (doc + objects) as PNG
if (exportBtn) exportBtn.addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  // Export exactly the document boundary size (same as canvas intrinsic size)
  tmp.width = canvas.width; tmp.height = canvas.height;
  const tctx = tmp.getContext('2d');
  tctx.clearRect(0, 0, tmp.width, tmp.height);
  tctx.drawImage(doc, 0, 0);
  for (const it of objects.items) tctx.drawImage(it.canvas, it.x, it.y, it.w, it.h);
  tmp.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'export.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});

function updateStatus() {
  if (!statusBar) return;
  const dim = `${canvas.width}×${canvas.height}`;
  const zoom = `${Math.round(viewport.scale * 100)}%`;
  statusBar.textContent = `${dim}  •  Zoom ${zoom}`;
}

// Text: create canvas for text and add as object
function createTextCanvas(text, { size = 48, color = '#ffffff', bold = false, font = 'Arial' } = {}) {
  const pad = Math.ceil(size * 0.25);
  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d');
  const fontStr = `${bold ? 'bold ' : ''}${size}px ${font}`;
  tctx.font = fontStr;
  tctx.textBaseline = 'alphabetic';
  const metrics = tctx.measureText(text || '');
  const ascent = Math.max(metrics.actualBoundingBoxAscent || size * 0.8, 1);
  const descent = Math.max(metrics.actualBoundingBoxDescent || size * 0.2, 0);
  const w = Math.ceil((metrics.width || 1) + pad * 2);
  const h = Math.ceil(ascent + descent + pad * 2);
  tmp.width = Math.max(1, w);
  tmp.height = Math.max(1, h);
  const ctx2 = tmp.getContext('2d');
  ctx2.font = fontStr;
  ctx2.fillStyle = color;
  ctx2.textBaseline = 'alphabetic';
  ctx2.fillText(text || '', pad, pad + ascent);
  return tmp;
}

if (addTextBtn) {
  addTextBtn.addEventListener('click', () => {
    const txt = (textContent && textContent.value) || 'Text';
    const size = Math.max(6, Math.min(512, Number(textSize && textSize.value) || 48));
    const color = (textColor && textColor.value) || '#ffffff';
    const bold = !!(textBold && textBold.checked);
    const font = (textFont && textFont.value) || 'Arial';
    const c = createTextCanvas(txt, { size, color, bold, font });
    // Place at current viewport top-left for visibility
    const tl = viewport.canvasToImage({ x: 20, y: 20 });
    const id = objects.addImageBitmap(c, { x: Math.round(tl.x), y: Math.round(tl.y) });
    objects.selectedId = id;
    // record add action
    const it = objects.getById(id);
    if (it) {
      objHistory.undo.push({ type: 'add', item: cloneItem(it) });
      objHistory.redo.length = 0; updateUndoRedoState();
    }
    render();
    persist();
  });
}

// Reflect Text Size slider value next to the control
function updateTextSizeLabel() {
  if (textSize && textSizeVal) textSizeVal.textContent = String(textSize.value);
}
if (textSize) {
  textSize.addEventListener('input', updateTextSizeLabel);
  updateTextSizeLabel();
}
