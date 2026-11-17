// Funções "profissionais" do editor (Fase 4): camadas especiais, câmera, motion e shape tween,
// rótulos, som, cenas, intervalos de quadros, distribuir e presets de movimento.
// São métodos acrescentados à classe Editor.

import { Editor, DEFAULT_TWEEN } from './editor.js';
import * as C from './commands.js';
import * as TL from '../model/timeline.js';
import { createLayer, createScene, clone, cloneElementsWithNewIds, uid, uniqueName, soundUsage } from '../model/document.js';
import { layerMatrices, timelineLength, cameraLayer, cameraAt, invert, multiply, IDENTITY, layerFrame, symbolById } from '../player/render.js';
import { matrixToProps, motionPropsAt } from '../player/tween.js';
import { elementLocalBounds, localBoxCorners, pointsBounds } from '../model/geometry.js';
import { presetKeys, presetFromTween } from './presets.js';

const P = Editor.prototype;

// ---------- camadas: tipos, pastas, parentesco, profundidade ----------

/** 'normal' | 'mask' | 'masked' | 'guide' | 'guided' | 'folder' | 'camera' */
P.layerKind = function (layer) {
  if (layer.type !== 'normal') return layer.type;
  if (layer.maskedBy) return 'masked';
  if (layer.guidedBy) return 'guided';
  return 'normal';
};

P.replaceLayers = function (after, label) {
  this.run(new C.ReplaceLayers(this.timeline.id, this.layers, after, label));
};

/** Muda o tipo da camada. Máscara já mascara a camada de baixo; "mascarada"/"guiada" procuram a de cima. */
P.setLayerKind = function (id, kind) {
  const layers = clone(this.layers);
  const i = layers.findIndex((l) => l.id === id);
  const L = layers[i];
  if (!L || L.type === 'folder' || L.type === 'camera') return;
  const release = () => {
    for (const o of layers) {
      if (o.maskedBy === L.id) delete o.maskedBy;
      if (o.guidedBy === L.id) delete o.guidedBy;
    }
  };
  const nearestAbove = (type, key) => {
    for (let k = i - 1; k >= 0; k--) {
      const o = layers[k];
      if (o.type === type) return o.id;
      if (o[key]) return o[key];
      if (o.type !== 'folder') break;
    }
    return null;
  };
  delete L.maskedBy;
  delete L.guidedBy;
  if (kind === 'normal') {
    release();
    L.type = 'normal';
  } else if (kind === 'mask') {
    release();
    L.type = 'mask';
    const below = layers[i + 1];
    if (below && below.type === 'normal' && !below.maskedBy && !below.guidedBy) below.maskedBy = L.id;
  } else if (kind === 'guide') {
    release();
    L.type = 'guide';
  } else if (kind === 'masked' || kind === 'guided') {
    if (L.type !== 'normal') release();
    L.type = 'normal';
    const ref = kind === 'masked' ? nearestAbove('mask', 'maskedBy') : nearestAbove('guide', 'guidedBy');
    if (!ref) {
      this.toast(kind === 'masked' ? 'Ponha esta camada logo abaixo de uma camada de máscara.' : 'Ponha esta camada logo abaixo de uma camada guia.');
      return;
    }
    L[kind === 'masked' ? 'maskedBy' : 'guidedBy'] = ref;
  }
  this.replaceLayers(layers, 'Tipo da camada');
};

/** Botão "guia de movimento": cria uma camada guia acima da ativa e faz a ativa seguir o caminho. */
P.addMotionGuide = function () {
  const active = this.activeLayer;
  if (active.type !== 'normal') return this.toast('Escolha uma camada normal para guiar.');
  const layers = clone(this.layers);
  const i = layers.findIndex((l) => l.id === active.id);
  const guide = createLayer(uniqueName(layers.map((l) => l.name), `Guia: ${active.name}`), 4, timelineLength(this.timeline));
  guide.type = 'guide';
  if (active.folderId) guide.folderId = active.folderId;
  layers.splice(i, 0, guide);
  layers[i + 1].guidedBy = guide.id;
  delete layers[i + 1].maskedBy;
  this.replaceLayers(layers, 'Guia de movimento');
  this.activeLayerId = guide.id;
  this.emit('layers');
  this.toast('Desenhe o caminho (linha ou lápis) na camada guia. Um tween clássico na camada de baixo segue esse caminho.');
};

P.addLayerFolder = function () {
  const layers = clone(this.layers);
  const idx = Math.max(0, layers.findIndex((l) => l.id === this.activeLayerId));
  const folder = createLayer(uniqueName(layers.map((l) => l.name), 'Pasta 1'), 3, 1);
  folder.type = 'folder';
  if (layers[idx]?.folderId) folder.folderId = layers[idx].folderId;
  layers.splice(idx, 0, folder);
  this.replaceLayers(layers, 'Nova pasta');
  this.activeLayerId = folder.id;
  this.emit('layers');
};

/** Abre/fecha a pasta na timeline (não entra no desfazer). */
P.toggleFolder = function (id) {
  const l = this.layer(id);
  if (!l || l.type !== 'folder') return;
  l.collapsed = !l.collapsed;
  this.emit('doc');
};

/** A camada e tudo que está dentro dela (se for pasta), na ordem da lista. */
P.layerBlock = function (layers, i) {
  const ids = new Set([layers[i].id]);
  const out = [layers[i]];
  for (let k = i + 1; k < layers.length; k++) {
    if (!ids.has(layers[k].folderId)) break;
    ids.add(layers[k].id);
    out.push(layers[k]);
  }
  return out;
};

/**
 * Move a camada (com o conteúdo, se for pasta) para a posição `insert` (índice na lista antes de mover)
 * e define a pasta onde ela fica (null = fora de pastas).
 */
P.moveLayerBlock = function (from, insert, folderId = null) {
  const layers = clone(this.layers);
  const block = this.layerBlock(layers, from);
  if (folderId && block.some((l) => l.id === folderId)) return; // pasta dentro dela mesma
  layers.splice(from, block.length);
  let to = insert > from ? insert - block.length : insert;
  if (folderId) {
    // dentro de uma pasta, a camada precisa ficar no bloco dela (logo abaixo da pasta)
    const fi = layers.findIndex((l) => l.id === folderId);
    if (fi < 0) return;
    const end = fi + this.layerBlock(layers, fi).length;
    if (to <= fi || to > end) to = fi + 1;
  }
  if (block[0].folderId === folderId && to === from) return;
  if (folderId) block[0].folderId = folderId;
  else delete block[0].folderId;
  // máscara e guia só valem com a camada encostada; se saiu de perto, solta
  layers.splice(Math.max(0, Math.min(layers.length, to)), 0, ...block);
  this.replaceLayers(layers, 'Mover camada');
};

const baseDeleteLayer = P.deleteLayer;
P.deleteLayer = function (id = this.activeLayerId) {
  const layers = clone(this.layers);
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const block = this.layerBlock(layers, i);
  if (layers.length - block.length < 1 || layers.filter((l) => l.type !== 'folder' && l.type !== 'camera').length - block.filter((l) => l.type !== 'folder' && l.type !== 'camera').length < 1) {
    return this.toast('A timeline precisa ter pelo menos uma camada de desenho.');
  }
  if (block.length === 1 && layers[i].type !== 'mask' && layers[i].type !== 'guide' && !layers.some((l) => l.parentLayerId === id)) {
    return baseDeleteLayer.call(this, id);
  }
  const gone = new Set(block.map((l) => l.id));
  const rest = layers.filter((l) => !gone.has(l.id));
  for (const l of rest) {
    if (gone.has(l.maskedBy)) delete l.maskedBy;
    if (gone.has(l.guidedBy)) delete l.guidedBy;
    if (gone.has(l.parentLayerId)) delete l.parentLayerId;
  }
  this.activeLayerId = (rest[Math.min(i, rest.length - 1)] || rest[0]).id;
  this.replaceLayers(rest, layers[i].type === 'folder' ? 'Apagar pasta' : 'Apagar camada');
};

/** Parentesco: a camada filha passa a seguir o objeto da camada mãe, sem pular de lugar. */
P.setLayerParent = function (id, parentId) {
  const tl = this.timeline;
  if (parentId === id) return;
  if (parentId) {
    for (let p = this.layer(parentId), guard = 0; p && guard < 64; guard++) {
      if (p.id === id) return this.toast('Uma camada não pode ser mãe da própria mãe.');
      p = p.parentLayerId ? this.layer(p.parentLayerId) : null;
    }
  }
  const layers = clone(tl.layers);
  const L = layers.find((l) => l.id === id);
  if (!L || (L.parentLayerId || null) === (parentId || null)) return;
  const old = L.frames.map((s) => layerMatrices(this.doc, tl, s.start, { camera: false }).get(id) || IDENTITY);
  if (parentId) L.parentLayerId = parentId;
  else delete L.parentLayerId;
  const temp = { layers };
  L.frames.forEach((s, k) => {
    const now = layerMatrices(this.doc, temp, s.start, { camera: false }).get(id) || IDENTITY;
    const conv = multiply(invert(now) || IDENTITY, old[k]);
    for (const el of s.elements) el.matrix = multiply(conv, el.matrix);
  });
  this.replaceLayers(layers, parentId ? 'Parentesco' : 'Tirar parentesco');
};

P.setLayerDepth = function (id, depth) {
  this.setLayerProps(id, { depth: Math.max(-900, Math.min(100000, Number(depth) || 0)) }, 'Profundidade da camada');
};

// ---------- câmera ----------

P.cameraLayer = function () {
  return this.editStack.length ? null : cameraLayer(this.scene);
};

P.addCamera = function () {
  if (this.editStack.length) return this.toast('A câmera é da cena. Volte para a cena para adicionar.');
  if (cameraLayer(this.scene)) return this.toast('A cena já tem câmera.');
  const layer = createLayer('Câmera', 0, timelineLength(this.scene));
  layer.type = 'camera';
  layer.color = '#9aa0a6';
  layer.frames[0].camera = { x: this.doc.width / 2, y: this.doc.height / 2, zoom: 100, rotation: 0, tint: '#000000', tintAmount: 0 };
  this.run(new C.AddLayer(this.scene.id, 0, layer, 'Adicionar câmera'));
};

P.removeCamera = function () {
  const cl = cameraLayer(this.scene);
  if (!cl) return;
  this.run(new C.RemoveLayer(this.scene.id, this.scene.layers.indexOf(cl), cl, 'Remover câmera'));
};

/** Garante um keyframe da câmera no quadro atual (se estiver no meio de um tween ou depois do fim). */
P.cameraKeyframeHere = function () {
  const cl = this.cameraLayer();
  if (!cl) return null;
  const span = this.spanAt(cl);
  // mudar a câmera fora de um keyframe cria um keyframe ali (com a câmera de agora)
  if (!span || span.start !== this.frame) {
    const r = TL.insertKeyframe(cl.frames, this.frame);
    if (r) this.run(new C.SetLayerFrames(cl.id, cl.frames, r.frames, 'Keyframe da câmera', this.frame, this.frame));
  }
  return this.spanAt(cl);
};

P.cameraState = function () {
  return this.editStack.length ? null : cameraAt(this.doc, this.scene, this.frame);
};

P.setCameraProps = function (patch) {
  const cl = this.cameraLayer();
  if (!cl) return;
  this.group('Câmera', () => {
    const span = this.cameraKeyframeHere();
    const cur = { ...cameraAt(this.doc, this.scene, this.frame) };
    this.run(new C.SetSpanProps(cl.id, span.start, { camera: span.camera }, { camera: { ...cur, ...patch } }, 'Câmera'));
  });
};

// ---------- tweens de movimento e de forma ----------

P.createMotionTween = function () {
  const layer = this.activeLayer;
  const span = this.currentSpan();
  if (!span) return this.toast('Não há quadro aqui para criar o tween.');
  if (span.elements.length !== 1) {
    return this.toast(span.elements.length ? 'O motion tween anima um objeto só por camada. Use Distribuir para camadas ou converta em símbolo.' : 'Desenhe ou ponha um objeto neste keyframe primeiro.');
  }
  this.group('Criar motion tween', () => {
    if (span.duration < 2) {
      const r = TL.insertFrames(layer.frames, span.start, Math.max(1, this.doc.fps - 1));
      this.run(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Inserir quadros'));
    }
    const s = this.spanAt(layer, span.start);
    this.run(new C.SetSpanProps(layer.id, s.start, { tween: s.tween }, { tween: { type: 'motion', props: {}, ease: 0, orient: false } }, 'Criar motion tween'));
  });
  this.toast('Motion tween criado: vá para outro quadro do trecho e mova o objeto; as keys são criadas sozinhas.');
};

P.createShapeTween = function () {
  const layer = this.activeLayer;
  const span = this.currentSpan();
  if (!span) return this.toast('Não há quadro aqui para criar o tween.');
  if (!span.elements.length || span.elements.some((el) => el.type !== 'shape')) {
    return this.toast('O shape tween transforma formas. Instâncias de símbolo usam tween clássico ou de movimento.');
  }
  this.run(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween: { type: 'shape', ease: 0, hints: [] } }, 'Criar shape tween'));
  const next = layer.frames[layer.frames.indexOf(this.currentSpan()) + 1];
  if (!next) this.toast('Shape tween criado. Ponha um keyframe depois (F6 ou F7) com a forma final.');
};

P.setMotionKeys = function (name, keys) {
  const layer = this.activeLayer;
  const span = this.currentSpan();
  if (span?.tween?.type !== 'motion') return;
  const tween = clone(span.tween);
  tween.props ||= {};
  if (keys?.length) tween.props[name] = keys.map((k) => ({ ...k })).sort((a, b) => a.t - b.t);
  else delete tween.props[name];
  this.run(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween }, 'Editar curva'));
};

/** Trecho do shape tween da camada ativa que mostra dicas neste quadro: início (lado "a") ou destino ("b"). */
P.shapeHintContext = function () {
  const layer = this.activeLayer;
  const i = layer.frames.findIndex((s) => this.frame >= s.start && this.frame < s.start + s.duration);
  if (i < 0) return null;
  const cur = layer.frames[i];
  if (cur.tween?.type === 'shape' && this.frame === cur.start && layer.frames[i + 1]) return { layer, span: cur, side: 'a' };
  const prev = layer.frames[i - 1];
  if (prev?.tween?.type === 'shape' && this.frame === cur.start) return { layer, span: prev, side: 'b' };
  return null;
};

P.addShapeHint = function () {
  const layer = this.activeLayer;
  let i = layer.frames.findIndex((s) => this.frame >= s.start && this.frame < s.start + s.duration);
  let span = layer.frames[i];
  if (span?.tween?.type !== 'shape' && layer.frames[i - 1]?.tween?.type === 'shape') span = layer.frames[--i];
  const next = layer.frames[i + 1];
  if (span?.tween?.type !== 'shape' || !next) return this.toast('Crie um shape tween com keyframe de destino antes de pôr dicas.');
  if ((span.tween.hints || []).length >= 26) return this.toast('Limite de 26 dicas (a até z).');
  const center = (el) => {
    const b = pointsBounds(localBoxCorners(el.matrix, elementLocalBounds(el, this.doc)));
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };
  const a = span.elements[0], b = next.elements[0];
  if (!a || !b) return;
  const tween = clone(span.tween);
  tween.hints = [...(tween.hints || []), { a: center(a), b: center(b) }];
  this.run(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween }, 'Dica de forma'));
  this.toast('Arraste a dica até a borda da forma aqui e no keyframe de destino.');
};

P.removeShapeHints = function () {
  const ctx = this.shapeHintContext();
  const span = ctx?.span || this.currentSpan();
  if (span?.tween?.type !== 'shape' || !span.tween.hints?.length) return;
  const layer = this.activeLayer;
  this.run(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween: { ...clone(span.tween), hints: [] } }, 'Tirar dicas de forma'));
};

// ---------- rótulos e som ----------

P.setSpanLabel = function (label, labelType = 'name') {
  const layer = this.activeLayer;
  const span = this.currentSpan();
  if (!span) return;
  const v = (label || '').trim();
  this.run(
    new C.SetSpanProps(
      layer.id,
      span.start,
      { label: span.label, labelType: span.labelType },
      { label: v || undefined, labelType: v ? labelType : undefined },
      'Rótulo do quadro',
    ),
  );
};

P.importSound = function ({ name, mime, data, duration }) {
  const snd = { id: uid('a'), name: uniqueName(this.doc.library.sounds.map((s) => s.name), name || 'Som'), folderId: null, mime, data, duration };
  this.run(new C.InsertLibraryEntry('sounds', this.doc.library.sounds.length, snd, 'Importar som'));
  return snd;
};

/** Som no keyframe da camada ativa (null tira). */
P.setSpanSound = function (patch) {
  const layer = this.activeLayer;
  const span = this.currentSpan();
  if (!span) return this.toast('Escolha um quadro da camada para pôr o som.');
  const sound = patch === null ? undefined : { sync: 'event', loops: 1, volume: 100, pan: 0, fadeIn: 0, fadeOut: 0, ...(span.sound || {}), ...patch };
  if (sound && !sound.id) return;
  this.run(new C.SetSpanProps(layer.id, span.start, { sound: span.sound }, { sound }, sound ? 'Som do quadro' : 'Tirar som'));
};

P.soundUsage = function () {
  return soundUsage(this.doc);
};

const baseDeleteLibraryEntry = P.deleteLibraryEntry;
P.deleteLibraryEntry = function (kind, id) {
  if (kind === 'folders') {
    // sons também sobem de nível quando a pasta é apagada
    const f = this.doc.library.folders.find((x) => x.id === id);
    if (!f) return;
    this.group('Apagar pasta', () => {
      for (const s of this.doc.library.sounds.filter((x) => x.folderId === id)) this.run(new C.PatchLibraryEntry('sounds', s.id, { folderId: id }, { folderId: f.parentId }));
      baseDeleteLibraryEntry.call(this, kind, id);
    });
    return;
  }
  if (kind !== 'sounds') return baseDeleteLibraryEntry.call(this, kind, id);
  const index = this.doc.library.sounds.findIndex((s) => s.id === id);
  if (index < 0) return;
  const cmds = [];
  for (const tl of [...this.doc.scenes, ...this.doc.library.items]) {
    for (const layer of tl.layers) {
      for (const sp of layer.frames) if (sp.sound?.id === id) cmds.push(new C.SetSpanProps(layer.id, sp.start, { sound: sp.sound }, { sound: undefined }));
    }
  }
  cmds.push(new C.DeleteLibraryEntry('sounds', index, this.doc.library.sounds[index]));
  this.run(new C.Compound('Apagar som', cmds));
  this.emit('library');
};

// ---------- cenas ----------

P.resetSceneView = function () {
  this.stop();
  this.editStack = [];
  this.frame = 0;
  const first = this.scene.layers.find((l) => l.type !== 'camera' && l.type !== 'folder') || this.scene.layers[0];
  this.activeLayerId = first.id;
  this.selection = new Set();
  this.frameSel = null;
  this.emitContext();
  this.emit('scenes');
};

P.setScene = function (i) {
  if (i === this.sceneIndex || i < 0 || i >= this.doc.scenes.length) return;
  this.sceneIndex = i;
  this.resetSceneView();
};

P.addScene = function () {
  const name = uniqueName(this.doc.scenes.map((s) => s.name), `Cena ${this.doc.scenes.length + 1}`);
  this.run(new C.InsertScene(this.sceneIndex + 1, createScene(name)));
  this.resetSceneView();
};

/** Cópia da cena com ids novos (as referências entre camadas acompanham). */
P.duplicateScene = function (i = this.sceneIndex) {
  const src = this.doc.scenes[i];
  const copy = clone(src);
  copy.id = uid('s');
  copy.name = uniqueName(this.doc.scenes.map((s) => s.name), `${src.name} cópia`);
  const map = new Map(copy.layers.map((l) => [l.id, uid('l')]));
  for (const l of copy.layers) {
    l.id = map.get(l.id);
    for (const k of ['folderId', 'maskedBy', 'guidedBy', 'parentLayerId']) if (l[k]) l[k] = map.get(l[k]);
    for (const s of l.frames) s.elements = cloneElementsWithNewIds(s.elements);
  }
  this.run(new C.InsertScene(i + 1, copy, 'Duplicar cena'));
  this.resetSceneView();
};

P.deleteScene = function (i = this.sceneIndex) {
  if (this.doc.scenes.length <= 1) return this.toast('O documento precisa ter pelo menos uma cena.');
  this.run(new C.DeleteScene(i, this.doc.scenes[i]));
  this.resetSceneView();
};

P.renameScene = function (i, name) {
  const s = this.doc.scenes[i];
  const v = (name || '').trim();
  if (!s || !v || v === s.name) return;
  this.run(new C.PatchScene(s.id, { name: s.name }, { name: v }, 'Renomear cena'));
  this.emit('scenes');
  this.emitContext();
};

P.moveScene = function (from, to) {
  if (to < 0 || to >= this.doc.scenes.length || from === to) return;
  this.run(new C.MoveScene(from, to));
  this.resetSceneView();
};

// ---------- intervalos de quadros ----------

P.setFrameSelection = function (sel) {
  this.frameSel = sel && sel.layerIds?.length ? { from: Math.min(sel.from, sel.to), to: Math.max(sel.from, sel.to), layerIds: sel.layerIds } : null;
  this.emit('frameSel');
};

P.frameRange = function () {
  return this.frameSel || { from: this.frame, to: this.frame, layerIds: [this.activeLayerId] };
};

P.rangeLayers = function (r = this.frameRange()) {
  return this.layers.filter((l) => r.layerIds.includes(l.id) && l.type !== 'folder');
};

P.hasFrameRange = function () {
  const r = this.frameSel;
  return !!r && (r.to > r.from || r.layerIds.length > 1);
};

P.rangeOp = function (label, fn) {
  const r = this.frameRange();
  const cmds = [];
  for (const layer of this.rangeLayers(r)) {
    const res = fn(layer.frames, r);
    if (res) cmds.push(new C.SetLayerFrames(layer.id, layer.frames, res.frames, label, this.frame, res.frame ?? this.frame));
  }
  this.stop();
  this.run(new C.Compound(label, cmds));
};

P.copyFrames = function () {
  const r = this.frameRange();
  this.frameClipboard = this.rangeLayers(r).map((l) => TL.extractRange(l.frames, r.from, r.to));
  this.toast(`${r.to - r.from + 1} ${r.to > r.from ? 'quadros copiados' : 'quadro copiado'}${this.frameClipboard.length > 1 ? ` de ${this.frameClipboard.length} camadas` : ''}.`);
};

P.cutFrames = function () {
  this.copyFrames();
  this.removeFrameRange('Recortar quadros');
};

P.removeFrameRange = function (label = 'Remover quadros') {
  this.rangeOp(label, (fr, r) => TL.removeRange(fr, r.from, r.to));
  this.setFrameSelection(null);
};

/**
 * Cola os quadros copiados a partir do quadro atual (ou do começo do intervalo selecionado),
 * a partir da camada ativa (uma linha por camada). Por padrão substitui o que está lá, sem
 * empurrar o resto; insert: true abre espaço e empurra os quadros seguintes.
 * Os quadros colados ficam selecionados.
 */
P.pasteFrames = function (insert = false) {
  const rows = this.frameClipboard;
  if (!rows?.length) return this.toast('Copie quadros primeiro (Ctrl+Alt+C).');
  const sel = this.hasFrameRange() ? this.frameRange() : null;
  const at = sel ? sel.from : this.frame;
  const firstId = sel ? this.layers.find((l) => sel.layerIds.includes(l.id))?.id || this.activeLayerId : this.activeLayerId;
  const start = this.layerIndex(firstId);
  const targets = this.layers.slice(start).filter((l) => l.type !== 'folder' && l.type !== 'camera').slice(0, rows.length);
  if (targets.length < rows.length) this.toast(`Faltam camadas: ${rows.length - targets.length} linha(s) não coladas.`);
  const label = insert ? 'Colar inserindo quadros' : 'Colar quadros';
  const cmds = targets.map((layer, k) => {
    const r = TL.insertSpans(layer.frames, at, rows[k], { overwrite: !insert });
    return new C.SetLayerFrames(layer.id, layer.frames, r.frames, label, this.frame, at);
  });
  this.stop();
  this.run(new C.Compound(label, cmds));
  const n = TL.lengthOf(rows[0]);
  this.setFrameSelection({ from: at, to: at + n - 1, layerIds: targets.map((l) => l.id) });
};

P.reverseFrames = function () {
  const r = this.frameRange();
  if (r.to <= r.from) return this.toast('Selecione dois ou mais quadros na timeline (arraste sobre eles).');
  this.rangeOp('Inverter quadros', (fr) => TL.reverseRange(fr, r.from, r.to));
};

P.convertToKeyframes = function (blank = false) {
  this.rangeOp(blank ? 'Converter em keyframes vazios' : 'Converter em keyframes', (fr, r) => TL.convertRange(fr, r.from, r.to, blank));
};

/** F5/F6/F7/Shift+F5 com um intervalo selecionado valem para o intervalo inteiro. */
const baseTimelineOp = P.timelineOp;
P.timelineOp = function (name) {
  if (this.hasFrameRange()) {
    const r = this.frameRange();
    if (name === 'insertKeyframe') return this.convertToKeyframes(false);
    if (name === 'insertBlankKeyframe') return this.convertToKeyframes(true);
    if (name === 'removeFrame') return this.removeFrameRange();
    if (name === 'insertFrame') return this.rangeOp('Inserir quadros', (fr) => TL.insertFrames(fr, r.from, r.to - r.from + 1));
  }
  return baseTimelineOp.call(this, name);
};

// ---------- tween no intervalo selecionado ----------
// Com quadros selecionados na timeline, criar ou tirar tween vale para todos os trechos do
// intervalo (em todas as camadas da seleção), num passo só de desfazer.

/** Trechos que o intervalo pega: { layer, span, next } de cada camada da seleção. */
P.rangeSpans = function (r = this.frameRange()) {
  const out = [];
  for (const layer of this.rangeLayers(r)) {
    layer.frames.forEach((span, i) => {
      if (span.start <= r.to && span.start + span.duration > r.from) out.push({ layer, span, next: layer.frames[i + 1] || null });
    });
  }
  return out;
};

const TWEEN_LABEL = { classic: 'Criar tween clássico', motion: 'Criar motion tween', shape: 'Criar shape tween' };

/** Cria o tween em cada trecho do intervalo que pode ter (ou só no do quadro, sem intervalo). */
P.createTweenInRange = function (type) {
  const label = TWEEN_LABEL[type];
  const cmds = [];
  let skipped = 0;
  for (const { layer, span, next } of this.rangeSpans()) {
    if (span.tween) continue;
    const isCam = layer.type === 'camera';
    let tween = null;
    if (type === 'classic' && next && (span.elements.length || isCam)) tween = { ...DEFAULT_TWEEN };
    if (type === 'shape' && next && !isCam && span.elements.length && span.elements.every((e) => e.type === 'shape')) tween = { type: 'shape', ease: 0, hints: [] };
    if (type === 'motion' && !isCam && span.elements.length === 1 && span.duration > 1) tween = { type: 'motion', props: {}, ease: 0, orient: false };
    if (!tween) {
      skipped++;
      continue;
    }
    cmds.push(new C.SetSpanProps(layer.id, span.start, { tween: undefined }, { tween }, label));
  }
  if (cmds.length) this.run(new C.Compound(label, cmds));
  if (!cmds.length) this.toast('Nenhum trecho do intervalo pode ter esse tween: falta keyframe de destino ou conteúdo.');
  else if (skipped) this.toast(`Tween criado em ${cmds.length} ${cmds.length === 1 ? 'trecho' : 'trechos'}; ${skipped} ficaram sem (sem destino ou sem conteúdo).`);
};

P.removeTweenInRange = function () {
  const cmds = this.rangeSpans()
    .filter((x) => x.span.tween)
    .map(({ layer, span }) => new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween: undefined }, 'Remover tween'));
  if (cmds.length) this.run(new C.Compound('Remover tween', cmds));
};

const baseClassic = P.createClassicTween;
P.createClassicTween = function () {
  if (this.hasFrameRange()) return this.createTweenInRange('classic');
  return baseClassic.call(this);
};
const baseShape = P.createShapeTween;
P.createShapeTween = function () {
  if (this.hasFrameRange()) return this.createTweenInRange('shape');
  return baseShape.call(this);
};
const baseMotion = P.createMotionTween;
P.createMotionTween = function () {
  if (this.hasFrameRange()) return this.createTweenInRange('motion');
  return baseMotion.call(this);
};
const baseRemove = P.removeTween;
P.removeTween = function () {
  if (this.hasFrameRange()) return this.removeTweenInRange();
  return baseRemove.call(this);
};

/** Ctrl+T: liga o tween clássico onde não tem; se tudo já tem, tira. */
P.toggleClassicTween = function () {
  const spans = this.rangeSpans();
  if (spans.length && spans.every((x) => x.span.tween || !x.next)) {
    if (spans.some((x) => x.span.tween)) return this.removeTween();
  }
  return this.createClassicTween();
};

// ---------- arrastar na timeline ----------

/** Arrasta o keyframe que começa em `start` (camada `layerId`) para `to`. */
P.moveKeyframeTo = function (layerId, start, to) {
  const layer = this.layer(layerId);
  if (!layer) return;
  const r = TL.moveKeyframe(layer.frames, start, to);
  if (!r) return;
  this.stop();
  this.run(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Mover keyframe', this.frame, r.frame));
};

/** Arrasta o intervalo selecionado `delta` quadros (copy: Alt, deixa os originais). */
P.moveFrameRange = function (delta, copy = false) {
  const r = this.frameRange();
  const label = copy ? 'Copiar quadros arrastando' : 'Mover quadros';
  const cmds = [];
  let dest = r.from;
  for (const layer of this.rangeLayers(r)) {
    const res = TL.moveRange(layer.frames, r.from, r.to, delta, { copy });
    if (!res) continue;
    dest = res.frame;
    cmds.push(new C.SetLayerFrames(layer.id, layer.frames, res.frames, label, this.frame, res.frame));
  }
  if (!cmds.length) return;
  this.stop();
  this.run(new C.Compound(label, cmds));
  this.setFrameSelection({ from: dest, to: dest + (r.to - r.from), layerIds: r.layerIds });
};

// ---------- faixa de reprodução ----------
// Só no editor (não vai para o arquivo): reproduzir e repetir apenas um trecho, como um ciclo.

P.setPlayRange = function (range) {
  if (range) {
    const from = Math.max(0, Math.min(range.from, range.to));
    const to = Math.max(from, Math.max(range.from, range.to));
    this.playRange = { from, to };
  } else this.playRange = null;
  this.emit('options');
};

/** Faixa usada para tocar: a escolhida (cortada no fim da cena) ou a cena toda. */
P.playBounds = function () {
  const len = this.length;
  const r = this.playRange;
  if (!r || r.from >= len) return { from: 0, to: len - 1 };
  return { from: r.from, to: Math.min(r.to, len - 1) };
};

// ---------- distribuir ----------

P.distributeToKeyframes = function () {
  const items = this.selectedItems().filter((it) => !it.motion && !it.multi);
  if (items.length < 2) return this.toast('Selecione dois ou mais objetos de uma camada.');
  this.group('Distribuir para keyframes', () => {
    this.materialize();
    const sel = this.selectedItems().filter((it) => !it.motion && !it.multi);
    const layer = sel[0].layer;
    const span = sel[0].span;
    const mine = sel.filter((it) => it.layer === layer && it.span === span);
    const ids = new Set(mine.map((it) => it.el.id));
    const fr = clone(layer.frames);
    const i = layer.frames.indexOf(span);
    const s = fr[i];
    const rest = s.elements.filter((el) => !ids.has(el.id));
    const moved = s.elements.filter((el) => ids.has(el.id));
    const first = rest.length ? rest : [moved.shift()];
    const total = s.duration;
    s.elements = first;
    s.duration = 1;
    delete s.tween;
    const spans = moved.map((el) => ({ start: 0, duration: 1, elements: [el] }));
    if (spans.length) spans[spans.length - 1].duration = Math.max(1, total - spans.length);
    else s.duration = total;
    fr.splice(i + 1, 0, ...spans);
    TL.normalize(fr);
    this.run(new C.SetLayerFrames(layer.id, layer.frames, fr, 'Distribuir para keyframes'));
    this.setSelection([]);
  });
};

P.distributeToLayers = function () {
  const items = this.selectedItems().filter((it) => !it.motion && !it.multi);
  if (!items.length) return this.toast('Selecione os objetos para mandar cada um para uma camada.');
  this.group('Distribuir para camadas', () => {
    this.materialize();
    const sel = this.selectedItems().filter((it) => !it.motion && !it.multi);
    const layers = clone(this.layers);
    const names = layers.map((l) => l.name);
    // de cima para baixo, cada objeto vira uma camada logo abaixo da sua camada de origem
    for (const it of [...sel].reverse()) {
      const src = layers.find((l) => l.id === it.layer.id);
      const sp = src.frames.find((s) => s.start === it.span.start);
      const idx = sp.elements.findIndex((e) => e.id === it.el.id);
      if (idx < 0) continue;
      const [el] = sp.elements.splice(idx, 1);
      const base = el.type === 'instance' ? symbolById(this.doc, el.symbolId)?.name || 'Símbolo' : 'Forma';
      const name = uniqueName(names, base);
      names.push(name);
      const nl = createLayer(name, layers.length, 1);
      nl.frames = [];
      if (sp.start > 0) nl.frames.push({ start: 0, duration: sp.start, elements: [] });
      nl.frames.push({ start: sp.start, duration: sp.duration, elements: [el] });
      if (src.folderId) nl.folderId = src.folderId;
      TL.normalize(nl.frames);
      layers.splice(layers.indexOf(src) + 1, 0, nl);
    }
    this.replaceLayers(layers, 'Distribuir para camadas');
  });
};

// ---------- editar vários quadros ----------
P.setMulti = function (patch) {
  Object.assign(this.multi, patch);
  this.pruneSelection();
  this.emit('options');
};

// ---------- presets de movimento ----------
P.applyMotionPreset = function (preset) {
  const items = this.selectedItems().filter((it) => !it.multi);
  if (items.length !== 1) return this.toast('Selecione um objeto para aplicar o preset.');
  const it0 = items[0];
  const layer = it0.layer;
  const others = (layerFrame(layer, this.frame, this.timeline)?.items.length || 0) > 1;
  if (others) return this.toast('O objeto precisa estar sozinho na camada. Use Distribuir para camadas antes.');
  const frames = Math.max(2, Math.round(preset.seconds * this.doc.fps));
  this.group(`Preset: ${preset.name}`, () => {
    // keyframe no quadro atual com a pose de agora
    let span = this.spanAt(layer);
    if (span.start !== this.frame || span.tween?.type === 'motion') {
      if (span.start !== this.frame) {
        const r = TL.insertKeyframe(layer.frames, this.frame);
        if (r) this.run(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Keyframe'));
      }
      span = this.spanAt(layer);
    }
    if (span.duration < frames) {
      const r = TL.insertFrames(layer.frames, span.start, frames - span.duration);
      this.run(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Inserir quadros'));
      span = this.spanAt(layer);
    }
    const el = span.elements[0];
    const base = matrixToProps(el.matrix);
    base.alpha = el.color?.mode === 'alpha' ? el.color.alpha ?? 100 : 100;
    const tween = { type: 'motion', props: presetKeys(preset, base, frames), ease: 0, easeType: preset.easeType || 'linear', orient: false };
    this.run(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween }, `Preset: ${preset.name}`));
  });
};

P.presetFromCurrent = function (name) {
  const span = this.currentSpan();
  if (span?.tween?.type !== 'motion') {
    this.toast('Fique num motion tween para salvar o preset.');
    return null;
  }
  return presetFromTween(name, span, this.doc.fps, motionPropsAt);
};
