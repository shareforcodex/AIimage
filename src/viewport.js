export class Viewport {
  constructor() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.minScale = 0.1;
    this.maxScale = 10;
    this.docW = 0;
    this.docH = 0;
    this.viewW = 0;
    this.viewH = 0;
  }

  reset(docW, docH, viewW, viewH) {
    this.docW = docW; this.docH = docH; this.viewW = viewW; this.viewH = viewH;
    this.scale = 1;
    // Center document within view
    this.tx = Math.floor((viewW - docW) / 2);
    this.ty = Math.floor((viewH - docH) / 2);
    this.clamp();
  }

  apply(ctx) {
    ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty);
  }

  screenToCanvas(point, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (point.x - rect.left) * scaleX,
      y: (point.y - rect.top) * scaleY,
    };
  }

  canvasToImage(pt) {
    return {
      x: (pt.x - this.tx) / this.scale,
      y: (pt.y - this.ty) / this.scale,
    };
  }

  imageToCanvas(pt) {
    return {
      x: pt.x * this.scale + this.tx,
      y: pt.y * this.scale + this.ty,
    };
  }

  zoomAt(factor, cx, cy) {
    const prevScale = this.scale;
    const next = clamp(prevScale * factor, this.minScale, this.maxScale);
    if (next === prevScale) return;
    // keep (cx, cy) stable
    const k = next / prevScale;
    this.tx = cx - k * (cx - this.tx);
    this.ty = cy - k * (cy - this.ty);
    this.scale = next;
    this.clamp();
  }

  panBy(dx, dy) {
    this.tx += dx;
    this.ty += dy;
    this.clamp();
  }

  setViewSize(viewW, viewH) {
    this.viewW = viewW; this.viewH = viewH;
    this.clamp();
  }

  clamp() {
    const cw = this.docW * this.scale;
    const ch = this.docH * this.scale;
    // Horizontal
    if (cw <= this.viewW) {
      this.tx = Math.round((this.viewW - cw) / 2);
    } else {
      const minTx = Math.round(this.viewW - cw);
      const maxTx = 0;
      if (this.tx < minTx) this.tx = minTx;
      if (this.tx > maxTx) this.tx = maxTx;
    }
    // Vertical
    if (ch <= this.viewH) {
      this.ty = Math.round((this.viewH - ch) / 2);
    } else {
      const minTy = Math.round(this.viewH - ch);
      const maxTy = 0;
      if (this.ty < minTy) this.ty = minTy;
      if (this.ty > maxTy) this.ty = maxTy;
    }
  }
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
