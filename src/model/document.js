// Modelo de dados: documento → cenas → camadas → trechos (keyframe + duração) → elementos.
// Tudo é JSON puro, serializável.

export const FORMAT = 'frame-animator';
export const VERSION = 1;

export const LAYER_COLORS = [
  '#4f9dff', '#ff6b6b', '#3ecf8e', '#f5a524', '#b072ff', '#00c2d1', '#ff7ac6', '#a3d14b',
];

let counter = 0;
export function uid(prefix = 'e') {
  counter = (counter + 1) % 1679616;
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}

export const clone = (o) => structuredClone(o);

export function createDocument({ width = 1280, height = 720, fps = 24, background = '#ffffff' } = {}) {
  return {
    format: FORMAT,
    version: VERSION,
    width,
    height,
    fps,
    background,
    scenes: [createScene('Cena 1')],
  };
}

export function createScene(name) {
  return { id: uid('s'), name, layers: [createLayer('Camada 1', 0)] };
}

export function createLayer(name, colorIndex = 0, length = 1) {
  return {
    id: uid('l'),
    name,
    visible: true,
    locked: false,
    outline: false,
    color: LAYER_COLORS[colorIndex % LAYER_COLORS.length],
    frames: [{ start: 0, duration: Math.max(1, length), elements: [] }],
  };
}

/** Cópia de elementos com ids novos (para keyframes duplicados e colar). */
export function cloneElementsWithNewIds(elements) {
  return elements.map((el) => ({ ...clone(el), id: uid('e') }));
}

export function serialize(doc) {
  return JSON.stringify(doc);
}

/** Lê e valida um documento salvo. Lança erro com mensagem legível se for inválido. */
export function parseDocument(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  if (!d || d.format !== FORMAT) throw new Error('Este arquivo não é um documento do Frame Animator.');
  if (typeof d.version !== 'number' || d.version > VERSION) {
    throw new Error('Este arquivo foi salvo numa versão mais nova do Frame Animator.');
  }
  const num = (v, def, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
  d.width = num(d.width, 1280, 1, 16000);
  d.height = num(d.height, 720, 1, 16000);
  d.fps = num(d.fps, 24, 1, 120);
  if (typeof d.background !== 'string') d.background = '#ffffff';
  if (!Array.isArray(d.scenes) || !d.scenes.length) throw new Error('O documento não tem cenas.');
  for (const s of d.scenes) {
    s.id ||= uid('s');
    s.name ||= 'Cena';
    if (!Array.isArray(s.layers) || !s.layers.length) s.layers = [createLayer('Camada 1')];
    s.layers.forEach((l, i) => {
      l.id ||= uid('l');
      l.name ||= `Camada ${i + 1}`;
      l.visible = l.visible !== false;
      l.locked = !!l.locked;
      l.outline = !!l.outline;
      l.color ||= LAYER_COLORS[i % LAYER_COLORS.length];
      if (!Array.isArray(l.frames) || !l.frames.length) l.frames = [{ start: 0, duration: 1, elements: [] }];
      let start = 0;
      for (const f of l.frames) {
        f.start = start;
        f.duration = Math.max(1, Math.floor(f.duration) || 1);
        start += f.duration;
        if (!Array.isArray(f.elements)) f.elements = [];
        f.elements = f.elements.filter((el) => el && el.type === 'shape' && el.path && Array.isArray(el.path.pts));
        for (const el of f.elements) {
          el.id ||= uid('e');
          if (!Array.isArray(el.matrix) || el.matrix.length !== 6) el.matrix = [1, 0, 0, 1, 0, 0];
        }
      }
    });
  }
  return d;
}
