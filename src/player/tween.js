// Interpolação do tween clássico e efeitos de cor.
// Faz parte do player: o editor, a janela de teste e o export usam o mesmo cálculo.

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Easing no estilo clássico: -100 acelera (entra devagar), +100 desacelera (sai devagar). */
export function easeT(t, ease = 0) {
  const e = clamp(ease / 100, -1, 1);
  return t + e * (t - t * t);
}

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

export function lerpHex(a, b, t) {
  if (!a || !b || a === b) return t < 0.5 ? a : b;
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => lerp(v, y[i], t)));
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
  return a && b && a.type === b.type && (a.type !== 'instance' || a.symbolId === b.symbolId);
}

/** Elementos interpolados do trecho `span` em direção ao keyframe `next`, `offset` quadros depois do início. */
export function tweenElements(span, next, offset) {
  const tw = span.tween;
  const t = easeT(offset / span.duration, tw.ease);
  return span.elements.map((a, i) => {
    const b = next.elements[i];
    if (!compatible(a, b)) return a;
    const out = { ...a, matrix: lerpMatrix(a.matrix, b.matrix, t, tw) };
    if (a.type === 'instance') out.color = lerpColorEffect(a.color, b.color, t);
    else {
      if (a.fill && b.fill) out.fill = lerpHex(a.fill, b.fill, t);
      if (a.stroke && b.stroke) out.stroke = lerpHex(a.stroke, b.stroke, t);
      out.strokeWidth = lerp(a.strokeWidth || 0, b.strokeWidth || 0, t);
    }
    return out;
  });
}
