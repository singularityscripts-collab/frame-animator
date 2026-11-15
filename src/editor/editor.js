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
import { elementWorldBounds, unionBounds } from '../model/geometry.js';
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
} from '../player/render.js';
import { Player } from '../player/player.js';
import { History } from './history.js';
import * as C from './commands.js';

export const DEFAULT_TWEEN = { type: 'classic', ease: 0, rotate: 'auto', rotations: 0 };

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
    this.editStack = [];
    this.frame = 0;
    this.activeLayerId = this.scene.layers[0].id;
    this.selection = new Set();
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
  /** Matriz do espaço da timeline editada para o espaço da cena (edição no lugar). */
  get contextMatrix() {
    return this.editStack[this.editStack.length - 1]?.matrix || IDENTITY;
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
    return layer.visible && !layer.locked;
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
    if (!this.layer(this.activeLayerId)) this.activeLayerId = this.layers[0].id;
    this.pruneSelection();
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
  setStyle(patch) {
    Object.assign(this.style, patch);
    this.emit('style');
    if (this.selectedItems().some((it) => it.el.type === 'shape')) {
      const s = this.style;
      this.updateSelection('Cor e traço', (el) => {
        if (el.type !== 'shape') return;
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
  /**
   * Elementos do quadro atual, de baixo para cima, já com tween calculado:
   * [{ layer, span, el, index, offset, mcTime, tweened }]
   */
  frameItems({ editableOnly = true } = {}) {
    const out = [];
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (editableOnly && !this.isEditable(layer)) continue;
      const lf = layerFrame(layer, this.frame);
      if (!lf) continue;
      for (const it of lf.items) {
        out.push({ layer, span: lf.span, el: it.el, index: it.index, offset: lf.offset, mcTime: it.mcTime, tweened: lf.tweened });
      }
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
  boundsOf(it) {
    return elementWorldBounds(it.el, this.doc, it.offset, it.mcTime);
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
    const layers = [...new Set(items.map((it) => it.layer))];
    const cmds = [];
    const newIds = [];
    for (const layer of layers) {
      const r = TL.insertKeyframe(layer.frames, this.frame);
      if (!r) continue;
      cmds.push(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Novo keyframe', this.frame, this.frame));
      const span = r.frames.find((s) => s.start === this.frame);
      for (const it of items) if (it.layer === layer) newIds.push(span.elements[it.index].id);
    }
    if (!cmds.length) return false;
    const keep = [...this.selection].filter((id) => !items.some((it) => it.el.id === id));
    this.history.execute(new C.Compound('Novo keyframe', cmds), this);
    this.selection = new Set([...keep, ...newIds]);
    this.afterChange();
    return true;
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

  /** Não deixa colocar um símbolo dentro dele mesmo. */
  filterRecursive(elements) {
    const host = this.editingSymbol;
    if (!host) return elements;
    const ok = elements.filter((el) => el.type !== 'instance' || !symbolContains(this.doc, el.symbolId, host.id));
    if (ok.length < elements.length) this.toast('Um símbolo não pode ficar dentro dele mesmo.');
    return ok;
  }

  addElements(elements, label = 'Desenhar') {
    elements = this.filterRecursive(elements);
    if (!elements.length) return false;
    const pre = this.prepareDrawing();
    if (pre === false) return false;
    const layer = this.activeLayer;
    const start = pre ? this.frame : this.spanAt(layer).start;
    this.run(new C.Compound(label, [pre, new C.AddElements(layer.id, start, elements)]));
    return true;
  }

  /** Aplica mutate(el) numa cópia de cada elemento selecionado e registra o comando. */
  updateSelection(label, mutate) {
    this.group(label, () => {
      this.materialize();
      const cmds = [];
      for (const g of this.groupSelected()) {
        const before = g.items.map((it) => clone(it.el));
        const after = before.map((el) => {
          const c = clone(el);
          mutate(c);
          return c;
        });
        cmds.push(new C.UpdateElements(g.layer.id, g.span.start, before, after));
      }
      this.run(new C.Compound(label, cmds));
    });
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
    if (this.addElements(els, 'Colar')) this.setSelection(els.map((e) => e.id));
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
    this.updateSelection('Mover', (el) => {
      el.matrix = multiply(translation(dx, dy), el.matrix);
    });
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
      const els = items.map((it) => ({ ...clone(it.el), matrix: multiply(translation(-rx, -ry), it.el.matrix) }));
      const sym = createSymbol(name || this.nextSymbolName(), type, els);
      const inst = createInstance(sym, translation(rx, ry));
      const target = items[items.length - 1];
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
      matrix: item ? multiply(this.contextMatrix, item.el.matrix) : translation(this.doc.width / 2, this.doc.height / 2),
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
    const key = kind === 'items' ? 'folderId' : 'parentId';
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
