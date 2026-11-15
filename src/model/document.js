// Modelo de dados: documento → cenas → camadas → trechos (keyframe + duração) → elementos.
// Biblioteca: símbolos (cada um tem suas próprias camadas, como uma cena) e pastas.
// Tudo é JSON puro, serializável.

export const FORMAT = 'frame-animator';
export const VERSION = 2;

export const LAYER_COLORS = [
  '#4f9dff', '#ff6b6b', '#3ecf8e', '#f5a524', '#b072ff', '#00c2d1', '#ff7ac6', '#a3d14b',
];

export const SYMBOL_TYPES = { graphic: 'Gráfico', movieclip: 'Movie clip' };

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
    library: { folders: [], items: [] },
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

export function createSymbol(name, type = 'graphic', elements = [], folderId = null) {
  const layer = createLayer('Camada 1', 0);
  layer.frames[0].elements = elements;
  return { id: uid('y'), name, type, folderId, layers: [layer] };
}

export function createInstance(symbol, matrix = [1, 0, 0, 1, 0, 0]) {
  return {
    id: uid('e'),
    type: 'instance',
    symbolId: symbol.id,
    matrix,
    behavior: symbol.type === 'movieclip' ? 'movieclip' : 'graphic',
    loop: 'loop',
    firstFrame: 0,
    color: { mode: 'none' },
  };
}

/** Cópia de elementos com ids novos (para keyframes duplicados e colar). */
export function cloneElementsWithNewIds(elements) {
  return elements.map((el) => ({ ...clone(el), id: uid('e') }));
}

// ---------- percorrer o documento ----------

/** Todas as timelines: cenas e símbolos. */
export function allTimelines(doc) {
  return [...doc.scenes, ...(doc.library?.items || [])];
}

export function findTimeline(doc, id) {
  return allTimelines(doc).find((t) => t.id === id) || null;
}

export function findLayer(doc, layerId) {
  for (const tl of allTimelines(doc)) {
    const l = tl.layers.find((x) => x.id === layerId);
    if (l) return { timeline: tl, layer: l };
  }
  return null;
}

export function* allElements(doc) {
  for (const tl of allTimelines(doc)) {
    for (const layer of tl.layers) {
      for (const span of layer.frames) {
        for (const el of span.elements) yield { timeline: tl, layer, span, el };
      }
    }
  }
}

/** Quantas instâncias de cada símbolo existem (contando keyframes). */
export function symbolUsage(doc) {
  const count = new Map();
  for (const { el } of allElements(doc)) {
    if (el.type === 'instance') count.set(el.symbolId, (count.get(el.symbolId) || 0) + 1);
  }
  return count;
}

/** O símbolo `outerId` contém (direta ou indiretamente) o símbolo `innerId`? Evita símbolo dentro de si mesmo. */
export function symbolContains(doc, outerId, innerId) {
  if (outerId === innerId) return true;
  const seen = new Set();
  const stack = [outerId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const sym = doc.library.items.find((s) => s.id === id);
    if (!sym) continue;
    for (const l of sym.layers) {
      for (const s of l.frames) {
        for (const el of s.elements) {
          if (el.type !== 'instance') continue;
          if (el.symbolId === innerId) return true;
          stack.push(el.symbolId);
        }
      }
    }
  }
  return false;
}

export function uniqueName(existing, base) {
  const names = new Set(existing);
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// ---------- salvar e abrir ----------

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

  // versão 1 não tinha biblioteca
  if (!d.library || typeof d.library !== 'object') d.library = { folders: [], items: [] };
  if (!Array.isArray(d.library.folders)) d.library.folders = [];
  if (!Array.isArray(d.library.items)) d.library.items = [];
  const folderIds = new Set();
  for (const f of d.library.folders) {
    f.id ||= uid('f');
    f.name ||= 'Pasta';
    folderIds.add(f.id);
  }
  for (const f of d.library.folders) if (!folderIds.has(f.parentId)) f.parentId = null;
  d.library.items = d.library.items.filter((s) => s && Array.isArray(s.layers));
  for (const s of d.library.items) {
    s.id ||= uid('y');
    s.name ||= 'Símbolo';
    if (!SYMBOL_TYPES[s.type]) s.type = 'graphic';
    if (!folderIds.has(s.folderId)) s.folderId = null;
  }
  const symbolIds = new Set(d.library.items.map((s) => s.id));

  for (const tl of allTimelines(d)) {
    tl.id ||= uid('s');
    if (!tl.layers.length) tl.layers = [createLayer('Camada 1')];
    tl.layers.forEach((l, i) => normalizeLayer(l, i, symbolIds));
  }
  for (const s of d.scenes) s.name ||= 'Cena';
  d.version = VERSION;
  return d;
}

function normalizeLayer(l, i, symbolIds) {
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
    if (f.tween && f.tween.type !== 'classic') delete f.tween;
    if (!Array.isArray(f.elements)) f.elements = [];
    f.elements = f.elements.filter(
      (el) =>
        el &&
        ((el.type === 'shape' && el.path && Array.isArray(el.path.pts)) ||
          (el.type === 'instance' && symbolIds.has(el.symbolId))),
    );
    for (const el of f.elements) {
      el.id ||= uid('e');
      if (!Array.isArray(el.matrix) || el.matrix.length !== 6) el.matrix = [1, 0, 0, 1, 0, 0];
      if (el.type === 'instance') {
        if (el.behavior !== 'movieclip') el.behavior = 'graphic';
        if (!['loop', 'once', 'single'].includes(el.loop)) el.loop = 'loop';
        el.firstFrame = Math.max(0, Math.floor(el.firstFrame) || 0);
        if (!el.color || typeof el.color !== 'object') el.color = { mode: 'none' };
      }
    }
  }
}
