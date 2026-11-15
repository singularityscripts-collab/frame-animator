// Motor de renderização compartilhado.
// Usado pelo editor (palco), pela janela de teste e pelo export.
// Não depende de nada do editor: só recebe o documento (JSON) e um contexto Canvas 2D.

import { colorToCT, tweenElements } from './tween.js';

// ---------- Matrizes 2D no formato do canvas: [a, b, c, d, e, f] ----------

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** m * n (aplica n primeiro, depois m). */
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyPoint(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translation = (x, y) => [1, 0, 0, 1, x, y];
export const scaling = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export function rotation(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

// ---------- Caminhos ----------
// path = { closed: boolean, pts: [[x, y, inX, inY, outX, outY], ...] }
// in/out são as alças Bézier relativas ao ponto (0,0 = canto reto).

const path2dCache = new WeakMap();

export function getPath2D(path) {
  let p = path2dCache.get(path);
  if (!p) {
    p = buildPath2D(path);
    path2dCache.set(path, p);
  }
  return p;
}

export function buildPath2D(path) {
  const p = new Path2D();
  const pts = path.pts;
  const n = pts.length;
  if (!n) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  const segs = path.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a[4] || a[5] || b[2] || b[3]) {
      p.bezierCurveTo(a[0] + a[4], a[1] + a[5], b[0] + b[2], b[1] + b[3], b[0], b[1]);
    } else {
      p.lineTo(b[0], b[1]);
    }
  }
  if (path.closed) p.closePath();
  return p;
}

// ---------- Documento ----------

export function symbolById(doc, id) {
  const items = doc.library?.items;
  if (!items) return null;
  for (const s of items) if (s.id === id) return s;
  return null;
}

// ---------- Linha do tempo ----------
// Uma "timeline" é qualquer objeto com layers: a cena ou um símbolo.

export function spanIndexAt(layer, frame) {
  const fr = layer.frames;
  for (let i = 0; i < fr.length; i++) {
    if (frame >= fr[i].start && frame < fr[i].start + fr[i].duration) return i;
  }
  return -1;
}

/** Trecho (keyframe + quadros que o seguram) que cobre o quadro, ou null. */
export function getSpanAt(layer, frame) {
  const i = spanIndexAt(layer, frame);
  return i < 0 ? null : layer.frames[i];
}

export function layerLength(layer) {
  const last = layer.frames[layer.frames.length - 1];
  return last ? last.start + last.duration : 0;
}

export function timelineLength(tl) {
  let n = 1;
  for (const l of tl.layers) n = Math.max(n, layerLength(l));
  return n;
}
export const sceneLength = timelineLength;

/** O tween deste trecho tem para onde ir? (keyframe seguinte logo depois) */
export function tweenTarget(layer, index) {
  const s = layer.frames[index];
  return s?.tween ? layer.frames[index + 1] || null : null;
}

/**
 * O que a camada mostra num quadro, já com o tween calculado.
 * { span, index, offset, tweened, items: [{ el, index, mcTime }] } ou null.
 */
export function layerFrame(layer, frame) {
  const si = spanIndexAt(layer, frame);
  if (si < 0) return null;
  const span = layer.frames[si];
  const offset = frame - span.start;
  let elements = span.elements;
  let tweened = false;
  const next = tweenTarget(layer, si);
  if (next && offset > 0) {
    elements = tweenElements(span, next, offset);
    tweened = true;
  }
  return {
    span,
    index: si,
    offset,
    tweened,
    items: elements.map((el, i) => ({ el, index: i, mcTime: el.type === 'instance' ? frame - runStart(layer, si, i, el) : 0 })),
  };
}

/** Desde que quadro o mesmo movie clip segue aparecendo nesta posição (para ele continuar tocando). */
function runStart(layer, si, i, el) {
  let start = layer.frames[si].start;
  for (let k = si - 1; k >= 0; k--) {
    const prev = layer.frames[k].elements[i];
    if (!prev || prev.type !== 'instance' || prev.symbolId !== el.symbolId) break;
    start = layer.frames[k].start;
  }
  return start;
}

/** Quadro interno que uma instância mostra. */
export function instanceFrame(sym, el, offset, mcTime, playMC) {
  const len = timelineLength(sym);
  if (el.behavior === 'movieclip') return playMC ? mcTime % len : 0;
  const first = Math.max(0, Math.min(len - 1, el.firstFrame || 0));
  if (el.loop === 'single') return first;
  if (el.loop === 'once') return Math.min(first + offset, len - 1);
  return (first + offset) % len;
}

// ---------- Desenho ----------

const MAX_DEPTH = 24;
const scratch = [];

function scratchCanvas(depth, w, h) {
  let c = scratch[depth];
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    scratch[depth] = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/** Desenha algo aplicando uma transformação de cor (brilho, tom, alfa, avançado). */
function drawWithColor(ctx, ct, depth, draw) {
  if (!ct) return draw(ctx);
  const rgbIdentity = ct.rm === 1 && ct.gm === 1 && ct.bm === 1 && !ct.ro && !ct.go && !ct.bo && !ct.ao;
  if (rgbIdentity) {
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, ct.am));
    draw(ctx);
    ctx.restore();
    return;
  }
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const sc = scratchCanvas(depth, w, h);
  const s = sc.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.globalAlpha = 1;
  s.clearRect(0, 0, w, h);
  s.setTransform(ctx.getTransform());
  draw(s);
  s.setTransform(1, 0, 0, 1, 0, 0);
  let alpha = Math.max(0, Math.min(1, ct.am));
  const p = 1 - ct.rm;
  const tintLike = ct.rm === ct.gm && ct.gm === ct.bm && p > 0 && !ct.ao;
  if (tintLike) {
    // cor final = cor * (1-p) + C * p  →  pintar C por cima com opacidade p
    const c = [ct.ro / p, ct.go / p, ct.bo / p].map((v) => Math.max(0, Math.min(255, Math.round(v))));
    s.globalCompositeOperation = 'source-atop';
    s.globalAlpha = p;
    s.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    s.fillRect(0, 0, w, h);
  } else {
    const img = s.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      d[i] = d[i] * ct.rm + ct.ro;
      d[i + 1] = d[i + 1] * ct.gm + ct.go;
      d[i + 2] = d[i + 2] * ct.bm + ct.bo;
      d[i + 3] = d[i + 3] * ct.am + ct.ao;
    }
    s.putImageData(img, 0, 0);
    alpha = 1;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  ctx.drawImage(sc, 0, 0);
  ctx.restore();
}

/**
 * Desenha um elemento (forma ou instância de símbolo).
 * env.outline: cor para desenhar só o contorno; env.outlinePx: espessura do contorno em pixels.
 * env.offset / env.mcTime: tempo para escolher o quadro de instâncias.
 * env.playMC: movie clips tocam (teste/export) ou ficam no 1º quadro (editor).
 */
export function drawElement(ctx, doc, el, env = {}) {
  const depth = env.depth || 0;
  if (el.type === 'shape') {
    const p = getPath2D(el.path);
    if (env.outline) {
      const tp = new Path2D();
      tp.addPath(p, ctx.getTransform().multiply(new DOMMatrix(el.matrix)));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = env.outline;
      ctx.lineWidth = env.outlinePx || 1;
      ctx.lineJoin = 'round';
      ctx.stroke(tp);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.transform(...el.matrix);
    if (el.fill && el.path.closed) {
      ctx.fillStyle = el.fill;
      ctx.fill(p);
    }
    if (el.stroke && el.strokeWidth > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(p);
    }
    ctx.restore();
    return;
  }
  if (el.type === 'instance') {
    const sym = symbolById(doc, el.symbolId);
    if (!sym || depth >= MAX_DEPTH) return;
    const f = instanceFrame(sym, el, env.offset || 0, env.mcTime || 0, env.playMC);
    ctx.save();
    ctx.transform(...el.matrix);
    const inner = {
      outline: env.outline,
      outlinePx: env.outlinePx,
      playMC: env.playMC,
      depth: depth + 1,
      includeHidden: false,
    };
    const draw = (c) => renderTimeline(c, doc, sym, f, inner);
    if (env.outline) draw(ctx);
    else drawWithColor(ctx, colorToCT(el.color), depth, draw);
    ctx.restore();
  }
}

/**
 * Desenha todas as camadas de uma timeline num quadro. Camadas de cima ficam por cima.
 * opts.layerFilter(layer) → boolean
 * opts.includeHidden: desenha também camadas ocultas
 * opts.honorOutline: respeita o modo contorno de cada camada (editor)
 * opts.outline: força contorno numa cor (onion skin em modo contorno)
 * opts.outlinePx: espessura do contorno em pixels
 * opts.skipId: não desenha o elemento com esse id (edição no lugar)
 * opts.playMC: movie clips tocam
 */
export function renderTimeline(ctx, doc, tl, frame, opts = {}) {
  for (let i = tl.layers.length - 1; i >= 0; i--) {
    const layer = tl.layers[i];
    if (!layer.visible && !opts.includeHidden) continue;
    if (opts.layerFilter && !opts.layerFilter(layer)) continue;
    const lf = layerFrame(layer, frame);
    if (!lf) continue;
    const outline = opts.outline || (opts.honorOutline && layer.outline ? layer.color : null);
    for (const it of lf.items) {
      if (opts.skipId && it.el.id === opts.skipId) continue;
      drawElement(ctx, doc, it.el, {
        outline,
        outlinePx: opts.outlinePx,
        offset: lf.offset,
        mcTime: it.mcTime,
        playMC: opts.playMC,
        depth: opts.depth || 0,
      });
    }
  }
}

/** Desenha um quadro de uma cena inteira (fundo + conteúdo) num canvas do tamanho pedido. Base do export. */
export function renderDocumentFrame(ctx, doc, sceneIndex, frame, { width, height, transparent = false } = {}) {
  const w = width ?? doc.width, h = height ?? doc.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(w / doc.width, 0, 0, h / doc.height, 0, 0);
  if (!transparent) {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  renderTimeline(ctx, doc, doc.scenes[sceneIndex], frame, { playMC: true });
}
