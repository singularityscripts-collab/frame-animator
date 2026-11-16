// Efeitos de instância: filtros, modos de mesclagem, escala de 9 fatias, cache como bitmap e 3D.

import { drawMesh } from './mesh.js';

export const BLEND_MODES = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  lighten: 'lighten',
  darken: 'darken',
  overlay: 'overlay',
  hardlight: 'hard-light',
  difference: 'difference',
  add: 'lighter',
  invert: 'exclusion',
  alpha: 'destination-in',
  erase: 'destination-out',
};
export const BLEND_LABELS = {
  normal: 'Normal',
  multiply: 'Multiplicar',
  screen: 'Tela',
  lighten: 'Clarear',
  darken: 'Escurecer',
  overlay: 'Sobrepor',
  hardlight: 'Luz forte',
  difference: 'Diferença',
  add: 'Adicionar',
  invert: 'Inverter',
  alpha: 'Alfa (recorta o de baixo)',
  erase: 'Apagar (fura o de baixo)',
};

export const FILTER_DEFAULTS = {
  dropShadow: { type: 'dropShadow', distance: 6, angle: 45, blur: 6, color: '#000000', alpha: 60, strength: 1, inner: false, knockout: false },
  blur: { type: 'blur', blur: 6 },
  glow: { type: 'glow', blur: 10, color: '#ffcc00', alpha: 100, strength: 2, inner: false, knockout: false },
  bevel: { type: 'bevel', distance: 4, angle: 45, blur: 4, highlight: '#ffffff', shadow: '#000000', strength: 1 },
  adjustColor: { type: 'adjustColor', brightness: 0, contrast: 0, saturation: 0, hue: 0 },
};
export const FILTER_LABELS = { dropShadow: 'Sombra', blur: 'Desfoque', glow: 'Brilho', bevel: 'Chanfro', adjustColor: 'Ajuste de cor' };

const rgba = (hex, a = 1) => {
  const n = parseInt(String(hex || '#000').replace('#', '').slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function scaleOfTransform(t) {
  return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
}

function fresh(scratch, key, w, h) {
  const c = scratch(key, w, h);
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.filter = 'none';
  x.clearRect(0, 0, w, h);
  return x;
}

/** Sombra/brilho interno: só dentro da forma. */
function inner(scratch, key, src, dx, dy, blur, color) {
  const w = src.width, h = src.height;
  const a = fresh(scratch, key + 'a', w, h);
  a.fillStyle = color;
  a.fillRect(0, 0, w, h);
  a.globalCompositeOperation = 'destination-out';
  a.drawImage(src, dx, dy);
  const b = fresh(scratch, key + 'b', w, h);
  b.filter = `blur(${Math.max(0, blur)}px)`;
  b.drawImage(a.canvas, 0, 0);
  b.filter = 'none';
  b.globalCompositeOperation = 'destination-in';
  b.drawImage(src, 0, 0);
  return b.canvas;
}

/** Aplica a lista de filtros a um canvas (do tamanho do alvo); devolve o canvas resultante. */
export function applyFilters(src, filters, px, scratch, key) {
  let cur = src;
  filters.forEach((f, i) => {
    if (f.enabled === false) return;
    const w = cur.width, h = cur.height;
    const o = fresh(scratch, `${key}f${i % 2}`, w, h);
    const blur = ((f.blur ?? 0) * px) / 2;
    if (f.type === 'blur') {
      o.filter = `blur(${blur}px)`;
      o.drawImage(cur, 0, 0);
    } else if (f.type === 'adjustColor') {
      o.filter = `brightness(${1 + (f.brightness || 0) / 100}) contrast(${1 + (f.contrast || 0) / 100}) saturate(${1 + (f.saturation || 0) / 100}) hue-rotate(${f.hue || 0}deg)`;
      o.drawImage(cur, 0, 0);
    } else if (f.type === 'dropShadow' || f.type === 'glow') {
      const ang = ((f.angle ?? 45) * Math.PI) / 180;
      const dist = f.type === 'glow' ? 0 : (f.distance ?? 0) * px;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      const color = rgba(f.color, (f.alpha ?? 100) / 100);
      const times = Math.max(1, Math.min(4, Math.round(f.strength || 1)));
      if (f.inner) {
        const sh = inner(scratch, `${key}i${i}`, cur, dx, dy, blur, color);
        o.drawImage(cur, 0, 0);
        for (let k = 0; k < times; k++) o.drawImage(sh, 0, 0);
      } else {
        o.filter = `drop-shadow(${dx}px ${dy}px ${blur}px ${color})`;
        for (let k = 0; k < times; k++) o.drawImage(cur, 0, 0);
        o.filter = 'none';
        if (f.knockout) {
          o.globalCompositeOperation = 'destination-out';
          o.drawImage(cur, 0, 0);
          o.globalCompositeOperation = 'source-over';
        } else o.drawImage(cur, 0, 0);
      }
    } else if (f.type === 'bevel') {
      const ang = ((f.angle ?? 45) * Math.PI) / 180;
      const d = (f.distance ?? 4) * px;
      const dx = Math.cos(ang) * d, dy = Math.sin(ang) * d;
      o.drawImage(cur, 0, 0);
      const times = Math.max(1, Math.min(3, Math.round(f.strength || 1)));
      const hi = inner(scratch, `${key}h${i}`, cur, -dx, -dy, blur, rgba(f.highlight || '#ffffff', 0.85));
      const sh = inner(scratch, `${key}s${i}`, cur, dx, dy, blur, rgba(f.shadow || '#000000', 0.85));
      for (let k = 0; k < times; k++) {
        o.drawImage(sh, 0, 0);
        o.drawImage(hi, 0, 0);
      }
    } else {
      o.drawImage(cur, 0, 0);
    }
    cur = o.canvas;
  });
  return cur;
}

// ---------- cache como bitmap ----------
const cache = new Map();
let cacheVersion = 0;
/** Esquece as imagens guardadas (chamado quando o documento muda: o conteúdo pode ser outro). */
export function clearBitmapCache() {
  cache.clear();
  cacheVersion++;
}
export const bitmapCacheVersion = () => cacheVersion;

/** Imagem do conteúdo (local) numa resolução; reaproveita enquanto nada muda. */
export function cachedContent(key, bounds, res, draw) {
  const k = `${key}:${Math.round(Math.log2(res) * 4)}:${cacheVersion}`;
  let c = cache.get(k);
  if (c) return c;
  c = renderContent(bounds, res, draw);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  cache.set(k, c);
  return c;
}

/** Desenha o conteúdo local num canvas próprio com `res` pixels por unidade (1px de margem). */
export function renderContent(bounds, res, draw, target = null) {
  const w = Math.max(1, Math.min(4096, Math.ceil(bounds.w * res) + 2));
  const h = Math.max(1, Math.min(4096, Math.ceil(bounds.h * res) + 2));
  const c = target || (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  x.setTransform(res, 0, 0, res, -bounds.x * res + 1, -bounds.y * res + 1);
  draw(x);
  return c;
}

// ---------- escala de 9 fatias ----------
/** Desenha a imagem do conteúdo (feita com renderContent) esticando só o miolo. m = matriz da instância. */
export function drawNineSlice(ctx, img, bounds, res, grid, m) {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = (Math.sign(det) || 1) * Math.hypot(m[2], m[3]);
  const rot = Math.atan2(m[1], m[0]);
  const B = bounds;
  const gx0 = Math.max(B.x, Math.min(B.x + B.w, grid.x)), gx1 = Math.max(gx0, Math.min(B.x + B.w, grid.x + grid.w));
  const gy0 = Math.max(B.y, Math.min(B.y + B.h, grid.y)), gy1 = Math.max(gy0, Math.min(B.y + B.h, grid.y + grid.h));
  const xs = [B.x, gx0, gx1, B.x + B.w], ys = [B.y, gy0, gy1, B.y + B.h];
  const W = B.w * Math.abs(sx), H = B.h * Math.abs(sy);
  const left = gx0 - B.x, right = B.x + B.w - gx1, top = gy0 - B.y, bottom = B.y + B.h - gy1;
  const midW = Math.max(0, W - left - right), midH = Math.max(0, H - top - bottom);
  const dxs = [0, left, left + midW, W], dys = [0, top, top + midH, H];
  ctx.save();
  ctx.transform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), m[4], m[5]);
  if (sy < 0) ctx.scale(1, -1);
  ctx.translate(B.x * Math.abs(sx), B.y * Math.abs(sy));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const sw = (xs[i + 1] - xs[i]) * res, sh = (ys[j + 1] - ys[j]) * res;
      const dw = dxs[i + 1] - dxs[i], dh = dys[j + 1] - dys[j];
      if (sw < 0.5 || sh < 0.5 || dw <= 0 || dh <= 0) continue;
      ctx.drawImage(img, (xs[i] - B.x) * res + 1, (ys[j] - B.y) * res + 1, sw, sh, dxs[i], dys[j], dw, dh);
    }
  }
  ctx.restore();
}

// ---------- 3D (movie clips) ----------
/**
 * Projeta o conteúdo (imagem de renderContent) com rotação X/Y e profundidade Z, em perspectiva.
 * persp = { angle (graus de campo de visão), x, y (ponto de fuga) } no espaço do pai.
 */
export function draw3D(ctx, img, bounds, res, el, persp, docWidth) {
  const rx = ((el.rx || 0) * Math.PI) / 180, ry = ((el.ry || 0) * Math.PI) / 180;
  const m = el.matrix;
  const elScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const fov = ((persp.angle ?? 55) * Math.PI) / 180;
  const f = docWidth / 2 / Math.tan(fov / 2);
  const vp = { x: persp.x, y: persp.y };
  const map = (u, v) => {
    const lx = bounds.x + u * bounds.w, ly = bounds.y + v * bounds.h;
    const x1 = lx * Math.cos(ry), z1 = -lx * Math.sin(ry);
    const y2 = ly * Math.cos(rx) - z1 * Math.sin(rx), z2 = ly * Math.sin(rx) + z1 * Math.cos(rx);
    const px = m[0] * x1 + m[2] * y2 + m[4], py = m[1] * x1 + m[3] * y2 + m[5];
    const Z = z2 * elScale + (el.z || 0);
    const s = f / Math.max(1, f + Z);
    return { x: vp.x + (px - vp.x) * s, y: vp.y + (py - vp.y) * s };
  };
  drawMesh(ctx, img, { x: 1, y: 1, w: bounds.w * res, h: bounds.h * res }, map, 10, 10);
}

export function has3D(el) {
  return !!(el.rx || el.ry || el.z);
}
