// Interpolação do tween clássico e efeitos de cor.
// Faz parte do player: o editor, a janela de teste e o export usam o mesmo cálculo.

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

import { applyEase, easeT, curveY } from './ease.js';
import { pointAt, nearestS, prepareMorph, morphPath, profileAt } from './geom.js';

export { easeT, applyEase };

// ---------- matriz ----------
export function decompose(m) {
  const [a, b, c, d, e, f] = m;
  return { x: e, y: f, sx: Math.hypot(a, b), sy: Math.hypot(c, d), ky: Math.atan2(b, a), kx: Math.atan2(-c, d) };
}

export function compose(p) {
  return [p.sx * Math.cos(p.ky), p.sx * Math.sin(p.ky), -p.sy * Math.sin(p.kx), p.sy * Math.cos(p.kx), p.x, p.y];
}

const shortest = (d) => ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/** Quanto girar de a até b, respeitando a opção de rotação do tween. */
export function rotationDelta(a, b, rotate = 'auto', turns = 0) {
  let d = shortest(b - a);
  if (rotate === 'none') return 0;
  if (rotate === 'cw') {
    if (d < 0) d += TAU;
    d += TAU * turns;
  } else if (rotate === 'ccw') {
    if (d > 0) d -= TAU;
    d -= TAU * turns;
  }
  return d;
}

export function lerpMatrix(m0, m1, t, tween = {}) {
  const p = decompose(m0), q = decompose(m1);
  const dky = rotationDelta(p.ky, q.ky, tween.rotate, tween.rotations || 0);
  const extra = dky - (tween.rotate === 'none' ? 0 : shortest(q.ky - p.ky));
  const dkx = (tween.rotate === 'none' ? 0 : shortest(q.kx - p.kx)) + extra;
  return compose({
    x: lerp(p.x, q.x, t),
    y: lerp(p.y, q.y, t),
    sx: lerp(p.sx, q.sx, t),
    sy: lerp(p.sy, q.sy, t),
    ky: p.ky + dky * t,
    kx: p.kx + dkx * t,
  });
}

// ---------- cores ----------
export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** [r, g, b, a] com a de 0 a 255 (aceita #rgb, #rrggbb e #rrggbbaa). */
export function hexToRgba(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [...hexToRgb(h), Number.isFinite(a) ? a : 255];
}

export function rgbaToHex(rgba) {
  const a = clamp(Math.round(rgba[3] ?? 255), 0, 255);
  return rgbToHex(rgba.slice(0, 3)) + (a < 255 ? a.toString(16).padStart(2, '0') : '');
}

export function lerpHex(a, b, t) {
  if (!a || !b || a === b) return t < 0.5 ? a : b;
  const x = hexToRgba(a), y = hexToRgba(b);
  return rgbaToHex(x.map((v, i) => lerp(v, y[i], t)));
}

const isGrad = (f) => !!f && typeof f === 'object';

/** Interpola preenchimentos: cor com cor, ou gradientes do mesmo tipo e mesmo número de paradas. */
export function lerpFill(a, b, t) {
  if (!isGrad(a) && !isGrad(b)) return lerpHex(a, b, t);
  if (!isGrad(a) || !isGrad(b) || a.type !== b.type || a.stops.length !== b.stops.length) return t < 0.5 ? a : b;
  const ma = a.matrix || [1, 0, 0, 1, 0, 0], mb = b.matrix || [1, 0, 0, 1, 0, 0];
  return {
    type: a.type,
    focal: lerp(a.focal || 0, b.focal || 0, t),
    matrix: ma.map((v, i) => lerp(v, mb[i], t)),
    stops: a.stops.map((s, i) => ({
      offset: lerp(s.offset, b.stops[i].offset, t),
      color: lerpHex(s.color, b.stops[i].color, t),
      alpha: lerp(s.alpha ?? 1, b.stops[i].alpha ?? 1, t),
    })),
  };
}

// ---------- efeito de cor ----------
// color = { mode: 'none'|'brightness'|'tint'|'alpha'|'advanced', brightness, tint, tintAmount, alpha,
//           rm, gm, bm, am (%), ro, go, bo, ao (deslocamento -255..255) }
// ct (transformação de cor) = { rm, gm, bm, am (0..1+), ro, go, bo, ao }

export const NO_COLOR = Object.freeze({ mode: 'none' });

export function colorToCT(c) {
  if (!c || !c.mode || c.mode === 'none') return null;
  const ct = { rm: 1, gm: 1, bm: 1, am: 1, ro: 0, go: 0, bo: 0, ao: 0 };
  if (c.mode === 'alpha') ct.am = clamp((c.alpha ?? 100) / 100, 0, 1);
  else if (c.mode === 'brightness') {
    const b = clamp((c.brightness ?? 0) / 100, -1, 1);
    const m = 1 - Math.abs(b);
    ct.rm = ct.gm = ct.bm = m;
    if (b > 0) ct.ro = ct.go = ct.bo = 255 * b;
  } else if (c.mode === 'tint') {
    const p = clamp((c.tintAmount ?? 0) / 100, 0, 1);
    const [r, g, b] = hexToRgb(c.tint);
    ct.rm = ct.gm = ct.bm = 1 - p;
    ct.ro = r * p;
    ct.go = g * p;
    ct.bo = b * p;
  } else if (c.mode === 'advanced') {
    ct.rm = (c.rm ?? 100) / 100;
    ct.gm = (c.gm ?? 100) / 100;
    ct.bm = (c.bm ?? 100) / 100;
    ct.am = (c.am ?? 100) / 100;
    ct.ro = c.ro ?? 0;
    ct.go = c.go ?? 0;
    ct.bo = c.bo ?? 0;
    ct.ao = c.ao ?? 0;
  }
  return ct;
}

function ctToAdvanced(ct) {
  ct ||= { rm: 1, gm: 1, bm: 1, am: 1, ro: 0, go: 0, bo: 0, ao: 0 };
  return {
    mode: 'advanced',
    rm: ct.rm * 100,
    gm: ct.gm * 100,
    bm: ct.bm * 100,
    am: ct.am * 100,
    ro: ct.ro,
    go: ct.go,
    bo: ct.bo,
    ao: ct.ao,
  };
}

/** "Nenhum" equivalente no modo do outro lado, para interpolar sem pulo. */
function neutralFor(mode, other) {
  if (mode === 'alpha') return { mode, alpha: 100 };
  if (mode === 'brightness') return { mode, brightness: 0 };
  if (mode === 'tint') return { mode, tint: other.tint, tintAmount: 0 };
  return ctToAdvanced(null);
}

export function lerpColorEffect(a, b, t) {
  let ma = a?.mode || 'none', mb = b?.mode || 'none';
  if (ma === 'none' && mb === 'none') return a || NO_COLOR;
  if (ma === 'none') {
    a = neutralFor(mb, b);
    ma = mb;
  } else if (mb === 'none') {
    b = neutralFor(ma, a);
    mb = ma;
  }
  if (ma === mb) {
    const out = { mode: ma };
    for (const k of ['brightness', 'tintAmount', 'alpha', 'rm', 'gm', 'bm', 'am', 'ro', 'go', 'bo', 'ao']) {
      if (a[k] != null || b[k] != null) out[k] = lerp(a[k] ?? 0, b[k] ?? 0, t);
    }
    if (ma === 'tint') out.tint = lerpHex(a.tint, b.tint, t);
    return out;
  }
  const x = colorToCT(a), y = colorToCT(b);
  const ct = {};
  for (const k of ['rm', 'gm', 'bm', 'am', 'ro', 'go', 'bo', 'ao']) ct[k] = lerp(x[k], y[k], t);
  return ctToAdvanced(ct);
}

// ---------- tween de um trecho ----------
export function compatible(a, b) {
  return (
    a && b && a.type === b.type && (a.type !== 'instance' || a.symbolId === b.symbolId) && (a.type !== 'bitmap' || a.assetId === b.assetId)
  );
}

/** Filtros, 3D e malha de pinos também andam no tween. */
function lerpExtras(out, a, b, t) {
  for (const k of ['rx', 'ry', 'z']) if (a[k] || b[k]) out[k] = lerp(a[k] || 0, b[k] || 0, t);
  const fa = a.filters || [], fb = b.filters || [];
  if (fa.length && fa.length === fb.length && fa.every((f, i) => f.type === fb[i].type)) {
    out.filters = fa.map((f, i) => {
      const g = { ...f };
      for (const [k, v] of Object.entries(f)) {
        const w = fb[i][k];
        if (typeof v === 'number' && typeof w === 'number') g[k] = lerp(v, w, t);
        else if (typeof v === 'string' && v.startsWith('#') && typeof w === 'string') g[k] = lerpHex(v, w, t);
      }
      return g;
    });
  }
  const pa = a.warp?.pins, pb = b.warp?.pins;
  if (pa?.length && pb?.length === pa.length) {
    out.warp = { pins: pa.map((p, i) => ({ ...p, dx: lerp(p.dx, pb[i].dx, t), dy: lerp(p.dy, pb[i].dy, t) })) };
  }
}

/**
 * Elementos interpolados do trecho `span` em direção ao keyframe `next`, `offset` quadros depois do início.
 * guide: polilinha medida do guia de movimento (o elemento anda sobre ela).
 */
export function tweenElements(span, next, offset, guide = null) {
  const tw = span.tween;
  const t = applyEase(offset / span.duration, tw);
  if (tw.type === 'shape') return shapeTweenElements(span, next, t);
  return span.elements.map((a, i) => {
    const b = next.elements[i];
    if (!compatible(a, b)) return a;
    let matrix = lerpMatrix(a.matrix, b.matrix, t, tw);
    if (guide) matrix = followGuide(matrix, a, b, t, guide, tw.orient);
    const out = { ...a, matrix };
    lerpExtras(out, a, b, t);
    if (a.type === 'instance') out.color = lerpColorEffect(a.color, b.color, t);
    else if (a.type !== 'shape') return out;
    else {
      if (a.fill && b.fill) out.fill = lerpFill(a.fill, b.fill, t);
      if (a.stroke && b.stroke) out.stroke = lerpHex(a.stroke, b.stroke, t);
      out.strokeWidth = lerp(a.strokeWidth || 0, b.strokeWidth || 0, t);
    }
    return out;
  });
}

// ---------- guia de movimento ----------
/** Põe o ponto de registro sobre o caminho do guia; com orient, gira junto com a tangente. */
function followGuide(m, a, b, t, guide, orient) {
  const s0 = nearestS(guide, a.matrix[4], a.matrix[5]);
  const s1 = nearestS(guide, b.matrix[4], b.matrix[5]);
  const p = pointAt(guide, s0 + (s1 - s0) * t);
  const out = m.slice();
  out[4] = p.x;
  out[5] = p.y;
  if (orient) {
    const p0 = pointAt(guide, s0);
    const d = p.angle - p0.angle;
    const c = Math.cos(d), sn = Math.sin(d);
    const [ma, mb, mc, md] = out;
    out[0] = c * ma - sn * mb;
    out[1] = sn * ma + c * mb;
    out[2] = c * mc - sn * md;
    out[3] = sn * mc + c * md;
  }
  return out;
}

// ---------- shape tween ----------
function gradToSpace(fill, m) {
  if (!fill || typeof fill !== 'object') return fill;
  const g = fill.matrix || [1, 0, 0, 1, 0, 0];
  const r = [
    m[0] * g[0] + m[2] * g[1],
    m[1] * g[0] + m[3] * g[1],
    m[0] * g[2] + m[2] * g[3],
    m[1] * g[2] + m[3] * g[3],
    m[0] * g[4] + m[2] * g[5] + m[4],
    m[1] * g[4] + m[3] * g[5] + m[5],
  ];
  return { ...fill, matrix: r };
}

// ---------- animação ponto a ponto (como no Moho) ----------
/**
 * Mesma estrutura de pontos: mesmos subcaminhos, mesma quantidade de pontos em cada um e o mesmo
 * fechamento. É o caso de um keyframe copiado (F6 ou auto-key) com os pontos movidos: aí o tween
 * liga cada ponto ao seu par, com as alças, em vez de reamostrar o contorno (a forma não "derrete").
 */
export function sameStructure(pa, pb) {
  if (!pa || !pb) return false;
  const A = pa.subs || [pa], B = pb.subs || [pb];
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) {
    if (!!A[i].closed !== !!B[i].closed || (A[i].pts?.length || 0) !== (B[i].pts?.length || 0)) return false;
  }
  return A.some((s) => s.pts?.length);
}

/** As duas chaves vêm do mesmo desenho (uma é cópia da outra, via F6, auto-key ou colar). */
export const sameDrawing = (a, b) => (a.lineage || a.id) === (b.lineage || b.id);

const sameMatrix = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const detScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/** Ponto [x, y, inX, inY, outX, outY] levado pela matriz (âncora inteira; alças só pela parte linear). */
function xfPoint(m, q) {
  return [
    m[0] * q[0] + m[2] * q[1] + m[4],
    m[1] * q[0] + m[3] * q[1] + m[5],
    m[0] * q[2] + m[2] * q[3],
    m[1] * q[2] + m[3] * q[3],
    m[0] * q[4] + m[2] * q[5],
    m[1] * q[4] + m[3] * q[5],
  ];
}

/** Perfil de largura no meio do caminho entre dois perfis (cada um pode faltar = largura cheia). */
function lerpProfile(pa, pb, t) {
  if (!pa?.length && !pb?.length) return undefined;
  const ts = [...new Set([...(pa || []), ...(pb || []), { t: 0 }, { t: 1 }].map((p) => p.t))].sort((x, y) => x - y);
  return ts.map((u) => ({ t: u, w: lerp(pa?.length ? profileAt(pa, u) : 1, pb?.length ? profileAt(pb, u) : 1, t) }));
}

/** Interpolação exata ponto a ponto entre duas formas de mesma estrutura. */
export function lerpShapeExact(a, b, t) {
  const keep = sameMatrix(a.matrix, b.matrix);
  const A = a.path.subs || [a.path], B = b.path.subs || [b.path];
  const subs = A.map((sa, si) => {
    const sb = B[si];
    return {
      closed: !!sa.closed,
      pts: sa.pts.map((qa, pi) => {
        const qb = sb.pts[pi];
        const xa = keep ? qa : xfPoint(a.matrix, qa), xb = keep ? qb : xfPoint(b.matrix, qb);
        return xa.map((v, k) => lerp(v, xb[k] ?? 0, t));
      }),
    };
  });
  const path = a.path.subs ? { ...a.path, subs } : { ...subs[0], ...(a.path.fillRule ? { fillRule: a.path.fillRule } : {}) };
  const out = { ...a, matrix: keep ? a.matrix : [1, 0, 0, 1, 0, 0], path };
  if (keep) {
    if (a.fill && b.fill) out.fill = lerpFill(a.fill, b.fill, t);
    out.strokeWidth = lerp(a.strokeWidth || 0, b.strokeWidth || 0, t);
  } else {
    const fa = gradToSpace(a.fill, a.matrix), fb = gradToSpace(b.fill, b.matrix);
    out.fill = fa && fb ? lerpFill(fa, fb, t) : t < 0.5 ? fa : fb;
    // a espessura acompanha a escala que a matriz tinha (o caminho saiu da matriz)
    out.strokeWidth = lerp((a.strokeWidth || 0) * detScale(a.matrix), (b.strokeWidth || 0) * detScale(b.matrix), t);
  }
  if (!(a.fill && b.fill) && keep) out.fill = t < 0.5 ? a.fill : b.fill;
  out.stroke = a.stroke && b.stroke ? lerpHex(a.stroke, b.stroke, t) : t < 0.5 ? a.stroke : b.stroke;
  const prof = lerpProfile(a.widthProfile, b.widthProfile, t);
  if (prof) out.widthProfile = prof;
  else delete out.widthProfile;
  // esconder/mostrar é degrau: vale o do keyframe de onde o tween sai
  if (a.hidden) out.hidden = true;
  else delete out.hidden;
  return out;
}

function shapeTweenElements(span, next, t) {
  const hints = span.tween.hints || [];
  return span.elements.map((a, i) => {
    const b = next.elements[i];
    if (!a || !b || a.type !== 'shape' || b.type !== 'shape') return a;
    // mesma estrutura de pontos (e sem dicas de forma pedindo outra correspondência): ponto a ponto
    if (!(i === 0 && hints.length) && sameDrawing(a, b) && sameStructure(a.path, b.path)) return lerpShapeExact(a, b, t);
    const path = morphPath(prepareMorph(a, b, i === 0 ? hints : []), t);
    if (!path) return a;
    const fa = gradToSpace(a.fill, a.matrix), fb = gradToSpace(b.fill, b.matrix);
    return {
      ...a,
      matrix: [1, 0, 0, 1, 0, 0],
      path,
      fill: fa && fb ? lerpFill(fa, fb, t) : t < 0.5 ? fa : fb,
      stroke: a.stroke && b.stroke ? lerpHex(a.stroke, b.stroke, t) : t < 0.5 ? a.stroke : b.stroke,
      strokeWidth: lerp(a.strokeWidth || 0, b.strokeWidth || 0, t),
    };
  });
}

// ---------- motion tween ----------
// tween = { type: 'motion', props: { x: [keys], y, rotation, skew, scaleX, scaleY, alpha }, orient, ease... }
// key = { t (quadro dentro do trecho), v, it, iv, ot, ov } — alças opcionais (curva no editor de movimento).

export const MOTION_PROPS = ['x', 'y', 'rotation', 'skew', 'scaleX', 'scaleY', 'alpha'];
export const MOTION_LABELS = {
  x: 'Posição X',
  y: 'Posição Y',
  rotation: 'Rotação (°)',
  skew: 'Inclinação (°)',
  scaleX: 'Escala X (%)',
  scaleY: 'Escala Y (%)',
  alpha: 'Alfa (%)',
};

const DEG = 180 / Math.PI;

/** Matriz → propriedades do motion tween (graus e porcentagens, como no painel). */
export function matrixToProps(m) {
  const d = decompose(m);
  return { x: d.x, y: d.y, rotation: d.ky * DEG, skew: (d.kx - d.ky) * DEG, scaleX: d.sx * 100, scaleY: d.sy * 100 };
}

export function propsToMatrix(p) {
  const ky = p.rotation / DEG;
  return compose({ x: p.x, y: p.y, sx: p.scaleX / 100, sy: p.scaleY / 100, ky, kx: ky + p.skew / DEG });
}

/** Valor de uma lista de keys no quadro t. Trechos sem alças usam o easing do tween. */
export function evalKeys(keys, t, tw) {
  const n = keys.length;
  if (!n) return undefined;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[n - 1].t) return keys[n - 1].v;
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  if (a.ot || a.ov || b.it || b.iv) {
    return curveY(
      [
        { x: a.t, y: a.v, ox: a.ot || 0, oy: a.ov || 0 },
        { x: b.t, y: b.v, ix: b.it || 0, iy: b.iv || 0 },
      ],
      t,
    );
  }
  const u = (t - a.t) / (b.t - a.t || 1);
  return a.v + (b.v - a.v) * applyEase(u, tw);
}

/** Propriedades no quadro t (o que não tem key fica como no elemento base). */
export function motionPropsAt(span, t) {
  const tw = span.tween;
  const base = span.elements[0];
  const P = matrixToProps(base.matrix);
  P.alpha = base.color?.mode === 'alpha' ? base.color.alpha ?? 100 : 100;
  for (const name of MOTION_PROPS) {
    const keys = tw.props?.[name];
    if (keys?.length) P[name] = evalKeys(keys, t, tw);
  }
  return P;
}

/** Elemento do motion tween no quadro t (dentro do trecho). */
export function motionElement(span, t) {
  const base = span.elements[0];
  if (!base) return null;
  const tw = span.tween;
  const P = motionPropsAt(span, t);
  if (tw.orient) {
    const ang = (u) => {
      const q0 = motionPropsAt(span, Math.max(0, u - 0.5)), q1 = motionPropsAt(span, Math.min(span.duration - 1, u + 0.5));
      return Math.atan2(q1.y - q0.y, q1.x - q0.x);
    };
    if (span.duration > 1) P.rotation += (ang(t) - ang(0)) * DEG;
  }
  const el = { ...base, matrix: propsToMatrix(P) };
  if (tw.props?.alpha?.length) {
    const c = base.color;
    if (!c || c.mode === 'none' || c.mode === 'alpha') el.color = { mode: 'alpha', alpha: P.alpha };
    else el.color = { ...colorToAdvanced(c), am: P.alpha };
  }
  return el;
}

function colorToAdvanced(c) {
  const ct = colorToCT(c);
  return { mode: 'advanced', rm: ct.rm * 100, gm: ct.gm * 100, bm: ct.bm * 100, am: ct.am * 100, ro: ct.ro, go: ct.go, bo: ct.bo, ao: ct.ao };
}

/** Grava (ou cria) uma key no quadro t. Devolve a lista nova. */
export function setKey(keys = [], t, v) {
  const out = keys.map((k) => ({ ...k }));
  const i = out.findIndex((k) => Math.abs(k.t - t) < 1e-6);
  if (i >= 0) out[i].v = v;
  else {
    out.push({ t, v });
    out.sort((a, b) => a.t - b.t);
  }
  return out;
}

/** Pontos do caminho do motion tween (um por quadro), para desenhar no palco. */
export function motionPath(span) {
  const pts = [];
  for (let t = 0; t < span.duration; t++) {
    const p = motionPropsAt(span, t);
    pts.push({ t, x: p.x, y: p.y });
  }
  return pts;
}
