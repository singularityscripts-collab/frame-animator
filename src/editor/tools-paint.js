// Ferramentas de pintura: pincel (com pressão), balde, borracha, conta-gotas e transformar gradiente.

import {
  renderTimeline,
  multiply,
  invert,
  applyPoint,
  translation,
  scaling,
  rotation,
  getPath2D,
  isGradient,
  IDENTITY,
} from '../player/render.js';
import { makeShape } from '../model/geometry.js';
import { clone } from '../model/document.js';
import { floodFill, traceContours, polygonArea } from '../model/raster.js';
import * as V from '../model/vector-ops.js';
import { applyFill } from './editor.js';

export const GAP_SIZES = { none: 0, small: 3, medium: 6, large: 12 };

/** Cor sólida para prévias (gradiente → primeira cor). */
export function solidOf(fill) {
  if (!fill) return '#000000';
  return isGradient(fill) ? fill.stops?.[0]?.color || '#000000' : fill;
}

/**
 * Pressão da caneta → fator da largura (0,12 a 1).
 * Mouse e toque: largura cheia. Caneta com pressão 0 (o toque inicial de muitas mesas
 * digitalizadoras): null = ainda desconhecida; o traço usa a primeira pressão que chegar.
 * A curva (expoente 0,7) deixa o traço leve mais fácil de controlar.
 */
export function pressureOf(e, usePressure) {
  if (!usePressure || e.pointerType !== 'pen') return 1;
  if (!(e.pressure > 0)) return null;
  return 0.12 + 0.88 * Math.pow(Math.min(1, e.pressure), 0.7);
}

/**
 * Estabilizador "corda": o ponto que desenha só anda quando o cursor se afasta mais que o
 * comprimento da corda, puxado na direção dele. Tira a tremedeira da mão sem atrasar o traço
 * no tempo, e o que aparece ao vivo é exatamente o traço final (nada muda ao soltar).
 * rope: comprimento em unidades do desenho (0 = sem estabilizar).
 */
export function ropeStabilizer(rope) {
  let cur = null;
  return {
    get point() {
      return cur;
    },
    push(x, y) {
      if (!cur) {
        cur = { x, y };
        return cur;
      }
      const dx = x - cur.x, dy = y - cur.y;
      const d = Math.hypot(dx, dy);
      if (d <= rope) return null;
      const k = (d - rope) / d;
      cur = { x: cur.x + dx * k, y: cur.y + dy * k };
      return cur;
    },
  };
}

/** Comprimento da corda (unidades do desenho) para a suavização de 0 a 100 (até ~22 px na tela). */
export const ropeLength = (smoothing, scale) => ((Math.max(0, Math.min(100, smoothing)) / 100) * 22) / (scale || 1);

function drawTrail(ctx, pts, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = (pts[i - 1].w + pts[i].w) / 2;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRing(ctx, stage, radiusPx) {
  const p = stage.lastPointer;
  if (!p || stage.active) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, Math.max(1.5, radiusPx), 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, Math.max(1.5, radiusPx) + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------- Pincel ----------
export function brushTool(stage, editor) {
  let pts = null;
  let rope = null;
  let lastW = 1;
  let pending = 0; // pontos do começo ainda sem pressão conhecida
  const opts = () => editor.toolOptions.brush;
  const addPoint = (p, w) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) * stage.scale < 1) {
      if (w != null) last.w = Math.max(last.w ?? 0, w);
      return;
    }
    pts.push({ x: p.x, y: p.y, w });
  };
  /** Largura do ponto: pressão suavizada (sem degraus); antes da 1ª pressão, guarda para preencher depois. */
  const widthAt = (e) => {
    const pr = pressureOf(e, opts().pressure);
    if (pr == null) {
      pending++;
      return null;
    }
    const w = opts().size * pr;
    lastW = pts.length - pending > 0 ? lastW + (w - lastW) * 0.45 : w;
    if (pending) {
      for (const q of pts) if (q.w == null) q.w = lastW;
      pending = 0;
    }
    return lastW;
  };
  return {
    cursor: 'crosshair',
    coalesced: true,
    down(e) {
      // Alt+clique: pega a cor do que está embaixo (conta-gotas rápido)
      if (e.alt) return pickColor(stage, editor, e, 'fill');
      pts = [];
      pending = 0;
      rope = ropeStabilizer(ropeLength(opts().smoothing, stage.scale));
      const w = widthAt(e);
      const p = rope.push(e.wx, e.wy);
      pts.push({ x: p.x, y: p.y, w });
      // o palco fica parado durante o traço: só o rastro é redesenhado (traço sem atraso)
      stage.render();
      stage.freeze();
    },
    move(e) {
      if (!pts) return;
      const w = widthAt(e);
      const p = rope.push(e.wx, e.wy);
      if (p) addPoint(p, w ?? null);
      stage.invalidate();
    },
    up() {
      if (!pts) return;
      // pressão nunca conhecida (caneta sem pressão): largura cheia
      const raw = pts.map((q) => ({ ...q, w: q.w ?? opts().size }));
      pts = null;
      stage.unfreeze();
      let res;
      try {
        res = V.fromPaper(V.cleanOutline(V.strokeOutline(raw), 0.1 / stage.scale));
      } catch (err) {
        console.error(err);
        return editor.toast('Não foi possível criar o traço do pincel.');
      }
      if (!res) return;
      const s = editor.style;
      editor.addElements([makeShape({ path: res.path, cx: res.cx, cy: res.cy, fill: s.fill, stroke: null, strokeWidth: 0 })], 'Pincel');
    },
    cancel() {
      pts = null;
      stage.unfreeze();
    },
    hover() {
      stage.setCursor('crosshair');
      stage.invalidate();
    },
    drawWorld(ctx) {
      if (pts) drawTrail(ctx, pts.map((q) => ({ ...q, w: q.w ?? opts().size })), solidOf(editor.style.fill));
    },
    drawScreen(ctx) {
      if (pts) return drawRope(ctx, stage, rope?.point);
      drawRing(ctx, stage, (opts().size / 2) * stage.scale);
    },
  };
}

/** Corda do estabilizador: linha fina do cursor até o ponto que está desenhando. */
export function drawRope(ctx, stage, p) {
  const c = stage.lastPointer;
  if (!p || !c) return;
  const s = stage.toScreen(p.x, p.y);
  if (Math.hypot(s.x - c.sx, s.y - c.sy) < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(79, 157, 255, 0.8)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(c.sx, c.sy);
  ctx.lineTo(s.x, s.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Conta-gotas: pega a cor sob o ponteiro para o preenchimento ('fill') ou o traço ('stroke').
 * Forma: a cor dela (gradiente inteiro); instância, imagem ou fundo: a cor do pixel.
 */
export function pickColor(stage, editor, e, target = 'fill') {
  const hit = stage.hitTest(e.wx, e.wy);
  const el = hit?.el;
  if (el?.type === 'shape') {
    const inFill = el.fill && el.path.closed && stage.pointInFill(hit, e.wx, e.wy);
    if (inFill && target === 'fill') {
      const f = isGradient(el.fill) ? { type: el.fill.type, stops: clone(el.fill.stops) } : el.fill;
      editor.setStyle({ fill: f, fillOn: true }, { applyToSelection: false });
      return editor.toast('Cor do preenchimento copiada.');
    }
    if (el.stroke && (!inFill || target === 'stroke')) {
      editor.setStyle({ stroke: el.stroke, strokeOn: true, strokeWidth: el.strokeWidth }, { applyToSelection: false });
      return editor.toast('Cor e espessura do traço copiadas.');
    }
    if (inFill && !isGradient(el.fill)) {
      editor.setStyle({ stroke: el.fill, strokeOn: true }, { applyToSelection: false });
      return editor.toast('Cor copiada para o traço.');
    }
  }
  const { canvas } = stage.renderContent({ withBackground: true });
  const d = canvas.getContext('2d').getImageData(Math.floor(e.sx * stage.dpr), Math.floor(e.sy * stage.dpr), 1, 1).data;
  const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  editor.setStyle(target === 'fill' ? { fill: hex, fillOn: true } : { stroke: hex, strokeOn: true }, { applyToSelection: false });
  editor.toast(`Cor ${hex} copiada para o ${target === 'fill' ? 'preenchimento' : 'traço'}.`);
}

// ---------- Borracha ----------
export function eraserTool(stage, editor) {
  let pts = null;
  const opts = () => editor.toolOptions.eraser;
  const width = () => opts().size / stage.scale;
  return {
    cursor: 'crosshair',
    coalesced: true,
    down(e) {
      pts = [{ x: e.wx, y: e.wy, w: width() }];
      stage.render();
      stage.freeze();
    },
    move(e) {
      if (!pts) return;
      const last = pts[pts.length - 1];
      if (Math.hypot(e.wx - last.x, e.wy - last.y) * stage.scale < 1.5) return;
      pts.push({ x: e.wx, y: e.wy, w: width() });
      stage.invalidate();
    },
    up() {
      if (!pts) return;
      const p = pts;
      pts = null;
      stage.unfreeze();
      try {
        const region = V.cleanOutline(V.strokeOutline(p), 0.05 / stage.scale);
        const r = editor.eraseRegion(region, opts().mode, { allLayers: !!opts().allLayers });
        if (r?.skippedRig) editor.toast('Partes que dobram com os ossos só podem ser apagadas num quadro com a pose zerada.');
      } catch (err) {
        console.error(err);
        editor.toast('Não foi possível apagar aqui.');
      }
    },
    cancel() {
      pts = null;
      stage.unfreeze();
    },
    hover() {
      stage.setCursor('crosshair');
      stage.invalidate();
    },
    drawWorld(ctx) {
      if (pts) drawTrail(ctx, pts, 'rgba(255, 70, 90, 0.35)');
    },
    drawScreen(ctx) {
      drawRing(ctx, stage, opts().size / 2);
    },
  };
}

// ---------- Balde ----------
export function bucketTool(stage, editor) {
  return {
    cursor: 'crosshair',
    down(e) {
      // Alt+clique: pega a cor do que está embaixo (conta-gotas rápido)
      if (e.alt) return pickColor(stage, editor, e, 'fill');
      const fill = editor.style.fill;
      // 1) clicou dentro de uma forma fechada: troca o preenchimento dela
      const hit = stage.hitTest(e.wx, e.wy);
      if (hit?.el.type === 'shape' && hit.el.path.closed && stage.pointInFill(hit, e.wx, e.wy)) {
        editor.updateItems([hit], 'Balde de tinta', (el) => {
          el.fill = applyFill(el, fill);
        });
        return;
      }
      // 2) área vazia cercada por linhas: cria uma forma nova por baixo.
      // Rasteriza a parte visível numa resolução própria (mais fina que a tela quando o zoom é baixo).
      const { canvas, k, x0, y0 } = renderForFill(stage);
      const w = canvas.width, h = canvas.height;
      const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      const ink = new Uint8Array(w * h);
      for (let i = 0; i < ink.length; i++) ink[i] = data[i * 4 + 3] > 40 ? 1 : 0;
      // lacuna medida em pixels da tela, convertida para a resolução do balde
      const gapScreen = GAP_SIZES[editor.toolOptions.bucket.gap] ?? 3;
      const gap = Math.min(24, Math.round((gapScreen * k) / stage.scale));
      const r = floodFill(ink, w, h, (e.wx - x0) * k, (e.wy - y0) * k, gap);
      if (r.status === 'ink') return editor.toast('Clique numa área vazia cercada por linhas, ou dentro de uma forma.');
      if (r.status === 'open') return editor.toast('A área não está fechada. Aumente "Fechar lacunas" nas propriedades do balde.');
      const loops = traceContours(r.region, w, h)
        .filter((l) => Math.abs(polygonArea(l)) > 6)
        .map((l) => l.map((q) => ({ x: q.x / k + x0, y: q.y / k + y0 })));
      const res = V.polygonsToShapePath(loops, 0.75 / k);
      if (!res) return;
      const shape = makeShape({ path: res.path, cx: res.cx, cy: res.cy, fill, stroke: null, strokeWidth: 0 });
      editor.addElements([shape], 'Balde de tinta', 0);
    },
  };
}

// ---------- Conta-gotas ----------
// Clique: pega a cor do preenchimento (ou do traço, clicando na linha). Shift+clique: pega para o traço.
// A ferramenta não troca sozinha: a cor vai para as amostras e você escolhe o que fazer com ela.
export function eyedropperTool(stage, editor) {
  return {
    cursor: 'copy',
    down(e) {
      pickColor(stage, editor, e, e.shift ? 'stroke' : 'fill');
    },
  };
}

// ---------- Transformar gradiente ----------
// Alças no espaço canônico do gradiente: centro, largura, tamanho (radial), giro e foco (radial).
const GRAD_HANDLES = {
  linear: [
    { id: 'center', u: 0, v: 0, shape: 'circle' },
    { id: 'width', u: 1, v: 0, shape: 'square' },
    { id: 'rotate', u: 0, v: -1, shape: 'circle' },
  ],
  radial: [
    { id: 'center', u: 0, v: 0, shape: 'circle' },
    { id: 'width', u: 1, v: 0, shape: 'square' },
    { id: 'size', u: Math.SQRT1_2, v: Math.SQRT1_2, shape: 'circle' },
    { id: 'rotate', u: 0, v: -1, shape: 'circle' },
    { id: 'focal', u: null, v: 0, shape: 'triangle' },
  ],
};

export function gradientTool(stage, editor) {
  let st = null;

  const target = () => {
    const items = editor.selectedItems();
    if (items.length !== 1) return null;
    const it = items[0];
    return it.el.type === 'shape' && isGradient(it.el.fill) ? it : null;
  };
  const wmOf = () => target()?.wm;
  const G = (el) => multiply(wmOf() || el.matrix, el.fill.matrix || IDENTITY);
  const handles = (el) =>
    GRAD_HANDLES[el.fill.type].map((h) => {
      const u = h.id === 'focal' ? el.fill.focal || 0 : h.u;
      const w = applyPoint(G(el), u, h.v);
      return { ...h, u, ...stage.toScreen(w.x, w.y) };
    });

  return {
    cursor: 'default',
    down(e) {
      const it = target();
      if (it) {
        const h = handles(it.el).find((q) => Math.hypot(q.x - e.sx, q.y - e.sy) <= 8);
        if (h) {
          st = { h, start: e, moved: false };
          return;
        }
      }
      const hit = stage.hitTest(e.wx, e.wy);
      if (!hit) return editor.deselect();
      editor.setSelection([hit.el.id]);
      if (hit.el.type !== 'shape' || !isGradient(hit.el.fill)) editor.toast('Esta forma não tem preenchimento em gradiente. Escolha um na aba Cores.');
    },
    move(e) {
      if (!st) return;
      if (!st.moved) {
        if (Math.hypot(e.sx - st.start.sx, e.sy - st.start.sy) < 2) return;
        editor.materialize();
        const it = target();
        if (!it) return (st = null);
        st.before = new Map([[it.el.id, clone(it.el)]]);
        st.G0 = G(it.el);
        st.moved = true;
      }
      const it = target();
      if (!it) return;
      const el = it.el;
      const G0 = st.G0;
      const inv0 = invert(G0);
      const p = applyPoint(inv0, e.wx, e.wy); // ponteiro no espaço canônico de quando o arraste começou
      let Gn = G0;
      const fill = { ...el.fill };
      switch (st.h.id) {
        case 'center':
          Gn = multiply(translation(e.wx - st.start.wx, e.wy - st.start.wy), G0);
          break;
        case 'width':
          Gn = multiply(G0, scaling(Math.max(0.02, Math.abs(p.x)) * Math.sign(p.x || 1), 1));
          break;
        case 'size': {
          const s = Math.max(0.02, Math.hypot(p.x, p.y));
          Gn = multiply(G0, scaling(s, s));
          break;
        }
        case 'rotate': {
          const a = Math.atan2(p.y, p.x) + Math.PI / 2;
          const r = e.shift ? Math.round(a / (Math.PI / 12)) * (Math.PI / 12) : a;
          Gn = multiply(G0, rotation(r));
          break;
        }
        case 'focal':
          fill.focal = Math.max(-0.95, Math.min(0.95, p.x));
          break;
      }
      const invEl = invert(it.wm || el.matrix);
      if (!invEl) return;
      fill.matrix = multiply(invEl, Gn);
      el.fill = fill;
      stage.invalidate();
    },
    up() {
      if (!st) return;
      const s = st;
      st = null;
      if (s.moved && s.before) editor.commitLiveEdit('Transformar gradiente', s.before);
    },
    cancel() {
      if (st?.before) {
        const it = target();
        if (it) it.el.fill = st.before.get(it.el.id)?.fill ?? it.el.fill;
      }
      st = null;
    },
    hover(e) {
      const it = target();
      const h = it && handles(it.el).find((q) => Math.hypot(q.x - e.sx, q.y - e.sy) <= 8);
      const cursors = { center: 'move', width: 'ew-resize', size: 'nwse-resize', rotate: 'crosshair', focal: 'ew-resize' };
      stage.setCursor(h ? cursors[h.id] : 'default');
    },
    drawScreen(ctx) {
      const it = target();
      if (!it) return;
      const el = it.el;
      const g = G(el);
      const scr = (u, v) => {
        const w = applyPoint(g, u, v);
        return stage.toScreen(w.x, w.y);
      };
      ctx.save();
      ctx.strokeStyle = '#4f9dff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (el.fill.type === 'linear') {
        for (const u of [-1, 1]) {
          const a = scr(u, -1), b = scr(u, 1);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        const c = scr(0, 0), t = scr(0, -1);
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(t.x, t.y);
      } else {
        for (let k = 0; k <= 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          const q = scr(Math.cos(a), Math.sin(a));
          k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
      }
      ctx.stroke();
      for (const h of handles(el)) {
        ctx.fillStyle = h.id === 'center' ? '#4f9dff' : '#ffffff';
        ctx.beginPath();
        if (h.shape === 'square') ctx.rect(h.x - 4.5, h.y - 4.5, 9, 9);
        else if (h.shape === 'triangle') {
          ctx.moveTo(h.x, h.y - 6);
          ctx.lineTo(h.x + 5.5, h.y + 4);
          ctx.lineTo(h.x - 5.5, h.y + 4);
          ctx.closePath();
        } else ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

/**
 * Para o balde: desenha a área visível da timeline com k pixels por unidade do desenho
 * (pelo menos 2, ou a escala da tela se for maior), até uns 6 milhões de pixels.
 */
function renderForFill(stage) {
  const { editor } = stage;
  const { w: cw, h: ch } = stage.size;
  const corners = [stage.toWorld(0, 0), stage.toWorld(cw, 0), stage.toWorld(cw, ch), stage.toWorld(0, ch)];
  const x0 = Math.min(...corners.map((p) => p.x)), x1 = Math.max(...corners.map((p) => p.x));
  const y0 = Math.min(...corners.map((p) => p.y)), y1 = Math.max(...corners.map((p) => p.y));
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const k = Math.max(0.05, Math.min(Math.max(2, stage.scale * stage.dpr), Math.sqrt(6e6 / area)));
  const c = (stage._fillCanvas ||= document.createElement('canvas'));
  c.width = Math.max(1, Math.ceil((x1 - x0) * k));
  c.height = Math.max(1, Math.ceil((y1 - y0) * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  // espaço do balde = espaço da tela da timeline (sem a câmera base); o renderer aplica a câmera por camada
  const inScene = !editor.editStack.length;
  const c0inv = inScene ? invert(editor.sceneCameraMatrix()) || IDENTITY : IDENTITY;
  ctx.setTransform(...multiply([k, 0, 0, k, -x0 * k, -y0 * k], c0inv));
  renderTimeline(ctx, editor.doc, editor.timeline, editor.frame, { camera: inScene });
  return { canvas: c, k, x0, y0 };
}

/** Desenha o conteúdo editável sem nada do editor por cima (para o conta-gotas). */
export function renderContentFor(stage, { withBackground = false } = {}) {
  const { editor, canvas: main } = stage;
  const c = (stage._contentCanvas ||= document.createElement('canvas'));
  c.width = main.width;
  c.height = main.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const sceneBase = stage.deviceView();
  const inScene = !editor.editStack.length;
  const base = multiply(sceneBase, editor.contextMatrix);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  if (withBackground) {
    ctx.fillStyle = '#34343b';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(...sceneBase);
    ctx.fillStyle = editor.doc.background;
    ctx.fillRect(0, 0, editor.doc.width, editor.doc.height);
  }
  ctx.setTransform(...(inScene ? sceneBase : base));
  renderTimeline(ctx, editor.doc, editor.timeline, editor.frame, { camera: inScene });
  return { canvas: c, base };
}

export { getPath2D };
