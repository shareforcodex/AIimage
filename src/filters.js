function applyKernel3x3(dctx, kernel, divisor = null, bias = 0) {
  const w = dctx.canvas.width, h = dctx.canvas.height;
  const src = dctx.getImageData(0, 0, w, h);
  const out = dctx.createImageData(w, h);
  const s = src.data, o = out.data;
  const sum = kernel.reduce((a, b) => a + b, 0);
  let div = (divisor === null || divisor === undefined) ? sum : divisor;
  if (!div) div = 1;
  const k = kernel;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const px = clamp(x + kx, 0, w - 1);
          const py = clamp(y + ky, 0, h - 1);
          const idx = (py * w + px) * 4;
          const kval = k[(ky + 1) * 3 + (kx + 1)];
          r += s[idx] * kval;
          g += s[idx + 1] * kval;
          b += s[idx + 2] * kval;
          a += s[idx + 3] * kval;
        }
      }
      const oi = (y * w + x) * 4;
      o[oi] = clampByte(r / div + bias);
      o[oi + 1] = clampByte(g / div + bias);
      o[oi + 2] = clampByte(b / div + bias);
      o[oi + 3] = clampByte(a / div);
    }
  }
  dctx.putImageData(out, 0, 0);
}

export function blur(dctx) {
  applyKernel3x3(dctx, [1, 2, 1, 2, 4, 2, 1, 2, 1], 16, 0);
}

export function sharpen(dctx) {
  applyKernel3x3(dctx, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1, 0);
}

export function applyLevels(dctx, { black = 0, gamma = 1.0, white = 255 }) {
  black = clamp(black, 0, 254);
  white = clamp(white, black + 1, 255);
  gamma = Math.max(0.1, gamma);
  const w = dctx.canvas.width, h = dctx.canvas.height;
  const img = dctx.getImageData(0, 0, w, h);
  const d = img.data;
  const scale = 255 / (white - black);
  const invGamma = 1 / gamma;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = remap(d[i], black, scale, invGamma);
    d[i + 1] = remap(d[i + 1], black, scale, invGamma);
    d[i + 2] = remap(d[i + 2], black, scale, invGamma);
  }
  dctx.putImageData(img, 0, 0);
}

export function applyCurves(dctx, preset = 'none') {
  if (preset === 'none') return;
  const amount = preset === 's' ? 0.35 : preset === 'strong-s' ? 0.6 : preset === 'inverse-s' ? -0.35 : 0.35;
  const w = dctx.canvas.width, h = dctx.canvas.height;
  const img = dctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = curve(d[i], amount);
    d[i + 1] = curve(d[i + 1], amount);
    d[i + 2] = curve(d[i + 2], amount);
  }
  dctx.putImageData(img, 0, 0);
}

function remap(v, black, scale, invGamma) {
  let t = (v - black) * scale; // 0..255
  t = clamp(t, 0, 255) / 255; // 0..1
  t = Math.pow(t, invGamma);
  return clampByte(t * 255);
}

function curve(v, amount) {
  const t = v / 255; // 0..1
  // Smoothstep-like S curve blend
  const s = t * t * (3 - 2 * t);
  const out = t * (1 - Math.abs(amount)) + s * amount;
  return clampByte(out * 255);
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
