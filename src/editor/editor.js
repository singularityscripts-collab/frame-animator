// Estado do editor e operações de alto nível. A interface só chama métodos daqui.

import {
  createDocument,
  createLayer,
  createSymbol,
  createInstance,
  clone,
  cloneElementsWithNewIds,
  uid,
  uniqueName,
  symbolContains,
  symbolUsage,
  allTimelines,
} from '../model/document.js';
import * as TL from '../model/timeline.js';
import { elementLocalBounds, localBoxCorners, pointsBounds, unionBounds, pathBounds, fitGradient } from '../model/geometry.js';
import { matrixToProps, motionPropsAt, setKey } from '../player/tween.js';
import * as V from '../model/vector-ops.js';
import {
  getSpanAt,
  timelineLength,
  layerFrame,
  symbolById,
  instanceFrame,
  multiply,
  translation,
  scaling,
  rotation,
  IDENTITY,
  isGradient,
  invert,
  layerMatrices,
  cameraAt,
  cameraMatrix,
} from '../player/render.js';
import { Player } from '../player/player.js';
import { History } from './history.js';
import * as C from './commands.js';

export const DEFAULT_TWEEN = { type: 'classic', ease: 0, rotate: 'auto', rotations: 0 };

export const DEFAULT_SWATCHES = [
  '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff',
  '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#4f9dff', '#1d1d21',
  { type: 'linear', stops: [{ offset: 0, color: '#ffffff', alpha: 1 }, { offset: 1, color: '#000000', alpha: 1 }] },
  { type: 'radial', stops: [{ offset: 0, color: '#ffffff', alpha: 1 }, { offset: 1, color: '#000000', alpha: 1 }] },
  { type: 'linear', stops: [{ offset: 0, color: '#ff3b30', alpha: 1 }, { offset: 0.5, color: '#ffcc00', alpha: 1 }, { offset: 1, color: '#34c759', alpha: 1 }] },
  { type: 'radial', stops: [{ offset: 0, color: '#ffffff', alpha: 1 }, { offset: 1, color: '#007aff', alpha: 0 }] },
];

/** Aplica um preenchimento a uma forma. Gradiente novo encaixa na forma; trocar só as cores mantém a posição. */
export function applyFill(el, fill) {
  if (!el.path.closed || !fill) return null;
  if (!isGradient(fill)) return fill;
  if (isGradient(el.fill) && el.fill.type === fill.type) return { ...structuredClone(fill), matrix: el.fill.matrix, focal: el.fill.focal };
  return fitGradient(fill, pathBounds(el.path));
}

export class Editor {
  constructor() {
    this.listeners = new Map();
    this.history = new History();
    this.tool = 'select';
    this.style = { fill: '#4f9dff', stroke: '#1d1d21', strokeWidth: 2, fillOn: true, strokeOn: true };
    this.onion = { enabled: false, before: 2, after: 2, outline: false, beforeColor: '#3b82f6', afterColor: '#22c55e' };
    this.loop = true;
    this.toolOptions = {
      brush: { size: 14, pressure: true, smoothing: 40 },
      eraser: { size: 24, mode: 'normal' },
      bucket: { gap: 'small' },
    };
    this.multi = { enabled: false, before: 2, after: 2 };
    this.frameSel = null; // intervalo selecionado na timeline: { from, to, layerIds }
    this.frameClipboard = null;
    this.clipboard = null;
    this.pasteCount = 0;
    this.player = new Player({
      getLength: () => this.length,
      getFps: () => this.doc.fps,
      getLoop: () => this.loop,
      onFrame: (f) => {
        this.frame = f;
        this.emit('frame');
      },
      onStop: () => this.emit('playing'),
      onLoop: () => this.emit('loop'),
    });
    this.load(createDocument(), null);
  }

  // ---------- eventos ----------
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  emit(type, detail) {
    for (const fn of this.listeners.get(type) || []) fn(detail);
    if (type !== '*') for (const fn of this.listeners.get('*') || []) fn(type, detail);
  }
  toast(msg) {
    this.emit('toast', msg);
  }

  // ---------- documento ----------
  load(doc, filePath) {
    this.player.stop();
    this.doc = doc;
    this.sceneIndex = 0;
    this.editStack = [];
    this.frame = 0;
    this.activeLayerId = (this.scene.layers.find((l) => l.type !== 'camera' && l.type !== 'folder') || this.scene.layers[0]).id;
    this.selection = new Set();
    this.frameSel = null;
    this.history.clear();
    this.filePath = filePath;
    this.emit('load');
    this.emit('context');
    this.emit('doc');
    this.emit('file');
  }

  get scene() {
    return this.doc.scenes[this.sceneIndex];
  }
  /** Timeline sendo editada: a cena ou o símbolo aberto. */
  get timeline() {
    const top = this.editStack[this.editStack.length - 1];
    return (top && symbolById(this.doc, top.symbolId)) || this.scene;
  }
  get editingSymbol() {
    return this.editStack.length ? this.timeline : null;
  }
  /**
   * Matriz do espaço da timeline editada para a tela da cena: na cena, a câmera (se houver);
   * dentro de um símbolo editado no lugar, a transformação da instância.
   */
  get contextMatrix() {
    const top = this.editStack[this.editStack.length - 1];
    if (top) return top.matrix;
    return this.sceneCameraMatrix();
  }
  sceneCameraMatrix(frame = this.frame) {
    const cam = cameraAt(this.doc, this.scene, frame);
    return cam ? cameraMatrix(this.doc, cam, 0) : IDENTITY;
  }
  /** Matriz de cada camada da timeline editada, relativa à câmera base (parentesco e profundidade). */
  layerMatrixMap() {
    const inScene = !this.editStack.length;
    const lms = layerMatrices(this.doc, this.timeline, this.frame, { camera: inScene });
    const c0 = inScene && lms.camera ? cameraMatrix(this.doc, lms.camera, 0) : IDENTITY;
    const c0inv = invert(c0) || IDENTITY;
    const out = new Map();
    for (const [id, m] of lms) out.set(id, multiply(c0inv, m));
    return out;
  }
  layerMatrixOf(layer) {
    return this.layerMatrixMap().get(layer.id) || IDENTITY;
  }
  get layers() {
    return this.timeline.layers;
  }
  get length() {
    return timelineLength(this.timeline);
  }
  get dirty() {
    return this.history.dirty;
  }
  get fileName() {
    if (!this.filePath) return 'Sem título';
    return this.filePath.split(/[\\/]/).pop().replace(/\.fanim$/i, '');
  }
  layer(id) {
    return this.layers.find((l) => l.id === id);
  }
  layerIndex(id) {
    return this.layers.findIndex((l) => l.id === id);
  }
  get activeLayer() {
    return this.layer(this.activeLayerId) || this.layers[0];
  }
  spanAt(layer, frame = this.frame) {
    return getSpanAt(layer, frame);
  }
  isEditable(layer) {
    if (layer.type === 'folder' || layer.type === 'camera') return false;
    for (let l = layer, guard = 0; l && guard < 64; guard++) {
      if (!l.visible || l.locked) return false;
      l = l.folderId ? this.layer(l.folderId) : null;
    }
    return true;
  }
  symbol(id) {
    return symbolById(this.doc, id);
  }

  // ---------- histórico ----------
  run(cmd) {
    if (!cmd || (cmd.cmds && !cmd.cmds.length)) return;
    this.history.execute(cmd, this);
    this.afterChange();
  }
  /** Registra um comando já aplicado ao documento (edição ao vivo no palco). */
  commit(cmd) {
    if (!cmd || (cmd.cmds && !cmd.cmds.length)) return;
    this.history.push(cmd);
    this.afterChange();
  }
  /** Tudo que fn executar vira um passo só de desfazer. */
  group(label, fn) {
    const before = this.history.undoStack.length;
    const r = fn();
    const n = this.history.undoStack.length - before;
    if (n > 1) this.history.squash(n, label);
    return r;
  }
  undo() {
    this.player.stop();
    const c = this.history.undo(this);
    if (c) {
      this.afterChange();
      this.toast(`Desfeito: ${c.label}`);
    }
  }
  redo() {
    this.player.stop();
    const c = this.history.redo(this);
    if (c) {
      this.afterChange();
      this.toast(`Refeito: ${c.label}`);
    }
  }
  afterChange() {
    this.validateStack();
    if (this.sceneIndex >= this.doc.scenes.length) this.sceneIndex = this.doc.scenes.length - 1;
    if (!this.layer(this.activeLayerId)) this.activeLayerId = this.layers[0].id;
    this.pruneSelection();
    this.emit('scenes');
    this.emit('doc');
    this.emit('frame');
    this.emit('selection');
    this.emit('library');
  }

  // ---------- quadro e reprodução ----------
  setFrame(f) {
    f = Math.max(0, Math.min(99999, Math.round(f)));
    if (f === this.frame) return;
    this.frame = f;
    this.pruneSelection();
    this.emit('frame');
  }
  togglePlay() {
    if (this.player.playing) this.player.stop();
    else this.player.play(this.frame);
    this.emit('playing');
  }
  stop() {
    this.player.stop();
  }
  nextFrame() {
    this.stop();
    this.setFrame(this.frame + 1 >= this.length && this.loop ? 0 : this.frame + 1);
  }
  prevFrame() {
    this.stop();
    this.setFrame(this.frame === 0 && this.loop ? this.length - 1 : this.frame - 1);
  }
  firstFrame() {
    this.stop();
    this.setFrame(0);
  }
  lastFrame() {
    this.stop();
    this.setFrame(this.length - 1);
  }
  setLoop(v) {
    this.loop = v;
    this.emit('options');
  }
  setOnion(patch) {
    Object.assign(this.onion, patch);
    this.emit('options');
  }

  // ---------- ferramentas e estilo ----------
  setTool(t) {
    this.tool = t;
    this.emit('tool');
  }
  setStyle(patch, { applyToSelection = true } = {}) {
    Object.assign(this.style, patch);
    this.emit('style');
    if (applyToSelection && this.selectedItems().some((it) => it.el.type === 'shape')) {
      const s = this.style;
      this.updateSelection('Cor e traço', (el) => {
        if (el.type !== 'shape') return;
        if ('fill' in patch || 'fillOn' in patch) el.fill = s.fillOn ? applyFill(el, s.fill) : null;
        if ('stroke' in patch || 'strokeOn' in patch) el.stroke = s.strokeOn ? s.stroke : null;
        if ('strokeWidth' in patch) {
          el.strokeWidth = s.strokeWidth;
          if (!el.stroke && s.strokeOn) el.stroke = s.stroke;
        }
      });
    }
  }

  setToolOptions(tool, patch) {
    Object.assign(this.toolOptions[tool], patch);
    this.emit('toolOptions');
  }

  // ---------- seleção ----------
  /**
   * Elementos do quadro atual, de baixo para cima, já com tween calculado:
   * [{ layer, span, el, index, offset, mcTime, tweened }]
   */
  frameItems({ editableOnly = true, multi = true } = {}) {
    const out = [];
    const tl = this.timeline;
    const lms = this.layerMatrixMap();
    const range = multi && this.multi.enabled ? [this.frame - this.multi.before, this.frame + this.multi.after] : null;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (layer.type === 'folder' || layer.type === 'camera') continue;
      if (editableOnly && !this.isEditable(layer)) continue;
      const lm = lms.get(layer.id) || IDENTITY;
      const lf = layerFrame(layer, this.frame, tl);
      if (range) {
        // editar vários quadros: os outros keyframes do intervalo também ficam selecionáveis
        for (const sp of layer.frames) {
          if (sp === lf?.span || sp.start < range[0] || sp.start > range[1]) continue;
          sp.elements.forEach((el, index) =>
            out.push({ layer, span: sp, el, index, offset: 0, mcTime: 0, tweened: false, multi: true, lm, wm: multiply(lm, el.matrix) }),
          );
        }
      }
      if (!lf) continue;
      for (const it of lf.items) {
        out.push({
          layer,
          span: lf.span,
          el: it.el,
          index: it.index,
          offset: lf.offset,
          mcTime: it.mcTime,
          tweened: lf.tweened,
          motion: lf.motion && it.index === 0,
          lm,
          wm: multiply(lm, it.el.matrix),
        });
      }
    }
    return out;
  }

  /** Aplica uma transformação W (no espaço da tela da timeline) a um elemento que mora numa camada com matriz lm. */
  applyWorld(it, el, W) {
    const lm = it.lm || IDENTITY;
    el.matrix = multiply(invert(lm) || IDENTITY, multiply(W, multiply(lm, el.matrix)));
  }

  /** Tween de movimento com as propriedades mudadas no quadro t (cria keys só no que mudou). */
  motionTweenWithMatrix(span, t, m) {
    const tw = clone(span.tween);
    tw.props ||= {};
    const old = motionPropsAt(span, t);
    const at0 = motionPropsAt(span, 0);
    const nw = matrixToProps(m);
    for (const name of ['x', 'y', 'rotation', 'skew', 'scaleX', 'scaleY']) {
      let v = nw[name];
      if (name === 'rotation' || name === 'skew') v = old[name] + ((((v - old[name] + 180) % 360) + 360) % 360) - 180;
      if (Math.abs(v - old[name]) < 1e-6) continue;
      let keys = tw.props[name] || [];
      if (!keys.length && t !== 0) keys = [{ t: 0, v: at0[name] }];
      tw.props[name] = setKey(keys, t, v);
    }
    return tw;
  }

  // ---------- edição ao vivo (arrastar no palco) ----------
  beginLiveEdit(items = this.selectedItems()) {
    const els = new Map();
    const tweens = new Map();
    for (const it of items) {
      if (it.motion) tweens.set(`${it.layer.id}:${it.span.start}`, { layerId: it.layer.id, span: it.span, tween: clone(it.span.tween) });
      else els.set(it.el.id, clone(it.el));
    }
    return { els, tweens };
  }
  /** Muda a matriz (no espaço da camada) ao vivo; no motion tween, mexe nas keys do quadro. */
  setLiveMatrix(it, local) {
    if (it.motion) it.span.tween = this.motionTweenWithMatrix({ ...it.span, tween: it.span.tween }, it.offset, local);
    else it.el.matrix = local;
  }
  endLiveEdit(label, snap) {
    const now = this.frameItems().filter((it) => !it.motion && snap.els.has(it.el.id));
    const cmds = this.groupSelected(now).map(
      (g) => new C.UpdateElements(g.layer.id, g.span.start, g.items.map((it) => snap.els.get(it.el.id)), g.items.map((it) => it.el)),
    );
    for (const v of snap.tweens.values()) cmds.push(new C.SetSpanProps(v.layerId, v.span.start, { tween: v.tween }, { tween: v.span.tween }));
    this.commit(new C.Compound(label, cmds));
  }
  cancelLiveEdit(snap) {
    for (const it of this.frameItems()) {
      const b = snap.els.get(it.el.id);
      if (b && !it.motion) Object.assign(it.el, clone(b));
    }
    for (const v of snap.tweens.values()) v.span.tween = clone(v.tween);
    this.emit('selection');
  }
  selectedItems() {
    return this.frameItems().filter((it) => this.selection.has(it.el.id));
  }
  pruneSelection() {
    if (!this.selection.size) return;
    const alive = new Set(this.frameItems().map((it) => it.el.id));
    let changed = false;
    for (const id of this.selection) {
      if (!alive.has(id)) {
        this.selection.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('selection');
  }
  setSelection(ids) {
    this.selection = new Set(ids);
    this.emit('selection');
  }
  selectAll() {
    this.setSelection(this.frameItems().map((it) => it.el.id));
  }
  deselect() {
    this.setSelection([]);
  }
  boundsOf(it) {
    const b = elementLocalBounds(it.el, this.doc, it.offset, it.mcTime);
    return pointsBounds(localBoxCorners(it.wm || it.el.matrix, b));
  }
  selectionBounds() {
    const items = this.selectedItems();
    if (!items.length) return null;
    return unionBounds(items.map((it) => this.boundsOf(it)));
  }

  /**
   * Num quadro do meio de um tween, os elementos mostrados são calculados.
   * Antes de editar, cria um keyframe ali com a pose atual (como F6) e reaponta a seleção.
   * Retorna true se criou keyframe.
   */
  materialize() {
    const items = this.selectedItems().filter((it) => it.tweened);
    if (!items.length) return false;
    const spans = this.keyframeHere([...new Set(items.map((it) => it.layer))]);
    if (!spans) return false;
    const newIds = items.map((it) => spans.get(it.layer.id)?.elements[it.index]?.id).filter(Boolean);
    const keep = [...this.selection].filter((id) => !items.some((it) => it.el.id === id));
    this.selection = new Set([...keep, ...newIds]);
    this.afterChange();
    return true;
  }

  /**
   * Cria keyframe no quadro atual nas camadas dadas, quando o quadro está no meio de um tween
   * (o keyframe recebe a pose interpolada). Devolve Map(layerId → keyframe novo) ou null.
   */
  keyframeHere(layers) {
    const cmds = [];
    const spans = new Map();
    for (const layer of layers) {
      const lf = layerFrame(layer, this.frame, this.timeline);
      if (!lf?.tweened) continue;
      const r = TL.insertKeyframe(layer.frames, this.frame);
      if (!r) continue;
      cmds.push(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Novo keyframe', this.frame, this.frame));
    }
    if (!cmds.length) return null;
    this.history.execute(new C.Compound('Novo keyframe', cmds), this);
    for (const layer of layers) {
      const span = this.spanAt(layer);
      if (span?.start === this.frame) spans.set(layer.id, span);
    }
    return spans;
  }

  /** Aplica mutate(el) a uma lista de itens do quadro (não precisa estar selecionado). */
  updateItems(items, label, mutate) {
    this.group(label, () => {
      if (items.some((it) => it.tweened)) {
        const ids = items.map((it) => ({ layer: it.layer.id, index: it.index }));
        this.keyframeHere([...new Set(items.map((it) => it.layer))]);
        const now = this.frameItems();
        items = ids.map((k) => now.find((it) => it.layer.id === k.layer && it.index === k.index)).filter(Boolean);
      }
      const cmds = this.groupSelected(items.filter((it) => !it.motion)).map((g) => {
        const before = g.items.map((it) => clone(it.el));
        const after = before.map((el, k) => {
          const c = clone(el);
          mutate(c, g.items[k]);
          return c;
        });
        return new C.UpdateElements(g.layer.id, g.span.start, before, after);
      });
      // motion tween: a matriz vira keys no quadro; o resto vai para o elemento base
      for (const it of items.filter((x) => x.motion)) {
        const base = it.span.elements[0];
        const c = clone(it.el);
        mutate(c, it);
        cmds.push(new C.SetSpanProps(it.layer.id, it.span.start, { tween: it.span.tween }, { tween: this.motionTweenWithMatrix(it.span, it.offset, c.matrix) }));
        const { matrix, color, ...rest } = c;
        const after = { ...clone(base), ...rest, matrix: base.matrix };
        if (!it.span.tween.props?.alpha?.length) after.color = color;
        cmds.push(new C.UpdateElements(it.layer.id, it.span.start, [base], [after]));
      }
      this.run(new C.Compound(label, cmds));
    });
  }

  /** Troca os elementos de keyframes inteiros: changes = Map(layer → elementos novos). */
  replaceSpans(changes, label) {
    const cmds = [];
    for (const [layer, after] of changes) {
      const span = this.spanAt(layer);
      if (span) cmds.push(new C.SetSpanElements(layer.id, span.start, span.elements, after, label));
    }
    this.run(new C.Compound(label, cmds));
  }

  // ---------- desenho: borracha, booleanos, balde ----------
  /**
   * Apaga a região (item do Paper no espaço da timeline) das formas editáveis do quadro.
   * mode: 'normal' | 'fills' | 'lines'. Devolve quantas formas mudaram.
   */
  eraseRegion(region, mode = 'normal') {
    const compute = () => {
      const res = [];
      for (const it of this.frameItems()) {
        if (it.el.type !== 'shape' || it.motion || it.multi) continue;
        const out = V.eraseShape({ ...it.el, matrix: it.wm }, region, mode);
        const inv = invert(it.lm) || IDENTITY;
        if (out) res.push({ it, out: out.map((el) => ({ ...el, matrix: multiply(inv, el.matrix) })) });
      }
      return res;
    };
    let count = 0;
    this.group('Borracha', () => {
      let res = compute();
      if (!res.length) return;
      if (res.some((r) => r.it.tweened)) {
        this.keyframeHere([...new Set(res.filter((r) => r.it.tweened).map((r) => r.it.layer))]);
        res = compute();
      }
      const changes = new Map();
      for (const { it, out } of res) {
        if (!changes.has(it.layer)) changes.set(it.layer, it.span.elements.map((el) => [el]));
        changes.get(it.layer)[it.index] = out;
      }
      for (const [layer, parts] of changes) changes.set(layer, parts.flat());
      count = res.length;
      this.replaceSpans(changes, 'Borracha');
    });
    return count;
  }

  /** Booleanos entre formas selecionadas: 'union' | 'intersect' | 'punch' | 'crop'. */
  combineSelection(kind) {
    const labels = { union: 'Unir', intersect: 'Interseção', punch: 'Perfurar', crop: 'Recortar' };
    const items = this.selectedItems();
    const shapes = items.filter((it) => it.el.type === 'shape' && it.el.path.closed);
    if (shapes.length < 2) return this.toast('Selecione pelo menos duas formas fechadas (instâncias e linhas não entram).');
    if (shapes.length < items.length) this.toast('Instâncias e linhas abertas ficaram de fora.');
    this.group(labels[kind], () => {
      this.materialize();
      const sel = this.selectedItems().filter((it) => it.el.type === 'shape' && it.el.path.closed && !it.motion);
      const res = V.combine(kind, sel.map((it) => ({ ...it.el, matrix: it.wm })));
      const local = (el, it) => el && { ...el, matrix: multiply(invert(it.lm) || IDENTITY, el.matrix) };
      const top = sel[sel.length - 1];
      const replace = new Map([...res.replace].map(([id, el]) => [id, local(el, sel.find((it) => it.el.id === id))]));
      const add = local(res.add, top);
      const changes = new Map();
      for (const it of sel) {
        if (!changes.has(it.layer)) changes.set(it.layer, [...it.span.elements]);
        const list = changes.get(it.layer);
        const i = list.findIndex((e) => e?.id === it.el.id);
        list[i] = replace.has(it.el.id) ? replace.get(it.el.id) : it.el;
        if (add && it === top) list.splice(i + 1, 0, add);
      }
      for (const [layer, list] of changes) changes.set(layer, list.filter(Boolean));
      this.replaceSpans(changes, labels[kind]);
      const ids = add ? [add.id] : [...replace.entries()].filter(([, v]) => v).map(([, v]) => v.id);
      this.setSelection(ids);
    });
  }

  // ---------- amostras ----------
  get swatches() {
    return this.doc.swatches || DEFAULT_SWATCHES;
  }
  addSwatch(fill) {
    if (!fill) return;
    const clean = isGradient(fill) ? { type: fill.type, stops: structuredClone(fill.stops) } : fill;
    this.setDocProps({ swatches: [...this.swatches, clean] });
  }
  removeSwatch(index) {
    this.setDocProps({ swatches: this.swatches.filter((_, i) => i !== index) });
  }

  // ---------- edição de elementos ----------
  /** Garante que a camada ativa aceita desenho no quadro atual. Retorna o comando de timeline (ou null). */
  prepareDrawing() {
    const layer = this.activeLayer;
    if (layer.type === 'folder' || layer.type === 'camera') {
      this.toast(layer.type === 'folder' ? 'Pastas não têm desenho. Escolha uma camada.' : 'A camada da câmera não tem desenho.');
      return false;
    }
    if (!this.isEditable(layer)) {
      this.toast(layer.locked || !layer.visible ? (layer.locked ? 'A camada ativa está travada.' : 'A camada ativa está oculta.') : 'A pasta da camada está oculta ou travada.');
      return false;
    }
    if (!layer.visible) {
      this.toast('A camada ativa está oculta.');
      return false;
    }
    if (layer.locked) {
      this.toast('A camada ativa está travada.');
      return false;
    }
    const r = TL.ensureDrawable(layer.frames, this.frame);
    return r ? new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Novo keyframe', this.frame, this.frame) : null;
  }

  /** Não deixa colocar um símbolo dentro dele mesmo. */
  filterRecursive(elements) {
    const host = this.editingSymbol;
    if (!host) return elements;
    const ok = elements.filter((el) => el.type !== 'instance' || !symbolContains(this.doc, el.symbolId, host.id));
    if (ok.length < elements.length) this.toast('Um símbolo não pode ficar dentro dele mesmo.');
    return ok;
  }

  /** index: posição dentro do keyframe (null = por cima; 0 = por baixo, como o balde faz). */
  addElements(elements, label = 'Desenhar', index = null, { space = 'world' } = {}) {
    elements = this.filterRecursive(elements);
    if (!elements.length) return false;
    const pre = this.prepareDrawing();
    if (pre === false) return false;
    const layer = this.activeLayer;
    if (space === 'world') {
      // o desenho vem nas coordenadas da tela da timeline; a camada pode ter pai ou profundidade
      const inv = invert(this.layerMatrixOf(layer)) || IDENTITY;
      if (inv.some((v, i) => v !== IDENTITY[i])) elements = elements.map((el) => ({ ...el, matrix: multiply(inv, el.matrix) }));
    }
    const start = pre ? this.frame : this.spanAt(layer).start;
    this.run(new C.Compound(label, [pre, new C.AddElements(layer.id, start, elements, label, index)]));
    return true;
  }

  /** Aplica mutate(el) numa cópia de cada elemento selecionado e registra o comando. */
  updateSelection(label, mutate) {
    this.group(label, () => {
      this.materialize();
      this.updateItems(this.selectedItems(), label, mutate);
    });
  }

  /** Fecha uma edição feita ao vivo: before = Map(id → clone do elemento antes). */
  commitLiveEdit(label, before) {
    this.endLiveEdit(label, { els: before, tweens: new Map() });
  }

  groupSelected(items = this.selectedItems()) {
    const map = new Map();
    for (const it of items) {
      const key = `${it.layer.id}:${it.span.start}`;
      if (!map.has(key)) map.set(key, { layer: it.layer, span: it.span, items: [] });
      map.get(key).items.push(it);
    }
    return [...map.values()];
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.group('Apagar', () => {
      this.materialize();
      const cmds = this.groupSelected().map(
        (g) => new C.RemoveElements(g.layer.id, g.span.start, g.items.map((it) => ({ el: it.el, index: it.index }))),
      );
      this.run(new C.Compound('Apagar', cmds));
    });
  }

  copy() {
    const items = this.selectedItems();
    if (!items.length) return false;
    this.clipboard = items.map((it) => clone(it.el));
    this.pasteCount = 0;
    return true;
  }
  cut() {
    if (this.copy()) this.deleteSelection();
  }
  paste(inPlace = false) {
    if (!this.clipboard?.length) return;
    const offset = inPlace ? 0 : 10 * ++this.pasteCount;
    const els = cloneElementsWithNewIds(this.clipboard)
      .filter((el) => el.type !== 'instance' || this.symbol(el.symbolId))
      .map((el) => {
        el.matrix = multiply(translation(offset, offset), el.matrix);
        return el;
      });
    if (this.addElements(els, 'Colar', null, { space: 'local' })) this.setSelection(els.map((e) => e.id));
  }
  duplicate() {
    if (!this.selection.size) return;
    this.group('Duplicar', () => {
      this.materialize();
      const newIds = [];
      const cmds = this.groupSelected().map((g) => {
        const els = cloneElementsWithNewIds(g.items.map((it) => it.el)).map((el) => {
          el.matrix = multiply(translation(10, 10), el.matrix);
          newIds.push(el.id);
          return el;
        });
        return new C.AddElements(g.layer.id, g.span.start, els);
      });
      this.run(new C.Compound('Duplicar', cmds));
      this.setSelection(newIds);
    });
  }

  nudge(dx, dy) {
    if (!this.selection.size) return;
    this.updateSelection('Mover', (el, it) => this.applyWorld(it, el, translation(dx, dy)));
  }

  /** dir: 'front' | 'forward' | 'backward' | 'back' */
  arrange(dir) {
    if (!this.selection.size) return;
    this.group('Organizar', () => {
      this.materialize();
      const cmds = [];
      for (const g of this.groupSelected()) {
        const ids = g.span.elements.map((e) => e.id);
        const sel = new Set(g.items.map((it) => it.el.id));
        let order = ids.slice();
        if (dir === 'front') order = [...ids.filter((i) => !sel.has(i)), ...ids.filter((i) => sel.has(i))];
        else if (dir === 'back') order = [...ids.filter((i) => sel.has(i)), ...ids.filter((i) => !sel.has(i))];
        else if (dir === 'forward') {
          for (let i = order.length - 2; i >= 0; i--) {
            if (sel.has(order[i]) && !sel.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
          }
        } else if (dir === 'backward') {
          for (let i = 1; i < order.length; i++) {
            if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
          }
        }
        if (order.join() !== ids.join()) cmds.push(new C.ReorderElements(g.layer.id, g.span.start, ids, order));
      }
      this.run(new C.Compound('Organizar', cmds));
    });
  }

  /** Muda posição/tamanho da seleção pelo painel de propriedades (caixa no mundo). */
  setSelectionBounds(target) {
    const b = this.selectionBounds();
    if (!b) return;
    const sx = b.w > 0.0001 && target.w != null ? Math.max(0.01, target.w) / b.w : 1;
    const sy = b.h > 0.0001 && target.h != null ? Math.max(0.01, target.h) / b.h : 1;
    const nx = target.x ?? b.x, ny = target.y ?? b.y;
    const T = multiply(translation(nx, ny), multiply(scaling(sx, sy), translation(-b.x, -b.y)));
    this.updateSelection('Transformar', (el, it) => this.applyWorld(it, el, T));
  }

  rotateSelection(deg) {
    const b = this.selectionBounds();
    if (!b) return;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const R = multiply(translation(cx, cy), multiply(rotation((deg * Math.PI) / 180), translation(-cx, -cy)));
    this.updateSelection('Girar', (el, it) => this.applyWorld(it, el, R));
  }

  /** Propriedades de instâncias selecionadas (comportamento, loop, efeito de cor). */
  setInstanceProps(patch, label = 'Instância') {
    this.updateSelection(label, (el) => {
      if (el.type === 'instance') Object.assign(el, clone(patch));
    });
  }

  // ---------- timeline ----------
  timelineOp(name) {
    const ops = {
      insertFrame: [TL.insertFrames, 'Inserir quadro'],
      removeFrame: [TL.removeFrames, 'Remover quadro'],
      insertKeyframe: [TL.insertKeyframe, 'Inserir keyframe'],
      insertBlankKeyframe: [TL.insertBlankKeyframe, 'Inserir keyframe vazio'],
      clearKeyframe: [TL.clearKeyframe, 'Limpar keyframe'],
    };
    const [fn, label] = ops[name];
    this.stop();
    const layer = this.activeLayer;
    const r = fn(layer.frames, this.frame);
    if (!r) return;
    this.run(new C.SetLayerFrames(layer.id, layer.frames, r.frames, label, this.frame, r.frame));
  }

  /** Keyframe do quadro atual na camada ativa. */
  currentSpan() {
    return this.spanAt(this.activeLayer);
  }

  createClassicTween() {
    const layer = this.activeLayer;
    const span = this.currentSpan();
    if (!span) return this.toast('Não há quadro aqui para criar o tween.');
    if (span.tween) return;
    this.run(new C.SetSpanProps(layer.id, span.start, { tween: undefined }, { tween: { ...DEFAULT_TWEEN } }, 'Criar tween clássico'));
    const idx = layer.frames.indexOf(this.currentSpan());
    if (!layer.frames[idx + 1]) this.toast('Tween criado. Ele precisa de um keyframe depois para ter destino.');
  }

  removeTween() {
    const layer = this.activeLayer;
    const span = this.currentSpan();
    if (!span?.tween) return;
    this.run(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween: undefined }, 'Remover tween'));
  }

  setTweenProps(patch) {
    const layer = this.activeLayer;
    const span = this.currentSpan();
    if (!span?.tween) return;
    this.run(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween: { ...span.tween, ...patch } }, 'Ajustar tween'));
  }

  // ---------- camadas ----------
  setActiveLayer(id) {
    if (this.activeLayerId === id) return;
    this.activeLayerId = id;
    this.emit('layers');
  }
  addLayer() {
    const n = this.layers.length;
    let num = n + 1;
    const names = new Set(this.layers.map((l) => l.name));
    while (names.has(`Camada ${num}`)) num++;
    const layer = createLayer(`Camada ${num}`, num - 1, this.length);
    const idx = Math.max(0, this.layerIndex(this.activeLayerId));
    this.run(new C.AddLayer(this.timeline.id, idx, layer));
  }
  deleteLayer(id = this.activeLayerId) {
    if (this.layers.length <= 1) {
      this.toast('A timeline precisa ter pelo menos uma camada.');
      return;
    }
    const idx = this.layerIndex(id);
    const layer = this.layers[idx];
    this.activeLayerId = (this.layers[idx + 1] || this.layers[idx - 1]).id;
    this.run(new C.RemoveLayer(this.timeline.id, idx, layer));
  }
  setLayerProps(id, patch, label = 'Camada') {
    const l = this.layer(id);
    const before = {};
    for (const k of Object.keys(patch)) before[k] = l[k];
    this.run(new C.SetLayerProps(id, before, patch, label));
  }
  /** Alterna visível/travada/contorno de todas as camadas de uma vez. */
  toggleAllLayers(prop) {
    const target = prop === 'visible' ? !this.layers.every((l) => l.visible) : !this.layers.every((l) => l[prop]);
    const cmds = this.layers
      .filter((l) => l[prop] !== target)
      .map((l) => new C.SetLayerProps(l.id, { [prop]: l[prop] }, { [prop]: target }));
    this.run(new C.Compound('Camadas', cmds));
  }
  moveLayer(from, to) {
    if (from === to || to < 0 || to >= this.layers.length) return;
    this.run(new C.MoveLayer(this.timeline.id, from, to));
  }

  // ---------- símbolos: criar, entrar e sair ----------
  /** F8: transforma a seleção num símbolo e deixa uma instância no lugar. */
  convertToSymbol({ name, type = 'graphic', registration = 'center' }) {
    if (!this.selection.size) return this.toast('Selecione algo para converter em símbolo.');
    this.group('Converter em símbolo', () => {
      this.materialize();
      const items = this.selectedItems(); // de baixo para cima
      const b = unionBounds(items.map((it) => this.boundsOf(it)));
      const rx = registration === 'topleft' ? b.x : b.x + b.w / 2;
      const ry = registration === 'topleft' ? b.y : b.y + b.h / 2;
      const els = items.map((it) => ({ ...clone(it.el), matrix: multiply(translation(-rx, -ry), it.wm || it.el.matrix) }));
      const sym = createSymbol(name || this.nextSymbolName(), type, els);
      const target = items[items.length - 1];
      const inst = createInstance(sym, multiply(invert(target.lm || IDENTITY) || IDENTITY, translation(rx, ry)));
      const cmds = [new C.InsertLibraryEntry('items', this.doc.library.items.length, sym, 'Novo símbolo')];
      for (const g of this.groupSelected(items)) {
        cmds.push(new C.RemoveElements(g.layer.id, g.span.start, g.items.map((it) => ({ el: it.el, index: it.index }))));
      }
      cmds.push(new C.AddElements(target.layer.id, target.span.start, [inst]));
      this.run(new C.Compound('Converter em símbolo', cmds));
      this.setSelection([inst.id]);
      this.emit('library');
    });
  }

  nextSymbolName() {
    return uniqueName(this.doc.library.items.map((s) => s.name), `Símbolo ${this.doc.library.items.length + 1}`);
  }

  /** Ctrl+F8: símbolo vazio, já aberto para editar. */
  newSymbol({ name, type = 'graphic' }) {
    const sym = createSymbol(name || this.nextSymbolName(), type, []);
    this.run(new C.InsertLibraryEntry('items', this.doc.library.items.length, sym, 'Novo símbolo'));
    this.emit('library');
    this.enterSymbol(sym.id);
  }

  /**
   * Abre um símbolo para editar. Com `item` (instância clicada no palco) edita no lugar,
   * vendo o resto da cena atrás; sem item, edita isolado (vindo da biblioteca).
   */
  enterSymbol(symbolId, item = null) {
    const sym = this.symbol(symbolId);
    if (!sym) return;
    this.stop();
    const entry = {
      symbolId,
      instanceId: item?.el.id || null,
      isolated: !item,
      matrix: item ? multiply(this.contextMatrix, item.wm || item.el.matrix) : translation(this.doc.width / 2, this.doc.height / 2),
      parentFrame: this.frame,
      parentLayerId: this.activeLayerId,
      parentSelection: [...this.selection],
    };
    this.editStack.push(entry);
    this.frame = item ? instanceFrame(sym, item.el, item.offset, item.mcTime, false) : 0;
    this.activeLayerId = sym.layers[0].id;
    this.selection = new Set();
    this.emitContext();
  }

  /** Volta para a timeline de cima (levels = quantos níveis subir; Infinity = cena). */
  exitSymbol(levels = 1) {
    if (!this.editStack.length) return;
    this.stop();
    let entry;
    for (let i = 0; i < levels && this.editStack.length; i++) entry = this.editStack.pop();
    this.frame = entry.parentFrame;
    this.activeLayerId = entry.parentLayerId;
    this.selection = new Set(entry.parentSelection);
    if (!this.layer(this.activeLayerId)) this.activeLayerId = this.layers[0].id;
    this.pruneSelection();
    this.emitContext();
  }

  emitContext() {
    this.emit('context');
    this.emit('doc');
    this.emit('frame');
    this.emit('layers');
    this.emit('selection');
  }

  /** Se o símbolo aberto deixou de existir (ex.: desfazer), volta para onde dá. */
  validateStack() {
    const i = this.editStack.findIndex((e) => !this.symbol(e.symbolId));
    if (i >= 0) {
      const levels = this.editStack.length - i;
      this.exitSymbol(levels);
    }
  }

  /** Breadcrumb: [{ name, level }] da cena até o símbolo aberto. */
  get breadcrumb() {
    return [
      { name: this.scene.name, level: 0 },
      ...this.editStack.map((e, i) => ({ name: this.symbol(e.symbolId)?.name || '?', level: i + 1 })),
    ];
  }

  /** Coloca uma instância do símbolo num ponto (arrastar da biblioteca para o palco). */
  placeSymbol(symbolId, x, y) {
    const sym = this.symbol(symbolId);
    if (!sym) return;
    const inst = createInstance(sym, translation(x, y));
    if (this.addElements([inst], `Colocar ${sym.name}`)) {
      this.setSelection([inst.id]);
      this.emit('library');
    }
  }

  // ---------- biblioteca ----------
  usage() {
    return symbolUsage(this.doc);
  }

  addFolder(name, parentId = null) {
    const f = { id: uid('f'), name: name || uniqueName(this.doc.library.folders.map((x) => x.name), 'Pasta'), parentId };
    this.run(new C.InsertLibraryEntry('folders', this.doc.library.folders.length, f, 'Nova pasta'));
    this.emit('library');
    return f;
  }

  patchLibrary(kind, id, patch, label = 'Biblioteca') {
    const entry = this.doc.library[kind].find((x) => x.id === id);
    if (!entry) return;
    const before = {};
    for (const k of Object.keys(patch)) before[k] = entry[k];
    this.run(new C.PatchLibraryEntry(kind, id, before, patch, label));
    this.emit('library');
  }

  /** Mover para pasta, sem deixar uma pasta entrar nela mesma. */
  moveToFolder(kind, id, folderId) {
    if (kind === 'folders') {
      for (let f = folderId; f; f = this.doc.library.folders.find((x) => x.id === f)?.parentId) {
        if (f === id) return;
      }
    }
    const entry = this.doc.library[kind].find((x) => x.id === id);
    const key = kind === 'folders' ? 'parentId' : 'folderId';
    if (!entry || entry[key] === folderId) return;
    this.patchLibrary(kind, id, { [key]: folderId }, 'Mover para pasta');
  }

  /** Apaga um símbolo (e todas as instâncias dele) ou uma pasta (o conteúdo sobe um nível). */
  deleteLibraryEntry(kind, id) {
    const lib = this.doc.library;
    const index = lib[kind].findIndex((x) => x.id === id);
    if (index < 0) return;
    const entry = lib[kind][index];
    const cmds = [];
    if (kind === 'folders') {
      for (const s of lib.items.filter((x) => x.folderId === id)) cmds.push(new C.PatchLibraryEntry('items', s.id, { folderId: id }, { folderId: entry.parentId }));
      for (const f of lib.folders.filter((x) => x.parentId === id)) cmds.push(new C.PatchLibraryEntry('folders', f.id, { parentId: id }, { parentId: entry.parentId }));
    } else {
      for (const tl of allTimelines(this.doc)) {
        if (tl.id === id) continue;
        for (const layer of tl.layers) {
          if (!layer.frames.some((s) => s.elements.some((el) => el.symbolId === id))) continue;
          const after = clone(layer.frames);
          for (const s of after) s.elements = s.elements.filter((el) => el.symbolId !== id);
          cmds.push(new C.SetLayerFrames(layer.id, layer.frames, after, 'Remover instâncias'));
        }
      }
    }
    cmds.push(new C.DeleteLibraryEntry(kind, index, entry));
    this.run(new C.Compound(kind === 'items' ? `Apagar ${entry.name}` : 'Apagar pasta', cmds));
    this.emit('library');
  }

  duplicateSymbol(id) {
    const src = this.symbol(id);
    if (!src) return;
    const copy = clone(src);
    copy.id = uid('y');
    copy.name = uniqueName(this.doc.library.items.map((s) => s.name), `${src.name} cópia`);
    for (const l of copy.layers) {
      l.id = uid('l');
      for (const s of l.frames) s.elements = cloneElementsWithNewIds(s.elements);
    }
    this.run(new C.InsertLibraryEntry('items', this.doc.library.items.length, copy, 'Duplicar símbolo'));
    this.emit('library');
    return copy;
  }

  // ---------- documento ----------
  setDocProps(patch) {
    const before = {};
    for (const k of Object.keys(patch)) before[k] = this.doc[k];
    this.run(new C.SetDocProps(before, patch, 'Propriedades do documento'));
  }
}
