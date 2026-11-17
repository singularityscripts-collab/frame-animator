// Ferramentas do palco. Cada uma pode ter: down, move, up, hover, cancel, drawWorld, drawScreen, cursor.

import { multiply, invert, applyPoint, translation, scaling, rotation, drawElement, IDENTITY } from '../player/render.js';
import { motionPropsAt, setKey } from '../player/tween.js';
import * as C from './commands.js';
import { clone } from '../model/document.js';
import { rectPath, ellipsePath, linePath, freehandPath, makeShape, pointsBounds, elementLocalBounds, localBoxCorners } from '../model/geometry.js';
import { brushTool, eraserTool, bucketTool, eyedropperTool, gradientTool, ropeStabilizer, ropeLength, pickColor, drawRope } from './tools-paint.js';
import { subselectTool, lassoTool, polystarTool, penTool, anchorTool, textTool, warpTool, threeDTool, widthTool, transformTool, rotateViewTool } from './tools-final.js';
import { boneTool } from './tools-rig.js';
import { simplify } from '../model/geometry.js';

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
    subselect: subselectTool(stage, editor),
    lasso: lassoTool(stage, editor),
    polystar: polystarTool(stage, editor),
    pen: penTool(stage, editor),
    penAdd: anchorTool(stage, editor, 'add'),
    penDelete: anchorTool(stage, editor, 'delete'),
    penConvert: anchorTool(stage, editor, 'convert'),
    text: textTool(stage, editor),
    bone: boneTool(stage, editor),
    warp: warpTool(stage, editor),
    threeD: threeDTool(stage, editor),
    width: widthTool(stage, editor),
    transform: transformTool(stage, editor),
    rotateView: rotateViewTool(stage),
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
  let hoverId = null;
  let lastHandle = null;

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
      const sel = new Set(editor.selection);
      // Alt: tira da seleção (clique na peça ou retângulo de seleção)
      if (e.alt) {
        if (hit) {
          sel.delete(hit.el.id);
          editor.setSelection(sel);
          st = null;
          return;
        }
        st = { mode: 'marquee', op: 'sub', start: e, cur: e, base: sel };
        return;
      }
      if (hit) {
        const id = hit.el.id;
        if (e.shift) {
          // Shift: soma à seleção (ou tira, se a peça já estava selecionada)
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
        // clicar (sem arrastar) numa peça de uma seleção com várias deixa só ela
        st = { mode: 'move', start: e, moved: false, only: !e.shift && sel.has(id) && sel.size > 1 ? id : null };
        stage.setCursor('move');
        return;
      }
      // dentro da moldura da seleção (entre as peças, numa linha fina): arrasta a seleção
      if (fr && !e.shift && stage.insideSelection(fr, e.sx, e.sy)) {
        st = { mode: 'move', start: e, moved: false };
        stage.setCursor('move');
        return;
      }
      if (!e.shift) editor.deselect();
      st = { mode: 'marquee', op: e.shift ? 'add' : 'set', start: e, cur: e, base: new Set(e.shift ? editor.selection : []) };
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
        for (const [k, v] of [['x', p.x], ['y', p.y]]) {
          let keys = tw.props[k] || [];
          if (!keys.length && t !== 0) keys = [{ t: 0, v: motionPropsAt({ ...it.span, tween: st.before }, 0)[k] }];
          tw.props[k] = setKey(keys, t, v);
        }
        it.span.tween = tw;
        stage.invalidate();
        return;
      }
      if (!st.moved) {
        // num quadro interpolado de tween clássico, cria o keyframe antes de mexer
        st.materialized = editor.materialize();
        Object.assign(st, capture());
        st.box0 = editor.selectionBounds();
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
        if (!e.ctrl && st.box0) ({ dx, dy } = stage.snapBox(st.box0, dx, dy, new Set(st.items.map((x) => x.it.el.id))));
        W = T(dx, dy);
        st.readout = `x ${fmtN(dx)}   y ${fmtN(dy)}`;
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
        const ux = Math.hypot(F[0], F[1]), uy = Math.hypot(F[2], F[3]);
        st.readout = `${fmtN(Math.abs(box.w * sx * ux))} × ${fmtN(Math.abs(box.h * sy * uy))}   (${fmtN(sx * 100)}% × ${fmtN(sy * 100)}%)`;
      } else if (st.mode === 'rotate') {
        const { box, F } = st.fr;
        const c = applyPoint(F, box.x + box.w / 2, box.y + box.h / 2);
        let a = Math.atan2(e.wy - c.y, e.wx - c.x) - Math.atan2(st.start.wy - c.y, st.start.wx - c.x);
        if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        W = compose(T(c.x, c.y), rotation(a), T(-c.x, -c.y));
        st.readout = `${fmtN((a * 180) / Math.PI)}°`;
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
          const ids = new Set(s.base);
          for (const it of marqueeItems(stage, s, e)) s.op === 'sub' ? ids.delete(it.el.id) : ids.add(it.el.id);
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
      stage.snapLines = [];
      if (!s.moved) {
        if (s.only) editor.setSelection([s.only]);
        return;
      }
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
      const prev = hoverId;
      hoverId = null;
      if (stage.hitShapeHint(e.sx, e.sy) || stage.hitMotionPath(e.sx, e.sy)) stage.setCursor('pointer');
      else {
        const fr = stage.selectionFrame();
        const h = fr && stage.hitHandle(fr, e.sx, e.sy);
        stage.hoverHandle = h?.handle?.id || (h?.type === 'rotate' ? 'rotate' : null);
        stage.statusHint = null;
        if (h) {
          stage.setCursor(h.cursor);
          stage.statusHint = h.type === 'rotate' ? [['Arraste', 'gira'], ['Shift', 'passos de 15°']] : [['Arraste', 'escala'], ['Shift', 'mantém a proporção'], ['Alt', 'a partir do centro']];
        } else {
          const hit = stage.hitTest(e.wx, e.wy);
          if (hit) stage.statusHint = [['Arraste', 'move'], ['Shift+arraste', 'só na horizontal ou vertical'], ['Ctrl', 'sem encaixe'], ['Shift+clique', 'soma'], ['Alt+clique', 'tira'], ['Duplo clique', hit.el.type === 'instance' ? 'entra no símbolo' : 'edita os pontos']];
          // a peça sob o mouse ganha um contorno: dá para ver o que o clique vai pegar
          if (hit && !editor.selection.has(hit.el.id)) hoverId = hit.el.id;
          stage.setCursor(hit || (fr && stage.insideSelection(fr, e.sx, e.sy)) ? 'move' : 'default');
        }
      }
      if (prev !== hoverId || stage.hoverHandle !== lastHandle) stage.invalidate();
      lastHandle = stage.hoverHandle;
    },

    drawScreen(ctx) {
      // contorno da peça sob o mouse
      if (!st && hoverId) {
        const it = editor.frameItems().find((x) => x.el.id === hoverId);
        if (it) drawItemBox(ctx, stage, editor, it, 'rgba(79,157,255,0.9)', [3, 2]);
      }
      if (st?.mode === 'marquee' && st.moved) {
        const sub = st.op === 'sub';
        // o que o retângulo vai pegar (ou tirar) aparece antes de soltar
        for (const it of marqueeItems(stage, st, st.cur)) drawItemBox(ctx, stage, editor, it, sub ? 'rgba(255,93,93,0.95)' : 'rgba(79,157,255,0.95)', []);
        const x = Math.min(st.start.sx, st.cur.sx), y = Math.min(st.start.sy, st.cur.sy);
        const w = Math.abs(st.cur.sx - st.start.sx), h = Math.abs(st.cur.sy - st.start.sy);
        ctx.save();
        ctx.fillStyle = sub ? 'rgba(255,93,93,0.10)' : 'rgba(79,157,255,0.12)';
        ctx.strokeStyle = sub ? '#ff5d5d' : '#4f9dff';
        ctx.setLineDash([4, 3]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
        ctx.restore();
      }
      // medidas ao mover, escalar e girar
      if (st?.moved && st.readout && stage.lastPointer) drawReadout(ctx, stage.lastPointer.sx + 16, stage.lastPointer.sy + 18, st.readout);
    },
  };
}

const fmtN = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/** Itens que o retângulo de seleção pega: os que encostam nele. */
function marqueeItems(stage, st, e) {
  const r = pointsBounds([
    { x: st.start.wx, y: st.start.wy },
    { x: e.wx, y: e.wy },
  ]);
  return stage.itemsInRect(r);
}

/** Moldura (girada junto com a peça) de um item. */
function drawItemBox(ctx, stage, editor, it, color, dash) {
  const b = elementLocalBounds(it.el, editor.doc, it.offset, it.mcTime);
  const pts = localBoxCorners(it.wm || it.el.matrix, b).map((p) => stage.toScreen(p.x, p.y));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** Etiqueta com as medidas, perto do cursor. */
export function drawReadout(ctx, x, y, text) {
  ctx.save();
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  const cw = ctx.canvas.width / (window.devicePixelRatio || 1);
  if (x + w > cw - 4) x = cw - 4 - w;
  ctx.fillStyle = 'rgba(28,28,32,0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, 20, 4) : ctx.rect(x, y, w, 20);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e6e6ea';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + 10.5);
  ctx.restore();
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
      const p = e.ctrl ? { x: e.wx, y: e.wy } : stage.snapPoint(e.wx, e.wy);
      st = { x0: p.x, y0: p.y, preview: null };
    },
    move(e) {
      if (!st) return;
      if (!e.ctrl) {
        const p = stage.snapPoint(e.wx, e.wy);
        e = { ...e, wx: p.x, wy: p.y };
      }
      const g = geometry(e);
      st.preview = g.w > 0 && g.h > 0 ? build(g) : null;
      stage.invalidate();
    },
    up(e) {
      if (!st) return;
      if (!e.ctrl) {
        const p = stage.snapPoint(e.wx, e.wy);
        e = { ...e, wx: p.x, wy: p.y };
      }
      stage.snapLines = [];
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
  let rope = null;
  return {
    cursor: 'crosshair',
    coalesced: true,
    down(e) {
      // Alt+clique: pega a cor do traço que está embaixo
      if (e.alt) return pickColor(stage, editor, e, 'stroke');
      rope = ropeStabilizer(ropeLength(editor.toolOptions.pencil?.smoothing ?? 25, stage.scale));
      const p = rope.push(e.wx, e.wy);
      pts = [{ x: p.x, y: p.y }];
      stage.render();
      stage.freeze();
    },
    move(e) {
      if (!pts) return;
      const p = rope.push(e.wx, e.wy);
      if (p) {
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * stage.scale >= 1.5) pts.push({ x: p.x, y: p.y });
      }
      stage.invalidate();
    },
    up() {
      if (!pts) return;
      const p = pts;
      pts = null;
      stage.unfreeze();
      if (p.length < 2) return;
      const s = editor.style;
      const { path, cx, cy } = pencilPath(p, editor.toolOptions.pencil?.mode || 'smooth', stage.scale);
      editor.addElements([makeShape({ path, cx, cy, fill: null, stroke: s.stroke, strokeWidth: Math.max(1, s.strokeWidth) })], 'Lápis');
    },
    cancel() {
      pts = null;
      stage.unfreeze();
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
    drawScreen(ctx) {
      if (pts) drawRope(ctx, stage, rope?.point);
    },
  };
}

/**
 * Caminho do lápis conforme o modo:
 * - smooth: curvas suaves; ink: segue o traço quase como foi feito;
 * - straighten: retas e cantos, e reconhece linha, retângulo e elipse.
 */
export function pencilPath(p, mode, scale = 1) {
  if (mode === 'smooth') return freehandPath(p, 1.2 / scale);
  const b = pointsBounds(p);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const toPath = (pts, closed) => ({ path: { closed, pts: pts.map((q) => [q.x - cx, q.y - cy, 0, 0, 0, 0]) }, cx, cy });
  if (mode === 'ink') {
    const pts = simplify(p, 0.35 / scale);
    return toPath(pts.length >= 2 ? pts : [p[0], p[p.length - 1]], false);
  }
  // endireitar
  const diag = Math.hypot(b.w, b.h) || 1;
  const first = p[0], last = p[p.length - 1];
  const closed = p.length > 8 && Math.hypot(first.x - last.x, first.y - last.y) < diag * 0.18;
  if (closed) {
    // elipse? distância ao centro quase constante (normalizada pelos raios)
    const rx = b.w / 2 || 1, ry = b.h / 2 || 1;
    const rs = p.map((q) => Math.hypot((q.x - cx) / rx, (q.y - cy) / ry));
    const mean = rs.reduce((a, r) => a + r, 0) / rs.length;
    const dev = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / rs.length);
    const corners = simplify([...p, first], diag * 0.08);
    if (dev < 0.09 && corners.length > 5) return { path: ellipsePath(b.w, b.h), cx, cy };
    if (corners.length === 5) {
      // quatro cantos perto da caixa: retângulo
      const near = corners.slice(0, 4).every((q) => Math.min(Math.abs(q.x - b.x), Math.abs(q.x - b.x - b.w)) < diag * 0.15 && Math.min(Math.abs(q.y - b.y), Math.abs(q.y - b.y - b.h)) < diag * 0.15);
      if (near) return { path: rectPath(b.w, b.h), cx, cy };
    }
    return toPath(corners.slice(0, -1), true);
  }
  const pts = simplify(p, Math.max(2 / scale, diag * 0.04));
  // quase reta: vira linha; ângulos perto de 0/45/90 encaixam
  if (pts.length === 2) {
    const dx = last.x - first.x, dy = last.y - first.y;
    const a = Math.atan2(dy, dx), step = Math.PI / 4, ar = Math.round(a / step) * step;
    const L = Math.hypot(dx, dy);
    const end = Math.abs(a - ar) < 0.12 ? { x: first.x + Math.cos(ar) * L, y: first.y + Math.sin(ar) * L } : last;
    return toPath([first, end], false);
  }
  return toPath(pts, false);
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
