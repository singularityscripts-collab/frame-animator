// Easing: presets, curva personalizada (Bézier) e o easing clássico de −100 a +100.
// Usado por todos os tipos de tween (clássico, movimento, forma e câmera).

const PI = Math.PI;
const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = (2 * PI) / 3, c5 = (2 * PI) / 4.5;

function bounceOut(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const EASES = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  cubicIn: (t) => t ** 3,
  cubicOut: (t) => 1 - (1 - t) ** 3,
  cubicInOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  quartIn: (t) => t ** 4,
  quartOut: (t) => 1 - (1 - t) ** 4,
  quartInOut: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  sineIn: (t) => 1 - Math.cos((t * PI) / 2),
  sineOut: (t) => Math.sin((t * PI) / 2),
  sineInOut: (t) => -(Math.cos(PI * t) - 1) / 2,
  expoIn: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  expoOut: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  circIn: (t) => 1 - Math.sqrt(1 - t * t),
  circOut: (t) => Math.sqrt(1 - (t - 1) ** 2),
  backIn: (t) => c3 * t ** 3 - c1 * t * t,
  backOut: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  backInOut: (t) =>
    t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  elasticIn: (t) => (t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * c4)),
  elasticOut: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  elasticInOut: (t) =>
    t === 0 || t === 1
      ? t
      : t < 0.5
        ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1,
  bounceIn: (t) => 1 - bounceOut(1 - t),
  bounceOut,
  bounceInOut: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
};

export const EASE_LABELS = {
  linear: 'Sem easing',
  quadIn: 'Acelerar (suave)',
  quadOut: 'Desacelerar (suave)',
  quadInOut: 'Acelerar e desacelerar (suave)',
  cubicIn: 'Acelerar (médio)',
  cubicOut: 'Desacelerar (médio)',
  cubicInOut: 'Acelerar e desacelerar (médio)',
  quartIn: 'Acelerar (forte)',
  quartOut: 'Desacelerar (forte)',
  quartInOut: 'Acelerar e desacelerar (forte)',
  sineIn: 'Seno: entrada',
  sineOut: 'Seno: saída',
  sineInOut: 'Seno: entrada e saída',
  expoIn: 'Exponencial: entrada',
  expoOut: 'Exponencial: saída',
  circIn: 'Circular: entrada',
  circOut: 'Circular: saída',
  backIn: 'Recuar antes de ir',
  backOut: 'Passar do ponto e voltar',
  backInOut: 'Recuar e passar do ponto',
  elasticIn: 'Elástico: entrada',
  elasticOut: 'Elástico: saída',
  elasticInOut: 'Elástico: entrada e saída',
  bounceIn: 'Quicar: entrada',
  bounceOut: 'Quicar: saída',
  bounceInOut: 'Quicar: entrada e saída',
};

/** Easing clássico: −100 acelera (entra devagar), +100 desacelera (sai devagar). */
export function easeT(t, ease = 0) {
  const e = Math.max(-1, Math.min(1, ease / 100));
  return t + e * (t - t * t);
}

// ---------- curvas Bézier em pedaços ----------
// Uma curva é uma lista de pontos ordenados por x: { x, y, ix, iy, ox, oy } (alças relativas).
// Serve para o easing personalizado (x e y de 0 a 1) e para as curvas do editor de movimento.

function cubic(p0, p1, p2, p3, s) {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}

/** Valor y da curva no ponto x. Fora do intervalo, segura o primeiro/último valor. */
export function curveY(points, x) {
  const n = points.length;
  if (!n) return x;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[n - 1].x) return points[n - 1].y;
  let i = 0;
  while (i < n - 2 && x > points[i + 1].x) i++;
  const a = points[i], b = points[i + 1];
  if (!(a.ox || a.oy || b.ix || b.iy)) {
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
  }
  // alças em x ficam dentro do trecho (curva continua sendo função de x)
  const x1 = Math.min(b.x, Math.max(a.x, a.x + (a.ox || 0)));
  const x2 = Math.min(b.x, Math.max(a.x, b.x + (b.ix || 0)));
  let lo = 0, hi = 1, s = 0.5;
  for (let k = 0; k < 30; k++) {
    s = (lo + hi) / 2;
    const xs = cubic(a.x, x1, x2, b.x, s);
    if (xs < x) lo = s;
    else hi = s;
  }
  return cubic(a.y, a.y + (a.oy || 0), b.y + (b.iy || 0), b.y, s);
}

export const DEFAULT_EASE_CURVE = [
  { x: 0, y: 0, ix: 0, iy: 0, ox: 0.3, oy: 0 },
  { x: 1, y: 1, ix: -0.3, iy: 0, ox: 0, oy: 0 },
];

/** Aplica o easing configurado num tween (t de 0 a 1). */
export function applyEase(t, tw) {
  if (!tw) return t;
  if (tw.easeType === 'custom' && Array.isArray(tw.easeCurve) && tw.easeCurve.length >= 2) return curveY(tw.easeCurve, t);
  if (tw.easeType && EASES[tw.easeType]) return EASES[tw.easeType](t);
  return easeT(t, tw.ease || 0);
}
