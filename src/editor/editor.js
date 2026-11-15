// Estado do editor e operações de alto nível. A interface só chama métodos daqui.

import { createDocument, createLayer, clone, cloneElementsWithNewIds } from '../model/document.js';
import * as TL from '../model/timeline.js';
import { elementWorldBounds, unionBounds } from '../model/geometry.js';
import { getSpanAt, sceneLength, multiply, translation, scaling, rotation } from '../player/render.js';
import { Player } from '../player/player.js';
import { History } from './history.js';
import * as C from './commands.js';

export class Editor {
  constructor() {
    this.listeners = new Map();
    this.history = new History();
    this.tool = 'select';
    this.style = { fill: '#4f9dff', stroke: '#1d1d21', strokeWidth: 2, fillOn: true, strokeOn: true };
    this.onion = { enabled: false, before: 2, after: 2, outline: false, beforeColor: '#3b82f6', afterColor: '#22c55e' };
    this.loop = true;
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
    this.frame = 0;
    this.activeLayerId = this.scene.layers[0].id;
    this.selection = new Set();
    this.history.clear();
    this.filePath = filePath;
    this.emit('load');
    this.emit('doc');
    this.emit('file');
  }

  get scene() {
    return this.doc.scenes[this.sceneIndex];
  }
  get layers() {
    return this.scene.layers;
  }
  get length() {
    return sceneLength(this.scene);
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
    return layer.visible && !layer.locked;
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
    if (!this.layer(this.activeLayerId)) this.activeLayerId = this.layers[0].id;
    this.pruneSelection();
    this.emit('doc');
    this.emit('frame');
    this.emit('selection');
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
  setStyle(patch) {
    Object.assign(this.style, patch);
    this.emit('style');
    if (this.selection.size) {
      const s = this.style;
      this.updateSelection('Cor e traço', (el) => {
        if ('fill' in patch || 'fillOn' in patch) el.fill = el.path.closed && s.fillOn ? s.fill : null;
        if ('stroke' in patch || 'strokeOn' in patch) el.stroke = s.strokeOn ? s.stroke : null;
        if ('strokeWidth' in patch) {
          el.strokeWidth = s.strokeWidth;
          if (!el.stroke && s.strokeOn) el.stroke = s.stroke;
        }
      });
    }
  }

  // ---------- seleção ----------
  /** Elementos do quadro atual em camadas editáveis: [{ layer, span, el, index }], de baixo para cima. */
  frameItems({ editableOnly = true } = {}) {
    const out = [];
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (editableOnly && !this.isEditable(layer)) continue;
      const span = this.spanAt(layer);
      if (!span) continue;
      span.elements.forEach((el, index) => out.push({ layer, span, el, index }));
    }
    return out;
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
  selectionBounds() {
    const items = this.selectedItems();
    if (!items.length) return null;
    return unionBounds(items.map((it) => elementWorldBounds(it.el)));
  }

  // ---------- edição de elementos ----------
  /** Garante que a camada ativa aceita desenho no quadro atual. Retorna o comando de timeline (ou null). */
  prepareDrawing() {
    const layer = this.activeLayer;
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

  addElements(elements, label = 'Desenhar') {
    const pre = this.prepareDrawing();
    if (pre === false) return false;
    const layer = this.activeLayer;
    const start = pre ? this.frame : this.spanAt(layer).start;
    const cmd = new C.Compound(label, [pre, new C.AddElements(layer.id, start, elements)]);
    this.run(cmd);
    return true;
  }

  /** Aplica mutate(el) numa cópia de cada elemento selecionado e registra o comando. */
  updateSelection(label, mutate) {
    const groups = this.groupSelected();
    const cmds = [];
    for (const g of groups) {
      const before = g.items.map((it) => clone(it.el));
      const after = before.map((el) => {
        const c = clone(el);
        mutate(c);
        return c;
      });
      cmds.push(new C.UpdateElements(g.layer.id, g.span.start, before, after));
    }
    this.run(new C.Compound(label, cmds));
  }

  /** Fecha uma edição feita ao vivo: before = Map(id → clone do elemento antes). */
  commitLiveEdit(label, before) {
    const groups = this.groupSelected(this.frameItems().filter((it) => before.has(it.el.id)));
    const cmds = groups.map(
      (g) => new C.UpdateElements(g.layer.id, g.span.start, g.items.map((it) => before.get(it.el.id)), g.items.map((it) => it.el)),
    );
    this.commit(new C.Compound(label, cmds));
  }

  groupSelected(items = this.selectedItems()) {
    const map = new Map();
    for (const it of items) {
      const key = it.layer.id;
      if (!map.has(key)) map.set(key, { layer: it.layer, span: it.span, items: [] });
      map.get(key).items.push(it);
    }
    return [...map.values()];
  }

  deleteSelection() {
    const groups = this.groupSelected();
    if (!groups.length) return;
    const cmds = groups.map(
      (g) => new C.RemoveElements(g.layer.id, g.span.start, g.items.map((it) => ({ el: it.el, index: it.index }))),
    );
    this.run(new C.Compound('Apagar', cmds));
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
    const els = cloneElementsWithNewIds(this.clipboard).map((el) => {
      el.matrix = multiply(translation(offset, offset), el.matrix);
      return el;
    });
    if (this.addElements(els, 'Colar')) this.setSelection(els.map((e) => e.id));
  }
  duplicate() {
    const items = this.selectedItems();
    if (!items.length) return;
    const groups = this.groupSelected(items);
    const newIds = [];
    const cmds = groups.map((g) => {
      const els = cloneElementsWithNewIds(g.items.map((it) => it.el)).map((el) => {
        el.matrix = multiply(translation(10, 10), el.matrix);
        newIds.push(el.id);
        return el;
      });
      return new C.AddElements(g.layer.id, g.span.start, els);
    });
    this.run(new C.Compound('Duplicar', cmds));
    this.setSelection(newIds);
  }

  nudge(dx, dy) {
    if (!this.selection.size) return;
    this.updateSelection('Mover', (el) => {
      el.matrix = multiply(translation(dx, dy), el.matrix);
    });
  }

  /** dir: 'front' | 'forward' | 'backward' | 'back' */
  arrange(dir) {
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
  }

  /** Muda posição/tamanho da seleção pelo painel de propriedades (caixa no mundo). */
  setSelectionBounds(target) {
    const b = this.selectionBounds();
    if (!b) return;
    const sx = b.w > 0.0001 && target.w != null ? Math.max(0.01, target.w) / b.w : 1;
    const sy = b.h > 0.0001 && target.h != null ? Math.max(0.01, target.h) / b.h : 1;
    const nx = target.x ?? b.x, ny = target.y ?? b.y;
    // escala a partir do canto superior esquerdo, depois move
    const T = multiply(translation(nx, ny), multiply(scaling(sx, sy), translation(-b.x, -b.y)));
    this.updateSelection('Transformar', (el) => {
      el.matrix = multiply(T, el.matrix);
    });
  }

  rotateSelection(deg) {
    const b = this.selectionBounds();
    if (!b) return;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const R = multiply(translation(cx, cy), multiply(rotation((deg * Math.PI) / 180), translation(-cx, -cy)));
    this.updateSelection('Girar', (el) => {
      el.matrix = multiply(R, el.matrix);
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
    this.run(new C.AddLayer(idx, layer));
  }
  deleteLayer(id = this.activeLayerId) {
    if (this.layers.length <= 1) {
      this.toast('A cena precisa ter pelo menos uma camada.');
      return;
    }
    const idx = this.layerIndex(id);
    const layer = this.layers[idx];
    this.activeLayerId = (this.layers[idx + 1] || this.layers[idx - 1]).id;
    this.run(new C.RemoveLayer(idx, layer));
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
    this.run(new C.MoveLayer(from, to));
  }

  // ---------- documento ----------
  setDocProps(patch) {
    const before = {};
    for (const k of Object.keys(patch)) before[k] = this.doc[k];
    this.run(new C.SetDocProps(before, patch, 'Propriedades do documento'));
  }
}

