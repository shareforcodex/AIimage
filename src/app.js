import { History } from './history.js';
import { Viewport } from './viewport.js';
import { CropMarquee } from './crop.js';
import { blur, sharpen, applyLevels as fxLevels, applyCurves as fxCurves } from './filters.js';
import { saveState, loadState, debounce } from './storage.js';
import { ObjectsManager } from './objects.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Direct Export UI: show canvas on top, then selected images
window.addEventListener('export-show-ui', async () => {
  try {
    const { mime, ext, quality } = getExportFormat();
    currentMultiExports = [];

    // 1) Full scene (canvas + objects) as first item
    const scene = document.createElement('canvas');
    scene.width = doc.width; scene.height = doc.height;
    const sctx = scene.getContext('2d');
    sctx.clearRect(0, 0, scene.width, scene.height);
    sctx.drawImage(doc, 0, 0);
    for (const it of objects.getDrawOrder()) {
      sctx.drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, it.x, it.y, it.w, it.h);
    }
    // Output canvas respects JPEG background if needed
    const out = document.createElement('canvas');
    const octx = out.getContext('2d');
    if (mime === 'image/jpeg') {
      out.width = scene.width; out.height = scene.height;
      octx.fillStyle = '#000000'; octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(scene, 0, 0);
    } else {
      out.width = scene.width; out.height = scene.height;
      if (mime === 'image/png') { /* keep transparency */ }
      octx.drawImage(scene, 0, 0);
    }
    const canvasBlob = await exportCanvasToBlob(out, { mime, quality });
    if (canvasBlob) {
      const url = URL.createObjectURL(canvasBlob);
      const sizeKB = Math.round((canvasBlob.size || 0) / 1024);
      const filename = `canvas-${out.width}x${out.height}-${sizeKB}KB-${dateStamp()}.${ext}`;
      currentMultiExports.push({ id: 'canvas', w: out.width, h: out.height, blob: canvasBlob, url, filename });
    }

    // 2) Selected images (multi or single)
    const ids = (selectMode && selectMode.checked && multiSelected.size > 0)
      ? Array.from(multiSelected)
      : (objects.selected ? [objects.selected.id] : []);
    for (const id of ids) {
      const it = objects.getById(id); if (!it) continue;
      const outC = document.createElement('canvas');
      const w = Math.max(1, Math.round(it.w));
      const h = Math.max(1, Math.round(it.h));
      outC.width = w; outC.height = h;
      const octx2 = outC.getContext('2d');
      if (mime === 'image/jpeg') { octx2.fillStyle = '#ffffff'; octx2.fillRect(0, 0, w, h); }
      octx2.drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, 0, 0, w, h);
      const blob = await exportCanvasToBlob(outC, { mime, quality });
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const sizeKB = Math.round((blob.size || 0) / 1024);
      const filename = `selected-${w}x${h}-${sizeKB}KB-${dateStamp()}-${id}.${ext}`;
      currentMultiExports.push({ id, w, h, blob, url, filename });
    }

    // 3) Populate the dialog and show it
    if (multiExportList && multiExportDialog) {
      multiExportList.innerHTML = '';
      for (const item of currentMultiExports) {
        const wrap = document.createElement('div');
        wrap.className = 'multi-export-item';
        const img = document.createElement('img');
        img.className = 'multi-export-thumb';
        img.src = item.url;
        img.alt = `${item.id === 'canvas' ? 'Canvas' : 'Selected'} ${item.w}×${item.h}`;
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => {
          const w = window.open(item.url, '_blank', 'noopener');
          if (w) w.opener = null;
        });
        const meta = document.createElement('div');
        meta.className = 'multi-export-meta';
        meta.textContent = `${item.id === 'canvas' ? 'Canvas' : 'Selected'} • ${item.w}×${item.h} • ${(Math.round((item.blob.size/1024)*10)/10)} KB`;
        const btn = document.createElement('button');
        btn.className = 'download-btn';
        btn.textContent = 'Download';
        btn.addEventListener('click', () => {
          const a = document.createElement('a'); a.href = item.url; a.download = item.filename; document.body.appendChild(a); a.click(); a.remove();
        });
        wrap.appendChild(img); wrap.appendChild(meta); wrap.appendChild(btn);
        multiExportList.appendChild(wrap);
      }
      if (downloadAllBtn) {
        downloadAllBtn.onclick = async () => {
          try {
            const JSZipRef = window.JSZip || window.jszip || window.JSzip;
            if (!JSZipRef) {
              // Fallback: individual downloads
              for (const item of currentMultiExports) {
                const a = document.createElement('a'); a.href = item.url; a.download = item.filename;
                document.body.appendChild(a); a.click(); a.remove();
              }
              return;
            }
            const zip = new JSZipRef();
            for (const item of currentMultiExports) zip.file(item.filename, item.blob);
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a'); a.href = url; a.download = `export-${dateStamp()}.zip`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1200);
          } catch (err) { console.error('ZIP download failed', err); }
        };
      }
      const closeDialog = () => {
        multiExportDialog.style.display = 'none';
        for (const item of currentMultiExports) { try { URL.revokeObjectURL(item.url); } catch {} }
        currentMultiExports = [];
        multiExportList.innerHTML = '';
      };
      if (closeMultiExportBtn) closeMultiExportBtn.onclick = closeDialog;
      multiExportDialog.style.display = 'flex';
    }
  } catch (err) {
    console.error('Error preparing export UI:', err);
  }
});
// Offscreen document (image space)
const doc = document.createElement('canvas');
const dctx = doc.getContext('2d', { willReadFrequently: true });

const fileInput = document.getElementById('fileInput');
const presetSelect = document.getElementById('presetSelect');
const customW = document.getElementById('customW');
const customH = document.getElementById('customH');
const applySizeBtn = document.getElementById('applySizeBtn');
// Object resizing controls (Edit menu)
const objectSizePreset = document.getElementById('objectSizePreset');
const objCustomW = document.getElementById('objCustomW');
const objCustomH = document.getElementById('objCustomH');
const applyObjSizeBtn = document.getElementById('applyObjSizeBtn');
// Edit menu: duplicate & z-index
const duplicateObjBtn = document.getElementById('duplicateObjBtn');
const zIndexInput = document.getElementById('zIndexInput');
const applyZIndexBtn = document.getElementById('applyZIndexBtn');

const brightness = document.getElementById('brightness');
const contrast = document.getElementById('contrast');
const saturation = document.getElementById('saturation');
const applyAdjustBtn = document.getElementById('applyAdjustBtn');

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const removeObjectBtn = document.getElementById('removeObject');
const selectAllBtn = document.getElementById('selectAllBtn');

const rotateL = document.getElementById('rotateL');
const rotateR = document.getElementById('rotateR');
const flipH = document.getElementById('flipH');
const flipV = document.getElementById('flipV');

const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomResetBtn = document.getElementById('zoomReset');
const quickZoomInBtn = document.getElementById('quickZoomIn');
const quickZoomOutBtn = document.getElementById('quickZoomOut');
const quickZoomLabel = document.getElementById('quickZoomLabel');

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
const exportFormatSel = document.getElementById('exportFormat');
const exportActionSel = document.getElementById('exportAction');
const keepAspect = document.getElementById('keepAspect');
const statusBar = document.getElementById('statusBar');
const selectMode = document.getElementById('selectMode');
let multiSelected = new Set();
const sizePopover = document.getElementById('sizePopover');
const sizePresetsEl = document.getElementById('sizePresets');
const sizePopoverTitle = document.getElementById('sizePopoverTitle');
const sizeInput = document.getElementById('sizeInput');
const applySizeQuick = document.getElementById('applySizeQuick');
const cancelSizeQuick = document.getElementById('cancelSizeQuick');
const sizeError = document.getElementById('sizeError');
// Position popover refs
const posPopover = document.getElementById('posPopover');
const posXInput = document.getElementById('posXInput');
const posYInput = document.getElementById('posYInput');
const posZInput = document.getElementById('posZInput');
// Preset buttons
const posPreset00 = document.getElementById('posPreset00');
const posPreset1010 = document.getElementById('posPreset1010');
const posPreset100100 = document.getElementById('posPreset100100');
const posPresetCenter = document.getElementById('posPresetCenter');
let posEditBefore = null; // capture for single undo entry

// Multi-export dialog elements
const multiExportDialog = document.getElementById('multiExportDialog');
const multiExportList = document.getElementById('multiExportList');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const closeMultiExportBtn = document.getElementById('closeMultiExportBtn');
let currentMultiExports = [];
// Lightbox elements
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxClose = document.getElementById('lightboxClose');
function openLightbox(url) {
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = url;
  lightbox.style.display = 'flex';
}
function closeLightbox() {
  if (!lightbox || !lightboxImg) return;
  lightbox.style.display = 'none';
  lightboxImg.src = '';
}
if (lightboxClose) lightboxClose.onclick = closeLightbox;
if (lightbox) lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

// Text tools
const textContent = document.getElementById('textContent');
const textColor = document.getElementById('textColor');
const textSize = document.getElementById('textSize');
const textSizeVal = document.getElementById('textSizeVal');
const textStyle = document.getElementById('textStyle');
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

// Improve usability on touch devices by enlarging handles
let observedTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
function isCoarsePointer() {
  try {
    return (
      (window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches)) ||
      (navigator.maxTouchPoints || 0) > 0
    );
  } catch (_) { return (navigator.maxTouchPoints || 0) > 0; }
}
function desiredHandleSize() {
  const coarse = isCoarsePointer();
  const touch = observedTouch || coarse; // prioritize actual touch presence
  const base = 30; // desktop size
  const touchSize = 96; // larger for touch
  let size = touch ? touchSize : base;
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
// Upgrade to touch sizing as soon as a touch is detected at runtime
window.addEventListener('touchstart', () => { if (!observedTouch) { observedTouch = true; applyHandleSize(); scheduleRender(); } }, { passive: true });
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !observedTouch) { observedTouch = true; applyHandleSize(); scheduleRender(); } });
window.addEventListener('resize', () => { applyHandleSize(); render(); });

// Select Mode lifecycle: keep behavior predictable
if (selectMode) {
  const selectLabel = selectMode.closest('label');
  const syncSelectLabel = () => {
    const active = !!selectMode.checked;
    if (selectLabel) selectLabel.classList.toggle('active', active);
    if (selectAllBtn) selectAllBtn.hidden = !active;
  };
  selectMode.addEventListener('change', () => {
    if (selectMode.checked) {
      // When enabling, seed the set with the current selection (if any)
      multiSelected = new Set(multiSelected); // ensure it's a Set instance
      if (objects.selected) multiSelected.add(objects.selected.id);
    } else {
      // When disabling, clear multi selection
      multiSelected.clear();
    }
    syncSelectLabel();
    render();
  });
  // initialize state on load
  syncSelectLabel();
}

// Select All in Select Mode
if (selectAllBtn) {
  selectAllBtn.addEventListener('click', () => {
    if (!selectMode || !selectMode.checked) return;
    if (!objects || !objects.items || objects.items.length === 0) return;
    multiSelected = new Set(objects.items.map(it => it.id));
    // Maintain a single selection for compatibility (use topmost by draw order)
    const order = objects.getDrawOrder();
    if (order.length) objects.selectedId = order[order.length - 1].id;
    updateEditMenuRemoveState();
    render();
  });
}

// Quick open shortcut: Ctrl/Cmd+O to trigger file picker
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    if (fileInput) fileInput.click();
  }
});

const persist = debounce(() => saveState(doc, { scale: viewport.scale, tx: viewport.tx, ty: viewport.ty }, objects), 300);

// Objects action history (for undo/redo of move/resize/crop/add)
const objHistory = { undo: [], redo: [] };
let objActionStart = null; // deep clone of item before modification

function cloneItem(it) {
  const c = document.createElement('canvas');
  c.width = it.canvas.width; c.height = it.canvas.height;
  c.getContext('2d').drawImage(it.canvas, 0, 0);
  return { id: it.id, canvas: c, x: it.x, y: it.y, w: it.w, h: it.h, sx: it.sx, sy: it.sy, sw: it.sw, sh: it.sh, z: typeof it.z === 'number' ? it.z : 0, meta: it.meta ? { ...it.meta } : null };
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
  } else if (act.type === 'remove') {
    objects.addFromData(act.item);
    objHistory.redo.push({ type: 'remove', item: act.item });
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
  } else if (act.type === 'remove') {
    objects.removeById(act.item.id);
    objHistory.undo.push({ type: 'remove', item: act.item });
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

let _needsRender = false;
let fastMode = false; // simplify rendering during continuous interactions
function scheduleRender() {
  if (_needsRender) return;
  _needsRender = true;
  requestAnimationFrame(() => {
    _needsRender = false;
    render();
  });
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  viewport.apply(ctx);
  ctx.drawImage(doc, 0, 0);
  objects.draw(ctx);
  ctx.restore();
  // Draw document boundary as tri-color dashed (white, yellow, green)
  ctx.save();
  viewport.apply(ctx);
  const s = viewport.scale || 1;
  const px = 1 / s;
  const thick = 4 * px; // scale-stable thickness
  const x = 0.5 * px, y = 0.5 * px;
  const w = doc.width - 1 * px, h = doc.height - 1 * px;
  const dash = 8 * px; // base dash unit
  const pattern = [dash, 2 * dash]; // one dash, two dashes gap -> 3 slots
  const colors = ['#000000', '#FFD700', '#00EE90'];
  const offsets = [0, dash, 2 * dash];
  ctx.lineWidth = thick;
  for (let i = 0; i < 3; i++) {
    ctx.setLineDash(pattern);
    ctx.lineDashOffset = offsets[i];
    ctx.strokeStyle = colors[i];
    ctx.strokeRect(x, y, w, h);
  }
  // cleanup
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.restore();
  crop.draw(ctx, viewport, canvas);
  const selScale = viewport.scale || 1;
  const green = '#00EE90'; // light green
  const selDash = fastMode ? [] : [4 / selScale, 4 / selScale];
  // Selection rendering
  if (selectMode && selectMode.checked) {
    // Single selection (no multi set yet): draw thick light green
    if (!multiSelected.size && objects.selected) {
      const it = objects.selected;
      ctx.save();
      viewport.apply(ctx);
      ctx.strokeStyle = green;
      ctx.lineWidth = 4 / selScale;
      ctx.setLineDash(selDash);
      ctx.strokeRect(it.x + 0.5 / selScale, it.y + 0.5 / selScale, it.w, it.h);
      ctx.restore();
    }
  } else {
    // Not in Select Mode: default selection visuals
    objects.drawSelection(ctx, viewport);
  }
  // Draw multi selections outlines in Select Mode
  if (selectMode && selectMode.checked && multiSelected.size) {
    ctx.save();
    viewport.apply(ctx);
    ctx.strokeStyle = green;
    ctx.lineWidth = 4 / selScale;
    ctx.setLineDash(selDash);
    for (const id of multiSelected) {
      const it = objects.getById(id); if (!it) continue;
      ctx.strokeRect(it.x + 0.5 / selScale, it.y + 0.5 / selScale, it.w, it.h);
    }
    ctx.restore();
  }
  // Avoid DOM writes during fast interactions to keep FPS high
  if (!fastMode) updateStatus();
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

function clampPosInt(n) {
  n = Math.round(Number(n) || 0);
  return Math.max(1, Math.min(4096, n));
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

// Auto-calc height from width for selected image (maintain aspect)
if (objCustomW) {
  objCustomW.addEventListener('input', () => {
    const sel = objects.selected;
    if (!sel) return; // only when a single object is selected
    const w = Math.max(1, Number(objCustomW.value) || 0);
    if (!w) return;
    const ratio = sel.h / Math.max(1, sel.w);
    const h = Math.round(w * ratio);
    if (objCustomH) objCustomH.value = String(h);
  });
}

// Resize Selected Object (Edit menu)
function resizeSelectedObjectTo(w, h) {
  const sel = objects.selected;
  if (!sel) return;
  // Clamp and ensure positive
  const tw = clampPosInt(w);
  const th = clampPosInt(h);
  const before = cloneItem(sel);
  // Bake current crop to new target resolution
  const srcW = sel.sw, srcH = sel.sh;
  const srcC = document.createElement('canvas');
  srcC.width = srcW; srcC.height = srcH;
  srcC.getContext('2d').drawImage(sel.canvas, sel.sx, sel.sy, sel.sw, sel.sh, 0, 0, srcW, srcH);
  const outC = document.createElement('canvas');
  outC.width = tw; outC.height = th;
  outC.getContext('2d').drawImage(srcC, 0, 0, srcW, srcH, 0, 0, tw, th);
  // Keep center anchored
  const cx = sel.x + sel.w / 2;
  const cy = sel.y + sel.h / 2;
  sel.canvas = outC;
  sel.sx = 0; sel.sy = 0; sel.sw = tw; sel.sh = th;
  sel.w = tw; sel.h = th;
  sel.x = Math.round(cx - tw / 2);
  sel.y = Math.round(cy - th / 2);
  render();
  const after = cloneItem(sel);
  objHistory.undo.push({ type: 'modify', id: sel.id, before, after });
  objHistory.redo.length = 0; updateUndoRedoState();
  persist();
}

if (objectSizePreset) {
  objectSizePreset.addEventListener('change', () => {
    if (!objectSizePreset.value) return;
    const [w, h] = objectSizePreset.value.split('x').map(Number);
    // Always reflect preset into custom inputs
    if (objCustomW) objCustomW.value = String(w);
    if (objCustomH) objCustomH.value = String(h);
    // Apply to multi-select if enabled; otherwise single selection
    const hasMulti = selectMode && selectMode.checked && multiSelected.size > 0;
    if (hasMulti) {
      resizeSelectedObjectsTo(w, h);
    } else {
      const sel = objects.selected;
      if (sel) resizeSelectedObjectTo(w, h);
    }
  });
}
if (applyObjSizeBtn) {
  applyObjSizeBtn.addEventListener('click', () => {
    const w = Number(objCustomW && objCustomW.value);
    const h = Number(objCustomH && objCustomH.value);
    if (!w || !h) return;
    const hasMulti = selectMode && selectMode.checked && multiSelected.size > 0;
    if (hasMulti) {
      resizeSelectedObjectsTo(w, h);
      return;
    }
    const sel = objects.selected;
    if (!sel) { window.alert('Select an image object first.'); return; }
    resizeSelectedObjectTo(w, h);
  });
}

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
  const sel = objects.selected;
  if (sel) {
    // Rotate only the selected object
    const before = cloneItem(sel);
    // Bake current crop into a standalone canvas
    const srcW = sel.sw, srcH = sel.sh;
    const srcC = document.createElement('canvas');
    srcC.width = srcW; srcC.height = srcH;
    srcC.getContext('2d').drawImage(sel.canvas, sel.sx, sel.sy, sel.sw, sel.sh, 0, 0, srcW, srcH);
    const rad = (deg * Math.PI) / 180;
    const abs = Math.abs(deg) % 360;
    const outW = (abs === 90 || abs === 270) ? srcH : srcW;
    const outH = (abs === 90 || abs === 270) ? srcW : srcH;
    const outC = document.createElement('canvas');
    outC.width = outW; outC.height = outH;
    const octx = outC.getContext('2d');
    octx.save();
    octx.translate(outW / 2, outH / 2);
    octx.rotate(rad);
    octx.drawImage(srcC, -srcW / 2, -srcH / 2);
    octx.restore();
    // Replace canvas and reset source rect
    sel.canvas = outC;
    sel.sx = 0; sel.sy = 0; sel.sw = outW; sel.sh = outH;
    // Maintain visual center; swap displayed w/h for 90/270
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    if (abs === 90 || abs === 270) {
      const nw = sel.h;
      const nh = sel.w;
      sel.w = nw; sel.h = nh;
      sel.x = Math.round(cx - nw / 2);
      sel.y = Math.round(cy - nh / 2);
    }
    // 180 keeps size/pos
    render();
    // record history for object action
    const after = cloneItem(sel);
    objHistory.undo.push({ type: 'modify', id: sel.id, before, after });
    objHistory.redo.length = 0; updateUndoRedoState();
    persist();
    return;
  }
  // No selection: rotate entire document
  const rad = (deg * Math.PI) / 180;
  const oldW = doc.width, oldH = doc.height;
  const beforeObjects = cloneAllItems();
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
  // Rotate all objects around the document center and rotate their content
  const newW = doc.width, newH = doc.height;
  const cx0 = oldW / 2, cy0 = oldH / 2;
  const cx1 = newW / 2, cy1 = newH / 2;
  for (const it of objects.items) {
    // Bake crop
    const srcW = it.sw, srcH = it.sh;
    const srcC = document.createElement('canvas');
    srcC.width = srcW; srcC.height = srcH;
    srcC.getContext('2d').drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, 0, 0, srcW, srcH);
    // Rotate content
    const abs = Math.abs(deg) % 360;
    const outW = (abs === 90 || abs === 270) ? srcH : srcW;
    const outH = (abs === 90 || abs === 270) ? srcW : srcH;
    const outC = document.createElement('canvas');
    outC.width = outW; outC.height = outH;
    const octx = outC.getContext('2d');
    octx.save();
    octx.translate(outW / 2, outH / 2);
    octx.rotate(rad);
    octx.drawImage(srcC, -srcW / 2, -srcH / 2);
    octx.restore();
    it.canvas = outC;
    it.sx = 0; it.sy = 0; it.sw = outW; it.sh = outH;
    // Position: rotate center point around doc center
    const ocx = it.x + it.w / 2;
    const ocy = it.y + it.h / 2;
    const dx = ocx - cx0;
    const dy = ocy - cy0;
    const ndx = Math.cos(rad) * dx - Math.sin(rad) * dy;
    const ndy = Math.sin(rad) * dx + Math.cos(rad) * dy;
    // New displayed size
    if (abs === 90 || abs === 270) {
      const nw = it.h;
      const nh = it.w;
      it.w = nw; it.h = nh;
    }
    const ncx = cx1 + ndx;
    const ncy = cy1 + ndy;
    it.x = Math.round(ncx - it.w / 2);
    it.y = Math.round(ncy - it.h / 2);
  }
  render();
  snapshot();
  const afterObjects = cloneAllItems();
  objHistory.undo.push({ type: 'replace', before: beforeObjects, after: afterObjects });
  objHistory.redo.length = 0; updateUndoRedoState();
  persist();
}

function flip(horizontal, vertical) {
  const sel = objects.selected;
  if (sel) {
    const before = cloneItem(sel);
    // Bake current crop
    const srcW = sel.sw, srcH = sel.sh;
    const srcC = document.createElement('canvas');
    srcC.width = srcW; srcC.height = srcH;
    srcC.getContext('2d').drawImage(sel.canvas, sel.sx, sel.sy, sel.sw, sel.sh, 0, 0, srcW, srcH);
    const outC = document.createElement('canvas');
    outC.width = srcW; outC.height = srcH;
    const octx = outC.getContext('2d');
    octx.save();
    octx.translate(horizontal ? outC.width : 0, vertical ? outC.height : 0);
    octx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
    octx.drawImage(srcC, 0, 0);
    octx.restore();
    // Replace canvas and reset source rect (dest size, pos unchanged)
    sel.canvas = outC;
    sel.sx = 0; sel.sy = 0; sel.sw = outC.width; sel.sh = outC.height;
    render();
    const after = cloneItem(sel);
    objHistory.undo.push({ type: 'modify', id: sel.id, before, after });
    objHistory.redo.length = 0; updateUndoRedoState();
    persist();
    return;
  }
  // No selection: flip the whole document (doc + objects)
  const beforeObjects = cloneAllItems();
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
  // Flip all objects' content and positions across document dimensions
  for (const it of objects.items) {
    // Bake crop
    const srcW = it.sw, srcH = it.sh;
    const srcC = document.createElement('canvas');
    srcC.width = srcW; srcC.height = srcH;
    srcC.getContext('2d').drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, 0, 0, srcW, srcH);
    const outC = document.createElement('canvas');
    outC.width = srcW; outC.height = srcH;
    const octx = outC.getContext('2d');
    octx.save();
    octx.translate(horizontal ? srcW : 0, vertical ? srcH : 0);
    octx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
    octx.drawImage(srcC, 0, 0);
    octx.restore();
    it.canvas = outC;
    it.sx = 0; it.sy = 0; it.sw = outC.width; it.sh = outC.height;
    // Mirror position
    if (horizontal) it.x = Math.round(doc.width - (it.x + it.w));
    if (vertical) it.y = Math.round(doc.height - (it.y + it.h));
  }
  render();
  snapshot();
  const afterObjects = cloneAllItems();
  objHistory.undo.push({ type: 'replace', before: beforeObjects, after: afterObjects });
  objHistory.redo.length = 0; updateUndoRedoState();
  persist();
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
    scheduleRender();
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
  scheduleRender();
}

// Pointer interactions
canvas.addEventListener('pointerdown', (e) => {
  // If position popover is open, hide it on any canvas interaction
  if (posPopover && !posPopover.hidden) closePosPopover();
  canvas.setPointerCapture(e.pointerId);
  const isBrush = (brushToggle.getAttribute('aria-pressed') === 'true') || (drawMode && drawMode.checked);
  const isCrop = (cropToggle && cropToggle.getAttribute('aria-pressed') === 'true') && crop.active;
  if (isCrop) {
    const ip = getImagePoint(e);
    const mode = crop.hitTest(ip) || 'move';
    crop.beginDrag(mode, ip);
    fastMode = true;
    return;
  }
  if (spaceKey || e.button === 1) {
    isPanning = true;
    fastMode = true;
    lastPoint = getCanvasPoint(e);
    return;
  }
  // Objects interactions if not brush
  if (!isBrush) {
    const ip = getImagePoint(e);
    // In Select Mode: toggle selection on click without dragging
    if (selectMode && selectMode.checked) {
      const hit = objects.hitTest(ip);
      if (hit) {
        if (multiSelected.has(hit)) multiSelected.delete(hit); else multiSelected.add(hit);
        objects.selectedId = hit; // keep single selected for compatibility
        updateEditMenuRemoveState();
        render();
      }
      return;
    }
    const prevSel = objects.selected ? objects.selected.id : null;
    const acted = objects.beginInteraction(ip);
    if (acted) {
      // capture starting state for history
      const sel = objects.selected;
      if (sel) objActionStart = cloneItem(sel);
      // If Add menu is open and selected is text, sync inputs
      syncAddPanelFromSelection();
      updateEditMenuRemoveState();
      fastMode = true;
      scheduleRender();
      return;
    } else {
      // If selection was cleared, re-render to hide selection box
      const nowSel = objects.selected ? objects.selected.id : null;
      if (prevSel && !nowSel) { scheduleRender(); updateEditMenuRemoveState(); }
    }
  }
  if (isBrush) {
    isDrawing = true;
    fastMode = true;
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
    scheduleRender();
    return;
  }
  if (isPanning) {
    const p = getCanvasPoint(e);
    viewport.panBy(p.x - lastPoint.x, p.y - lastPoint.y);
    lastPoint = p;
    scheduleRender();
    return;
  }
  if (objects.drag) {
    const ip = getImagePoint(e);
    if (objects.updateInteraction(ip)) scheduleRender();
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
    // Update Add panel inputs if a text object is selected after interaction
    syncAddPanelFromSelection();
    objActionStart = null;
    persist();
  }
  // turn off fast mode after interactions
  fastMode = false;
  scheduleRender();
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
function updateZoomLabel() {
  const v = `${Math.round(viewport.scale * 100)}%`;
  if (quickZoomLabel) quickZoomLabel.textContent = v;
}
function doZoomIn() { viewport.zoomAt(1.2, canvas.width / 2, canvas.height / 2); updateZoomLabel(); render(); }
function doZoomOut() { viewport.zoomAt(1 / 1.2, canvas.width / 2, canvas.height / 2); updateZoomLabel(); render(); }
if (zoomInBtn) {
  zoomInBtn.addEventListener('click', doZoomIn);
  zoomInBtn.addEventListener('touchstart', (e) => { e.preventDefault(); doZoomIn(); }, { passive: false });
}
if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', doZoomOut);
  zoomOutBtn.addEventListener('touchstart', (e) => { e.preventDefault(); doZoomOut(); }, { passive: false });
}
if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { viewport.reset(doc.width, doc.height, canvas.width, canvas.height); updateZoomLabel(); render(); });
// Quick zoom buttons near status bar
if (quickZoomInBtn) {
  quickZoomInBtn.addEventListener('click', doZoomIn);
  // Prevent double-tap zoom on mobile
  quickZoomInBtn.addEventListener('touchstart', (e) => { e.preventDefault(); doZoomIn(); }, { passive: false });
}
if (quickZoomOutBtn) {
  quickZoomOutBtn.addEventListener('click', doZoomOut);
  // Prevent double-tap zoom on mobile
  quickZoomOutBtn.addEventListener('touchstart', (e) => { e.preventDefault(); doZoomOut(); }, { passive: false });
}
// (Removed duplicate handlers)

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
  updateEditMenuRemoveState();
})();

// Prevent long-press context menu/select on iOS around the canvas
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length === 1) e.preventDefault(); }, { passive: false });

// Menubar behavior: only one top-level menu open at a time
const menus = Array.from(document.querySelectorAll('.menubar > .menu'));
for (const m of menus) {
  m.addEventListener('toggle', () => {
    if (m.open) {
      for (const other of menus) if (other !== m && other.open) other.open = false;
    }
  });
}

// Edit menu: show/hide Remove button based on selection
function updateEditMenuRemoveState() {
  if (!removeObjectBtn) return;
  const sel = objects.selected;
  // Show when an object is selected (images have meta null; text has meta.type === 'text')
  removeObjectBtn.hidden = !sel;
  // Enable/disable related controls
  const controls = [objectSizePreset, objCustomW, objCustomH, applyObjSizeBtn, duplicateObjBtn, zIndexInput, applyZIndexBtn];
  for (const c of controls) if (c) c.disabled = !sel;
  // Prefill custom size with current displayed size
  if (sel && objCustomW && objCustomH) {
    objCustomW.value = String(Math.round(sel.w));
    objCustomH.value = String(Math.round(sel.h));
  }
  // Prefill Z index
  if (sel && zIndexInput) {
    zIndexInput.value = String(typeof sel.z === 'number' ? sel.z : 0);
  }
}

const editMenuEl = Array.from(document.querySelectorAll('.menu > summary')).find(s => s.textContent.trim() === 'Edit')?.parentElement;
if (editMenuEl) {
  editMenuEl.addEventListener('toggle', () => {
    if (editMenuEl.open) updateEditMenuRemoveState();
  });
}

if (removeObjectBtn) {
  removeObjectBtn.addEventListener('click', () => {
    const sel = objects.selected;
    if (!sel) return;
    const confirmed = window.confirm('Remove the selected object?');
    if (!confirmed) return;
    const item = cloneItem(sel);
    objects.removeById(sel.id);
    render();
    objHistory.undo.push({ type: 'remove', item });
    objHistory.redo.length = 0; updateUndoRedoState();
    persist();
    updateEditMenuRemoveState();
  });
}

// Duplicate selected object with +50,+50 offset
if (duplicateObjBtn) {
  duplicateObjBtn.addEventListener('click', () => {
    const sel = objects.selected; if (!sel) { window.alert('Select an object to duplicate.'); return; }
    const data = {
      canvas: (() => { const c = document.createElement('canvas'); c.width = sel.canvas.width; c.height = sel.canvas.height; c.getContext('2d').drawImage(sel.canvas, 0, 0); return c; })(),
      x: Math.round(sel.x + 50),
      y: Math.round(sel.y + 50),
      w: sel.w,
      h: sel.h,
      sx: sel.sx,
      sy: sel.sy,
      sw: sel.sw,
      sh: sel.sh,
      z: typeof sel.z === 'number' ? sel.z : 0,
      meta: sel.meta ? { ...sel.meta } : null,
    };
    const newId = objects.addFromData(data);
    const it = objects.getById(newId);
    if (it) {
      objects.selectedId = it.id;
      render();
      objHistory.undo.push({ type: 'add', item: cloneItem(it) });
      objHistory.redo.length = 0; updateUndoRedoState();
      persist();
      updateEditMenuRemoveState();
    }
  });
}

// Apply Z-index to selected
if (applyZIndexBtn) {
  applyZIndexBtn.addEventListener('click', () => {
    const sel = objects.selected; if (!sel) { window.alert('Select an object to set Z.'); return; }
    const nz = Math.round(Number(zIndexInput && zIndexInput.value));
    const before = cloneItem(sel);
    sel.z = isNaN(nz) ? 0 : nz;
    render();
    const after = cloneItem(sel);
    objHistory.undo.push({ type: 'modify', id: sel.id, before, after });
    objHistory.redo.length = 0; updateUndoRedoState();
    persist();
  });
}

// Settings
if (keepAspect) {
  objects.keepAspect = !!keepAspect.checked;
  keepAspect.addEventListener('change', () => {
    objects.keepAspect = !!keepAspect.checked;
  });
}

function getExportFormat() {
  const val = (exportFormatSel && exportFormatSel.value) || 'jpeg';
  if (val === 'png') return { mime: 'image/png', ext: 'png', quality: undefined };
  if (val === 'webp') return { mime: 'image/webp', ext: 'webp', quality: 0.92 };
  return { mime: 'image/jpeg', ext: 'jpg', quality: 0.92 };
}

// No persistent target; export action select triggers immediately

function exportCanvasToBlob(c, { mime, quality }) {
  return new Promise((resolve) => c.toBlob((b) => resolve(b), mime, quality));
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function exportFullCanvas() {
  const { mime, ext, quality } = getExportFormat();
  // 1) Render the full scene (exactly like render()) to an offscreen scene canvas
  const scene = document.createElement('canvas');
  scene.width = doc.width;
  scene.height = doc.height;
  const sctx = scene.getContext('2d');
  sctx.clearRect(0, 0, scene.width, scene.height);
  sctx.drawImage(doc, 0, 0);
  // Use the same drawing semantics as on-screen rendering
  for (const it of objects.getDrawOrder()) {
    sctx.drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, it.x, it.y, it.w, it.h);
  }

  // 2) Prepare output canvas: full scene or active crop rectangle
  const out = document.createElement('canvas');
  const octx = out.getContext('2d');
  const hasCrop = !!(crop && crop.active && crop.rect && crop.rect.w > 0 && crop.rect.h > 0);

  if (hasCrop) {
    const { x, y, w, h } = crop.rect;
    out.width = Math.max(1, Math.round(w));
    out.height = Math.max(1, Math.round(h));
    if (mime === 'image/jpeg') { octx.fillStyle = '#000000'; octx.fillRect(0, 0, out.width, out.height); }
    // Copy exactly the visible crop region from the scene
    octx.drawImage(scene, x, y, w, h, 0, 0, out.width, out.height);
  } else {
    out.width = scene.width;
    out.height = scene.height;
    if (mime === 'image/jpeg') { octx.fillStyle = '#000000'; octx.fillRect(0, 0, out.width, out.height); }
    octx.drawImage(scene, 0, 0);
  }

  // 3) Export the output canvas
  const blob = await exportCanvasToBlob(out, { mime, quality });
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `image-${dateStamp()}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportSelectedOnly() {
  const sel = objects.selected; if (!sel) return;
  const { mime, ext, quality } = getExportFormat();
  const outC = document.createElement('canvas');
  const w = Math.max(1, Math.round(sel.w));
  const h = Math.max(1, Math.round(sel.h));
  outC.width = w; outC.height = h;
  const octx = outC.getContext('2d');
  if (mime === 'image/jpeg') { octx.fillStyle = '#000000'; octx.fillRect(0, 0, w, h); }
  octx.drawImage(sel.canvas, sel.sx, sel.sy, sel.sw, sel.sh, 0, 0, w, h);
  const blob = await exportCanvasToBlob(outC, { mime, quality });
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const sizeKB = Math.round((blob.size || 0) / 1024);
  const stamp = dateStamp();
  a.href = url; a.download = `selected-${outC.width}x${outC.height}-${sizeKB}KB-${stamp}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Handle export events from the dialog
window.addEventListener('export-canvas', async () => {
  try {
    await exportFullCanvas();
  } catch (error) {
    console.error('Error exporting canvas:', error);
  }
});

window.addEventListener('export-selected', async () => {
  try {
    const hasMulti = selectMode && selectMode.checked && multiSelected.size > 0;
    if (hasMulti) {
      // Prepare a preview UI and allow batch download instead of firing multiple downloads
      const { mime, ext, quality } = getExportFormat();
      const ids = Array.from(multiSelected);
      currentMultiExports = [];
      // Build blobs for each selected
      for (const id of ids) {
        const it = objects.getById(id);
        if (!it) continue;
        const outC = document.createElement('canvas');
        const w = Math.max(1, Math.round(it.w));
        const h = Math.max(1, Math.round(it.h));
        outC.width = w; outC.height = h;
        const octx = outC.getContext('2d');
        if (mime === 'image/jpeg') { octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, w, h); }
        octx.drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, 0, 0, w, h);
        const blob = await new Promise(resolve => outC.toBlob(b => resolve(b), mime, quality));
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const sizeKB = Math.round(blob.size / 1024);
        const stamp = dateStamp();
        const filename = `selected-${w}x${h}-${sizeKB}KB-${stamp}-${id}.${ext}`;
        currentMultiExports.push({ id, w, h, blob, url, filename });
      }
      // Populate UI
      if (multiExportList && multiExportDialog) {
        multiExportList.innerHTML = '';
        for (const item of currentMultiExports) {
          const wrap = document.createElement('div');
          wrap.className = 'multi-export-item';
          const img = document.createElement('img');
          img.className = 'multi-export-thumb';
          img.src = item.url;
          img.alt = `Selected ${item.w}×${item.h} (id ${item.id})`;
          img.style.cursor = 'pointer';
          img.addEventListener('click', () => {
            const w = window.open(item.url, '_blank', 'noopener');
            if (w) w.opener = null;
          });
          const meta = document.createElement('div');
          meta.className = 'multi-export-meta';
          meta.textContent = `${item.w}×${item.h} • ${(Math.round((item.blob.size/1024)*10)/10)} KB`;
          const btn = document.createElement('button');
          btn.className = 'download-btn';
          btn.textContent = 'Download';
          btn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = item.url; a.download = item.filename; document.body.appendChild(a); a.click(); a.remove();
          });
          wrap.appendChild(img);
          wrap.appendChild(meta);
          wrap.appendChild(btn);
          multiExportList.appendChild(wrap);
        }
        // Wire up buttons
        if (downloadAllBtn) {
          downloadAllBtn.onclick = async () => {
            try {
              const JSZipRef = window.JSZip || window.jszip || window.JSzip;
              if (!JSZipRef) {
                // Fallback: trigger individual downloads if JSZip missing
                for (const item of currentMultiExports) {
                  const a = document.createElement('a');
                  a.href = item.url; a.download = item.filename;
                  document.body.appendChild(a); a.click(); a.remove();
                }
                return;
              }
              const zip = new JSZipRef();
              for (const item of currentMultiExports) zip.file(item.filename, item.blob);
              const zipBlob = await zip.generateAsync({ type: 'blob' });
              const url = URL.createObjectURL(zipBlob);
              const a = document.createElement('a');
              a.href = url; a.download = `selected-images-${dateStamp()}.zip`;
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1200);
            } catch (err) { console.error('ZIP download failed', err); }
          };
        }
        const closeDialog = () => {
          if (!multiExportDialog) return;
          multiExportDialog.style.display = 'none';
          // Cleanup URLs
          for (const item of currentMultiExports) try { URL.revokeObjectURL(item.url); } catch {}
          currentMultiExports = [];
          if (multiExportList) multiExportList.innerHTML = '';
        };
        if (closeMultiExportBtn) closeMultiExportBtn.onclick = closeDialog;
        // Show dialog
        multiExportDialog.style.display = 'flex';
      }
    } else if (objects.selected) {
      await exportSelectedOnly();
    } else {
      // Show message if nothing is selected
      alert('Please select one or more images to export.');
    }
  } catch (error) {
    console.error('Error exporting selected items:', error);
  }
});

// Explicit selected export button (uses same format selector)
// Removed separate Export Selected button; handled via export target select.

function updateStatus() {
  if (!statusBar) return;
  const canvasDim = `${canvas.width}×${canvas.height}`;
  let selDim = '';
  let posDim = '';
  const hasMulti = selectMode && selectMode.checked && multiSelected.size > 0;
  if (hasMulti) {
    selDim = `${multiSelected.size} selected`;
  } else if (objects && objects.selected) {
    const sel = objects.selected;
    const w = Math.max(1, Math.round(sel.w));
    const h = Math.max(1, Math.round(sel.h));
    selDim = `${w}×${h}`;
    const z = typeof sel.z === 'number' ? sel.z : 0;
    posDim = `${Math.round(sel.x)},${Math.round(sel.y)},${z}`;
  }
  // Render interactive spans for canvas and object size
  const parts = [];
  parts.push(`<button class="linkish" id="statusCanvas">${canvasDim}</button>`);
  if (selDim) {
    parts.push(`<button class="linkish" id="statusObject">${selDim}</button>`);
    if (posDim) parts.push(`<button class="linkish" id="statusPos" title="Set position">${posDim}</button>`);
  }
  statusBar.innerHTML = parts.join('  •  ');
  // Attach click handlers after render
  const sc = document.getElementById('statusCanvas');
  const so = document.getElementById('statusObject');
  const sp = document.getElementById('statusPos');
  if (sc) sc.onclick = () => openSizePopover('canvas');
  if (so) so.onclick = () => openSizePopover('object');
  if (sp) sp.onclick = () => openPosPopover();
}

// Styling helper for inline link-like buttons in status
const styleTag = document.createElement('style');
styleTag.textContent = `.status-bar .linkish{appearance:none;border:none;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer;text-decoration:underline dotted 1px rgba(255,255,255,.4);} .status-bar .linkish:hover{opacity:.9}`;
document.head.appendChild(styleTag);

let popoverTarget = null; // 'canvas' | 'object' | null
function openSizePopover(target) {
  popoverTarget = target;
  if (!sizePopover || !sizePresetsEl) return;
  // Title and presets per target
  sizePopoverTitle.textContent = target === 'canvas' ? 'Resize Canvas' : 'Resize Selected';
  sizePresetsEl.innerHTML = '';
  const mkBtn = (label, w, h) => {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = label;
    b.addEventListener('click', () => applyParsedSize(w, h));
    return b;
  };
  const presets = target === 'canvas'
    ? [
        [1024,1024], [1024,1536], [1536,1024], 
        [2000,2000], [2000,4000], [4000,4000], 
        [4000,8000], [1242,2688], [1668,2388]
      ]
    : [
        [32,32], [64,64], [128,128], [1024,1024],
        [1242,2688], [1668,2388]
      ];
  for (const [w,h] of presets) sizePresetsEl.appendChild(mkBtn(`${w}×${h}`, w, h));
  
  // Set current dimensions in the input field
  if (sizeInput) {
    sizeInput.value = target === 'canvas' 
      ? `${doc.width}×${doc.height}`
      : objectsManager.getSelected() 
        ? `${objectsManager.getSelected().w}×${objectsManager.getSelected().h}`
        : '';
    sizeInput.select();
  }
  
  sizeError.textContent = '';
  sizePopover.hidden = false;
}

function closeSizePopover() {
  popoverTarget = null;
  if (sizePopover) sizePopover.hidden = true;
}

function parseSize(text) {
  if (!text) return null;
  const s = String(text).trim().toLowerCase().replace(/×/g,'x');
  const sepMatch = s.match(/^(\d+)\s*[x,\s]\s*(\d+)$/);
  if (!sepMatch) return null;
  const w = Math.max(1, parseInt(sepMatch[1], 10));
  const h = Math.max(1, parseInt(sepMatch[2], 10));
  if (!isFinite(w) || !isFinite(h) || w < 1 || h < 1) return null;
  return { w, h };
}

function applyParsedSize(w, h) {
  if (popoverTarget === 'canvas') {
    setCanvasSize(w, h);
    closeSizePopover();
  } else if (popoverTarget === 'object') {
    const hasMulti = selectMode && selectMode.checked && multiSelected.size > 0;
    if (hasMulti) {
      resizeSelectedObjectsTo(w, h);
    } else {
      resizeSelectedObjectTo(w, h);
    }
    closeSizePopover();
  }
}

if (applySizeQuick) applySizeQuick.addEventListener('click', () => {
  const parsed = parseSize(sizeInput && sizeInput.value);
  if (!parsed) { if (sizeError) sizeError.textContent = 'Enter size like 1024x1024 or 800,600'; return; }
  applyParsedSize(parsed.w, parsed.h);
});
if (cancelSizeQuick) cancelSizeQuick.addEventListener('click', () => closeSizePopover());
const exportSelectedBtn = document.getElementById('exportSelectedBtn');

// Position popover logic
function openPosPopover() {
  if (!posPopover || !objects || !objects.selected) return;
  const sel = objects.selected;
  if (posXInput) posXInput.value = String(Math.round(sel.x));
  if (posYInput) posYInput.value = String(Math.round(sel.y));
  if (posZInput) posZInput.value = String(typeof sel.z === 'number' ? sel.z : 0);
  posEditBefore = cloneItem(sel);
  posPopover.hidden = false;
  if (posXInput) posXInput.focus();
}
function closePosPopover() {
  if (!posPopover) return;
  posPopover.hidden = true;
  // Create a single undo entry for the live-edited session
  if (posEditBefore && objects && objects.selected && posEditBefore.id === objects.selected.id) {
    const sel = objects.selected;
    const after = cloneItem(sel);
    // Only record if changed
    if (posEditBefore.x !== after.x || posEditBefore.y !== after.y || (posEditBefore.z ?? 0) !== (after.z ?? 0)) {
      objHistory.undo.push({ type: 'modify', id: sel.id, before: posEditBefore, after });
      objHistory.redo.length = 0; updateUndoRedoState(); persist();
    }
  }
  posEditBefore = null;
}

// Apply live on input
function applyLivePosition(nx, ny) {
  const sel = objects.selected; if (!sel) return;
  const clampedX = Math.round(Number.isFinite(nx) ? nx : sel.x);
  const clampedY = Math.round(Number.isFinite(ny) ? ny : sel.y);
  if (clampedX === sel.x && clampedY === sel.y) return;
  sel.x = clampedX; sel.y = clampedY;
  scheduleRender();
}
if (posXInput) posXInput.addEventListener('input', () => {
  const sel = objects.selected; if (!sel) return;
  const nx = Number(posXInput.value);
  applyLivePosition(nx, sel.y);
});
if (posYInput) posYInput.addEventListener('input', () => {
  const sel = objects.selected; if (!sel) return;
  const ny = Number(posYInput.value);
  applyLivePosition(sel.x, ny);
});
if (posZInput) posZInput.addEventListener('input', () => {
  const sel = objects.selected; if (!sel) return;
  const nz = Math.round(Number(posZInput.value));
  const val = Number.isFinite(nz) ? nz : 0;
  if ((sel.z ?? 0) === val) return;
  sel.z = val;
  scheduleRender();
});

// Presets
function setPreset(x, y) {
  const sel = objects.selected; if (!sel) return;
  if (posXInput) posXInput.value = String(x);
  if (posYInput) posYInput.value = String(y);
  applyLivePosition(x, y);
}
if (posPreset00) posPreset00.addEventListener('click', () => setPreset(0, 0));
if (posPreset1010) posPreset1010.addEventListener('click', () => setPreset(10, 10));
if (posPreset100100) posPreset100100.addEventListener('click', () => setPreset(100, 100));
if (posPresetCenter) posPresetCenter.addEventListener('click', () => {
  const sel = objects.selected; if (!sel) return;
  const nx = Math.round((doc.width - sel.w) / 2);
  const ny = Math.round((doc.height - sel.h) / 2);
  setPreset(nx, ny);
});

// Close on Escape or outside click (like size popover)
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePosPopover(); });
window.addEventListener('mousedown', (e) => {
  if (!posPopover || posPopover.hidden) return;
  if (!posPopover.contains(e.target)) closePosPopover();
});
if (exportSelectedBtn) exportSelectedBtn.addEventListener('click', async () => {
  const { mime, ext, quality } = getExportFormat();
  const ids = (selectMode && selectMode.checked && multiSelected.size > 0)
    ? Array.from(multiSelected)
    : (objects.selected ? [objects.selected.id] : []);
  if (!ids.length) { if (sizeError) sizeError.textContent = 'No selection to export'; return; }
  for (const id of ids) {
    const it = objects.getById(id); if (!it) continue;
    const outC = document.createElement('canvas');
    const w = Math.max(1, Math.round(it.w));
    const h = Math.max(1, Math.round(it.h));
    outC.width = w; outC.height = h;
    const octx = outC.getContext('2d');
    if (mime === 'image/jpeg') { octx.fillStyle = '#000000'; octx.fillRect(0, 0, w, h); }
    octx.drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, 0, 0, w, h);
    const blob = await exportCanvasToBlob(outC, { mime, quality });
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const sizeKB = Math.round((blob.size || 0) / 1024);
    const stamp = dateStamp();
    a.href = url; a.download = `selected-${outC.width}x${outC.height}-${sizeKB}KB-${stamp}-${id}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }
});

function resizeSelectedObjectsTo(w, h) {
  const beforeObjects = cloneAllItems();
  const ids = Array.from(multiSelected);
  for (const id of ids) {
    const sel = objects.getById(id);
    if (!sel) continue;
    const tw = clampPosInt(w);
    const th = clampPosInt(h);
    const srcW = sel.sw, srcH = sel.sh;
    const srcC = document.createElement('canvas');
    srcC.width = srcW; srcC.height = srcH;
    srcC.getContext('2d').drawImage(sel.canvas, sel.sx, sel.sy, sel.sw, sel.sh, 0, 0, srcW, srcH);
    const outC = document.createElement('canvas');
    outC.width = tw; outC.height = th;
    outC.getContext('2d').drawImage(srcC, 0, 0, srcW, srcH, 0, 0, tw, th);
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    sel.canvas = outC;
    sel.sx = 0; sel.sy = 0; sel.sw = tw; sel.sh = th;
    sel.w = tw; sel.h = th;
    sel.x = Math.round(cx - tw / 2);
    sel.y = Math.round(cy - th / 2);
  }
  render();
  const afterObjects = cloneAllItems();
  objHistory.undo.push({ type: 'replace', before: beforeObjects, after: afterObjects });
  objHistory.redo.length = 0; updateUndoRedoState();
  persist();
}
// Close on Escape or outside click
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSizePopover(); });
window.addEventListener('mousedown', (e) => {
  if (!sizePopover || sizePopover.hidden) return;
  if (!sizePopover.contains(e.target) && !(statusBar && statusBar.contains(e.target))) closeSizePopover();
});

// Text: create canvas for text and add as object
function createTextCanvas(text, { size = 48, color = '#ffffff', bold = false, italic = false, font = 'Arial' } = {}) {
  const pad = Math.ceil(size * 0.25);
  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d');
  const fontStr = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${font}`;
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
    // Parse style selector value: "Font|variant"
    let font = 'Arial';
    let variant = 'regular';
    if (textStyle && textStyle.value) {
      const parts = String(textStyle.value).split('|');
      font = parts[0] || 'Arial';
      variant = parts[1] || 'regular';
    }
    const bold = /bold/i.test(variant);
    const italic = /italic/i.test(variant);

    // If a text object is selected, update it instead of creating a new one
    const sel = objects.selected;
    if (sel && sel.meta && sel.meta.type === 'text') {
      const before = cloneItem(sel);
      sel.meta = { type: 'text', text: txt, size, color, bold, italic, font, variant };
      const newCanvas = createTextCanvas(txt, { size, color, bold, italic, font });
      // Keep top-left position; update dimensions and source rect
      sel.canvas = newCanvas;
      sel.sx = 0; sel.sy = 0; sel.sw = newCanvas.width; sel.sh = newCanvas.height;
      sel.w = newCanvas.width; sel.h = newCanvas.height;
      render();
      const after = cloneItem(sel);
      objHistory.undo.push({ type: 'modify', id: sel.id, before, after });
      objHistory.redo.length = 0; updateUndoRedoState();
      persist();
      return;
    }

    const c = createTextCanvas(txt, { size, color, bold, italic, font });
    // Place centered on the document
    const x = Math.round((doc.width - c.width) / 2);
    const y = Math.round((doc.height - c.height) / 2);
    const id = objects.addImageBitmap(c, { x, y }, { type: 'text', text: txt, size, color, bold, italic, font, variant });
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

// Sync Add panel with selected text object when menu opens or selection changes
function variantFromFlags({ bold, italic }) {
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}
function syncAddPanelFromSelection() {
  const sel = objects.selected;
  if (!sel || !sel.meta || sel.meta.type !== 'text') return;
  const m = sel.meta;
  if (textContent) textContent.value = m.text ?? '';
  if (textColor && m.color) textColor.value = m.color;
  if (textSize && m.size) { textSize.value = String(m.size); updateTextSizeLabel(); }
  if (textStyle) {
    const variant = m.variant || variantFromFlags(m);
    const val = `${m.font || 'Arial'}|${variant}`;
    // If option exists, set; otherwise default
    textStyle.value = val;
  }
}

// Detect selection changes via interactions and canvas clicks
const addMenuEl = Array.from(document.querySelectorAll('.menu > summary')).find(s => s.textContent.trim() === 'Add')?.parentElement;
if (addMenuEl) {
  addMenuEl.addEventListener('toggle', () => {
    if (addMenuEl.open) syncAddPanelFromSelection();
  });
}

function updateSelectedTextFromInputs() {
  const sel = objects.selected;
  if (!sel || !sel.meta || sel.meta.type !== 'text') return false;
  const before = cloneItem(sel);
  const txt = (textContent && textContent.value) || '';
  const size = Math.max(6, Math.min(512, Number(textSize && textSize.value) || 48));
  const color = (textColor && textColor.value) || '#ffffff';
  let font = 'Arial';
  let variant = 'regular';
  if (textStyle && textStyle.value) {
    const parts = String(textStyle.value).split('|');
    font = parts[0] || 'Arial';
    variant = parts[1] || 'regular';
  }
  const bold = /bold/i.test(variant);
  const italic = /italic/i.test(variant);
  sel.meta = { type: 'text', text: txt, size, color, bold, italic, font, variant };
  const nc = createTextCanvas(txt, { size, color, bold, italic, font });
  const cx = sel.x + sel.w / 2;
  const cy = sel.y + sel.h / 2;
  sel.canvas = nc;
  sel.sx = 0; sel.sy = 0; sel.sw = nc.width; sel.sh = nc.height;
  sel.w = nc.width; sel.h = nc.height;
  // Keep center anchored so editing feels stable
  sel.x = Math.round(cx - sel.w / 2);
  sel.y = Math.round(cy - sel.h / 2);
  render();
  const after = cloneItem(sel);
  objHistory.undo.push({ type: 'modify', id: sel.id, before, after });
  objHistory.redo.length = 0; updateUndoRedoState();
  persist();
  return true;
}

// Live-update selected text when changing controls
if (textContent) textContent.addEventListener('input', () => { updateSelectedTextFromInputs(); });
if (textColor) textColor.addEventListener('change', () => { updateSelectedTextFromInputs(); });
if (textSize) textSize.addEventListener('change', () => { updateSelectedTextFromInputs(); });
if (textStyle) textStyle.addEventListener('change', () => { updateSelectedTextFromInputs(); });
