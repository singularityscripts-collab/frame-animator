// Traço vetorial "de verdade" (como no Moho): uma linha central com pontos editáveis e uma
// largura em cada trecho (perfil de largura), em vez de uma forma preenchida com o contorno.
// Funções puras: recebem as amostras da caneta/mouse e devolvem caminho + perfil.

import { simplify, smoothOpen } from './geometry.js';
import { reduceProfile } from '../player/geom.js';

/** Curvas de pressão: expoente aplicado à pressão crua (0–1). Leve engrossa rápido; firme pede força. */
export const PRESSURE_CURVES = { soft: 0.5, normal: 0.75, firm: 1.45 };
export const PRESSURE_CURVE_LABELS = { soft: 'Leve', normal: 'Normal', firm: 'Firme' };
/** Largura mínima (fração do tamanho) com a pressão mais leve. */
export const MIN_PRESSURE_WIDTH = 0.08;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Pressão crua → fator da largura (MIN a 1), pela curva escolhida. */
export function pressureFactor(p, curve = 'normal') {
  const k = PRESSURE_CURVES[curve] ?? PRESSURE_CURVES.normal;
  return MIN_PRESSURE_WIDTH + (1 - MIN_PRESSURE_WIDTH) * Math.pow(clamp01(p), k);
}

/** Caminho da curva de pressão para a prévia (SVG w×h, eixo y para cima). */
export function pressureCurveSvgPath(curve, w = 60, h = 36) {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const p = i / 20;
    pts.push(`${(p * w).toFixed(1)},${(h - pressureFactor(p, curve) * h).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

/** Fidelidade (0–100) → tolerância da simplificação em pixels da tela. 100 = segue cada tremida. */
export const fidelityTolerance = (fidelity) => 0.2 + ((100 - Math.max(0, Math.min(100, fidelity ?? 70))) / 100) * 3.6;

/** Catmull-Rom → Bézier para um caminho fechado. */
export function smoothClosed(points) {
  const n = points.length;
  const pts = points.map((p) => [p.x, p.y, 0, 0, 0, 0]);
  if (n < 3) return { closed: true, pts };
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n], next = points[(i + 1) % n];
    const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
    pts[i][2] = -tx;
    pts[i][3] = -ty;
    pts[i][4] = tx;
    pts[i][5] = ty;
  }
  return { closed: true, pts };
}

/** Comprimentos acumulados da polilinha. */
function cumulative(pts) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return len;
}

/** Valor de w das amostras na distância s (interpolação linear pelo comprimento). */
function widthAtLength(pts, len, s) {
  let i = 1;
  while (i < len.length - 1 && len[i] < s) i++;
  const a = pts[i - 1], b = pts[i] || a;
  const seg = len[i] - len[i - 1];
  const u = seg > 0 ? clamp01((s - len[i - 1]) / seg) : 0;
  return a.w + (b.w - a.w) * u;
}

/** Afinar: 0 na ponta até 1 depois de `len` unidades (curva suave, a ponta fica fina mas visível). */
const taperCurve = (u) => Math.max(0.04, Math.sin((clamp01(u) * Math.PI) / 2));

/**
 * Larguras ao vivo (prévia enquanto desenha): fator por amostra com o afinar do começo já aplicado.
 * samples: [{x, y, w}] (w = fator 0–1 ou null = ainda sem pressão).
 */
export function liveWidths(samples, taperStart = 0) {
  let s = 0, known = null;
  const firstKnown = samples.find((q) => q.w != null)?.w ?? 1;
  return samples.map((q, i) => {
    if (i) s += Math.hypot(q.x - samples[i - 1].x, q.y - samples[i - 1].y);
    known = q.w ?? known ?? firstKnown;
    return known * (taperStart > 0 ? taperCurve(s / taperStart) : 1);
  });
}

/** Larguras finais (fator) por amostra, com as duas pontas afinadas: para o pincel de forma preenchida. */
export function finalWidths(samples, taperStart = 0, taperEnd = 0) {
  const live = liveWidths(samples, 0);
  const len = cumulative(samples);
  const L = len[len.length - 1] || 0;
  const tS = Math.min(taperStart, L * 0.45), tE = Math.min(taperEnd, L * 0.45);
  return live.map((w, i) => w * (tS > 0 ? taperCurve(len[i] / tS) : 1) * (tE > 0 ? taperCurve((L - len[i]) / tE) : 1));
}

/**
 * Amostras da caneta → traço editável.
 * samples: [{x, y, w}] no espaço da tela da timeline; w = fator de pressão (0–1) ou null.
 * opts:
 * - mode: 'smooth' (curvas suaves) | 'ink' (segmentos retos, segue o traço);
 * - tolerance: simplificação, em unidades do desenho;
 * - taperStart / taperEnd: comprimento do afinar das pontas, em unidades do desenho;
 * - closeDist: terminar a essa distância do começo fecha o caminho (0 = nunca fecha).
 * Retorna { path, cx, cy, profile (ou null se a largura é constante), closed } ou null.
 */
export function strokeFromSamples(samples, { mode = 'smooth', tolerance = 1, taperStart = 0, taperEnd = 0, closeDist = 0 } = {}) {
  // pressão desconhecida no começo (toque inicial da caneta): usa a primeira que chegou
  const firstKnown = samples.find((q) => q.w != null)?.w ?? 1;
  let last = firstKnown;
  let pts = [];
  for (const q of samples) {
    last = q.w ?? last;
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) < 1e-6) {
      prev.w = Math.max(prev.w, last);
      continue;
    }
    pts.push({ x: q.x, y: q.y, w: last });
  }
  if (pts.length < 2) return null;
  let len = cumulative(pts);
  const total = len[len.length - 1];
  if (!(total > 0)) return null;

  // fechar: terminou perto do começo, num traço bem maior que essa distância
  const first = pts[0], end = pts[pts.length - 1];
  const closed = closeDist > 0 && pts.length > 6 && Math.hypot(first.x - end.x, first.y - end.y) <= closeDist && total > closeDist * 6;
  if (closed) {
    // tira o finalzinho que encosta no começo (o fechamento liga os dois)
    while (pts.length > 4 && Math.hypot(pts[pts.length - 1].x - first.x, pts[pts.length - 1].y - first.y) < closeDist * 0.5) pts.pop();
    len = cumulative(pts);
  }
  const L = len[len.length - 1];

  // ---- perfil de largura: amostragem densa pelo comprimento, suavizada, com as pontas afinadas
  const N = 64;
  const ts = new Set();
  for (let i = 0; i <= N; i++) ts.add(i / N);
  const tS = closed ? 0 : Math.min(taperStart, L * 0.45) / L;
  const tE = closed ? 0 : Math.min(taperEnd, L * 0.45) / L;
  for (let k = 1; k <= 8; k++) {
    if (tS) ts.add((tS * k) / 8);
    if (tE) ts.add(1 - (tE * k) / 8);
  }
  const grid = [...ts].sort((a, b) => a - b);
  const raw = grid.map((t) => widthAtLength(pts, len, t * L));
  // suaviza o ruído da pressão (média de 5 vizinhos pelo índice)
  const smooth = raw.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      s += raw[j];
      n++;
    }
    return s / n;
  });
  const profile = grid.map((t, i) => {
    let w = smooth[i];
    if (tS && t < tS) w *= taperCurve(t / tS);
    if (tE && t > 1 - tE) w *= taperCurve((1 - t) / tE);
    return { t, w };
  });
  const reduced = reduceProfile(profile, 0.02);
  const constant = reduced.every((p) => Math.abs(p.w - 1) < 0.03);

  // ---- caminho
  const center = pts.map((q) => ({ x: q.x, y: q.y }));
  let simple = simplify(closed ? [...center, center[0]] : center, mode === 'ink' ? Math.min(tolerance, 0.5) : tolerance);
  if (closed) simple = simple.slice(0, -1);
  if (simple.length < 2) simple = [center[0], center[center.length - 1]];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of simple) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const local = simple.map((q) => ({ x: q.x - cx, y: q.y - cy }));
  let path;
  if (mode === 'ink') path = { closed, pts: local.map((q) => [q.x, q.y, 0, 0, 0, 0]) };
  else path = closed ? (local.length >= 3 ? smoothClosed(local) : { closed: true, pts: local.map((q) => [q.x, q.y, 0, 0, 0, 0]) }) : smoothOpen(local);
  return { path, cx, cy, profile: constant ? null : reduced, closed };
}
