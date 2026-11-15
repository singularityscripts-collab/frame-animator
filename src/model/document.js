// Modelo de dados: documento → cenas → camadas → trechos (keyframe + duração) → elementos.
// Biblioteca: símbolos (cada um tem suas próprias camadas, como uma cena) e pastas.
// Tudo é JSON puro, serializável.

export const FORMAT = 'frame-animator';
export const VERSION = 4;

export const LAYER_TYPES = {
  normal: 'Normal',
  mask: 'Máscara',
  guide: 'Guia',
  folder: 'Pasta',
  camera: 'Câmera',
};
export const SOUND_SYNC = { event: 'Evento', start: 'Iniciar', stop: 'Parar', stream: 'Stream' };
export const LABEL_TYPES = { name: 'Nome', comment: 'Comentário', anchor: 'Âncora' };

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
    library: { folders: [], items: [], sounds: [] },
  };
}

export function createScene(name) {
  return { id: uid('s'), name, layers: [createLayer('Camada 1', 0)] };
}

export function createLayer(name, colorIndex = 0, length = 1) {
  return {
    id: uid('l'),
    name,
    type: 'normal',
    depth: 0,
    collapsed: false,
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

  // versão 1 não tinha biblioteca; a 4 ganhou sons
  if (!d.library || typeof d.library !== 'object') d.library = { folders: [], items: [] };
  if (!Array.isArray(d.library.sounds)) d.library.sounds = [];
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
  d.library.sounds = d.library.sounds.filter((x) => x && typeof x.data === 'string' && x.data.length > 0);
  for (const snd of d.library.sounds) {
    snd.id ||= uid('a');
    snd.name ||= 'Som';
    snd.duration = Number.isFinite(snd.duration) ? Math.max(0, snd.duration) : 0;
    if (!folderIds.has(snd.folderId)) snd.folderId = null;
  }
  const soundIds = new Set(d.library.sounds.map((x) => x.id));

  for (const tl of allTimelines(d)) {
    tl.id ||= uid('s');
    if (!tl.layers.length) tl.layers = [createLayer('Camada 1')];
    tl.layers.forEach((l, i) => normalizeLayer(l, i, symbolIds, soundIds));
    const layerIds = new Set(tl.layers.map((l) => l.id));
    const byId = new Map(tl.layers.map((l) => [l.id, l]));
    for (const l of tl.layers) {
      const ref = (k, type) => {
        if (!l[k]) return;
        const t = byId.get(l[k]);
        if (!layerIds.has(l[k]) || t === l || (type && t.type !== type)) delete l[k];
      };
      ref('folderId', 'folder');
      ref('maskedBy', 'mask');
      ref('guidedBy', 'guide');
      ref('parentLayerId');
    }
    // só uma câmera por cena, e nunca dentro de símbolos
    const isScene = d.scenes.includes(tl);
    let cams = 0;
    for (const l of tl.layers) if (l.type === 'camera' && (!isScene || cams++ > 0)) l.type = 'normal';
  }
  for (const s of d.scenes) s.name ||= 'Cena';
  if (d.swatches !== undefined && (!Array.isArray(d.swatches) || !d.swatches.every(validFill))) delete d.swatches;
  d.version = VERSION;
  return d;
}

function validPath(path) {
  if (!path || typeof path !== 'object') return false;
  if (Array.isArray(path.subs)) return path.subs.length > 0 && path.subs.every((sp) => sp && Array.isArray(sp.pts));
  return Array.isArray(path.pts);
}

export function validFill(f) {
  if (typeof f === 'string') return true;
  return (
    !!f &&
    (f.type === 'linear' || f.type === 'radial') &&
    Array.isArray(f.stops) &&
    f.stops.length >= 1 &&
    f.stops.every((st) => st && typeof st.color === 'string' && Number.isFinite(st.offset))
  );
}

function normalizeLayer(l, i, symbolIds, soundIds) {
  l.id ||= uid('l');
  if (!LAYER_TYPES[l.type]) l.type = 'normal';
  l.depth = Number.isFinite(l.depth) ? Math.max(-900, Math.min(100000, l.depth)) : 0;
  l.collapsed = !!l.collapsed;
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
    if (f.tween && !['classic', 'motion', 'shape'].includes(f.tween.type)) delete f.tween;
    if (f.tween?.type === 'motion' && (typeof f.tween.props !== 'object' || !f.tween.props)) f.tween.props = {};
    if (f.label != null && typeof f.label !== 'string') delete f.label;
    if (f.label && !LABEL_TYPES[f.labelType]) f.labelType = 'name';
    if (f.sound && !soundIds.has(f.sound.id)) delete f.sound;
    if (f.sound && !SOUND_SYNC[f.sound.sync]) f.sound.sync = 'event';
    if (f.camera && typeof f.camera !== 'object') delete f.camera;
    if (!Array.isArray(f.elements)) f.elements = [];
    f.elements = f.elements.filter(
      (el) => el && ((el.type === 'shape' && validPath(el.path)) || (el.type === 'instance' && symbolIds.has(el.symbolId))),
    );
    for (const el of f.elements) {
      el.id ||= uid('e');
      if (!Array.isArray(el.matrix) || el.matrix.length !== 6) el.matrix = [1, 0, 0, 1, 0, 0];
      if (el.type === 'shape') {
        if (el.fill && !validFill(el.fill)) el.fill = null;
        if (el.stroke && typeof el.stroke !== 'string') el.stroke = null;
      }
      if (el.type === 'instance') {
        if (el.behavior !== 'movieclip') el.behavior = 'graphic';
        if (!['loop', 'once', 'single'].includes(el.loop)) el.loop = 'loop';
        el.firstFrame = Math.max(0, Math.floor(el.firstFrame) || 0);
        if (!el.color || typeof el.color !== 'object') el.color = { mode: 'none' };
      }
    }
  }
}

/** Quantas vezes cada som aparece em keyframes. */
export function soundUsage(doc) {
  const count = new Map();
  for (const tl of allTimelines(doc)) {
    for (const l of tl.layers) for (const sp of l.frames) if (sp.sound?.id) count.set(sp.sound.id, (count.get(sp.sound.id) || 0) + 1);
  }
  return count;
}

/** Camadas que estão dentro de uma pasta (direta ou indiretamente). */
export function folderDescendants(tl, folderId) {
  const out = [];
  const walk = (id) => {
    for (const l of tl.layers) {
      if (l.folderId === id) {
        out.push(l);
        if (l.type === 'folder') walk(l.id);
      }
    }
  };
  walk(folderId);
  return out;
}
