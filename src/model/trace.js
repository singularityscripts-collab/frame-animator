// Vetorizar bitmap: reduz as cores (k-means), acha o contorno de cada cor e vira formas suaves.
// Tudo puro (ImageData-like: { width, height, data }), para rodar no editor e nos testes.

import { traceContours, polygonArea } from './raster.js';
import { simplify } from './geometry.js';

/** k-means em RGB. Devolve { centers: [[r,g,b]], labels: Int16Array } (-1 = transparente). */
export function quantize(img, k = 8, iterations = 8) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const labels = new Int16Array(n).fill(-1);
  const opaque = [];
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] >= 128) opaque.push(i);
  if (!opaque.length) return { centers: [], labels };
  // amostra (para imagens grandes) e sementes espalhadas (o mais longe dos já escolhidos)
  const step = Math.max(1, Math.floor(opaque.length / 20000));
  const sample = [];
  for (let j = 0; j < opaque.length; j += step) {
    const i = opaque[j] * 4;
    sample.push([data[i], data[i + 1], data[i + 2]]);
  }
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers = [sample[0].slice()];
  const best = sample.map((p) => d2(p, centers[0]));
  while (centers.length < Math.min(k, sample.length)) {
    let bi = 0;
    for (let j = 1; j < sample.length; j++) if (best[j] > best[bi]) bi = j;
    if (best[bi] === 0) break; // menos cores que k
    centers.push(sample[bi].slice());
    for (let j = 0; j < sample.length; j++) best[j] = Math.min(best[j], d2(sample[j], centers[centers.length - 1]));
  }
  const nearest = (p) => {
    let bi = 0, bd = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const d = d2(p, centers[c]);
      if (d < bd) {
        bd = d;
        bi = c;
      }
    }
    return bi;
  };
  for (let it = 0; it < iterations; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const p of sample) {
      const c = nearest(p);
      acc[c][0] += p[0];
      acc[c][1] += p[1];
      acc[c][2] += p[2];
      acc[c][3]++;
    }
    let moved = false;
    acc.forEach((a, c) => {
      if (!a[3]) return;
      const nc = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      if (d2(nc, centers[c]) > 0.25) moved = true;
      centers[c] = nc;
    });
    if (!moved) break;
  }
  for (const i of opaque) labels[i] = nearest([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  return { centers: centers.map((c) => c.map((v) => Math.round(v))), labels };
}

/** Polígono fechado → pontos do editor, com alças suaves onde o canto não é agudo. */
export function smoothPolygon(poly, smoothing = 0.5, cornerDeg = 60) {
  const n = poly.length;
  const out = [];
  const lim = Math.cos(((180 - cornerDeg) * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const q = [p.x, p.y, 0, 0, 0, 0];
    if (smoothing > 0) {
      const v1x = p.x - a.x, v1y = p.y - a.y, v2x = b.x - p.x, v2y = b.y - p.y;
      const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
      if (cos > lim) {
        const tx = b.x - a.x, ty = b.y - a.y;
        const tl = Math.hypot(tx, ty) || 1;
        const k = smoothing / 3;
        q[2] = (-tx / tl) * l1 * k;
        q[3] = (-ty / tl) * l1 * k;
        q[4] = (tx / tl) * l2 * k;
        q[5] = (ty / tl) * l2 * k;
      }
    }
    out.push(q);
  }
  return out;
}

/**
 * Vetoriza. opts: { colors (1–64), minArea (px²), tolerance (px), smoothing (0–1) }.
 * Devolve [{ color: '#rrggbb', subs: [{ closed: true, pts }], area }] em pixels da imagem,
 * da maior para a menor (as menores ficam por cima).
 */
export function traceImage(img, opts = {}) {
  const { colors = 8, minArea = 8, tolerance = 1, smoothing = 0.6 } = opts;
  const { width: w, height: h } = img;
  const { centers, labels } = quantize(img, Math.max(1, Math.min(64, colors)));
  const out = [];
  const region = new Uint8Array(w * h);
  centers.forEach((c, ci) => {
    let any = false;
    for (let i = 0; i < labels.length; i++) {
      region[i] = labels[i] === ci ? 1 : 0;
      any ||= region[i] === 1;
    }
    if (!any) return;
    const polys = traceContours(region, w, h);
    const subs = [];
    let area = 0;
    for (const poly of polys) {
      const A = polygonArea(poly);
      if (Math.abs(A) < minArea) continue;
      const pts = simplify([...poly, poly[0]], tolerance).slice(0, -1);
      if (pts.length < 3) continue;
      area += A;
      subs.push({ closed: true, pts: smoothPolygon(pts, smoothing) });
    }
    if (!subs.length) return;
    out.push({ color: `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`, subs, area: Math.abs(area) });
  });
  return out.sort((a, b) => b.area - a.area);
}
