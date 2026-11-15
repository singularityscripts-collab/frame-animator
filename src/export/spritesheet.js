// Sprite sheet / texture atlas: desenha cada quadro, corta as bordas transparentes,
// empacota tudo numa imagem e gera o JSON no formato "hash" (o que os motores de jogo leem).

import { renderDocumentFrame, sceneLength } from '../player/render.js';

/**
 * Empacota retângulos em prateleiras (ordenados por altura). Devolve { w, h, rects: [{ x, y }] }
 * na mesma ordem da entrada. Largura alvo ≈ raiz da área total (folha quase quadrada).
 */
export function packRects(sizes, { padding = 2, layout = 'pack' } = {}) {
  const pad = Math.max(0, padding);
  if (!sizes.length) return { w: 1, h: 1, rects: [] };
  if (layout === 'grid') {
    const cw = Math.max(...sizes.map((s) => s.w)) + pad, ch = Math.max(...sizes.map((s) => s.h)) + pad;
    const cols = Math.ceil(Math.sqrt(sizes.length));
    const rows = Math.ceil(sizes.length / cols);
    return { w: cols * cw - pad || 1, h: rows * ch - pad || 1, rects: sizes.map((_, i) => ({ x: (i % cols) * cw, y: Math.floor(i / cols) * ch })) };
  }
  if (layout === 'row') {
    let x = 0;
    const rects = sizes.map((s) => {
      const r = { x, y: 0 };
      x += s.w + pad;
      return r;
    });
    return { w: Math.max(1, x - pad), h: Math.max(...sizes.map((s) => s.h)), rects };
  }
  const area = sizes.reduce((a, s) => a + (s.w + pad) * (s.h + pad), 0);
  const maxW = Math.max(Math.ceil(Math.sqrt(area) * 1.1), ...sizes.map((s) => s.w + pad));
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
  const rects = new Array(sizes.length);
  let x = 0, y = 0, shelf = 0, W = 0;
  for (const i of order) {
    const s = sizes[i];
    if (x > 0 && x + s.w > maxW) {
      y += shelf + pad;
      x = 0;
      shelf = 0;
    }
    rects[i] = { x, y };
    x += s.w + pad;
    W = Math.max(W, x - pad);
    shelf = Math.max(shelf, s.h);
  }
  return { w: Math.max(1, W), h: Math.max(1, y + shelf), rects };
}

/** Caixa dos pixels não transparentes de um ImageData (ou null se vazio). */
export function alphaBounds(img) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** JSON "hash" do atlas. */
export function atlasJSON(frames, { image, w, h, fps, name }) {
  const out = { frames: {}, animations: { [name]: [] }, meta: { app: 'Frame Animator', version: '1.0', image, format: 'RGBA8888', size: { w, h }, scale: '1', frameRate: fps } };
  for (const f of frames) {
    out.frames[f.name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: f.trimmed,
      spriteSourceSize: { x: f.ox, y: f.oy, w: f.w, h: f.h },
      sourceSize: { w: f.sw, h: f.sh },
      duration: Math.round(1000 / fps),
    };
    out.animations[name].push(f.name);
  }
  return out;
}

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/**
 * Gera a folha: { canvas, json }.
 * opts: { sceneIndex, from, to, scale (%), trim, padding, layout, name, onProgress(i, n) }
 */
export async function buildSpriteSheet(doc, opts = {}) {
  const si = opts.sceneIndex || 0;
  const len = sceneLength(doc.scenes[si]);
  const from = Math.max(0, opts.from ?? 0), to = Math.min(len - 1, opts.to ?? len - 1);
  const s = (opts.scale ?? 100) / 100;
  const sw = Math.max(1, Math.round(doc.width * s)), sh = Math.max(1, Math.round(doc.height * s));
  const name = opts.name || 'anim';
  const tmp = makeCanvas(sw, sh);
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  const cells = [];
  const seen = new Map(); // quadros idênticos reaproveitam a mesma célula
  for (let f = from; f <= to; f++) {
    renderDocumentFrame(ctx, doc, si, f, { width: sw, height: sh, transparent: true });
    const img = ctx.getImageData(0, 0, sw, sh);
    let b = opts.trim ? alphaBounds(img) : { x: 0, y: 0, w: sw, h: sh };
    if (!b) b = { x: 0, y: 0, w: 1, h: 1 };
    const crop = ctx.getImageData(b.x, b.y, b.w, b.h);
    // assinatura barata do conteúdo (para juntar quadros repetidos)
    let hash = 2166136261;
    const d = crop.data;
    for (let i = 0; i < d.length; i += 7) hash = Math.imul(hash ^ d[i], 16777619);
    const key = `${b.x},${b.y},${b.w},${b.h},${hash}`;
    cells.push({ f, b, crop, key, dup: seen.get(key) });
    if (!seen.has(key)) seen.set(key, cells.length - 1);
    opts.onProgress?.(f - from + 1, to - from + 1);
    if ((f - from) % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  const unique = cells.filter((c) => c.dup == null);
  const packed = packRects(unique.map((c) => ({ w: c.b.w, h: c.b.h })), { padding: opts.padding ?? 2, layout: opts.layout || 'pack' });
  const sheet = makeCanvas(packed.w, packed.h);
  const sc = sheet.getContext('2d');
  unique.forEach((c, i) => {
    c.pos = packed.rects[i];
    sc.putImageData(c.crop, c.pos.x, c.pos.y);
  });
  const frames = cells.map((c) => {
    const src = c.dup != null ? cells[c.dup] : c;
    return { name: `${name}${String(c.f - from).padStart(4, '0')}`, x: src.pos.x, y: src.pos.y, w: c.b.w, h: c.b.h, ox: c.b.x, oy: c.b.y, sw, sh, trimmed: !!opts.trim && (c.b.w !== sw || c.b.h !== sh) };
  });
  const json = atlasJSON(frames, { image: `${name}.png`, w: packed.w, h: packed.h, fps: doc.fps, name });
  return { canvas: sheet, json };
}
