// Ferramentas da fase final: subseleção, laço, polígono/estrela, caneta (e pontos), texto, ossos,
// malha de pinos, 3D, largura, transformação livre (inclinar, distorcer, envelope) e girar a vista.

import { multiply, invert, applyPoint, translation, IDENTITY, subpaths, layerFrame, drawElement } from '../player/render.js';
import { makeShape, pointsBounds, pathBounds } from '../model/geometry.js';
import { clone } from '../model/document.js';
import { mlsPoint, subdivideSub } from '../player/mesh.js';
import { flattenSub, measure, nearestS, pointAt } from '../player/geom.js';
import * as C from './commands.js';

const inv = (m) => invert(m) || IDENTITY;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Recentraliza um caminho (local) e devolve { path, cx, cy }. */
function recenter(path) {
  const b = pathBounds(path);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (const sp of subpaths(path)) for (const q of sp.pts) {
    q[0] -= cx;
    q[1] -= cy;
  }
  return { path, cx, cy };
}

function setPath(el, path) {
  el.path = path.subs ? { ...path, subs: path.subs.map((s) => ({ closed: s.closed, pts: s.pts })) } : { closed: path.closed, pts: path.pts, ...(path.fillRule ? { fillRule: path.fillRule } : {}) };
}

const mutablePath = (path) => clone(path);
const subOf = (path, i) => subpaths(path)[i];

// ---------- Subseleção (A): editar pontos e alças ----------
export function subselectTool(stage, editor) {
  let st = null;
  let selected = new Set(); // "elId:sub:pt"

  const shapes = () => editor.selectedItems().filter((it) => it.el.type === 'shape' && !it.motion);
  function anchors() {
    const out = [];
    for (const it of shapes()) {
      subpaths(it.el.path).forEach((sp, si) => {
        sp.pts.forEach((q, pi) => {
          const w = applyPoint(it.wm, q[0], q[1]);
          const hi = q[2] || q[3] ? applyPoint(it.wm, q[0] + q[2], q[1] + q[3]) : null;
          const ho = q[4] || q[5] ? applyPoint(it.wm, q[0] + q[4], q[1] + q[5]) : null;
          out.push({ it, si, pi, key: `${it.el.id}:${si}:${pi}`, s: stage.toScreen(w.x, w.y), hi: hi && stage.toScreen(hi.x, hi.y), ho: ho && stage.toScreen(ho.x, ho.y) });
        });
      });
    }
    return out;
  }

  const tool = {
    cursor: 'default',
    get selectedAnchors() {
      return selected;
    },
    down(e) {
      const as = anchors();
      // alças dos pontos selecionados primeiro
      for (const a of as) {
        if (!selected.has(a.key)) continue;
        for (const which of ['hi', 'ho']) {
          if (a[which] && Math.hypot(a[which].x - e.sx, a[which].y - e.sy) <= 6) {
            st = { mode: 'handle', a, which, snap: editor.beginLiveEdit(shapes()), orig: new Map(shapes().map((it) => [it.el.id, clone(it.el.path)])), alt: e.alt };
            return;
          }
        }
      }
      const hitA = as.find((a) => Math.hypot(a.s.x - e.sx, a.s.y - e.sy) <= 6);
      if (hitA) {
        if (e.shift) selected.has(hitA.key) ? selected.delete(hitA.key) : selected.add(hitA.key);
        else if (!selected.has(hitA.key)) selected = new Set([hitA.key]);
        st = { mode: 'anchors', start: e, snap: editor.beginLiveEdit(shapes()), orig: new Map(shapes().map((it) => [it.el.id, clone(it.el.path)])) };
        stage.invalidate();
        return;
      }
      const hit = stage.hitTest(e.wx, e.wy);
      if (hit?.el.type === 'shape') {
        if (!editor.selection.has(hit.el.id)) {
          editor.setSelection(e.shift ? [...editor.selection, hit.el.id] : [hit.el.id]);
          selected = new Set();
        }
        return;
      }
      if (!e.shift) selected = new Set();
      st = { mode: 'marquee', start: e, cur: e };
      stage.invalidate();
    },
    move(e) {
      if (!st) return;
      if (st.mode === 'marquee') {
        st.cur = e;
        stage.invalidate();
        return;
      }
      for (const it of shapes()) {
        const orig = st.orig.get(it.el.id);
        if (!orig) continue;
        const path = mutablePath(orig);
        const im = inv(it.wm);
        if (st.mode === 'anchors') {
          const a = applyPoint(im, st.start.wx, st.start.wy), b = applyPoint(im, e.wx, e.wy);
          const dx = b.x - a.x, dy = b.y - a.y;
          subpaths(path).forEach((sp, si) =>
            sp.pts.forEach((q, pi) => {
              if (!selected.has(`${it.el.id}:${si}:${pi}`)) return;
              q[0] += dx;
              q[1] += dy;
            }),
          );
        } else if (it.el.id === st.a.it.el.id) {
          const q = subOf(path, st.a.si).pts[st.a.pi];
          const p = applyPoint(im, e.wx, e.wy);
          const o = st.which === 'hi' ? [2, 3] : [4, 5], other = st.which === 'hi' ? [4, 5] : [2, 3];
          const oq = subOf(orig, st.a.si).pts[st.a.pi];
          const smooth = (() => {
            const a1 = Math.atan2(oq[3], oq[2]), a2 = Math.atan2(oq[5], oq[4]);
            const d = Math.abs(Math.atan2(Math.sin(a1 - a2 - Math.PI), Math.cos(a1 - a2 - Math.PI)));
            return (oq[2] || oq[3]) && (oq[4] || oq[5]) && d < 0.09;
          })();
          q[o[0]] = p.x - q[0];
          q[o[1]] = p.y - q[1];
          if (smooth && !e.alt) {
            // alça suave: a do outro lado acompanha a direção, mantendo o tamanho
            const L = Math.hypot(oq[other[0]], oq[other[1]]);
            const l = Math.hypot(q[o[0]], q[o[1]]) || 1;
            q[other[0]] = (-q[o[0]] / l) * L;
            q[other[1]] = (-q[o[1]] / l) * L;
          }
        }
        it.el.path = path;
      }
      stage.invalidate();
    },
    up(e) {
      if (!st) return;
      const s = st;
      st = null;
      if (s.mode === 'marquee') {
        const r = pointsBounds([
          { x: s.start.sx, y: s.start.sy },
          { x: e.sx, y: e.sy },
        ]);
        for (const a of anchors()) if (a.s.x >= r.x && a.s.x <= r.x + r.w && a.s.y >= r.y && a.s.y <= r.y + r.h) selected.add(a.key);
        stage.invalidate();
        return;
      }
      editor.endLiveEdit(s.mode === 'handle' ? 'Mover alça' : 'Mover pontos', s.snap);
    },
    cancel() {
      if (st?.snap) editor.cancelLiveEdit(st.snap);
      st = null;
    },
    /** Delete: apaga os pontos selecionados (a forma some se sobrar pouco). */
    deleteSelection() {
      if (!selected.size) return false;
      const keys = selected;
      editor.updateSelection('Apagar pontos', (el) => {
        if (el.type !== 'shape') return;
        const path = clone(el.path);
        const subs = subpaths(path)
          .map((sp, si) => ({ closed: sp.closed, pts: sp.pts.filter((_, pi) => !keys.has(`${el.id}:${si}:${pi}`)) }))
          .filter((sp) => sp.pts.length >= (sp.closed ? 3 : 2));
        if (!subs.length) {
          el.path = { closed: false, pts: [] };
          return;
        }
        el.path = subs.length === 1 ? subs[0] : { ...path, subs };
      });
      selected = new Set();
      // formas vazias saem
      const empty = editor.selectedItems().filter((it) => it.el.type === 'shape' && !subpaths(it.el.path).some((sp) => sp.pts.length));
      if (empty.length) {
        editor.setSelection(empty.map((it) => it.el.id));
        editor.deleteSelection();
      }
      return true;
    },
    hover(e) {
      const a = anchors().find((x) => Math.hypot(x.s.x - e.sx, x.s.y - e.sy) <= 6);
      stage.setCursor(a ? 'move' : 'default');
    },
    drawScreen(ctx) {
      const as = anchors();
      ctx.save();
      for (const it of shapes()) {
        // contorno do caminho
        ctx.strokeStyle = '#4f9dff';
        ctx.lineWidth = 1;
        ctx.save();
        ctx.setTransform(...multiply([stage.dpr, 0, 0, stage.dpr, 0, 0], multiply(stage.screenMatrix(), it.wm)));
        ctx.lineWidth = 1 / (stage.scale * Math.sqrt(Math.abs(it.wm[0] * it.wm[3] - it.wm[1] * it.wm[2])) || 1);
        ctx.stroke(new Path2D(pathToSvg(it.el.path)));
        ctx.restore();
      }
      for (const a of as) {
        const sel = selected.has(a.key);
        if (sel) {
          ctx.strokeStyle = '#ffd60a';
          for (const h of [a.hi, a.ho]) {
            if (!h) continue;
            ctx.beginPath();
            ctx.moveTo(a.s.x, a.s.y);
            ctx.lineTo(h.x, h.y);
            ctx.stroke();
            ctx.fillStyle = '#ffd60a';
            ctx.beginPath();
            ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = sel ? '#4f9dff' : '#ffffff';
        ctx.strokeStyle = '#1d3a66';
        ctx.fillRect(a.s.x - 3.5, a.s.y - 3.5, 7, 7);
        ctx.strokeRect(a.s.x - 3.5, a.s.y - 3.5, 7, 7);
      }
      if (st?.mode === 'marquee') {
        ctx.strokeStyle = '#4f9dff';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(Math.min(st.start.sx, st.cur.sx), Math.min(st.start.sy, st.cur.sy), Math.abs(st.cur.sx - st.start.sx), Math.abs(st.cur.sy - st.start.sy));
      }
      ctx.restore();
    },
  };
  return tool;
}

/** Caminho → texto SVG (para desenhar contornos de ajuda). */
export function pathToSvg(path) {
  let d = '';
  for (const sp of subpaths(path)) {
    const pts = sp.pts;
    const n = pts.length;
    if (!n) continue;
    d += `M${pts[0][0]} ${pts[0][1]}`;
    const segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      d += a[4] || a[5] || b[2] || b[3] ? `C${a[0] + a[4]} ${a[1] + a[5]} ${b[0] + b[2]} ${b[1] + b[3]} ${b[0]} ${b[1]}` : `L${b[0]} ${b[1]}`;
    }
    if (sp.closed) d += 'Z';
  }
  return d;
}

// ---------- Laço (L): livre ou poligonal ----------
export function lassoTool(stage, editor) {
  let pts = null;
  const mode = () => editor.toolOptions.lasso?.mode || 'free';
  function finish(shift) {
    const poly = pts;
    pts = null;
    stage.invalidate();
    if (!poly || poly.length < 3) return;
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    const ids = new Set(shift ? editor.selection : []);
    for (const it of editor.frameItems()) {
      const b = editor.boundsOf(it);
      if (inside(b.x + b.w / 2, b.y + b.h / 2)) ids.add(it.el.id);
    }
    editor.setSelection(ids);
  }
  return {
    cursor: 'crosshair',
    down(e) {
      if (mode() === 'polygon') {
        if (!pts) pts = [];
        if (pts.length >= 3 && dist(stage.toScreen(pts[0].x, pts[0].y), { x: e.sx, y: e.sy }) < 8) return finish(e.shift);
        pts.push({ x: e.wx, y: e.wy });
        stage.invalidate();
        return;
      }
      pts = [{ x: e.wx, y: e.wy }];
    },
    move(e) {
      if (!pts || mode() === 'polygon') return;
      pts.push({ x: e.wx, y: e.wy });
      stage.invalidate();
    },
    up(e) {
      if (mode() !== 'polygon') finish(e.shift);
    },
    hover(e) {
      this.mouse = e;
      if (pts && mode() === 'polygon') stage.invalidate();
    },
    keydown(e) {
      if (!pts) return false;
      if (e.key === 'Enter') finish(e.shiftKey);
      else if (e.key === 'Escape') {
        pts = null;
        stage.invalidate();
      } else return false;
      return true;
    },
    cancel() {
      pts = null;
    },
    drawScreen(ctx) {
      if (!pts?.length) return;
      ctx.save();
      ctx.strokeStyle = '#4f9dff';
      ctx.fillStyle = 'rgba(79,157,255,0.1)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = stage.toScreen(p.x, p.y);
        i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
      });
      if (mode() === 'polygon' && this.mouse) ctx.lineTo(this.mouse.sx, this.mouse.sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  };
}

// ---------- Polígono / estrela ----------
export function polystarPath(w, h, sides, star, inner) {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const pts = [];
  const count = star ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    const r = star && i % 2 ? inner : 1;
    pts.push([(Math.cos(a) * r * w) / 2, (Math.sin(a) * r * h) / 2, 0, 0, 0, 0]);
  }
  return { closed: true, pts };
}

export function polystarTool(stage, editor) {
  let st = null;
  const opts = () => editor.toolOptions.polystar;
  const geom = (e) => {
    let dx = e.wx - st.x0, dy = e.wy - st.y0;
    if (e.shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    return { cx: st.x0, cy: st.y0, w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  };
  const build = (g) => {
    const o = opts();
    const s = editor.style;
    return makeShape({ path: polystarPath(g.w, g.h, o.sides, o.style === 'star', (o.inner ?? 50) / 100), cx: g.cx, cy: g.cy, fill: s.fillOn ? s.fill : null, stroke: s.strokeOn ? s.stroke : null, strokeWidth: s.strokeWidth });
  };
  return {
    cursor: 'crosshair',
    down(e) {
      const p = stage.snapPoint(e.wx, e.wy);
      st = { x0: p.x, y0: p.y };
    },
    move(e) {
      if (!st) return;
      const g = geom(e);
      st.preview = g.w > 0 ? build(g) : null;
      stage.invalidate();
    },
    up(e) {
      if (!st) return;
      const g = geom(e);
      st = null;
      stage.invalidate();
      if (g.w * stage.scale < 3) return;
      editor.addElements([build(g)], opts().style === 'star' ? 'Estrela' : 'Polígono');
    },
    cancel() {
      st = null;
    },
    drawWorld(ctx) {
      if (st?.preview) drawElement(ctx, editor.doc, st.preview);
    },
  };
}

// ---------- Caneta (P) ----------
export function penTool(stage, editor) {
  let pts = null; // [{ x, y, ix, iy, ox, oy }] no mundo
  let drag = null;
  let mouse = null;
  function finish(closed) {
    const p = pts;
    pts = null;
    drag = null;
    stage.invalidate();
    if (!p || p.length < 2) return;
    const path = { closed, pts: p.map((q) => [q.x, q.y, q.ix || 0, q.iy || 0, q.ox || 0, q.oy || 0]) };
    const r = recenter(path);
    const s = editor.style;
    editor.addElements(
      [makeShape({ path: r.path, cx: r.cx, cy: r.cy, fill: closed && s.fillOn ? s.fill : null, stroke: s.strokeOn || !closed ? s.stroke : null, strokeWidth: Math.max(closed ? 0 : 1, s.strokeWidth) })],
      'Caneta',
    );
  }
  return {
    cursor: 'crosshair',
    down(e) {
      const p = e.ctrl ? { x: e.wx, y: e.wy } : stage.snapPoint(e.wx, e.wy);
      if (!pts) pts = [];
      if (pts.length >= 2 && dist(stage.toScreen(pts[0].x, pts[0].y), { x: e.sx, y: e.sy }) < 8) return finish(true);
      const q = { x: p.x, y: p.y };
      pts.push(q);
      drag = { q, start: e };
      stage.invalidate();
    },
    move(e) {
      mouse = e;
      if (!drag) return;
      if (Math.hypot(e.sx - drag.start.sx, e.sy - drag.start.sy) < 3) return;
      // arrastar puxa as alças (simétricas)
      drag.q.ox = e.wx - drag.q.x;
      drag.q.oy = e.wy - drag.q.y;
      drag.q.ix = -drag.q.ox;
      drag.q.iy = -drag.q.oy;
      stage.invalidate();
    },
    up() {
      drag = null;
    },
    hover(e) {
      mouse = e;
      if (pts) stage.invalidate();
    },
    keydown(e) {
      if (!pts) return false;
      if (e.key === 'Enter') finish(false);
      else if (e.key === 'Escape') finish(false);
      else return false;
      return true;
    },
    dblclick() {
      if (pts) {
        pts.pop();
        finish(false);
      }
    },
    cancel() {
      pts = null;
    },
    drawScreen(ctx) {
      if (!pts?.length) return;
      ctx.save();
      ctx.strokeStyle = '#4f9dff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((q, i) => {
        const s = stage.toScreen(q.x, q.y);
        if (!i) return ctx.moveTo(s.x, s.y);
        const a = pts[i - 1];
        const c1 = stage.toScreen(a.x + (a.ox || 0), a.y + (a.oy || 0)), c2 = stage.toScreen(q.x + (q.ix || 0), q.y + (q.iy || 0));
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, s.x, s.y);
      });
      if (mouse && !drag) ctx.lineTo(mouse.sx, mouse.sy);
      ctx.stroke();
      for (const q of pts) {
        const s = stage.toScreen(q.x, q.y);
        ctx.fillStyle = '#fff';
        ctx.fillRect(s.x - 3.5, s.y - 3.5, 7, 7);
        ctx.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7);
        if (q.ox || q.oy) {
          const h = stage.toScreen(q.x + q.ox, q.y + q.oy), h2 = stage.toScreen(q.x + q.ix, q.y + q.iy);
          ctx.beginPath();
          ctx.moveTo(h2.x, h2.y);
          ctx.lineTo(h.x, h.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}

/** Ponto mais perto num caminho local: { si, i (segmento), t, x, y }. */
function nearestOnPath(path, x, y) {
  let best = null;
  subpaths(path).forEach((sp, si) => {
    const n = sp.pts.length;
    const segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = sp.pts[i], b = sp.pts[(i + 1) % n];
      for (let k = 0; k <= 40; k++) {
        const t = k / 40, u = 1 - t;
        const px = u * u * u * a[0] + 3 * u * u * t * (a[0] + a[4]) + 3 * u * t * t * (b[0] + b[2]) + t * t * t * b[0];
        const py = u * u * u * a[1] + 3 * u * u * t * (a[1] + a[5]) + 3 * u * t * t * (b[1] + b[3]) + t * t * t * b[1];
        const d = Math.hypot(px - x, py - y);
        if (!best || d < best.d) best = { si, i, t, x: px, y: py, d };
      }
    }
  });
  return best;
}

/** Ferramentas de ponto: adicionar (=), remover (-) e converter (Shift+C) pontos de âncora. */
export function anchorTool(stage, editor, kind) {
  let st = null;
  const target = (e) => {
    const sel = editor.selectedItems().filter((it) => it.el.type === 'shape' && !it.motion);
    if (sel.length) return sel;
    const hit = stage.hitTest(e.wx, e.wy);
    if (hit?.el.type === 'shape') {
      editor.setSelection([hit.el.id]);
      return [hit];
    }
    return [];
  };
  return {
    cursor: kind === 'add' ? 'copy' : kind === 'delete' ? 'not-allowed' : 'alias',
    down(e) {
      for (const it of target(e)) {
        const im = inv(it.wm);
        const p = applyPoint(im, e.wx, e.wy);
        const tol = 8 / (stage.scale * (Math.sqrt(Math.abs(it.wm[0] * it.wm[3] - it.wm[1] * it.wm[2])) || 1));
        const subs = subpaths(it.el.path);
        let anchor = null;
        subs.forEach((sp, si) => sp.pts.forEach((q, pi) => {
          if (Math.hypot(q[0] - p.x, q[1] - p.y) <= tol) anchor = { si, pi };
        }));
        if (kind === 'add') {
          const n = nearestOnPath(it.el.path, p.x, p.y);
          if (!n || n.d > tol) continue;
          editor.updateItems([it], 'Adicionar ponto', (el) => {
            const path = clone(el.path);
            const sp = subOf(path, n.si);
            const a = sp.pts[n.i], b = sp.pts[(n.i + 1) % sp.pts.length];
            const t = n.t;
            const L = (p0, p1) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
            const P0 = [a[0], a[1]], P1 = [a[0] + a[4], a[1] + a[5]], P2 = [b[0] + b[2], b[1] + b[3]], P3 = [b[0], b[1]];
            const q0 = L(P0, P1), q1 = L(P1, P2), q2 = L(P2, P3), r0 = L(q0, q1), r1 = L(q1, q2), s = L(r0, r1);
            const curved = a[4] || a[5] || b[2] || b[3];
            if (curved) {
              a[4] = q0[0] - a[0];
              a[5] = q0[1] - a[1];
              b[2] = q2[0] - b[0];
              b[3] = q2[1] - b[1];
            }
            sp.pts.splice(n.i + 1, 0, curved ? [s[0], s[1], r0[0] - s[0], r0[1] - s[1], r1[0] - s[0], r1[1] - s[1]] : [s[0], s[1], 0, 0, 0, 0]);
            setPath(el, path);
          });
          return;
        }
        if (!anchor) continue;
        if (kind === 'delete') {
          editor.updateItems([it], 'Remover ponto', (el) => {
            const path = clone(el.path);
            const sp = subOf(path, anchor.si);
            if (sp.pts.length > (sp.closed ? 3 : 2)) sp.pts.splice(anchor.pi, 1);
            setPath(el, path);
          });
          return;
        }
        // converter: com alças vira canto; sem alças, arrastar puxa alças novas
        const q = subs[anchor.si].pts[anchor.pi];
        if (q[2] || q[3] || q[4] || q[5]) {
          editor.updateItems([it], 'Converter ponto', (el) => {
            const path = clone(el.path);
            const qq = subOf(path, anchor.si).pts[anchor.pi];
            qq[2] = qq[3] = qq[4] = qq[5] = 0;
            setPath(el, path);
          });
          return;
        }
        st = { it, anchor, snap: editor.beginLiveEdit([it]), orig: clone(it.el.path), im };
        return;
      }
    },
    move(e) {
      if (!st) return;
      const p = applyPoint(st.im, e.wx, e.wy);
      const path = clone(st.orig);
      const q = subOf(path, st.anchor.si).pts[st.anchor.pi];
      q[4] = p.x - q[0];
      q[5] = p.y - q[1];
      q[2] = -q[4];
      q[3] = -q[5];
      st.it.el.path = path;
      stage.invalidate();
    },
    up() {
      if (!st) return;
      const s = st;
      st = null;
      editor.endLiveEdit('Converter ponto', s.snap);
    },
    cancel() {
      if (st) editor.cancelLiveEdit(st.snap);
      st = null;
    },
    drawScreen(ctx) {
      stage.tools.subselect.drawScreen(ctx);
    },
  };
}

// ---------- Texto (T) ----------
export function textTool(stage, editor) {
  return {
    cursor: 'text',
    down(e) {
      const hit = stage.hitTest(e.wx, e.wy);
      if (hit?.el.type === 'text') return stage.editText(hit);
      const el = editor.addText(e.wx, e.wy - (editor.textDefaults.size || 32) * 0.6, '');
      if (!el) return;
      const it = editor.frameItems().find((x) => x.el.id === el.id);
      if (it) stage.editText(it, true);
    },
  };
}

// ---------- Ossos (M): ver tools-rig.js ----------

// ---------- Malha de pinos (W) ----------
export function warpTool(stage, editor) {
  let st = null;
  const target = () => {
    const sel = editor.selectedItems().filter((it) => (it.el.type === 'shape' || it.el.type === 'bitmap') && !it.motion);
    return sel.length === 1 ? sel[0] : null;
  };
  const pinsScreen = (it) =>
    (it.el.warp?.pins || []).map((p, i) => {
      const w = applyPoint(it.wm, p.x + p.dx, p.y + p.dy);
      return { i, ...stage.toScreen(w.x, w.y) };
    });
  return {
    cursor: 'crosshair',
    down(e) {
      let it = target();
      if (!it) {
        const hit = stage.hitTest(e.wx, e.wy);
        if (hit && (hit.el.type === 'shape' || hit.el.type === 'bitmap')) {
          editor.setSelection([hit.el.id]);
          it = hit;
        } else return editor.toast('Clique numa forma ou imagem para pôr pinos.');
      }
      const pin = pinsScreen(it).find((p) => Math.hypot(p.x - e.sx, p.y - e.sy) <= 8);
      if (pin && e.alt) {
        editor.updateItems([it], 'Tirar pino', (el) => {
          el.warp = { pins: el.warp.pins.filter((_, i) => i !== pin.i) };
          if (!el.warp.pins.length) delete el.warp;
        });
        return;
      }
      if (pin) {
        st = { it, i: pin.i, snap: editor.beginLiveEdit([it]), im: inv(it.wm) };
        return;
      }
      // pino novo: acha o ponto de descanso que hoje aparece sob o clique
      const pins = it.el.warp?.pins || [];
      const target2 = applyPoint(inv(it.wm), e.wx, e.wy);
      let r = { ...target2 };
      for (let k = 0; k < 12 && pins.length; k++) {
        const m = mlsPoint(pins, r.x, r.y);
        r = { x: r.x + (target2.x - m.x), y: r.y + (target2.y - m.y) };
      }
      editor.updateItems([it], 'Pino', (el) => {
        el.warp = { pins: [...(el.warp?.pins || []), { x: r.x, y: r.y, dx: target2.x - r.x, dy: target2.y - r.y }] };
      });
    },
    move(e) {
      if (!st) return;
      const p = applyPoint(st.im, e.wx, e.wy);
      const pins = st.it.el.warp.pins.map((q, i) => (i === st.i ? { ...q, dx: p.x - q.x, dy: p.y - q.y } : q));
      st.it.el.warp = { pins };
      stage.invalidate();
    },
    up() {
      if (!st) return;
      const s = st;
      st = null;
      editor.endLiveEdit('Mover pino', s.snap);
    },
    cancel() {
      if (st) editor.cancelLiveEdit(st.snap);
      st = null;
    },
    drawScreen(ctx) {
      const it = target();
      if (!it) return;
      ctx.save();
      for (const p of pinsScreen(it)) {
        ctx.fillStyle = '#ff2d95';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// ---------- 3D (G) ----------
export function threeDTool(stage, editor) {
  let st = null;
  return {
    cursor: 'move',
    down(e) {
      let it = editor.selectedItems().find((x) => x.el.type === 'instance');
      const hit = stage.hitTest(e.wx, e.wy);
      if (hit?.el.type === 'instance' && hit.el.id !== it?.el.id) {
        editor.setSelection([hit.el.id]);
        it = hit;
      }
      if (!it) return editor.toast('Clique numa instância de símbolo (de preferência movie clip) para girar em 3D.');
      editor.materialize();
      it = editor.selectedItems().find((x) => x.el.type === 'instance');
      st = { it, start: e, snap: editor.beginLiveEdit([it]), rx: it.el.rx || 0, ry: it.el.ry || 0, z: it.el.z || 0 };
    },
    move(e) {
      if (!st) return;
      const dx = e.sx - st.start.sx, dy = e.sy - st.start.sy;
      const el = st.it.el;
      if (e.shift) el.z = Math.round(st.z + dy * 2);
      else {
        el.ry = Math.round(((st.ry + dx * 0.5 + 540) % 360) - 180);
        el.rx = Math.round(((st.rx - dy * 0.5 + 540) % 360) - 180);
      }
      stage.invalidate();
      editor.emit('selection');
    },
    up() {
      if (!st) return;
      const s = st;
      st = null;
      editor.endLiveEdit('3D', s.snap);
    },
    cancel() {
      if (st) editor.cancelLiveEdit(st.snap);
      st = null;
    },
    drawScreen(ctx) {
      const it = editor.selectedItems().find((x) => x.el.type === 'instance');
      if (!it) return;
      const c = stage.toScreen(it.wm[4], it.wm[5]);
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ff3b30';
      ctx.beginPath();
      ctx.moveTo(c.x - 40, c.y);
      ctx.lineTo(c.x + 40, c.y);
      ctx.stroke();
      ctx.strokeStyle = '#34c759';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 40);
      ctx.lineTo(c.x, c.y + 40);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillText(`X ${Math.round(it.el.rx || 0)}°  Y ${Math.round(it.el.ry || 0)}°  Z ${Math.round(it.el.z || 0)}`, c.x + 8, c.y - 8);
      ctx.restore();
    },
  };
}

// ---------- Largura (U) ----------
export function widthTool(stage, editor) {
  let st = null;
  let hover = null;
  const strokes = () => editor.frameItems().filter((it) => it.el.type === 'shape' && it.el.stroke && it.el.strokeWidth > 0 && !it.motion);
  function locate(it, e) {
    const p = applyPoint(inv(it.wm), e.wx, e.wy);
    let acc = 0, best = null;
    const subs = subpaths(it.el.path).map((sp) => measure(flattenSub(sp, IDENTITY, 12)));
    const total = subs.reduce((n, m) => n + m.total, 0) || 1;
    for (const m of subs) {
      const s = nearestS(m, p.x, p.y);
      const q = pointAt(m, s);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || d < best.d) best = { d, t: (acc + s) / total, q };
      acc += m.total;
    }
    return best;
  }
  return {
    cursor: 'crosshair',
    down(e) {
      for (const it of [...strokes()].reverse()) {
        const l = locate(it, e);
        const sc = Math.sqrt(Math.abs(it.wm[0] * it.wm[3] - it.wm[1] * it.wm[2])) || 1;
        if (!l || l.d * sc * stage.scale > it.el.strokeWidth * sc * stage.scale / 2 + 10) continue;
        if (e.alt) {
          editor.updateItems([it], 'Tirar ponto de largura', (el) => {
            el.widthProfile = (el.widthProfile || []).filter((w) => Math.abs(w.t - l.t) > 0.03);
            if (!el.widthProfile.length) delete el.widthProfile;
          });
          return;
        }
        st = { it, t: l.t, snap: editor.beginLiveEdit([it]), base: clone(it.el.widthProfile || []) };
        return;
      }
    },
    move(e) {
      if (!st) {
        hover = null;
        for (const it of strokes()) {
          const l = locate(it, e);
          if (l && l.d * stage.scale < it.el.strokeWidth * stage.scale / 2 + 10) hover = { it, l };
        }
        stage.invalidate();
        return;
      }
      const l = locate(st.it, e);
      const w = Math.max(0.05, (2 * l.d) / (st.it.el.strokeWidth || 1));
      const prof = st.base.filter((x) => Math.abs(x.t - st.t) > 0.03);
      prof.push({ t: st.t, w });
      st.it.el.widthProfile = prof.sort((a, b) => a.t - b.t);
      stage.invalidate();
    },
    hover(e) {
      this.move(e);
    },
    up() {
      if (!st) return;
      const s = st;
      st = null;
      editor.endLiveEdit('Largura do traço', s.snap);
    },
    cancel() {
      if (st) editor.cancelLiveEdit(st.snap);
      st = null;
    },
    drawScreen(ctx) {
      ctx.save();
      for (const it of strokes()) {
        if (!it.el.widthProfile?.length && hover?.it.el.id !== it.el.id) continue;
        const subs = subpaths(it.el.path).map((sp) => measure(flattenSub(sp, IDENTITY, 12)));
        const total = subs.reduce((n, m) => n + m.total, 0);
        for (const wp of it.el.widthProfile || []) {
          let s = wp.t * total;
          const m = subs.find((x) => {
            if (s <= x.total) return true;
            s -= x.total;
            return false;
          });
          if (!m) continue;
          const q = pointAt(m, s);
          const w = applyPoint(it.wm, q.x, q.y);
          const sc = stage.toScreen(w.x, w.y);
          ctx.fillStyle = '#ffd60a';
          ctx.beginPath();
          ctx.moveTo(sc.x, sc.y - 5);
          ctx.lineTo(sc.x + 5, sc.y);
          ctx.lineTo(sc.x, sc.y + 5);
          ctx.lineTo(sc.x - 5, sc.y);
          ctx.fill();
        }
      }
      if (hover && !st) {
        const w = applyPoint(hover.it.wm, hover.l.q.x, hover.l.q.y);
        const s = stage.toScreen(w.x, w.y);
        ctx.strokeStyle = '#ffd60a';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// ---------- Transformação livre (Q): inclinar, distorcer e envelope ----------
/** Ponto de um retalho de Bézier bicúbico (4×4 pontos de controle) em u, v. */
function patchPoint(cp, u, v) {
  const B = (t) => [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3];
  const bu = B(u), bv = B(v);
  let x = 0, y = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const w = bu[i] * bv[j];
    x += cp[j * 4 + i].x * w;
    y += cp[j * 4 + i].y * w;
  }
  return { x, y };
}

export function transformTool(stage, editor) {
  let st = null;
  let lattice = null; // pontos de controle no mundo (envelope) ou cantos (distorcer)
  let latticeFor = null;
  const mode = () => editor.toolOptions.transform?.mode || 'free';
  const sel = () => editor.selectedItems().filter((it) => !it.motion);

  function ensureLattice() {
    const items = sel();
    const key = items.map((it) => it.el.id).join() + mode();
    if (latticeFor === key && lattice) return lattice;
    latticeFor = key;
    const b = editor.selectionBounds();
    if (!b) return (lattice = null);
    if (mode() === 'distort') lattice = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
    else if (mode() === 'envelope') {
      lattice = [];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) lattice.push({ x: b.x + (b.w * i) / 3, y: b.y + (b.h * j) / 3 });
    } else lattice = null;
    return lattice;
  }

  /** Deforma os caminhos guardados (no início) pela grade atual. */
  function applyDeform(items, origs, box) {
    const map = (x, y) => {
      const u = (x - box.x) / (box.w || 1), v = (y - box.y) / (box.h || 1);
      if (mode() === 'distort') {
        const [a, b, c, d] = lattice;
        const top = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, bot = { x: d.x + (c.x - d.x) * u, y: d.y + (c.y - d.y) * u };
        return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
      }
      return patchPoint(lattice, u, v);
    };
    for (const it of items) {
      const orig = origs.get(it.el.id);
      if (!orig) continue;
      const im = inv(it.wm);
      const subs = subpaths(orig).map((sp) => {
        const s2 = subdivideSub(sp, mode() === 'envelope' ? 4 : 1);
        return {
          closed: sp.closed,
          pts: s2.pts.map((q) => {
            const w = applyPoint(it.wm, q[0], q[1]);
            const p = applyPoint(im, ...Object.values(map(w.x, w.y)));
            const hi = q[2] || q[3] ? applyPoint(im, ...Object.values(map(...Object.values(applyPoint(it.wm, q[0] + q[2], q[1] + q[3]))))) : null;
            const ho = q[4] || q[5] ? applyPoint(im, ...Object.values(map(...Object.values(applyPoint(it.wm, q[0] + q[4], q[1] + q[5]))))) : null;
            return [p.x, p.y, hi ? hi.x - p.x : 0, hi ? hi.y - p.y : 0, ho ? ho.x - p.x : 0, ho ? ho.y - p.y : 0];
          }),
        };
      });
      it.el.path = subs.length === 1 ? subs[0] : { closed: orig.closed, fillRule: orig.fillRule, subs };
    }
  }

  return {
    cursor: 'default',
    down(e) {
      if (mode() === 'free') {
        // perto de uma borda (fora das alças) inclina; o resto é como a seleção
        const fr = stage.selectionFrame();
        if (fr && !stage.hitHandle(fr, e.sx, e.sy)) {
          const hs = stage.handles(fr);
          const by = Object.fromEntries(hs.map((h) => [h.id, h]));
          const edges = [['nw', 'ne', 'x', 'sw'], ['sw', 'se', 'x', 'nw'], ['nw', 'sw', 'y', 'ne'], ['ne', 'se', 'y', 'nw']];
          for (const [a, b, axis, opp] of edges) {
            const A = by[a], Bp = by[b];
            const vx = Bp.x - A.x, vy = Bp.y - A.y;
            const l2 = vx * vx + vy * vy || 1;
            const t = ((e.sx - A.x) * vx + (e.sy - A.y) * vy) / l2;
            if (t < 0.15 || t > 0.85 || Math.abs(t - 0.5) < 0.08) continue;
            if (Math.hypot(A.x + vx * t - e.sx, A.y + vy * t - e.sy) > 5) continue;
            editor.materialize();
            const items = sel();
            st = { mode: 'skew', axis, edge: a, opp: by[opp], fr: stage.selectionFrame(), start: e, items: items.map((it) => ({ it, m0: it.el.matrix.slice() })), snap: editor.beginLiveEdit(items) };
            return;
          }
        }
        return stage.tools.select.down(e);
      }
      const lat = ensureLattice();
      if (!lat) return stage.tools.select.down(e);
      const i = lat.findIndex((p) => {
        const s = stage.toScreen(p.x, p.y);
        return Math.hypot(s.x - e.sx, s.y - e.sy) <= 7;
      });
      if (i < 0) return stage.tools.select.down(e);
      const items = sel().filter((it) => it.el.type === 'shape');
      if (!items.length) return editor.toast('Distorcer e envelope só valem para formas (não para símbolos).');
      st = { mode: 'lattice', i, items, box: editor.selectionBounds(), origs: new Map(items.map((it) => [it.el.id, clone(it.el.path)])), snap: editor.beginLiveEdit(items), lat0: lattice.map((p) => ({ ...p })) };
    },
    move(e) {
      if (!st) return stage.tools.select.move(e);
      if (st.mode === 'skew') {
        const { F, box } = st.fr;
        const Finv = inv(F);
        const p = applyPoint(Finv, e.wx, e.wy), p0 = applyPoint(Finv, st.start.wx, st.start.wy);
        const sign = st.edge === 'nw' && st.axis === 'x' ? -1 : st.edge === 'nw' && st.axis === 'y' ? -1 : 1;
        const k = st.axis === 'x' ? ((p.x - p0.x) / (box.h || 1)) * sign : ((p.y - p0.y) / (box.w || 1)) * sign;
        const ax = box.x + box.w / 2, ay = box.y + box.h / 2;
        const S = st.axis === 'x' ? [1, 0, k, 1, 0, 0] : [1, k, 0, 1, 0, 0];
        const W = multiply(F, multiply(translation(ax, ay), multiply(S, multiply(translation(-ax, -ay), Finv))));
        for (const { it, m0 } of st.items) {
          const lm = it.lm || IDENTITY;
          editor.setLiveMatrix(it, multiply(inv(lm), multiply(W, multiply(lm, m0))));
        }
        stage.invalidate();
        return;
      }
      lattice[st.i] = { x: e.wx, y: e.wy };
      applyDeform(st.items, st.origs, st.box);
      stage.invalidate();
    },
    up(e) {
      if (!st) return stage.tools.select.up(e);
      const s = st;
      st = null;
      editor.endLiveEdit(s.mode === 'skew' ? 'Inclinar' : mode() === 'distort' ? 'Distorcer' : 'Envelope', s.snap);
      latticeFor = null;
    },
    cancel() {
      if (st?.snap) editor.cancelLiveEdit(st.snap);
      if (st?.lat0) lattice = st.lat0;
      st = null;
      stage.tools.select.cancel();
    },
    hover(e) {
      if (mode() === 'free') return stage.tools.select.hover(e);
      stage.setCursor('default');
    },
    drawScreen(ctx) {
      if (mode() === 'free') return stage.tools.select.drawScreen(ctx);
      const lat = ensureLattice();
      if (!lat) return;
      ctx.save();
      ctx.strokeStyle = '#4f9dff';
      const S = lat.map((p) => stage.toScreen(p.x, p.y));
      ctx.beginPath();
      if (mode() === 'distort') {
        S.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
      } else {
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
          const p = S[j * 4 + i];
          if (i < 3) {
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(S[j * 4 + i + 1].x, S[j * 4 + i + 1].y);
          }
          if (j < 3) {
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(S[(j + 1) * 4 + i].x, S[(j + 1) * 4 + i].y);
          }
        }
      }
      ctx.stroke();
      for (const p of S) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
      }
      ctx.restore();
    },
  };
}

// ---------- Girar a vista (Shift+H) ----------
export function rotateViewTool(stage) {
  let st = null;
  return {
    cursor: 'grab',
    down(e) {
      const { w, h } = stage.size;
      st = { a0: Math.atan2(e.sy - h / 2, e.sx - w / 2), r0: ((stage.view.rotation || 0) * 180) / Math.PI };
    },
    move(e) {
      if (!st) return;
      const { w, h } = stage.size;
      let d = ((Math.atan2(e.sy - h / 2, e.sx - w / 2) - st.a0) * 180) / Math.PI;
      if (e.shift) d = Math.round(d / 15) * 15;
      stage.setRotation(st.r0 + d);
    },
    up() {
      st = null;
    },
    dblclick() {
      stage.setRotation(0);
    },
  };
}

export { layerFrame };
