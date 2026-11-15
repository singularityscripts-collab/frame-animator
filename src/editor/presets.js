// Presets de movimento: animações prontas aplicadas como motion tween no objeto selecionado.
// Valores relativos à pose atual: 'add' soma (posição, giro), 'mul' multiplica (escala em %),
// 'abs' é absoluto (alfa).

export const PROP_MODE = { x: 'add', y: 'add', rotation: 'add', skew: 'add', scaleX: 'mul', scaleY: 'mul', alpha: 'abs' };

const both = (keys) => ({ scaleX: keys, scaleY: keys });

export const BUILTIN_PRESETS = [
  { id: 'in-left', name: 'Entrar pela esquerda', seconds: 0.75, easeType: 'cubicOut', props: { x: [[0, -400], [1, 0]], alpha: [[0, 0], [1, 100]] } },
  { id: 'in-top', name: 'Cair e quicar', seconds: 1, easeType: 'bounceOut', props: { y: [[0, -300], [1, 0]] } },
  { id: 'fade-in', name: 'Aparecer', seconds: 0.5, easeType: 'sineOut', props: { alpha: [[0, 0], [1, 100]] } },
  { id: 'fade-out', name: 'Sumir', seconds: 0.5, easeType: 'sineIn', props: { alpha: [[0, 100], [1, 0]] } },
  { id: 'spin', name: 'Girar 360°', seconds: 1, easeType: 'linear', props: { rotation: [[0, 0], [1, 360]] } },
  { id: 'pulse', name: 'Pulsar', seconds: 0.6, easeType: 'sineInOut', props: both([[0, 100], [0.5, 120], [1, 100]]) },
  { id: 'zoom-in', name: 'Zoom de entrada', seconds: 0.6, easeType: 'backOut', props: { ...both([[0, 0], [1, 100]]), alpha: [[0, 0], [1, 100]] } },
  {
    id: 'shake',
    name: 'Tremer',
    seconds: 0.5,
    easeType: 'linear',
    props: { x: [[0, 0], [0.125, -12], [0.25, 12], [0.375, -10], [0.5, 10], [0.625, -6], [0.75, 6], [0.875, -3], [1, 0]] },
  },
  { id: 'out-right', name: 'Sair pela direita', seconds: 0.75, easeType: 'cubicIn', props: { x: [[0, 0], [1, 400]], alpha: [[0, 100], [1, 0]] } },
  { id: 'hop', name: 'Pular no lugar', seconds: 0.6, easeType: 'sineInOut', props: { y: [[0, 0], [0.5, -80], [1, 0]] } },
];

/** Keys absolutas do preset para um objeto com propriedades base P e a duração em quadros. */
export function presetKeys(preset, P, frames) {
  const props = {};
  for (const [name, list] of Object.entries(preset.props)) {
    const mode = PROP_MODE[name];
    props[name] = list.map(([frac, d]) => ({
      t: Math.round(frac * Math.max(1, frames - 1)),
      v: mode === 'add' ? P[name] + d : mode === 'mul' ? (P[name] * d) / 100 : d,
    }));
  }
  return props;
}

/** Preset a partir de um motion tween (para salvar os do usuário). */
export function presetFromTween(name, span, fps, propsAt) {
  const P0 = propsAt(span, 0);
  const last = Math.max(1, span.duration - 1);
  const props = {};
  for (const [prop, keys] of Object.entries(span.tween.props || {})) {
    if (!keys?.length || !PROP_MODE[prop]) continue;
    const mode = PROP_MODE[prop];
    props[prop] = keys.map((k) => [k.t / last, mode === 'add' ? k.v - P0[prop] : mode === 'mul' ? (P0[prop] ? (k.v / P0[prop]) * 100 : 100) : k.v]);
  }
  return {
    id: `user-${Date.now().toString(36)}`,
    name,
    seconds: span.duration / fps,
    easeType: span.tween.easeType || 'linear',
    props,
    user: true,
  };
}
