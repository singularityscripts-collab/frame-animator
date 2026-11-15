// Operações vetoriais com Paper.js: booleanos, borracha, contorno do pincel e suavização de contornos.
// O Paper.js só é usado aqui, para geometria. Quem desenha continua sendo o renderer próprio (player).

import { subpaths, multiply, invert, translation, IDENTITY, isGradient } from '../player/render.js';
import { pathBounds, boundsIntersect, pointsBounds, simplify } from './geometry.js';
import { uid, clone } from './document.js';

export function getPaper() {
  const p = globalThis.paper;
  if (!p) throw new Error('Paper.js não foi carregado.');
  if (!p.project) p.setup(new p.Size(1, 1));
  return p;
}

/** Caminho do modelo (+ matriz) → item do Paper no espaço de destino. */
export function toPaper(path, matrix = IDENTITY, { openClosed = false } = {}) {
  const paper = getPaper();
  const items = [];
  for (const sp of subpaths(path)) {
    if (!sp.pts.length) continue;
    const pp = new paper.Path({ insert: false });
    for (const q of sp.pts) {
      pp.add(new paper.Segment(new paper.Point(q[0], q[1]), new paper.Point(q[2], q[3]), new paper.Point(q[4], q[5])));
    }
    if (sp.closed && openClosed) {
      // contorno fechado como linha aberta (para cortar traços): repete o primeiro ponto no fim
      const f = sp.pts[0];
      pp.add(new paper.Segment(new paper.Point(f[0], f[1]), new paper.Point(f[2], f[3]), new paper.Point(0, 0)));
      pp.firstSegment.handleIn = new paper.Point(0, 0);
    } else pp.closed = !!sp.closed;
    items.push(pp);
  }
  const item = items.length === 1 ? items[0] : new paper.CompoundPath({ children: items, insert: false });
  if (path.fillRule === 'evenodd') item.fillRule = 'evenodd';
  if (matrix !== IDENTITY) item.transform(new paper.Matrix(...matrix));
  return item;
}

/** Item do Paper → { path, cx, cy } com o caminho centralizado (ou null se ficou vazio). */
export function fromPaper(item, minArea = 0.01) {
  const children = item.className === 'CompoundPath' ? item.children : [item];
  const subs = [];
  for (const p of children) {
    if (p.segments.length < 2) continue;
    if (p.closed && Math.abs(p.area) < minArea) continue;
    subs.push({
      closed: p.closed,
      pts: p.segments.map((s) => [s.point.x, s.point.y, s.handleIn.x, s.handleIn.y, s.handleOut.x, s.handleOut.y]),
    });
  }
  if (!subs.length) return null;
  const path =
    subs.length === 1
      ? subs[0]
      : { closed: subs.every((s) => s.closed), fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero', subs };
  const b = pathBounds(path);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (const sp of subpaths(path)) for (const q of sp.pts) {
    q[0] -= cx;
    q[1] -= cy;
  }
  return { path, cx, cy };
}

/** O gradiente acompanha a forma quando ela muda de espaço local. */
function refitFill(fill, oldMatrix, newMatrix) {
  if (!isGradient(fill)) return fill;
  const inv = invert(newMatrix);
  if (!inv) return fill;
  return { ...clone(fill), matrix: multiply(inv, multiply(oldMatrix, fill.matrix || IDENTITY)) };
}

/** Nova forma a partir de um resultado do Paper (no espaço da timeline), herdando o estilo de `style`. */
function shapeFrom(res, style, id = uid('e')) {
  const matrix = translation(res.cx, res.cy);
  return {
    id,
    type: 'shape',
    matrix,
    path: res.path,
    fill: res.path.closed ? refitFill(style.fill, style.matrix, matrix) : null,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
  };
}

// ---------- Booleanos ----------
// els: formas fechadas, de baixo para cima, no espaço da timeline (cada uma com sua matriz).
// Devolve { replace: Map(id → forma nova | null), add: forma | null }

export function combine(kind, els) {
  const items = els.map((el) => toPaper(el.path, el.matrix));
  const top = els[els.length - 1];
  const opts = { insert: false };
  if (kind === 'union' || kind === 'intersect') {
    let acc = items[0];
    for (let i = 1; i < items.length; i++) acc = kind === 'union' ? acc.unite(items[i], opts) : acc.intersect(items[i], opts);
    const res = fromPaper(acc);
    const replace = new Map(els.map((el) => [el.id, null]));
    return { replace, add: res ? shapeFrom(res, top) : null };
  }
  // perfurar / recortar: a forma de cima corta as de baixo e some
  const cutter = items[items.length - 1];
  const replace = new Map([[top.id, null]]);
  els.slice(0, -1).forEach((el, i) => {
    const r = kind === 'punch' ? items[i].subtract(cutter, opts) : items[i].intersect(cutter, opts);
    const res = fromPaper(r);
    replace.set(el.id, res ? shapeFrom(res, el, el.id) : null);
  });
  return { replace, add: null };
}

// ---------- Borracha ----------
/**
 * Apaga a região `eraser` (item do Paper no espaço da timeline) de uma forma.
 * mode: 'normal' (preenchimento e linha), 'fills' (só preenchimento), 'lines' (só linha).
 * Devolve null se nada mudou, ou a lista de formas que substituem esta (0 a 2: preenchimento e linha).
 */
export function eraseShape(el, eraser, mode = 'normal') {
  const inv = invert(el.matrix);
  if (!inv) return null;
  const paper = getPaper();
  const local = eraser.clone({ insert: false });
  local.transform(new paper.Matrix(...inv));
  const lb = local.bounds;
  const pad = (el.strokeWidth || 0) / 2;
  const b = pathBounds(el.path);
  if (!boundsIntersect({ x: lb.x, y: lb.y, w: lb.width, h: lb.height }, { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad })) return null;

  const hasFill = !!el.fill && el.path.closed;
  const hasStroke = !!el.stroke && el.strokeWidth > 0;
  const opts = { insert: false };
  let changed = false;
  let fillPart = null, strokePart = null;

  if (hasFill) {
    if (mode === 'lines') fillPart = { ...el, stroke: null };
    else {
      const base = toPaper(el.path);
      const res = base.subtract(local, opts);
      if (Math.abs(Math.abs(res.area) - Math.abs(base.area)) > 0.01) {
        changed = true;
        const r = fromPaper(res);
        if (r) fillPart = { ...el, stroke: null, path: r.path, matrix: multiply(el.matrix, translation(r.cx, r.cy)), fill: refitFill(el.fill, el.matrix, multiply(el.matrix, translation(r.cx, r.cy))) };
      } else fillPart = { ...el, stroke: null };
    }
  }
  if (hasStroke) {
    const keepWhole = { ...el, id: hasFill ? uid('e') : el.id, fill: null };
    if (mode === 'fills') strokePart = keepWhole;
    else {
      const line = toPaper(el.path, IDENTITY, { openClosed: true });
      const res = joinTouching(line.subtract(local, { insert: false, trace: false }));
      if (Math.abs(res.length - line.length) > 0.01) {
        changed = true;
        const r = fromPaper(res);
        if (r) strokePart = { ...keepWhole, path: { ...r.path, closed: false }, matrix: multiply(el.matrix, translation(r.cx, r.cy)) };
      } else strokePart = keepWhole;
    }
  }
  if (!changed) return null;
  return [fillPart, strokePart].filter(Boolean);
}

/** Junta pedaços de linha cujas pontas se encostam (o contorno fechado foi aberto num ponto qualquer). */
function joinTouching(item) {
  if (item.className !== 'CompoundPath') return item;
  const paper = getPaper();
  const parts = item.children.map((c) => c.clone({ insert: false }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = 0; j < parts.length; j++) {
        if (i === j) continue;
        if (parts[i].lastSegment.point.getDistance(parts[j].firstSegment.point) < 0.01) {
          parts[i].join(parts[j], 0.01);
          parts.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return parts.length === 1 ? parts[0] : new paper.CompoundPath({ children: parts, insert: false });
}

// ---------- Pincel e borracha: contorno de um traço ----------
/**
 * Contorno fechado de um traço com largura variável. points: [{ x, y, w }].
 * Devolve um item do Paper (sem simplificar).
 */
export function strokeOutline(points, capSteps = 8) {
  const paper = getPaper();
  const pts = dedupe(points);
  if (pts.length === 1) {
    const p = pts[0];
    return new paper.Path.Circle({ center: [p.x, p.y], radius: Math.max(0.5, p.w / 2), insert: false });
  }
  const n = pts.length;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    let tx = c.x - a.x, ty = c.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const r = Math.max(0.25, pts[i].w / 2);
    left.push([pts[i].x - ty * r, pts[i].y + tx * r]);
    right.push([pts[i].x + ty * r, pts[i].y - tx * r]);
  }
  const cap = (p, from, rad) => {
    const out = [];
    for (let k = 1; k < capSteps; k++) {
      const a = from - (Math.PI * k) / capSteps; // gira passando pela frente do traço
      out.push([p.x + Math.cos(a) * rad, p.y + Math.sin(a) * rad]);
    }
    return out;
  };
  const e = pts[n - 1], s = pts[0];
  const endDir = Math.atan2(left[n - 1][1] - e.y, left[n - 1][0] - e.x);
  const startDir = Math.atan2(right[0][1] - s.y, right[0][0] - s.x);
  const poly = [
    ...left,
    ...cap(e, endDir, Math.max(0.25, e.w / 2)),
    ...right.reverse(),
    ...cap(s, startDir, Math.max(0.25, s.w / 2)),
  ];
  const path = new paper.Path({ segments: poly, closed: true, insert: false });
  return path;
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.3) out.push(p);
    else last.w = Math.max(last.w, p.w);
  }
  return out;
}

/** Limpa cruzamentos e simplifica um contorno (curvas suaves com poucos pontos). */
export function cleanOutline(item, tolerance = 1) {
  const paper = getPaper();
  let res = item;
  if (res.className === 'Path' && res.segments.length > 4) res.simplify(tolerance);
  res = res.resolveCrossings ? res.resolveCrossings() : res;
  if (res.reorient) res.reorient(true, true);
  // une com um vazio para normalizar o resultado como região
  const empty = new paper.Path({ insert: false });
  const u = res.unite(empty, { insert: false });
  return u.isEmpty() ? res : u;
}

/** Polígonos (contornos do balde) → caminho composto suave no espaço de destino. */
export function polygonsToShapePath(polys, tolerance = 1) {
  const paper = getPaper();
  // simplificação que mantém trechos retos (a curva do Paper exagera quando sobram só os cantos)
  const children = polys
    .filter((p) => p.length >= 3)
    .map((p) => {
      const pts = simplify([...p, p[0]], tolerance).slice(0, -1);
      return new paper.Path({ segments: pts.map((q) => [q.x, q.y]), closed: true, insert: false });
    })
    .filter((path) => path.segments.length >= 3);
  if (!children.length) return null;
  const item = children.length === 1 ? children[0] : new paper.CompoundPath({ children, insert: false });
  item.fillRule = 'nonzero';
  return fromPaper(item, 1);
}

export { pointsBounds };
