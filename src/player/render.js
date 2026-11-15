// Motor de renderização compartilhado.
// Usado pelo editor (palco), pela janela de teste e, no futuro, pelo export HTML5.
// Não depende de nada do editor: só recebe o documento (JSON) e um contexto Canvas 2D.

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

// ---------- Linha do tempo ----------

/** Trecho (keyframe + quadros que o seguram) que cobre o quadro, ou null. */
export function getSpanAt(layer, frame) {
  for (const s of layer.frames) {
    if (frame >= s.start && frame < s.start + s.duration) return s;
  }
  return null;
}

export function layerLength(layer) {
  const last = layer.frames[layer.frames.length - 1];
  return last ? last.start + last.duration : 0;
}

export function sceneLength(scene) {
  let n = 1;
  for (const l of scene.layers) n = Math.max(n, layerLength(l));
  return n;
}

// ---------- Desenho ----------

/**
 * Desenha um elemento no contexto (que já deve estar com a transformação de vista aplicada).
 * opts.outline: cor para desenhar só o contorno (modo contorno / onion skin).
 * opts.hairline: espessura do contorno em unidades do mundo.
 */
export function drawElement(ctx, el, opts = {}) {
  if (el.type !== 'shape') return;
  const p = getPath2D(el.path);
  if (opts.outline) {
    const tp = new Path2D();
    tp.addPath(p, new DOMMatrix(el.matrix));
    ctx.save();
    ctx.strokeStyle = opts.outline;
    ctx.lineWidth = opts.hairline || 1;
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
}

/**
 * Desenha todas as camadas de uma cena num quadro. Camadas de cima ficam por cima.
 * opts.layerFilter(layer) → boolean
 * opts.includeHidden: desenha também camadas ocultas
 * opts.honorOutline: respeita o modo contorno de cada camada (editor)
 * opts.outline: força contorno numa cor (onion skin em modo contorno)
 * opts.hairline: espessura do contorno
 */
export function renderScene(ctx, scene, frame, opts = {}) {
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const layer = scene.layers[i];
    if (!layer.visible && !opts.includeHidden) continue;
    if (opts.layerFilter && !opts.layerFilter(layer)) continue;
    const span = getSpanAt(layer, frame);
    if (!span) continue;
    const outline = opts.outline || (opts.honorOutline && layer.outline ? layer.color : null);
    for (const el of span.elements) drawElement(ctx, el, { outline, hairline: opts.hairline });
  }
}
