// Geometria do editor: criação de formas, limites (bounds) e suavização do lápis.

import { applyPoint, symbolById, layerFrame, instanceFrame } from '../player/render.js';
import { uid } from './document.js';

const K = 0.5522847498; // constante para aproximar elipse com Bézier

export function rectPath(w, h) {
  const x = w / 2, y = h / 2;
  return {
    closed: true,
    pts: [[-x, -y, 0, 0, 0, 0], [x, -y, 0, 0, 0, 0], [x, y, 0, 0, 0, 0], [-x, y, 0, 0, 0, 0]],
  };
}

export function ellipsePath(w, h) {
  const rx = w / 2, ry = h / 2, kx = rx * K, ky = ry * K;
  return {
    closed: true,
    pts: [
      [rx, 0, 0, -ky, 0, ky],
      [0, ry, kx, 0, -kx, 0],
      [-rx, 0, 0, ky, 0, -ky],
      [0, -ry, -kx, 0, kx, 0],
    ],
  };
}

/** Linha entre dois pontos do mundo; devolve { path, cx, cy } com o caminho centralizado. */
export function linePath(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return {
    path: { closed: false, pts: [[x1 - cx, y1 - cy, 0, 0, 0, 0], [x2 - cx, y2 - cy, 0, 0, 0, 0]] },
    cx,
    cy,
  };
}

/** Traço do lápis: simplifica os pontos e transforma em curvas suaves. */
export function freehandPath(points, tolerance) {
  let pts = simplify(points, tolerance);
  if (pts.length < 2) pts = [points[0], points[points.length - 1]];
  const b = pointsBounds(pts);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const local = pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  return { path: smoothOpen(local), cx, cy };
}

export function makeShape({ path, cx, cy, fill, stroke, strokeWidth }) {
  return {
    id: uid('e'),
    type: 'shape',
    matrix: [1, 0, 0, 1, cx, cy],
    path,
    fill: path.closed ? fill : null,
    stroke,
    strokeWidth,
  };
}

// ---------- Limites ----------

const boundsCache = new WeakMap();

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Limites do caminho em coordenadas locais (amostrando as curvas). */
export function pathBounds(path) {
  let b = boundsCache.get(path);
  if (b) return b;
  const pts = path.pts;
  const n = pts.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const p of pts) add(p[0], p[1]);
  const segs = path.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    if (!(a[4] || a[5] || c[2] || c[3])) continue;
    for (let s = 1; s < 12; s++) {
      const t = s / 12;
      add(bez(a[0], a[0] + a[4], c[0] + c[2], c[0], t), bez(a[1], a[1] + a[5], c[1] + c[3], c[1], t));
    }
  }
  if (!n) minX = minY = maxX = maxY = 0;
  b = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  boundsCache.set(path, b);
  return b;
}

/** Os 4 cantos do retângulo local, transformados para o mundo. */
export function localBoxCorners(m, b) {
  return [
    applyPoint(m, b.x, b.y),
    applyPoint(m, b.x + b.w, b.y),
    applyPoint(m, b.x + b.w, b.y + b.h),
    applyPoint(m, b.x, b.y + b.h),
  ];
}

export function pointsBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const EMPTY = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });

/** Limites do elemento no seu próprio espaço (forma: o caminho; instância: o conteúdo do símbolo). */
export function elementLocalBounds(el, doc, offset = 0, mcTime = 0, depth = 0) {
  if (el.type === 'shape') return pathBounds(el.path);
  const sym = doc && symbolById(doc, el.symbolId);
  if (!sym || depth > 20) return EMPTY;
  return timelineBounds(doc, sym, instanceFrame(sym, el, offset, mcTime, false), depth + 1) || EMPTY;
}

/** Limites de tudo que uma timeline mostra num quadro, ou null se estiver vazia. */
export function timelineBounds(doc, tl, frame, depth = 0) {
  const pts = [];
  for (const layer of tl.layers) {
    if (!layer.visible) continue;
    const lf = layerFrame(layer, frame);
    if (!lf) continue;
    for (const it of lf.items) {
      if (it.el.type === 'instance') {
        const sym = symbolById(doc, it.el.symbolId);
        if (!sym) continue;
        const b = timelineBounds(doc, sym, instanceFrame(sym, it.el, lf.offset, it.mcTime, false), depth + 1);
        if (b && depth < 20) pts.push(...localBoxCorners(it.el.matrix, b));
      } else {
        pts.push(...localBoxCorners(it.el.matrix, pathBounds(it.el.path)));
      }
    }
  }
  return pts.length ? pointsBounds(pts) : null;
}

/** Caixa alinhada aos eixos do elemento no espaço da timeline. */
export function elementWorldBounds(el, doc, offset = 0, mcTime = 0) {
  return pointsBounds(localBoxCorners(el.matrix, elementLocalBounds(el, doc, offset, mcTime)));
}

export function unionBounds(list) {
  const pts = [];
  for (const b of list) pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
  return pointsBounds(pts);
}

export function boundsIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

// ---------- Lápis: simplificação (Ramer–Douglas–Peucker) e suavização ----------

export function simplify(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const pa = points[a], pb = points[b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len2 = dx * dx + dy * dy;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      let d2;
      if (!len2) {
        d2 = (p.x - pa.x) ** 2 + (p.y - pa.y) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / len2));
        d2 = (p.x - pa.x - t * dx) ** 2 + (p.y - pa.y - t * dy) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Catmull-Rom → Bézier para um caminho aberto. */
export function smoothOpen(points) {
  const n = points.length;
  const pts = points.map((p) => [p.x, p.y, 0, 0, 0, 0]);
  if (n < 3) return { closed: false, pts };
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
    if (i > 0) {
      pts[i][2] = -tx;
      pts[i][3] = -ty;
    }
    if (i < n - 1) {
      pts[i][4] = tx;
      pts[i][5] = ty;
    }
  }
  return { closed: false, pts };
}
