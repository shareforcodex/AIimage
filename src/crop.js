export class CropMarquee {
  constructor() {
    this.active = false;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.drag = null; // { mode, start, orig }
    this.handleSize = 8;
  }

  toggle(on) {
    if (on === undefined) this.active = !this.active; else this.active = on;
  }

  setToDocument(docW, docH) {
    this.rect = { x: 0, y: 0, w: docW, h: docH };
  }

  beginDrag(mode, startPt) {
    this.drag = { mode, start: { ...startPt }, orig: { ...this.rect } };
  }

  updateDrag(pt, bounds) {
    if (!this.drag) return;
    const { mode, start, orig } = this.drag;
    let { x, y, w, h } = orig;
    const dx = pt.x - start.x;
    const dy = pt.y - start.y;
    if (mode === 'move') {
      x = clamp(x + dx, bounds.x, bounds.x + bounds.w - w);
      y = clamp(y + dy, bounds.y, bounds.y + bounds.h - h);
    } else {
      const left = x, top = y, right = x + w, bottom = y + h;
      let nx = left, ny = top, nr = right, nb = bottom;
      if (mode.includes('w')) nx = left + dx;
      if (mode.includes('e')) nr = right + dx;
      if (mode.includes('n')) ny = top + dy;
      if (mode.includes('s')) nb = bottom + dy;
      // keep within bounds
      nx = clamp(nx, bounds.x, nr - 1);
      ny = clamp(ny, bounds.y, nb - 1);
      nr = clamp(nr, nx + 1, bounds.x + bounds.w);
      nb = clamp(nb, ny + 1, bounds.y + bounds.h);
      x = nx; y = ny; w = nr - nx; h = nb - ny;
    }
    this.rect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  endDrag() { this.drag = null; }

  hitTest(imagePt) {
    const r = this.rect;
    const hs = this.handleSize;
    const handles = [
      { mode: 'nw', x: r.x, y: r.y },
      { mode: 'ne', x: r.x + r.w, y: r.y },
      { mode: 'sw', x: r.x, y: r.y + r.h },
      { mode: 'se', x: r.x + r.w, y: r.y + r.h },
      { mode: 'n', x: r.x + r.w / 2, y: r.y },
      { mode: 's', x: r.x + r.w / 2, y: r.y + r.h },
      { mode: 'w', x: r.x, y: r.y + r.h / 2 },
      { mode: 'e', x: r.x + r.w, y: r.y + r.h / 2 },
    ];
    for (const h of handles) {
      if (Math.abs(imagePt.x - h.x) <= hs && Math.abs(imagePt.y - h.y) <= hs) return h.mode;
    }
    if (
      imagePt.x >= r.x && imagePt.x <= r.x + r.w &&
      imagePt.y >= r.y && imagePt.y <= r.y + r.h
    ) return 'move';
    return null;
  }

  draw(ctx, viewport, canvas) {
    if (!this.active) return;
    const { x, y, w, h } = this.rect;

    // Screen-space overlay with punched hole in image-space for robust alignment
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-out';
    viewport.apply(ctx);
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Marquee + handles in image space
    ctx.save();
    viewport.apply(ctx);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 / viewport.scale;
    ctx.setLineDash([4 / viewport.scale, 4 / viewport.scale]);
    ctx.strokeRect(x + 0.5 / viewport.scale, y + 0.5 / viewport.scale, w, h);
    ctx.setLineDash([]);
    const hs = this.handleSize / viewport.scale;
    ctx.fillStyle = '#fff';
    const handles = [
      [x, y], [x + w, y], [x, y + h], [x + w, y + h],
      [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]
    ];
    for (const [hx, hy] of handles) ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    ctx.restore();
  }

  applyCrop(doc, dctx) {
    const { x, y, w, h } = this.rect;
    if (w < 1 || h < 1) return false;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').drawImage(doc, x, y, w, h, 0, 0, w, h);
    doc.width = w; doc.height = h;
    dctx.clearRect(0, 0, w, h);
    dctx.drawImage(tmp, 0, 0);
    this.setToDocument(w, h);
    this.active = false;
    return true;
  }
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
