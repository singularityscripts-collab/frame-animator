// Palco: vista (zoom/pan), renderização via player, onion skin, sobreposições e hit test.
// "Mundo" aqui é o espaço da timeline que está sendo editada (cena ou símbolo).
// Ao editar um símbolo no lugar, a matriz de contexto leva esse espaço para o espaço da cena.

import {
  renderTimeline,
  getSpanAt,
  invert,
  applyPoint,
  getPath2D,
  multiply,
  IDENTITY,
  symbolById,
  layerFrame,
  instanceFrame,
  cameraAt,
  applyCameraTint,
  drawElement,
} from '../player/render.js';
import { motionPath } from '../player/tween.js';
import { localBoxCorners, elementLocalBounds, unionBounds, boundsIntersect } from '../model/geometry.js';
import { createTools } from './tools.js';
import { renderContentFor } from './tools-paint.js';

const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
export const SYMBOL_MIME = 'application/x-frame-animator-symbol';
export const BITMAP_MIME = 'application/x-frame-animator-bitmap';

export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M18.5 8.5A7.5 7.5 0 1 0 19.5 14" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M18.5 8.5A7.5 7.5 0 1 0 19.5 14" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round"/><path d="M14.5 8.5h5v-5" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 8.5h5v-5" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}") 12 12, crosshair`;

export class Stage {
  constructor(canvas, editor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.editor = editor;
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.dpr = window.devicePixelRatio || 1;
    this.hitCtx = document.createElement('canvas').getContext('2d');
    this.onionCanvas = document.createElement('canvas');
    this.spaceDown = false;
    this.active = null; // ferramenta com arraste em andamento
    this.tools = createTools(this, editor);
    this.needsFit = true;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('lostpointercapture', (e) => this.onPointerUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('pointerleave', () => {
      if (this.active) return;
      this.lastPointer = null;
      this.invalidate();
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes(SYMBOL_MIME) || e.dataTransfer.types.includes(BITMAP_MIME) || e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    canvas.addEventListener('drop', (e) => {
      const bid = e.dataTransfer.getData(BITMAP_MIME);
      if (bid) {
        e.preventDefault();
        const ev = this.makeEvent(e);
        const b = editor.doc.library.bitmaps.find((x) => x.id === bid);
        if (b) editor.placeBitmap(bid, ev.wx - b.w / 2, ev.wy - b.h / 2);
        editor.setTool('select');
        return;
      }
      // imagens arrastadas do sistema
      const files = [...(e.dataTransfer.files || [])].filter((f) => /^image\//.test(f.type));
      if (files.length) {
        e.preventDefault();
        const ev = this.makeEvent(e);
        editor.importImageFiles?.(files, ev.wx, ev.wy);
        return;
      }
      const id = e.dataTransfer.getData(SYMBOL_MIME);
      if (!id) return;
      e.preventDefault();
      const ev = this.makeEvent(e);
      editor.placeSymbol(id, ev.wx, ev.wy);
      editor.setTool('select');
      canvas.focus();
    });

    for (const t of ['doc', 'frame', 'selection', 'options', 'layers', 'style']) editor.on(t, () => this.invalidate());
    editor.on('tool', () => {
      this.updateCursor();
      this.invalidate();
    });
    editor.on('load', () => {
      this.needsFit = true;
      this.resize();
    });
    editor.on('context', () => this.invalidate());
  }

  // ---------- vista ----------
  get size() {
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const { w, h } = this.size;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (this.needsFit) {
      this.needsFit = false;
      this.fit();
    }
    this.render();
  }

  fit() {
    const { w, h } = this.size;
    const d = this.editor.doc;
    const z = Math.max(0.05, Math.min((w - 48) / d.width, (h - 48) / d.height, 4));
    this.centerOn(z, d.width / 2, d.height / 2);
  }

  /** Põe o ponto (x, y) da cena no centro da área, com o zoom e a rotação da vista. */
  centerOn(z, x, y) {
    const { w, h } = this.size;
    const p = applyPoint(this.rotZoom(z), x, y);
    this.setView(z, w / 2 - p.x, h / 2 - p.y);
  }

  /** Zoom e rotação da vista (sem o deslocamento). */
  rotZoom(z = this.view.zoom, r = this.view.rotation || 0) {
    return [z * Math.cos(r), z * Math.sin(r), -z * Math.sin(r), z * Math.cos(r), 0, 0];
  }

  /** Cena → tela (pixels CSS). */
  viewMatrix() {
    const m = this.rotZoom();
    m[4] = this.view.panX;
    m[5] = this.view.panY;
    return m;
  }

  /** Cena → pixels do canvas. */
  deviceView() {
    return multiply([this.dpr, 0, 0, this.dpr, 0, 0], this.viewMatrix());
  }

  /** Gira a vista em torno do centro da área (graus absolutos). */
  setRotation(deg) {
    const { w, h } = this.size;
    const c = applyPoint(invert(this.viewMatrix()) || IDENTITY, w / 2, h / 2);
    this.view.rotation = (((deg % 360) + 540) % 360 - 180) * (Math.PI / 180);
    this.centerOn(this.view.zoom, c.x, c.y);
  }

  zoomTo(z, sx, sy) {
    const { w, h } = this.size;
    sx ??= w / 2;
    sy ??= h / 2;
    z = Math.max(0.05, Math.min(32, z));
    const c = applyPoint(invert(this.viewMatrix()) || IDENTITY, sx, sy); // ponto da cena sob o cursor
    const p = applyPoint(this.rotZoom(z), c.x, c.y);
    this.setView(z, sx - p.x, sy - p.y);
  }

  /** Zoom 100% centralizado no palco. */
  actualSize() {
    const d = this.editor.doc;
    this.centerOn(1, d.width / 2, d.height / 2);
  }

  setView(zoom, panX, panY) {
    Object.assign(this.view, { zoom, panX, panY });
    this.editor.emit('view', this.view);
    this.invalidate();
  }

  /** Matriz da timeline editada → tela (pixels CSS). */
  screenMatrix() {
    return multiply(this.viewMatrix(), this.editor.contextMatrix);
  }
  /** Escala aproximada da timeline editada na tela (para tolerâncias e contornos). */
  get scale() {
    const m = this.screenMatrix();
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  }
  toWorld(sx, sy) {
    return applyPoint(invert(this.screenMatrix()) || IDENTITY, sx, sy);
  }
  toScreen(wx, wy) {
    return applyPoint(this.screenMatrix(), wx, wy);
  }

  // ---------- entrada ----------
  currentTool() {
    if (this.spaceDown) return this.tools.hand;
    return this.tools[this.editor.tool] || this.tools.select;
  }

  makeEvent(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const w = this.toWorld(sx, sy);
    return {
      sx,
      sy,
      wx: w.x,
      wy: w.y,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      button: e.button,
      pressure: e.pressure,
      pointerType: e.pointerType,
    };
  }

  onPointerDown(e) {
    if (this.active) return;
    this.textEditor?.finish();
    const middle = e.button === 1;
    if (e.button !== 0 && !middle) return;
    e.preventDefault();
    this.canvas.focus();
    this.editor.stop();
    // réguas e guias: arrastar da régua cria guia; arrastar uma guia move (ou tira, se voltar à régua)
    const ev0 = this.makeEvent(e);
    const guideTool = !middle && !this.spaceDown && this.guidesTool(ev0);
    const tool = middle ? this.tools.hand : guideTool || this.currentTool();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ponteiro que o navegador não deixa capturar (ex.: evento sintético): segue sem captura
    }
    this.active = tool;
    tool.down?.(this.makeEvent(e));
  }

  onPointerMove(e) {
    const ev = this.makeEvent(e);
    this.lastPointer = ev;
    if (this.active) {
      // pincel e borracha usam todos os pontos intermediários da caneta/mouse (traço mais suave)
      if (this.active.coalesced && e.getCoalescedEvents) {
        const list = e.getCoalescedEvents();
        if (list.length > 1) {
          for (const c of list) this.active.move?.(this.makeEvent(c));
          return;
        }
      }
      this.active.move?.(ev);
    } else this.currentTool().hover?.(ev);
  }

  onPointerUp(e) {
    if (!this.active) return;
    const tool = this.active;
    this.active = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    tool.up?.(this.makeEvent(e));
    this.updateCursor();
  }

  /** Duplo clique: entra no símbolo clicado; em área vazia, sobe um nível. */
  onDoubleClick(e) {
    if (this.spaceDown) return;
    const ev = this.makeEvent(e);
    if (this.editor.tool !== 'select') return this.currentTool().dblclick?.(ev);
    const hit = this.hitTest(ev.wx, ev.wy);
    if (hit?.el.type === 'text') return this.editText(hit);
    if (hit?.el.type === 'instance') this.editor.enterSymbol(hit.el.symbolId, hit);
    else if (!hit && this.editor.editStack.length) this.editor.exitSymbol();
  }

  /**
   * Edita um texto direto no palco, com uma caixa de texto por cima do elemento.
   * Enter quebra linha; Esc ou clicar fora confirma. Texto novo vazio é apagado.
   */
  editText(it, isNew = false) {
    this.textEditor?.finish();
    const ed = this.editor;
    const el = it.el;
    const host = this.canvas.parentElement;
    const ta = document.createElement('textarea');
    ta.className = 'stage-text-editor';
    ta.value = el.text || '';
    ta.spellcheck = false;
    const m = multiply(this.screenMatrix(), it.wm || el.matrix);
    const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const r = this.canvas.getBoundingClientRect(), hr = host.getBoundingClientRect();
    Object.assign(ta.style, {
      position: 'absolute',
      left: `${r.left - hr.left + m[4]}px`,
      top: `${r.top - hr.top + m[5]}px`,
      font: `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.size * sc}px ${JSON.stringify(el.font || 'Arial')}`,
      lineHeight: String(el.lineHeight || 1.25),
      letterSpacing: `${(el.letterSpacing || 0) * sc}px`,
      color: el.color,
      textAlign: el.align || 'left',
      width: el.width ? `${el.width * sc}px` : 'auto',
      minWidth: '40px',
      transformOrigin: '0 0',
      transform: `rotate(${Math.atan2(m[1], m[0])}rad)`,
    });
    const fit = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight + 2}px`;
      if (!el.width) {
        ta.style.width = 'auto';
        ta.style.width = `${Math.max(40, ta.scrollWidth + 8)}px`;
      }
    };
    host.appendChild(ta);
    const prevText = el.text;
    el.__editing = true;
    this.invalidate();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      delete el.__editing;
      ta.remove();
      this.textEditor = null;
      const v = ta.value;
      // o item pode ter mudado (ou sumido) enquanto a caixa estava aberta
      const cur = ed.frameItems().find((x) => x.el.id === el.id);
      if (!cur) {
        // nada a fazer
      } else if (!v.trim() && (isNew || !prevText)) {
        ed.setSelection([el.id]);
        ed.deleteSelection();
      } else if (v !== prevText) ed.updateItems([cur], 'Editar texto', (x) => (x.text = v));
      this.invalidate();
      this.canvas.focus();
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('blur', finish);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish();
    });
    this.textEditor = { finish, el };
    setTimeout(() => {
      fit();
      ta.focus();
      ta.select();
    }, 0);
  }

  /** Esc durante um arraste: desfaz a edição ao vivo. Retorna true se havia algo para cancelar. */
  cancelDrag() {
    if (!this.active) return false;
    this.active.cancel?.();
    this.active = null;
    this.invalidate();
    this.updateCursor();
    return true;
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = this.canvas.getBoundingClientRect();
      this.zoomTo(this.view.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    } else {
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      this.setView(this.view.zoom, this.view.panX - dx, this.view.panY - dy);
    }
  }

  setSpace(down) {
    if (this.spaceDown === down || this.active) return;
    this.spaceDown = down;
    this.updateCursor();
  }

  setCursor(c) {
    if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c;
  }

  updateCursor() {
    const t = this.currentTool();
    if (this.lastPointer && t.hover) t.hover(this.lastPointer);
    else this.setCursor(t.cursor || 'default');
  }

  // ---------- seleção: caixa e alças ----------
  /** Moldura da seleção: F = matriz local→mundo, box = retângulo local. */
  selectionFrame() {
    const items = this.editor.selectedItems();
    if (!items.length) return null;
    if (items.length === 1) {
      const it = items[0];
      return { F: it.wm || it.el.matrix, box: elementLocalBounds(it.el, this.editor.doc, it.offset, it.mcTime), items };
    }
    return { F: IDENTITY, box: unionBounds(items.map((it) => this.editor.boundsOf(it))), items };
  }

  handles(fr) {
    const { F, box } = fr;
    return HANDLE_IDS.map((id) => {
      const [u, v] = HANDLE_POS[id];
      const lx = box.x + box.w * u, ly = box.y + box.h * v;
      const w = applyPoint(F, lx, ly);
      const s = this.toScreen(w.x, w.y);
      return { id, u, v, lx, ly, x: s.x, y: s.y };
    });
  }

  /** Qual alça está sob o ponteiro: { type: 'scale'|'rotate', handle, cursor } ou null. */
  hitHandle(fr, sx, sy) {
    const hs = this.handles(fr);
    const center = hs.reduce((a, h) => ({ x: a.x + h.x / 8, y: a.y + h.y / 8 }), { x: 0, y: 0 });
    for (const h of hs) {
      if (Math.abs(h.x - sx) <= 6 && Math.abs(h.y - sy) <= 6) {
        const ang = Math.atan2(h.y - center.y, h.x - center.x);
        const idx = ((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4;
        return { type: 'scale', handle: h, cursor: RESIZE_CURSORS[idx] };
      }
    }
    const corners = hs.filter((h) => h.u !== 0.5 && h.v !== 0.5); // nw, ne, se, sw
    for (const h of corners) {
      const d = Math.hypot(h.x - sx, h.y - sy);
      if (d > 6 && d < 22 && !pointInPolygon(sx, sy, corners)) {
        return { type: 'rotate', handle: h, cursor: ROTATE_CURSOR };
      }
    }
    return null;
  }

  // ---------- hit test ----------
  hitTest(wx, wy) {
    const items = this.editor.frameItems();
    const tol = 4 / this.scale;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (this.hitElement(it.wm ? { ...it.el, matrix: it.wm } : it.el, wx, wy, tol, it.offset, it.mcTime, 0)) return it;
    }
    return null;
  }

  hitElement(el, wx, wy, tol, offset = 0, mcTime = 0, depth = 0) {
    const m = el.matrix;
    const inv = invert(m);
    if (!inv) return false;
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const p = applyPoint(inv, wx, wy);
    const localTol = tol / scale;
    if (el.type === 'instance') {
      const doc = this.editor.doc;
      const sym = symbolById(doc, el.symbolId);
      if (!sym || depth > 20) return false;
      const f = instanceFrame(sym, el, offset, mcTime, false);
      for (const layer of sym.layers) {
        if (!layer.visible || layer.type === 'guide' || layer.type === 'folder') continue;
        const lf = layerFrame(layer, f, sym);
        if (!lf) continue;
        for (let i = lf.items.length - 1; i >= 0; i--) {
          const c = lf.items[i];
          if (this.hitElement(c.el, p.x, p.y, localTol, lf.offset, c.mcTime, depth + 1)) return true;
        }
      }
      return false;
    }
    const b = elementLocalBounds(el);
    const pad = localTol + (el.strokeWidth || 0);
    if (p.x < b.x - pad || p.x > b.x + b.w + pad || p.y < b.y - pad || p.y > b.y + b.h + pad) return false;
    const path = getPath2D(el.path);
    const ctx = this.hitCtx;
    if (el.fill && el.path.closed && ctx.isPointInPath(path, p.x, p.y, el.path.fillRule || 'nonzero')) return true;
    ctx.lineWidth = (el.stroke ? el.strokeWidth : 0) + 2 * localTol;
    return ctx.isPointInStroke(path, p.x, p.y);
  }

  /** O ponto cai dentro do preenchimento da forma (não só no traço)? */
  pointInFill(it, wx, wy) {
    const inv = invert(it.wm || it.el.matrix);
    if (!inv || !it.el.path.closed) return false;
    const p = applyPoint(inv, wx, wy);
    return this.hitCtx.isPointInPath(getPath2D(it.el.path), p.x, p.y, it.el.path.fillRule || 'nonzero');
  }

  /** Conteúdo da timeline num canvas do tamanho do palco, sem seleção nem onion (balde, conta-gotas). */
  renderContent(opts) {
    return renderContentFor(this, opts);
  }

  itemsInRect(r) {
    return this.editor.frameItems().filter((it) => boundsIntersect(this.editor.boundsOf(it), r));
  }

  // ---------- renderização ----------
  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render() {
    const { ctx, canvas, dpr, editor } = this;
    const doc = editor.doc;
    const playing = editor.player.playing;
    const sceneBase = this.deviceView();
    const base = multiply(sceneBase, editor.contextMatrix);
    const stack = editor.editStack;
    const isolated = stack[0]?.isolated;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#34343b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!isolated) {
      ctx.setTransform(...sceneBase);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = doc.background;
      ctx.fillRect(0, 0, doc.width, doc.height);
      ctx.restore();
      if (stack.length) {
        // editando no lugar: a cena aparece desbotada atrás, sem a instância aberta
        ctx.save();
        ctx.globalAlpha = 0.3;
        renderTimeline(ctx, doc, editor.scene, stack[0].parentFrame, { skipId: stack[0].instanceId });
        ctx.restore();
      }
    }

    // na cena, a câmera e o parentesco são aplicados camada a camada pelo próprio renderer
    const inScene = !stack.length;
    const contentBase = inScene ? sceneBase : base;
    ctx.setTransform(...contentBase);
    if (editor.onion.enabled && !playing) this.renderOnion(contentBase);
    renderTimeline(ctx, doc, editor.timeline, editor.frame, {
      honorOutline: true,
      outlinePx: dpr,
      showGuides: !playing,
      // como no editor clássico: a máscara só recorta no palco quando a camada de máscara está travada
      maskFilter: playing ? null : (m) => m.locked,
      camera: inScene,
    });
    if (!playing && editor.multi.enabled) this.drawMultiFrames(ctx, base);
    if (inScene) {
      ctx.setTransform(...sceneBase);
      applyCameraTint(ctx, doc, cameraAt(doc, editor.scene, editor.frame));
    }

    if (stack.length) this.drawRegistration(ctx);
    this.drawGridAndGuides(ctx);

    if (!playing) {
      const tool = this.active || this.currentTool();
      ctx.setTransform(...base);
      tool.drawWorld?.(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (editor.tool !== 'gradient') this.drawSelection(ctx);
      if (editor.tool === 'select') {
        this.drawMotionPath(ctx);
        this.drawShapeHints(ctx);
      }
      tool.drawScreen?.(ctx);
      this.drawSnapLines(ctx);
    }
  }

  /** Cruz no ponto de registro do símbolo aberto. */
  drawRegistration(ctx) {
    const p = this.toScreen(0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    const cross = () => {
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y);
      ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x, p.y + 7);
      ctx.stroke();
    };
    cross();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    cross();
    ctx.restore();
  }

  renderOnion(base) {
    const { editor, ctx, canvas } = this;
    const o = editor.onion;
    const tl = editor.timeline;
    const doc = editor.doc;
    const filter = (l) => !l.locked;
    // assinatura: quais keyframes aparecem num quadro (evita repetir quadros iguais)
    const sig = (f) =>
      tl.layers
        .map((l) => {
          if (!l.visible || l.locked) return -2;
          const s = getSpanAt(l, f);
          return s ? (s.tween ? `${s.start}~${f}` : s.start) : -1;
        })
        .join(',');
    const seen = new Set([sig(editor.frame)]);
    const list = [];
    for (let k = 1; k <= o.before; k++) {
      if (editor.frame - k < 0) break;
      list.push({ f: editor.frame - k, k, n: o.before, color: o.beforeColor });
    }
    const len = editor.length;
    for (let k = 1; k <= o.after; k++) {
      if (editor.frame + k >= len) break;
      list.push({ f: editor.frame + k, k, n: o.after, color: o.afterColor });
    }
    list.sort((a, b) => a.k - b.k); // mais perto primeiro, para ganhar a deduplicação
    const toDraw = [];
    for (const it of list) {
      const s = sig(it.f);
      if (seen.has(s)) continue;
      seen.add(s);
      toDraw.push(it);
    }
    toDraw.reverse(); // desenha o mais longe primeiro

    const oc = this.onionCanvas;
    if (oc.width !== canvas.width || oc.height !== canvas.height) {
      oc.width = canvas.width;
      oc.height = canvas.height;
    }
    const octx = oc.getContext('2d');
    for (const it of toDraw) {
      const alpha = 0.18 + 0.42 * (1 - (it.k - 1) / Math.max(1, it.n));
      if (o.outline) {
        ctx.save();
        ctx.globalAlpha = alpha + 0.2;
        renderTimeline(ctx, doc, tl, it.f, { layerFilter: filter, outline: it.color, outlinePx: this.dpr });
        ctx.restore();
        continue;
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.globalAlpha = 1;
      octx.clearRect(0, 0, oc.width, oc.height);
      octx.setTransform(...base);
      renderTimeline(octx, doc, tl, it.f, { layerFilter: filter, outlinePx: this.dpr });
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-atop';
      octx.globalAlpha = 0.6;
      octx.fillStyle = it.color;
      octx.fillRect(0, 0, oc.width, oc.height);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(oc, 0, 0);
      ctx.restore();
    }
    ctx.setTransform(...base);
  }

  drawSelection(ctx) {
    const fr = this.selectionFrame();
    if (!fr) return;
    const doc = this.editor.doc;
    const accent = '#4f9dff';
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = accent;
    if (fr.items.length > 1) {
      ctx.globalAlpha = 0.6;
      for (const it of fr.items) {
        const b = elementLocalBounds(it.el, doc, it.offset, it.mcTime);
        strokePoly(ctx, localBoxCorners(it.wm || it.el.matrix, b).map((p) => this.toScreen(p.x, p.y)));
      }
      ctx.globalAlpha = 1;
    }
    const hs = this.handles(fr);
    const byId = Object.fromEntries(hs.map((h) => [h.id, h]));
    strokePoly(ctx, [byId.nw, byId.ne, byId.se, byId.sw]);
    ctx.fillStyle = '#ffffff';
    for (const h of hs) {
      ctx.fillRect(Math.round(h.x) - 3.5, Math.round(h.y) - 3.5, 7, 7);
      ctx.strokeRect(Math.round(h.x) - 3.5, Math.round(h.y) - 3.5, 7, 7);
    }
    // ponto de transformação: centro da forma; numa instância, o ponto de registro do símbolo
    const single = fr.items.length === 1 ? fr.items[0] : null;
    const c =
      single?.el.type === 'instance'
        ? { x: (single.wm || single.el.matrix)[4], y: (single.wm || single.el.matrix)[5] }
        : applyPoint(fr.F, fr.box.x + fr.box.w / 2, fr.box.y + fr.box.h / 2);
    const sc = this.toScreen(c.x, c.y);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Edição de vários quadros: os outros keyframes do intervalo aparecem inteiros. */
Stage.prototype.drawMultiFrames = function (ctx, base) {
  const doc = this.editor.doc;
  ctx.save();
  ctx.setTransform(...base);
  for (const it of this.editor.frameItems()) {
    if (it.multi) drawElement(ctx, doc, { ...it.el, matrix: it.wm }, {});
  }
  ctx.restore();
};

// ---------- caminho do motion tween ----------
Stage.prototype.motionPathInfo = function () {
  const ed = this.editor;
  const items = ed.frameItems();
  const it = items.find((x) => x.motion && ed.selection.has(x.el.id)) || items.find((x) => x.motion && x.layer.id === ed.activeLayerId);
  if (!it || it.span.duration < 2) return null;
  const tw = it.span.tween;
  const keyT = new Set([...(tw.props?.x || []), ...(tw.props?.y || [])].map((k) => k.t));
  const lm = it.lm || IDENTITY;
  const points = motionPath(it.span).map((p) => {
    const w = applyPoint(lm, p.x, p.y);
    return { t: p.t, ...this.toScreen(w.x, w.y), key: keyT.has(p.t) || p.t === 0 };
  });
  return { it, points };
};

Stage.prototype.hitMotionPath = function (sx, sy) {
  const info = this.motionPathInfo();
  if (!info) return null;
  let best = null;
  for (const p of info.points) {
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= (p.key ? 7 : 4) && (!best || d < best.d || (p.key && !best.key))) best = { ...p, d, it: info.it };
  }
  return best;
};

Stage.prototype.drawMotionPath = function (ctx) {
  const info = this.motionPathInfo();
  if (!info) return;
  const cur = this.editor.frame - info.it.span.start;
  ctx.save();
  ctx.strokeStyle = 'rgba(79,157,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  info.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  for (const p of info.points) {
    ctx.fillStyle = p.t === cur ? '#ff4d5e' : p.key ? '#ffffff' : '#4f9dff';
    ctx.strokeStyle = '#1d3a66';
    if (p.key) {
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.t === cur ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
};

// ---------- dicas de forma ----------
Stage.prototype.shapeHintHandles = function () {
  const ed = this.editor;
  const c = ed.shapeHintContext();
  if (!c || !c.span.tween.hints?.length) return [];
  const lm = ed.layerMatrixOf(c.layer);
  return c.span.tween.hints.map((h, i) => {
    const w = applyPoint(lm, h[c.side].x, h[c.side].y);
    return { i, side: c.side, span: c.span, layer: c.layer, lm, letter: String.fromCharCode(97 + i), ...this.toScreen(w.x, w.y) };
  });
};

Stage.prototype.hitShapeHint = function (sx, sy) {
  return this.shapeHintHandles().find((h) => Math.hypot(h.x - sx, h.y - sy) <= 9) || null;
};

Stage.prototype.drawShapeHints = function (ctx) {
  const hs = this.shapeHintHandles();
  if (!hs.length) return;
  ctx.save();
  ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of hs) {
    ctx.fillStyle = h.side === 'a' ? '#ffd60a' : '#34c759';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.fillText(h.letter, h.x, h.y + 0.5);
  }
  ctx.restore();
};

function strokePoly(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x + 0.5, p.y + 0.5) : ctx.moveTo(p.x + 0.5, p.y + 0.5)));
  ctx.closePath();
  ctx.stroke();
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------- grade, guias, réguas e encaixe ----------
const RULER = 18;

Stage.prototype.rulersOn = function () {
  return !!this.editor.showRulers;
};

/** Desenha grade e guias (no espaço da cena) e as réguas (na tela). */
Stage.prototype.drawGridAndGuides = function (ctx) {
  const doc = this.editor.doc;
  const { w, h } = this.size;
  const M = this.viewMatrix();
  const inv = invert(M) || IDENTITY;
  const corners = [applyPoint(inv, 0, 0), applyPoint(inv, w, 0), applyPoint(inv, 0, h), applyPoint(inv, w, h)];
  const x0 = Math.min(...corners.map((p) => p.x)), x1 = Math.max(...corners.map((p) => p.x));
  const y0 = Math.min(...corners.map((p) => p.y)), y1 = Math.max(...corners.map((p) => p.y));
  ctx.save();
  ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  const line = (ax, ay, bx, by) => {
    const a = applyPoint(M, ax, ay), b = applyPoint(M, bx, by);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  };
  if (doc.grid?.show) {
    const g = Math.max(2, doc.grid.size || 20);
    if (g * this.view.zoom >= 4) {
      ctx.strokeStyle = (doc.grid.color || '#8a8a96') + '55';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(x0 / g) * g; x <= x1; x += g) line(x, y0, x, y1);
      for (let y = Math.floor(y0 / g) * g; y <= y1; y += g) line(x0, y, x1, y);
      ctx.stroke();
    }
  }
  if (doc.guides?.show !== false) {
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const gd of doc.guides?.items || []) gd.axis === 'v' ? line(gd.pos, y0, gd.pos, y1) : line(x0, gd.pos, x1, gd.pos);
    if (this.guideDrag) this.guideDrag.axis === 'v' ? line(this.guideDrag.pos, y0, this.guideDrag.pos, y1) : line(x0, this.guideDrag.pos, x1, this.guideDrag.pos);
    ctx.stroke();
  }
  if (this.rulersOn()) {
    ctx.fillStyle = '#26262b';
    ctx.fillRect(0, 0, w, RULER);
    ctx.fillRect(0, 0, RULER, h);
    ctx.fillStyle = '#3a3a42';
    ctx.fillRect(0, RULER - 1, w, 1);
    ctx.fillRect(RULER - 1, 0, 1, h);
    if (!this.view.rotation) {
      const z = this.view.zoom;
      const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s0) => s0 * z >= 50) || 1000;
      ctx.fillStyle = '#9a9aa6';
      ctx.font = '9px "Segoe UI", system-ui, sans-serif';
      ctx.strokeStyle = '#5a5a64';
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step / 5) {
        const sx = applyPoint(M, x, 0).x;
        const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
        ctx.moveTo(sx + 0.5, RULER);
        ctx.lineTo(sx + 0.5, major ? 4 : RULER - 5);
        if (major) ctx.fillText(String(Math.round(x)), sx + 2, 9);
      }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step / 5) {
        const sy = applyPoint(M, 0, y).y;
        const major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
        ctx.moveTo(RULER, sy + 0.5);
        ctx.lineTo(major ? 4 : RULER - 5, sy + 0.5);
        if (major) {
          ctx.save();
          ctx.translate(9, sy - 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(String(Math.round(y)), 0, 0);
          ctx.restore();
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();
};

/** Ferramenta temporária para criar/mover/tirar guias, se o clique foi numa régua ou numa guia. */
Stage.prototype.guidesTool = function (ev) {
  const doc = this.editor.doc;
  const inRulerTop = this.rulersOn() && ev.sy < RULER && ev.sx > RULER;
  const inRulerLeft = this.rulersOn() && ev.sx < RULER && ev.sy > RULER;
  let axis = inRulerTop ? 'h' : inRulerLeft ? 'v' : null;
  let index = -1;
  if (!axis && this.editor.tool === 'select' && doc.guides?.show !== false && !doc.guides?.locked && !this.editor.editStack.length) {
    const M = this.viewMatrix();
    (doc.guides?.items || []).forEach((gd, i) => {
      const p = applyPoint(M, gd.axis === 'v' ? gd.pos : 0, gd.axis === 'h' ? gd.pos : 0);
      const d = gd.axis === 'v' ? Math.abs(p.x - ev.sx) : Math.abs(p.y - ev.sy);
      if (d <= 4 && !this.view.rotation) {
        axis = gd.axis;
        index = i;
      }
    });
  }
  if (!axis) return null;
  const stage = this;
  const scenePt = (e) => applyPoint(invert(stage.viewMatrix()) || IDENTITY, e.sx, e.sy);
  return {
    down() {
      const p = scenePt(ev);
      stage.guideDrag = { axis, pos: axis === 'v' ? p.x : p.y };
    },
    move(e) {
      const p = scenePt(e);
      stage.guideDrag = { axis, pos: Math.round(axis === 'v' ? p.x : p.y) };
      stage.setCursor(axis === 'v' ? 'ew-resize' : 'ns-resize');
      stage.invalidate();
    },
    up(e) {
      const g = stage.guideDrag;
      stage.guideDrag = null;
      const items = [...(doc.guides?.items || [])];
      if (index >= 0) items.splice(index, 1);
      const out = stage.rulersOn() && (axis === 'v' ? e.sx < RULER : e.sy < RULER);
      if (g && !out) items.push(g);
      stage.editor.setDocProps({ guides: { ...(doc.guides || {}), items } });
      stage.invalidate();
    },
    cancel() {
      stage.guideDrag = null;
    },
  };
};

/**
 * Encaixe: ajusta um deslocamento (dx, dy) para que as bordas/centros da caixa encostem na grade,
 * nas guias, no palco ou em outros objetos. exclude: ids que não contam (a própria seleção).
 */
Stage.prototype.snapBox = function (box, dx, dy, exclude = new Set()) {
  const ed = this.editor;
  const doc = ed.doc;
  const tol = 6 / this.scale;
  const xs = [], ys = [];
  if (doc.guides?.snap !== false) for (const g of doc.guides?.items || []) (g.axis === 'v' ? xs : ys).push(g.pos);
  if (ed.snapObjects !== false) {
    xs.push(0, doc.width / 2, doc.width);
    ys.push(0, doc.height / 2, doc.height);
    for (const it of ed.frameItems()) {
      if (exclude.has(it.el.id)) continue;
      const b = ed.boundsOf(it);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
  }
  const best = (vals, cands, grid) => {
    let bd = tol, out = null;
    for (const v of vals) {
      for (const c of cands) {
        if (Math.abs(c - v) < bd) {
          bd = Math.abs(c - v);
          out = { d: c - v, at: c };
        }
      }
      if (grid) {
        const c = Math.round(v / grid) * grid;
        if (Math.abs(c - v) < bd) {
          bd = Math.abs(c - v);
          out = { d: c - v, at: c };
        }
      }
    }
    return out;
  };
  const grid = doc.grid?.snap ? doc.grid.size || 20 : 0;
  const bx = box.x + dx, by = box.y + dy;
  const sx = best([bx, bx + box.w / 2, bx + box.w], xs, grid);
  const sy = best([by, by + box.h / 2, by + box.h], ys, grid);
  this.snapLines = [];
  if (sx) {
    dx += sx.d;
    this.snapLines.push({ axis: 'v', pos: sx.at });
  }
  if (sy) {
    dy += sy.d;
    this.snapLines.push({ axis: 'h', pos: sy.at });
  }
  return { dx, dy };
};

/** Encaixe de um ponto (desenhar formas e linhas). */
Stage.prototype.snapPoint = function (x, y) {
  const r = this.snapBox({ x, y, w: 0, h: 0 }, 0, 0);
  return { x: x + r.dx, y: y + r.dy };
};

Stage.prototype.drawSnapLines = function (ctx) {
  if (!this.active || !this.snapLines?.length) return;
  const { w, h } = this.size;
  ctx.save();
  ctx.strokeStyle = '#ff2d95';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (const l of this.snapLines) {
    const p = this.toScreen(l.axis === 'v' ? l.pos : 0, l.axis === 'h' ? l.pos : 0);
    if (l.axis === 'v') {
      ctx.moveTo(p.x + 0.5, 0);
      ctx.lineTo(p.x + 0.5, h);
    } else {
      ctx.moveTo(0, p.y + 0.5);
      ctx.lineTo(w, p.y + 0.5);
    }
  }
  ctx.stroke();
  ctx.restore();
};
