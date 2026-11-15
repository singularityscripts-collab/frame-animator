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

// ---------- traço de largura variável (ferramenta de largura) ----------
/** Largura relativa no ponto t (0 a 1) do traço. profile = [{ t, w }] (w multiplica a espessura). */
export function profileAt(profile, t) {
  const pts = [...profile].sort((a, b) => a.t - b.t);
  if (!pts.length) return 1;
  if (pts[0].t > 0) pts.unshift({ t: 0, w: 1 });
  if (pts[pts.length - 1].t < 1) pts.push({ t: 1, w: 1 });
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      const u = (t - a.t) / (b.t - a.t || 1);
      return a.w + (b.w - a.w) * u;
    }
  }
  return pts[pts.length - 1].w;
}

/** Contorno (polígonos) de um traço com largura variável, no espaço local da forma. */
export function variableStrokePolys(path, width, profile) {
  const subs = subpaths(path).map((sp) => measure(flattenSub(sp, [1, 0, 0, 1, 0, 0], 10)));
  const total = subs.reduce((n, m) => n + m.total, 0) || 1;
  const polys = [];
  let acc = 0;
  for (const m0 of subs) {
    if (m0.points.length < 2) continue;
    // reamostra (uma reta tem só 2 pontos, mas a largura muda no meio dela)
    const steps = Math.max(24, Math.min(400, Math.ceil(m0.total / 3)));
    const rs = [];
    for (let k = 0; k <= steps; k++) rs.push(pointAt(m0, (m0.total * k) / steps));
    const m = measure(rs.map((q) => ({ x: q.x, y: q.y })));
    const n = m.points.length;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = m.points[Math.max(0, i - 1)], c = m.points[Math.min(n - 1, i + 1)];
      let tx = c.x - a.x, ty = c.y - a.y;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      const r = (width * profileAt(profile, (acc + m.len[i]) / total)) / 2;
      const p = m.points[i];
      left.push({ x: p.x - ty * r, y: p.y + tx * r });
      right.push({ x: p.x + ty * r, y: p.y - tx * r });
    }
    const closed = Math.hypot(m.points[0].x - m.points[n - 1].x, m.points[0].y - m.points[n - 1].y) < 0.01;
    if (closed) {
      polys.push(left, right.reverse());
    } else polys.push([...left, ...right.reverse()]);
    acc += m.total;
  }
  return polys;
}

/** Posições (e ângulos) para repetir um desenho ao longo do caminho (pincel de padrão). */
export function patternPlacements(path, step) {
  const out = [];
  if (!(step > 0.5)) return out;
  for (const sp of subpaths(path)) {
    const m = measure(flattenSub(sp, [1, 0, 0, 1, 0, 0], 10));
    for (let s = step / 2; s < m.total; s += step) out.push(pointAt(m, s));
  }
  return out;
}

/** Limites aproximados (pelos pontos de controle) do que uma timeline mostra num quadro. */
export function quickBounds(doc, tl, frame, layerFrameFn, symbolFn, depth = 0) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (m, x, y, pad = 0) => {
    const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
    minX = Math.min(minX, px - pad);
    minY = Math.min(minY, py - pad);
    maxX = Math.max(maxX, px + pad);
    maxY = Math.max(maxY, py + pad);
  };
  for (const layer of tl.layers) {
    if (!layer.visible || layer.type === 'guide' || layer.type === 'folder' || layer.type === 'camera') continue;
    const lf = layerFrameFn(layer, frame, tl);
    if (!lf) continue;
    for (const { el } of lf.items) {
      const m = el.matrix;
      if (el.type === 'shape') {
        const pad = (el.strokeWidth || 0) * Math.max(1, ...(el.widthProfile || []).map((p) => p.w)) / 2 + (el.brush ? 40 : 0);
        for (const sp of subpaths(el.path)) {
          for (const q of sp.pts) {
            add(m, q[0], q[1], pad);
            add(m, q[0] + q[2], q[1] + q[3], pad);
            add(m, q[0] + q[4], q[1] + q[5], pad);
          }
        }
        for (const p of el.warp?.pins || []) add(m, p.x + p.dx, p.y + p.dy, 20);
      } else if (el.type === 'bitmap' || el.type === 'component') {
        add(m, 0, 0);
        add(m, el.w, 0);
        add(m, 0, el.h);
        add(m, el.w, el.h);
      } else if (el.type === 'text') {
        const w = el.width > 0 ? el.width : (String(el.text || '').length + 1) * (el.size || 24) * 0.7;
        const h = (String(el.text || '').split('\n').length + 1) * (el.size || 24) * 1.4;
        add(m, -4, -4);
        add(m, w + 4, h);
      } else if (el.type === 'instance' && depth < 16) {
        const sym = symbolFn(doc, el.symbolId);
        const b = sym && quickBounds(doc, sym, 0, layerFrameFn, symbolFn, depth + 1);
        if (b) {
          const pad = (el.filters || []).reduce((n, f) => n + (f.blur || 0) + (f.distance || 0), 0);
          add(m, b.x, b.y, pad);
          add(m, b.x + b.w, b.y, pad);
          add(m, b.x, b.y + b.h, pad);
          add(m, b.x + b.w, b.y + b.h, pad);
        }
      }
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}
