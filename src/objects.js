export class ObjectsManager {
  constructor() {
    this.items = []; // { id, canvas, w, h, x, y }
    this.nextId = 1;
    this.selectedId = null;
    this.drag = null; // { mode: 'move'|'nw'|'ne'|'sw'|'se'|'n'|'s'|'w'|'e', start:{x,y}, orig:{x,y,w,h}, id }
    this.handleSize = 8;
    this.keepAspect = true;
  }

  addImageBitmap(img, at = null) {
    const iw = img.width; const ih = img.height;
    const c = document.createElement('canvas');
    c.width = iw; c.height = ih;
    c.getContext('2d').drawImage(img, 0, 0);
    const id = this.nextId++;
    const item = {
      id, canvas: c,
      // source rect (for cropping)
      sx: 0, sy: 0, sw: iw, sh: ih,
      // destination rect
      x: (at && typeof at.x === 'number') ? at.x : 0,
      y: (at && typeof at.y === 'number') ? at.y : 0,
      w: iw, h: ih,
    };
    this.items.push(item);
    this.selectedId = id;
    return id;
  }

  get selected() { return this.items.find(i => i.id === this.selectedId) || null; }

  bringToFront(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx >= 0) {
      const [it] = this.items.splice(idx, 1);
      this.items.push(it);
    }
  }

  draw(ctx) {
    for (const it of this.items) {
      ctx.drawImage(it.canvas, it.sx, it.sy, it.sw, it.sh, it.x, it.y, it.w, it.h);
    }
  }

  getById(id) { return this.items.find(i => i.id === id) || null; }

  removeById(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    const [it] = this.items.splice(idx, 1);
    if (this.selectedId === id) this.selectedId = null;
    return it;
  }

  addFromData(data) {
    const id = typeof data.id === 'number' ? data.id : this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const item = {
      id,
      canvas: data.canvas,
      x: data.x, y: data.y, w: data.w, h: data.h,
      sx: data.sx ?? 0, sy: data.sy ?? 0, sw: data.sw ?? data.canvas.width, sh: data.sh ?? data.canvas.height,
    };
    this.items.push(item);
    this.selectedId = id;
    return id;
  }

  setFromData(id, data) {
    const it = this.getById(id);
    if (!it) return false;
    it.canvas = data.canvas;
    it.x = data.x; it.y = data.y; it.w = data.w; it.h = data.h;
    it.sx = data.sx; it.sy = data.sy; it.sw = data.sw; it.sh = data.sh;
    return true;
  }

  drawSelection(ctx, viewport) {
    const sel = this.selected; if (!sel) return;
    ctx.save();
    viewport.apply(ctx);
    ctx.strokeStyle = '#4dabf7';
    ctx.lineWidth = 1 / viewport.scale;
    ctx.setLineDash([4 / viewport.scale, 4 / viewport.scale]);
    ctx.strokeRect(sel.x + 0.5 / viewport.scale, sel.y + 0.5 / viewport.scale, sel.w, sel.h);
    ctx.setLineDash([]);
    const hs = this.handleSize / viewport.scale;
    ctx.fillStyle = '#4dabf7';
    const handles = this._handlePoints(sel);
    for (const p of handles) ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.restore();
  }

  _handlePoints(r) {
    return [
      { mode: 'nw', x: r.x, y: r.y },
      { mode: 'ne', x: r.x + r.w, y: r.y },
      { mode: 'sw', x: r.x, y: r.y + r.h },
      { mode: 'se', x: r.x + r.w, y: r.y + r.h },
      { mode: 'n', x: r.x + r.w / 2, y: r.y },
      { mode: 's', x: r.x + r.w / 2, y: r.y + r.h },
      { mode: 'w', x: r.x, y: r.y + r.h / 2 },
      { mode: 'e', x: r.x + r.w, y: r.y + r.h / 2 },
    ];
  }

  hitTest(pt) {
    // topmost first
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (pt.x >= it.x && pt.x <= it.x + it.w && pt.y >= it.y && pt.y <= it.y + it.h) return it.id;
    }
    return null;
  }

  hitHandle(pt) {
    const sel = this.selected; if (!sel) return null;
    const hs = this.handleSize;
    for (const h of this._handlePoints(sel)) {
      if (Math.abs(pt.x - h.x) <= hs && Math.abs(pt.y - h.y) <= hs) return h.mode;
    }
    return null;
  }

  beginInteraction(pt) {
    const handle = this.hitHandle(pt);
    if (handle) {
      const sel = this.selected;
      const scaleX = sel.w / sel.sw;
      const scaleY = sel.h / sel.sh;
      this.drag = { mode: handle, start: { ...pt }, orig: { ...sel, scaleX, scaleY }, id: this.selectedId };
      return true;
    }
    const hit = this.hitTest(pt);
    if (hit) {
      this.selectedId = hit;
      this.bringToFront(hit);
      const sel = this.selected;
      const scaleX = sel.w / sel.sw;
      const scaleY = sel.h / sel.sh;
      this.drag = { mode: 'move', start: { ...pt }, orig: { ...sel, scaleX, scaleY }, id: hit };
      return true;
    }
    this.selectedId = null;
    return false;
  }

  updateInteraction(pt) {
    if (!this.drag) return false;
    const it = this.items.find(i => i.id === this.drag.id);
    if (!it) return false;
    const { mode, start, orig } = this.drag;
    const dx = pt.x - start.x; const dy = pt.y - start.y;
    if (mode === 'move') {
      it.x = Math.round(orig.x + dx);
      it.y = Math.round(orig.y + dy);
      return true;
    }
    let l = orig.x, t = orig.y, r = orig.x + orig.w, b = orig.y + orig.h;
    if (mode.includes('w')) l = orig.x + dx;
    if (mode.includes('e')) r = orig.x + orig.w + dx;
    if (mode.includes('n')) t = orig.y + dy;
    if (mode.includes('s')) b = orig.y + orig.h + dy;
    // Normalize
    let nx = Math.min(l, r), ny = Math.min(t, b);
    let nw = Math.max(1, Math.abs(r - l));
    let nh = Math.max(1, Math.abs(b - t));

    if (this.keepAspect && (mode === 'nw' || mode === 'ne' || mode === 'sw' || mode === 'se')) {
      const a = orig.w / Math.max(1, orig.h);
      const centerX = orig.x + orig.w / 2;
      const centerY = orig.y + orig.h / 2;
      {
        // Anchor opposite corner
        let anchorX = orig.x, anchorY = orig.y;
        if (mode === 'nw') { anchorX = orig.x + orig.w; anchorY = orig.y + orig.h; }
        if (mode === 'ne') { anchorX = orig.x; anchorY = orig.y + orig.h; }
        if (mode === 'sw') { anchorX = orig.x + orig.w; anchorY = orig.y; }
        if (mode === 'se') { anchorX = orig.x; anchorY = orig.y; }
        const vx = pt.x - anchorX;
        const vy = pt.y - anchorY;
        // Candidate sizes from each axis
        let wFromX = Math.abs(vx);
        let hFromX = Math.round(wFromX / a);
        let hFromY = Math.abs(vy);
        let wFromY = Math.round(hFromY * a);
        // Choose the one that stays within the drag direction vector
        let w = wFromX, h = hFromX;
        if (wFromY <= wFromX && hFromY <= hFromX) { w = wFromY; h = hFromY; }
        // Apply signs per quadrant
        const sx = (mode === 'nw' || mode === 'sw') ? -1 : 1;
        const sy = (mode === 'nw' || mode === 'ne') ? -1 : 1;
        const ax = anchorX, ay = anchorY;
        const rx = sx < 0 ? ax - w : ax;
        const ry = sy < 0 ? ay - h : ay;
        nx = Math.min(rx, rx + w); ny = Math.min(ry, ry + h);
        nw = Math.max(1, w); nh = Math.max(1, h);
      }
      it.x = Math.round(nx); it.y = Math.round(ny); it.w = Math.round(nw); it.h = Math.round(nh);
      return true;
    }

    // Edge handles: crop (no scale change)
    const sX = orig.scaleX || (orig.w / orig.sw);
    const sY = orig.scaleY || (orig.h / orig.sh);
    if (mode === 'e') {
      const dw = Math.round(nw - orig.w);
      if (dw < 0) { // crop inward only
        it.sw = clampInt(orig.sw + Math.round(dw / sX), 1, it.canvas.width - orig.sx);
        it.w = Math.round(it.sw * sX);
      }
    } else if (mode === 'w') {
      const dw = Math.round(nw - orig.w);
      if (dw < 0) {
        const dsw = Math.round(-dw / sX);
        const nsx = clampInt(orig.sx + dsw, 0, orig.sx + orig.sw - 1);
        const nsw = clampInt(orig.sw - dsw, 1, it.canvas.width - nsx);
        it.sx = nsx; it.sw = nsw;
        it.w = Math.round(it.sw * sX);
        it.x = Math.round(orig.x + (orig.w - it.w));
      }
    } else if (mode === 's') {
      const dh = Math.round(nh - orig.h);
      if (dh < 0) {
        it.sh = clampInt(orig.sh + Math.round(dh / sY), 1, it.canvas.height - orig.sy);
        it.h = Math.round(it.sh * sY);
      }
    } else if (mode === 'n') {
      const dh = Math.round(nh - orig.h);
      if (dh < 0) {
        const dsh = Math.round(-dh / sY);
        const nsy = clampInt(orig.sy + dsh, 0, orig.sy + orig.sh - 1);
        const nsh = clampInt(orig.sh - dsh, 1, it.canvas.height - nsy);
        it.sy = nsy; it.sh = nsh;
        it.h = Math.round(it.sh * sY);
        it.y = Math.round(orig.y + (orig.h - it.h));
      }
    }
    return true;
  }

  endInteraction() { this.drag = null; }

  // Serialization for persistence
  async serialize() {
    const out = [];
    for (const it of this.items) {
      const blob = await canvasToBlob(it.canvas);
      out.push({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, sx: it.sx, sy: it.sy, sw: it.sw, sh: it.sh, blob });
    }
    return out;
  }

  async load(serialized) {
    this.items = [];
    this.selectedId = null;
    this.nextId = 1;
    for (const s of serialized || []) {
      const img = await blobToImage(s.blob);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const id = this.nextId++;
      this.items.push({ id, canvas: c,
        x: s.x, y: s.y, w: s.w, h: s.h,
        sx: s.sx ?? 0, sy: s.sy ?? 0, sw: s.sw ?? c.width, sh: s.sh ?? c.height
      });
    }
  }
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

function clampInt(n, min, max) {
  n = Math.round(Number(n) || 0);
  if (min > max) { const t = min; min = max; max = t; }
  return Math.max(min, Math.min(max, n));
}
