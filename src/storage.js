const DB_NAME = 'aiimage';
const STORE = 'state';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveState(docCanvas, view, objectsManager) {
  try {
    const db = await openDB();
    const blob = await canvasToBlob(docCanvas);
    let objects = [];
    if (objectsManager && typeof objectsManager.serialize === 'function') {
      objects = await objectsManager.serialize();
    }
    await txPut(db, 'session', { png: blob, width: docCanvas.width, height: docCanvas.height, view, objects });
    db.close();
  } catch (e) {
    console.warn('saveState failed', e);
  }
}

export async function loadState(docCanvas, dctx) {
  try {
    const db = await openDB();
    const state = await txGet(db, 'session');
    db.close();
    if (!state || !state.png) return null;
    const img = await blobToImage(state.png);
    docCanvas.width = state.width; docCanvas.height = state.height;
    dctx.clearRect(0, 0, state.width, state.height);
    dctx.drawImage(img, 0, 0);
    return { view: state.view, width: state.width, height: state.height, objects: state.objects || [] };
  } catch (e) {
    console.warn('loadState failed', e);
    return null;
  }
}

function txPut(db, key, val) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function txGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function blobToImage(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.src = url;
  });
}

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
