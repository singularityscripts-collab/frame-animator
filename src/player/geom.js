// Geometria do player (sem Paper.js): achatar caminhos em polilinhas, medir, achar pontos
// e o morph do shape tween.

import { subpaths } from './render.js';

const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function bez(p0, p1, p2, p3, s) {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}

/** Subcaminho → lista de pontos (no espaço de `matrix`). Fechado repete o primeiro no fim. */
export function flattenSub(sp, matrix, steps = 12) {
  const pts = sp.pts;
  const n = pts.length;
  const out = [];
  if (!n) return out;
  const segs = sp.closed ? n : n - 1;
  out.push(apply(matrix, pts[0][0], pts[0][1]));
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (a[4] || a[5] || b[2] || b[3]) {
      for (let k = 1; k <= steps; k++) {
        const s = k / steps;
        out.push(
          apply(
            matrix,
            bez(a[0], a[0] + a[4], b[0] + b[2], b[0], s),
            bez(a[1], a[1] + a[5], b[1] + b[3], b[1], s),
          ),
        );
      }
    } else out.push(apply(matrix, b[0], b[1]));
  }
  return out;
}

/** Polilinha com comprimentos acumulados. */
export function measure(points) {
  const len = [0];
  for (let i = 1; i < points.length; i++) len.push(len[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return { points, len, total: len[len.length - 1] || 0 };
}

/** Ponto e ângulo da tangente a uma distância s do início. */
export function pointAt(m, s) {
  const { points, len, total } = m;
  if (points.length === 1 || total === 0) return { x: points[0].x, y: points[0].y, angle: 0 };
  s = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < len.length - 1 && len[i] < s) i++;
  const a = points[i - 1], b = points[i];
  const seg = len[i] - len[i - 1] || 1;
  const u = (s - len[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Distância (ao longo da polilinha) do ponto mais perto de (x, y). */
export function nearestS(m, x, y) {
  const { points, len } = m;
  let best = Infinity, bestS = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    const px = a.x + dx * u, py = a.y + dy * u;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) {
      best = d;
      bestS = len[i - 1] + u * Math.sqrt(l2);
    }
  }
  return bestS;
}

/** Caminho do guia de movimento: o primeiro subcaminho do primeiro elemento forma da camada guia. */
export function guideFromElements(elements) {
  const el = elements.find((e) => e.type === 'shape');
  if (!el) return null;
  const sp = subpaths(el.path)[0];
  if (!sp || sp.pts.length < 2) return null;
  const m = measure(flattenSub(sp, el.matrix, 16));
  return m.total > 0 ? m : null;
}

// ---------- shape tween (morph) ----------

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return a / 2;
}

/** n pontos igualmente espaçados num trecho [s0, s1] da polilinha (fechada se cíclica). */
function sampleRange(m, s0, s1, n, closed) {
  const out = [];
  const total = m.total;
  let span = s1 - s0;
  if (closed && span <= 0) span += total;
  for (let k = 0; k < n; k++) {
    let s = s0 + (span * k) / n;
    if (closed) s = ((s % total) + total) % total;
    const p = pointAt(m, s);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

const morphCache = new WeakMap();

/**
 * Prepara a correspondência de pontos entre duas formas (A no keyframe de início, B no de destino).
 * hints: [{ a: {x,y}, b: {x,y} }] no espaço da timeline (dicas de forma).
 * Devolve [{ A: pontos, B: pontos, closed }] por subcaminho.
 */
export function prepareMorph(a, b, hints = []) {
  const key = JSON.stringify(hints);
  let byB = morphCache.get(a);
  const cached = byB?.get(b);
  if (cached && cached.key === key) return cached.pairs;
  const subsA = subpaths(a.path), subsB = subpaths(b.path);
  const pairs = [];
  const count = Math.min(subsA.length, subsB.length);
  for (let i = 0; i < count; i++) {
    const closed = subsA[i].closed && subsB[i].closed;
    let pa = flattenSub(subsA[i], a.matrix, 12);
    let pb = flattenSub(subsB[i], b.matrix, 12);
    if (pa.length < 2 || pb.length < 2) continue;
    if (closed && Math.sign(signedArea(pa)) !== Math.sign(signedArea(pb))) pb = pb.reverse();
    const ma = measure(pa), mb = measure(pb);
    const n = Math.max(24, Math.min(360, Math.round(Math.max(ma.total, mb.total) / 3)));
    let A, B;
    const useHints = i === 0 && closed && hints.length >= 1;
    if (useHints) {
      const r = hintedSamples(ma, mb, hints, n);
      if (r) ({ A, B } = r);
    }
    if (!A) {
      A = closed ? sampleRange(ma, 0, ma.total, n, true) : sampleRange(ma, 0, ma.total, n - 1, false).concat([pa[pa.length - 1]]);
      B = closed ? sampleRange(mb, 0, mb.total, n, true) : sampleRange(mb, 0, mb.total, n - 1, false).concat([pb[pb.length - 1]]);
      if (closed) B = bestRotation(A, B);
    }
    pairs.push({ A, B, closed });
  }
  if (!byB) morphCache.set(a, (byB = new WeakMap()));
  byB.set(b, { key, pairs });
  return pairs;
}

/** Gira o início de B para casar melhor com A (menor distância total). */
function bestRotation(A, B) {
  const n = A.length;
  let best = Infinity, bestK = 0;
  const step = n > 120 ? 2 : 1;
  for (let k = 0; k < n; k += step) {
    let d = 0;
    for (let i = 0; i < n; i += 2) {
      const p = A[i], q = B[(i + k) % n];
      d += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d >= best) break;
    }
    if (d < best) {
      best = d;
      bestK = k;
    }
  }
  return B.map((_, i) => B[(i + bestK) % n]);
}

/** Com dicas de forma: cada trecho entre dicas de A corresponde ao trecho entre as mesmas dicas de B. */
function hintedSamples(ma, mb, hints, n) {
  const hs = hints.map((h) => ({ sa: nearestS(ma, h.a.x, h.a.y), sb: nearestS(mb, h.b.x, h.b.y) })).sort((x, y) => x.sa - y.sa);
  // as dicas de B precisam seguir a mesma ordem (cíclica) das de A
  const rel = hs.map((h) => (((h.sb - hs[0].sb) % mb.total) + mb.total) % mb.total);
  for (let i = 1; i < rel.length; i++) if (rel[i] < rel[i - 1]) return null;
  const A = [], B = [];
  const k = hs.length;
  for (let i = 0; i < k; i++) {
    const a0 = hs[i].sa, a1 = i + 1 < k ? hs[i + 1].sa : hs[0].sa + ma.total;
    const b0 = hs[i].sb, b1 = i + 1 < k ? hs[i + 1].sb : hs[0].sb;
    const cnt = Math.max(2, Math.round((n * (a1 - a0)) / ma.total));
    A.push(...sampleRange(ma, a0, a1 > ma.total ? a1 - ma.total : a1, cnt, true));
    B.push(...sampleRange(mb, b0, b1, cnt, true));
  }
  return { A, B };
}

/** Caminho intermediário (no espaço da timeline) entre A e B em t. */
export function morphPath(pairs, t) {
  const subs = pairs.map(({ A, B, closed }) => ({
    closed,
    pts: A.map((p, i) => [p.x + (B[i].x - p.x) * t, p.y + (B[i].y - p.y) * t, 0, 0, 0, 0]),
  }));
  if (!subs.length) return null;
  return subs.length === 1 ? subs[0] : { closed: subs.every((s) => s.closed), fillRule: 'nonzero', subs };
}
