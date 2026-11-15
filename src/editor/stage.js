// Palco: vista (zoom/pan), renderização via player, onion skin, sobreposições e hit test.

import { renderScene, getSpanAt, invert, applyPoint, getPath2D, IDENTITY } from '../player/render.js';
import { pathBounds, localBoxCorners, elementWorldBounds, unionBounds, boundsIntersect } from '../model/geometry.js';
import { createTools } from './tools.js';

const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

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
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    for (const t of ['doc', 'frame', 'selection', 'options', 'layers', 'style']) editor.on(t, () => this.invalidate());
    editor.on('tool', () => {
      this.updateCursor();
      this.invalidate();
    });
    editor.on('load', () => {
      this.needsFit = true;
      this.resize();
    });
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
    const z = Math.min((w - 48) / d.width, (h - 48) / d.height, 4);
    this.setView(Math.max(0.05, z), (w - d.width * z) / 2, (h - d.height * z) / 2);
  }

  zoomTo(z, sx, sy) {
    const { w, h } = this.size;
    sx ??= w / 2;
    sy ??= h / 2;
    z = Math.max(0.05, Math.min(32, z));
    const wp = this.toWorld(sx, sy);
    this.setView(z, sx - wp.x * z, sy - wp.y * z);
  }

  /** Zoom 100% centralizado no palco. */
  actualSize() {
    const { w, h } = this.size;
    const d = this.editor.doc;
    this.setView(1, (w - d.width) / 2, (h - d.height) / 2);
  }

  setView(zoom, panX, panY) {
    Object.assign(this.view, { zoom, panX, panY });
    this.editor.emit('view', this.view);
    this.invalidate();
  }

  toWorld(sx, sy) {
    const v = this.view;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  }
  toScreen(wx, wy) {
    const v = this.view;
    return { x: wx * v.zoom + v.panX, y: wy * v.zoom + v.panY };
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
    return { sx, sy, wx: w.x, wy: w.y, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button };
  }

  onPointerDown(e) {
    if (this.active) return;
    const middle = e.button === 1;
    if (e.button !== 0 && !middle) return;
    e.preventDefault();
    this.canvas.focus();
    this.editor.stop();
    const tool = middle ? this.tools.hand : this.currentTool();
    this.canvas.setPointerCapture(e.pointerId);
    this.active = tool;
    tool.down?.(this.makeEvent(e));
  }

  onPointerMove(e) {
    const ev = this.makeEvent(e);
    this.lastPointer = ev;
    if (this.active) this.active.move?.(ev);
    else this.currentTool().hover?.(ev);
  }

  onPointerUp(e) {
    if (!this.active) return;
    const tool = this.active;
    this.active = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    tool.up?.(this.makeEvent(e));
    this.updateCursor();
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
      const el = items[0].el;
      return { F: el.matrix, box: pathBounds(el.path), items };
    }
    return { F: IDENTITY, box: unionBounds(items.map((it) => elementWorldBounds(it.el))), items };
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
    const tol = 4 / this.view.zoom;
    for (let i = items.length - 1; i >= 0; i--) {
      if (this.hitElement(items[i].el, wx, wy, tol)) return items[i];
    }
    return null;
  }

  hitElement(el, wx, wy, tol) {
    const m = el.matrix;
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const b = elementWorldBounds(el);
    const pad = tol + (el.strokeWidth || 0) * scale;
    if (wx < b.x - pad || wx > b.x + b.w + pad || wy < b.y - pad || wy > b.y + b.h + pad) return false;
    const inv = invert(m);
    if (!inv) return false;
    const p = applyPoint(inv, wx, wy);
    const path = getPath2D(el.path);
    const ctx = this.hitCtx;
    if (el.fill && el.path.closed && ctx.isPointInPath(path, p.x, p.y)) return true;
    ctx.lineWidth = (el.stroke ? el.strokeWidth : 0) + (2 * tol) / scale;
    return ctx.isPointInStroke(path, p.x, p.y);
  }

  itemsInRect(r) {
    return this.editor.frameItems().filter((it) => boundsIntersect(elementWorldBounds(it.el), r));
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
    const { ctx, canvas, dpr, view, editor } = this;
    const doc = editor.doc;
    const playing = editor.player.playing;
    const z = view.zoom;
    const base = [dpr * z, 0, 0, dpr * z, dpr * view.panX, dpr * view.panY];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#34343b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(...base);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();

    if (editor.onion.enabled && !playing) this.renderOnion(base);

    renderScene(ctx, editor.scene, editor.frame, { honorOutline: true, hairline: 1 / z });

    if (!playing) {
      const tool = this.active || this.currentTool();
      ctx.setTransform(...base);
      tool.drawWorld?.(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawSelection(ctx);
      tool.drawScreen?.(ctx);
    }
  }

  renderOnion(base) {
    const { editor, ctx, canvas } = this;
    const o = editor.onion;
    const scene = editor.scene;
    const filter = (l) => !l.locked;
    // assinatura: quais keyframes aparecem num quadro (evita repetir quadros iguais)
    const sig = (f) => scene.layers.map((l) => (l.visible && !l.locked ? getSpanAt(l, f)?.start ?? -1 : -2)).join(',');
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
        renderScene(ctx, scene, it.f, { layerFilter: filter, outline: it.color, hairline: 1 / this.view.zoom });
        ctx.restore();
        continue;
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.globalAlpha = 1;
      octx.clearRect(0, 0, oc.width, oc.height);
      octx.setTransform(...base);
      renderScene(octx, scene, it.f, { layerFilter: filter, hairline: 1 / this.view.zoom });
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
    const accent = '#4f9dff';
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = accent;
    if (fr.items.length > 1) {
      ctx.globalAlpha = 0.6;
      for (const it of fr.items) {
        const pts = localBoxCorners(it.el.matrix, pathBounds(it.el.path)).map((p) => this.toScreen(p.x, p.y));
        strokePoly(ctx, pts);
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
    // ponto de transformação (centro)
    const c = applyPoint(fr.F, fr.box.x + fr.box.w / 2, fr.box.y + fr.box.h / 2);
    const sc = this.toScreen(c.x, c.y);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

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
