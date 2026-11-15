// Ferramentas do palco. Cada uma pode ter: down, move, up, hover, cancel, drawWorld, drawScreen, cursor.

import { multiply, invert, applyPoint, translation, scaling, rotation, drawElement, IDENTITY } from '../player/render.js';
import { motionPropsAt, setKey } from '../player/tween.js';
import * as C from './commands.js';
import { clone } from '../model/document.js';
import { rectPath, ellipsePath, linePath, freehandPath, makeShape, pointsBounds } from '../model/geometry.js';
import { brushTool, eraserTool, bucketTool, eyedropperTool, gradientTool } from './tools-paint.js';

const T = (x, y) => translation(x, y);
const compose = (...ms) => ms.reduce((a, b) => multiply(a, b));

export function createTools(stage, editor) {
  return {
    select: selectTool(stage, editor),
    rect: boxShapeTool(stage, editor, 'rect'),
    oval: boxShapeTool(stage, editor, 'oval'),
    line: lineTool(stage, editor),
    pencil: pencilTool(stage, editor),
    brush: brushTool(stage, editor),
    bucket: bucketTool(stage, editor),
    eraser: eraserTool(stage, editor),
    eyedropper: eyedropperTool(stage, editor),
    gradient: gradientTool(stage, editor),
    camera: cameraTool(stage, editor),
    hand: handTool(stage),
    zoom: zoomTool(stage),
  };
}

function shapeStyle(editor) {
  const s = editor.style;
  let fill = s.fillOn ? s.fill : null;
  let stroke = s.strokeOn ? s.stroke : null;
  if (!fill && !stroke) stroke = s.stroke;
  return { fill, stroke, strokeWidth: s.strokeWidth };
}

// ---------- Seleção: clicar, laço retangular, mover, escalar e girar ----------
// Também arrasta os pontos do caminho do motion tween e as dicas de forma.
function selectTool(stage, editor) {
  let st = null;

  /** Itens selecionados com a matriz (no espaço da camada) de quando o arraste começou. */
  function capture() {
    const items = editor.selectedItems();
    return { items: items.map((it) => ({ it, m0: it.el.matrix.slice() })), snap: editor.beginLiveEdit(items) };
  }

  return {
    cursor: 'default',
    down(e) {
      // 1) dicas de forma e pontos do caminho do motion tween têm prioridade
      const hint = stage.hitShapeHint(e.sx, e.sy);
      if (hint) {
        st = { mode: 'hint', hint, start: e, moved: false, before: clone(hint.span.tween) };
        return;
      }
      const pathPt = stage.hitMotionPath(e.sx, e.sy);
      if (pathPt) {
        st = { mode: 'path', pt: pathPt, start: e, moved: false, before: clone(pathPt.it.span.tween) };
        return;
      }
      const fr = stage.selectionFrame();
      if (fr) {
        const h = stage.hitHandle(fr, e.sx, e.sy);
        if (h) {
          const Finv = invert(fr.F);
          if (!Finv) return;
          st = { mode: h.type, fr, Finv, handle: h.handle, start: e, moved: false };
          stage.setCursor(h.cursor);
          return;
        }
      }
      const hit = stage.hitTest(e.wx, e.wy);
      if (hit) {
        const id = hit.el.id;
        const sel = new Set(editor.selection);
        if (e.shift) {
          if (sel.has(id)) {
            sel.delete(id);
            editor.setSelection(sel);
            st = null;
            return;
          }
          sel.add(id);
          editor.setSelection(sel);
        } else if (!sel.has(id)) {
          editor.setSelection([id]);
        }
        st = { mode: 'move', start: e, moved: false };
        stage.setCursor('move');
      } else {
        if (!e.shift) editor.deselect();
        st = { mode: 'marquee', start: e, cur: e, base: new Set(e.shift ? editor.selection : []) };
      }
    },

    move(e) {
      if (!st) return;
      if (!st.moved && Math.hypot(e.sx - st.start.sx, e.sy - st.start.sy) < 3) return;
      if (st.mode === 'marquee') {
        st.moved = true;
        st.cur = e;
        stage.invalidate();
        return;
      }
      if (st.mode === 'hint') {
        st.moved = true;
        const h = st.hint;
        const p = applyPoint(invert(h.lm) || IDENTITY, e.wx, e.wy);
        const hints = h.span.tween.hints.map((x) => ({ ...x }));
        hints[h.i] = { ...hints[h.i], [h.side]: { x: p.x, y: p.y } };
        h.span.tween = { ...h.span.tween, hints };
        stage.invalidate();
        return;
      }
      if (st.mode === 'path') {
        st.moved = true;
        const { it, t } = st.pt;
        const p = applyPoint(invert(it.lm) || IDENTITY, e.wx, e.wy);
        const tw = clone(st.before);
        tw.props ||= {};
        const at = motionPropsAt({ ...it.span, tween: st.before }, t);
        for (const [k, v] of [['x', p.x], ['y', p.y]]) {
          let keys = tw.props[k] || [];
          if (!keys.length && t !== 0) keys = [{ t: 0, v: motionPropsAt({ ...it.span, tween: st.before }, 0)[k] }];
          tw.props[k] = setKey(keys, t, v);
        }
        void at;
        it.span.tween = tw;
        stage.invalidate();
        return;
      }
      if (!st.moved) {
        // num quadro interpolado de tween clássico, cria o keyframe antes de mexer
        st.materialized = editor.materialize();
        Object.assign(st, capture());
        if (st.fr) {
          st.fr = stage.selectionFrame();
          st.Finv = invert(st.fr.F);
        }
      }
      st.moved = true;
      let W;
      if (st.mode === 'move') {
        let dx = e.wx - st.start.wx, dy = e.wy - st.start.wy;
        if (e.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        W = T(dx, dy);
      } else if (st.mode === 'scale') {
        const { box, F } = st.fr;
        const h = st.handle;
        const p = applyPoint(st.Finv, e.wx, e.wy);
        const ax = e.alt ? box.x + box.w / 2 : box.x + box.w * (1 - h.u);
        const ay = e.alt ? box.y + box.h / 2 : box.y + box.h * (1 - h.v);
        const fx = (v) => (Math.abs(v) < 0.001 ? (v < 0 ? -0.001 : 0.001) : v);
        let sx = h.u !== 0.5 && Math.abs(h.lx - ax) > 0.01 ? fx((p.x - ax) / (h.lx - ax)) : 1;
        let sy = h.v !== 0.5 && Math.abs(h.ly - ay) > 0.01 ? fx((p.y - ay) / (h.ly - ay)) : 1;
        if (e.shift) {
          if (h.u !== 0.5 && h.v !== 0.5) {
            const s = Math.max(Math.abs(sx), Math.abs(sy));
            sx = Math.sign(sx) * s;
            sy = Math.sign(sy) * s;
          } else if (h.u !== 0.5) sy = Math.abs(sx);
          else sx = Math.abs(sy);
        }
        W = compose(F, T(ax, ay), scaling(sx, sy), T(-ax, -ay), st.Finv);
      } else if (st.mode === 'rotate') {
        const { box, F } = st.fr;
        const c = applyPoint(F, box.x + box.w / 2, box.y + box.h / 2);
        let a = Math.atan2(e.wy - c.y, e.wx - c.x) - Math.atan2(st.start.wy - c.y, st.start.wx - c.x);
        if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        W = compose(T(c.x, c.y), rotation(a), T(-c.x, -c.y));
      }
      // W vale no espaço da tela da timeline; cada camada pode ter pai/profundidade (lm)
      for (const { it, m0 } of st.items) {
        const lm = it.lm || IDENTITY;
        editor.setLiveMatrix(it, multiply(invert(lm) || IDENTITY, multiply(W, multiply(lm, m0))));
      }
      stage.invalidate();
      editor.emit('selection');
    },

    up(e) {
      if (!st) return;
      const s = st;
      st = null;
      if (s.mode === 'marquee') {
        if (s.moved) {
          const r = pointsBounds([
            { x: s.start.wx, y: s.start.wy },
            { x: e.wx, y: e.wy },
          ]);
          const ids = new Set(s.base);
          for (const it of stage.itemsInRect(r)) ids.add(it.el.id);
          editor.setSelection(ids);
        }
        stage.invalidate();
        return;
      }
      if (s.mode === 'hint' || s.mode === 'path') {
        if (!s.moved) return;
        const span = s.mode === 'hint' ? s.hint.span : s.pt.it.span;
        const layerId = s.mode === 'hint' ? s.hint.layer.id : s.pt.it.layer.id;
        editor.commit(new C.SetSpanProps(layerId, span.start, { tween: s.before }, { tween: span.tween }, s.mode === 'hint' ? 'Mover dica de forma' : 'Editar caminho'));
        return;
      }
      if (!s.moved) return;
      const label = { move: 'Mover', scale: 'Escalar', rotate: 'Girar' }[s.mode];
      editor.endLiveEdit(label, s.snap);
      if (s.materialized) editor.history.squash(2, label);
    },

    cancel() {
      if (st?.snap) editor.cancelLiveEdit(st.snap);
      if (st?.mode === 'hint') st.hint.span.tween = st.before;
      if (st?.mode === 'path') st.pt.it.span.tween = st.before;
      st = null;
      editor.emit('selection');
    },

    hover(e) {
      if (stage.hitShapeHint(e.sx, e.sy) || stage.hitMotionPath(e.sx, e.sy)) return stage.setCursor('pointer');
      const fr = stage.selectionFrame();
      const h = fr && stage.hitHandle(fr, e.sx, e.sy);
      if (h) return stage.setCursor(h.cursor);
      stage.setCursor(stage.hitTest(e.wx, e.wy) ? 'move' : 'default');
    },

    drawScreen(ctx) {
      if (st?.mode !== 'marquee' || !st.moved) return;
      const x = Math.min(st.start.sx, st.cur.sx), y = Math.min(st.start.sy, st.cur.sy);
      const w = Math.abs(st.cur.sx - st.start.sx), h = Math.abs(st.cur.sy - st.start.sy);
      ctx.save();
      ctx.fillStyle = 'rgba(79,157,255,0.12)';
      ctx.strokeStyle = '#4f9dff';
      ctx.setLineDash([4, 3]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      ctx.restore();
    },
  };
}

// ---------- Câmera: arrastar move a câmera ----------
function cameraTool(stage, editor) {
  let st = null;
  return {
    cursor: 'move',
    down(e) {
      if (!editor.cameraLayer()) {
        editor.toast('Adicione uma câmera primeiro (botão de câmera na timeline ou no painel Propriedades).');
        return;
      }
      const n0 = editor.history.undoStack.length;
      const span = editor.cameraKeyframeHere();
      const cam = editor.cameraState();
      st = { sx: e.sx, sy: e.sy, span, layerId: editor.cameraLayer().id, before: clone(span.camera), cam, created: editor.history.undoStack.length - n0 };
    },
    move(e) {
      if (!st) return;
      const z = (stage.view.zoom * st.cam.zoom) / 100;
      const dx = (e.sx - st.sx) / z, dy = (e.sy - st.sy) / z;
      const r = (st.cam.rotation * Math.PI) / 180;
      const wx = dx * Math.cos(r) - dy * Math.sin(r), wy = dx * Math.sin(r) + dy * Math.cos(r);
      st.span.camera = { ...st.cam, x: st.cam.x - wx, y: st.cam.y - wy };
      stage.invalidate();
      editor.emit('camera');
    },
    up() {
      if (!st) return;
      const s = st;
      st = null;
      if (JSON.stringify(s.before) === JSON.stringify(s.span.camera)) return;
      editor.commit(new C.SetSpanProps(s.layerId, s.span.start, { camera: s.before }, { camera: s.span.camera }, 'Mover câmera'));
      if (s.created) editor.history.squash(s.created + 1, 'Mover câmera');
    },
    cancel() {
      if (st) st.span.camera = st.before;
      st = null;
    },
  };
}

// ---------- Retângulo e oval ----------
function boxShapeTool(stage, editor, kind) {
  let st = null;

  function geometry(e) {
    let dx = e.wx - st.x0, dy = e.wy - st.y0;
    if (e.shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    if (e.alt) return { cx: st.x0, cy: st.y0, w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
    return { cx: st.x0 + dx / 2, cy: st.y0 + dy / 2, w: Math.abs(dx), h: Math.abs(dy) };
  }

  function build(g) {
    const path = kind === 'rect' ? rectPath(g.w, g.h) : ellipsePath(g.w, g.h);
    return makeShape({ path, cx: g.cx, cy: g.cy, ...shapeStyle(editor) });
  }

  return {
    cursor: 'crosshair',
    down(e) {
      st = { x0: e.wx, y0: e.wy, preview: null };
    },
    move(e) {
      if (!st) return;
      const g = geometry(e);
      st.preview = g.w > 0 && g.h > 0 ? build(g) : null;
      stage.invalidate();
    },
    up(e) {
      if (!st) return;
      const g = geometry(e);
      st = null;
      stage.invalidate();
      if (g.w * stage.scale < 2 || g.h * stage.scale < 2) return;
      editor.addElements([build(g)], kind === 'rect' ? 'Retângulo' : 'Oval');
    },
    cancel() {
      st = null;
    },
    drawWorld(ctx) {
      if (st?.preview) drawElement(ctx, editor.doc, st.preview);
    },
  };
}

// ---------- Linha ----------
function lineTool(stage, editor) {
  let st = null;
  function end(e) {
    let x = e.wx, y = e.wy;
    if (e.shift) {
      const dx = x - st.x0, dy = y - st.y0;
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const d = Math.hypot(dx, dy);
      x = st.x0 + Math.cos(a) * d;
      y = st.y0 + Math.sin(a) * d;
    }
    return { x, y };
  }
  function build(p) {
    const s = editor.style;
    const { path, cx, cy } = linePath(st.x0, st.y0, p.x, p.y);
    return makeShape({ path, cx, cy, fill: null, stroke: s.stroke, strokeWidth: Math.max(1, s.strokeWidth) });
  }
  return {
    cursor: 'crosshair',
    down(e) {
      st = { x0: e.wx, y0: e.wy, preview: null };
    },
    move(e) {
      if (!st) return;
      st.preview = build(end(e));
      stage.invalidate();
    },
    up(e) {
      if (!st) return;
      const p = end(e);
      const ok = Math.hypot(p.x - st.x0, p.y - st.y0) * stage.scale >= 2;
      const el = ok && build(p);
      st = null;
      stage.invalidate();
      if (el) editor.addElements([el], 'Linha');
    },
    cancel() {
      st = null;
    },
    drawWorld(ctx) {
      if (st?.preview) drawElement(ctx, editor.doc, st.preview);
    },
  };
}

// ---------- Lápis ----------
function pencilTool(stage, editor) {
  let pts = null;
  return {
    cursor: 'crosshair',
    down(e) {
      pts = [{ x: e.wx, y: e.wy }];
    },
    move(e) {
      if (!pts) return;
      const last = pts[pts.length - 1];
      if (Math.hypot(e.wx - last.x, e.wy - last.y) * stage.scale < 1.5) return;
      pts.push({ x: e.wx, y: e.wy });
      stage.invalidate();
    },
    up() {
      if (!pts) return;
      const p = pts;
      pts = null;
      stage.invalidate();
      if (p.length < 2) return;
      const s = editor.style;
      const { path, cx, cy } = freehandPath(p, 1.2 / stage.scale);
      editor.addElements([makeShape({ path, cx, cy, fill: null, stroke: s.stroke, strokeWidth: Math.max(1, s.strokeWidth) })], 'Lápis');
    },
    cancel() {
      pts = null;
    },
    drawWorld(ctx) {
      if (!pts || pts.length < 2) return;
      const s = editor.style;
      ctx.save();
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = Math.max(1, s.strokeWidth);
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    },
  };
}

// ---------- Mão e zoom ----------
function handTool(stage) {
  let st = null;
  return {
    cursor: 'grab',
    down(e) {
      st = { sx: e.sx, sy: e.sy, panX: stage.view.panX, panY: stage.view.panY };
      stage.setCursor('grabbing');
    },
    move(e) {
      if (!st) return;
      stage.setView(stage.view.zoom, st.panX + e.sx - st.sx, st.panY + e.sy - st.sy);
    },
    up() {
      st = null;
    },
    hover() {
      stage.setCursor('grab');
    },
  };
}

function zoomTool(stage) {
  return {
    cursor: 'zoom-in',
    down(e) {
      stage.zoomTo(stage.view.zoom * (e.alt ? 0.5 : 2), e.sx, e.sy);
    },
    hover(e) {
      stage.setCursor(e.alt ? 'zoom-out' : 'zoom-in');
    },
  };
}
