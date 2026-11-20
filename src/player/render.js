// Motor de renderização compartilhado.
// Usado pelo editor (palco), pela janela de teste e pelo export.
// Não depende de nada do editor: só recebe o documento (JSON) e um contexto Canvas 2D.

import { colorToCT, tweenElements, motionElement, applyEase, lerpHex } from './tween.js';
import { guideFromElements, variableStrokePolys, patternPlacements, quickBounds, flattenSub, measure, pointAt } from './geom.js';
import { getImage, drawText, drawComponent, textBox } from './assets.js';
import { BLEND_MODES, applyFilters, cachedContent, renderContent, drawNineSlice, draw3D, has3D, scaleOfTransform } from './effects.js';
import { drawMesh, mlsPoint, warpPathPts, subdivideSub } from './mesh.js';
import { poseElements, lerpPose, hasDynamics, dynamicPose } from './bones.js';

// ---------- Matrizes 2D no formato do canvas: [a, b, c, d, e, f] ----------

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** m * n (aplica n primeiro, depois m). */
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyPoint(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translation = (x, y) => [1, 0, 0, 1, x, y];
export const scaling = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export function rotation(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

// ---------- Caminhos ----------
// path simples:   { closed: boolean, pts: [[x, y, inX, inY, outX, outY], ...] }
// path composto:  { closed: true, fillRule: 'nonzero'|'evenodd', subs: [path simples, ...] } (furos, várias partes)
// in/out são as alças Bézier relativas ao ponto (0,0 = canto reto).

/** Lista de subcaminhos simples de um caminho (simples ou composto). */
export function subpaths(path) {
  return path.subs || [path];
}

const path2dCache = new WeakMap();

export function getPath2D(path) {
  let p = path2dCache.get(path);
  if (!p) {
    p = buildPath2D(path);
    path2dCache.set(path, p);
  }
  return p;
}

export function buildPath2D(path) {
  const p = new Path2D();
  for (const sp of subpaths(path)) {
    const pts = sp.pts;
    const n = pts.length;
    if (!n) continue;
    p.moveTo(pts[0][0], pts[0][1]);
    const segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a[4] || a[5] || b[2] || b[3]) {
        p.bezierCurveTo(a[0] + a[4], a[1] + a[5], b[0] + b[2], b[1] + b[3], b[0], b[1]);
      } else {
        p.lineTo(b[0], b[1]);
      }
    }
    if (sp.closed) p.closePath();
  }
  return p;
}

// ---------- Preenchimento: cor sólida (com alfa) ou gradiente ----------
// fill = '#rrggbb' | '#rrggbbaa' | { type: 'linear'|'radial', stops: [{ offset, color, alpha }], matrix, focal }
// O gradiente vive num espaço canônico (linear: x de -1 a 1; radial: círculo de raio 1 no centro),
// e `matrix` leva esse espaço para o espaço local da forma (é o que a ferramenta de gradiente edita).

export function isGradient(fill) {
  return !!fill && typeof fill === 'object' && (fill.type === 'linear' || fill.type === 'radial');
}

function isBitmapFill(fill) {
  return !!fill && typeof fill === 'object' && fill.type === 'bitmap';
}

function stopColor(s) {
  const a = Math.max(0, Math.min(1, s.alpha ?? 1));
  const h = String(s.color || '#000000').replace('#', '');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function makeCanvasGradient(ctx, g) {
  let grad;
  if (g.type === 'radial') {
    const fx = Math.max(-0.98, Math.min(0.98, g.focal || 0));
    grad = ctx.createRadialGradient(fx, 0, 0, 0, 0, 1);
  } else {
    grad = ctx.createLinearGradient(-1, 0, 1, 0);
  }
  const stops = [...(g.stops || [])].sort((a, b) => a.offset - b.offset);
  for (const s of stops) grad.addColorStop(Math.max(0, Math.min(1, s.offset)), stopColor(s));
  return grad;
}

/** Preenche o Path2D `p` (em coordenadas locais da forma) com cor ou gradiente. */
export function fillPath(ctx, fill, p, rule = 'nonzero', doc = null) {
  if (fill && fill.type === 'bitmap') {
    const img = doc && getImage(doc, fill.assetId);
    if (!img) {
      ctx.fillStyle = 'rgba(128,128,128,0.3)';
      ctx.fill(p, rule);
      return;
    }
    const pat = ctx.createPattern(img, 'repeat');
    if (fill.matrix && pat.setTransform) pat.setTransform(new DOMMatrix(fill.matrix));
    ctx.fillStyle = pat;
    ctx.fill(p, rule);
    return;
  }
  if (!isGradient(fill)) {
    ctx.fillStyle = fill;
    ctx.fill(p, rule);
    return;
  }
  const gm = fill.matrix || IDENTITY;
  const inv = invert(gm);
  if (!inv) return;
  // leva o caminho para o espaço do gradiente, preenche lá e volta
  const gp = new Path2D();
  gp.addPath(p, new DOMMatrix(inv));
  ctx.save();
  ctx.transform(...gm);
  ctx.fillStyle = makeCanvasGradient(ctx, fill);
  ctx.fill(gp, rule);
  ctx.restore();
}

// ---------- Documento ----------

export function symbolById(doc, id) {
  const items = doc.library?.items;
  if (!items) return null;
  for (const s of items) if (s.id === id) return s;
  return null;
}

// ---------- Linha do tempo ----------
// Uma "timeline" é qualquer objeto com layers: a cena ou um símbolo.

export function spanIndexAt(layer, frame) {
  const fr = layer.frames;
  for (let i = 0; i < fr.length; i++) {
    if (frame >= fr[i].start && frame < fr[i].start + fr[i].duration) return i;
  }
  return -1;
}

/** Trecho (keyframe + quadros que o seguram) que cobre o quadro, ou null. */
export function getSpanAt(layer, frame) {
  const i = spanIndexAt(layer, frame);
  return i < 0 ? null : layer.frames[i];
}

export function layerLength(layer) {
  const last = layer.frames[layer.frames.length - 1];
  return last ? last.start + last.duration : 0;
}

export function timelineLength(tl) {
  let n = 1;
  for (const l of tl.layers) n = Math.max(n, layerLength(l));
  return n;
}
export const sceneLength = timelineLength;

/** O tween deste trecho tem para onde ir? (keyframe seguinte logo depois) */
export function tweenTarget(layer, index) {
  const s = layer.frames[index];
  return s?.tween ? layer.frames[index + 1] || null : null;
}

/**
 * O que a camada mostra num quadro, já com o tween calculado.
 * { span, index, offset, tweened, items: [{ el, index, mcTime }] } ou null.
 */
export function layerFrame(layer, frame, tl = null) {
  const si = spanIndexAt(layer, frame);
  if (si < 0) return null;
  const span = layer.frames[si];
  const offset = frame - span.start;
  let elements = span.elements;
  let tweened = false;
  let motion = false;
  if (span.tween?.type === 'motion' && elements.length) {
    // motion tween: o primeiro elemento segue as propriedades com keys; os outros ficam parados
    elements = [motionElement(span, offset), ...elements.slice(1)];
    motion = true;
  } else {
    const next = tweenTarget(layer, si);
    if (next && offset > 0) {
      elements = tweenElements(span, next, offset, span.tween.type === 'classic' ? guideFor(layer, frame, tl) : null);
      tweened = true;
    }
  }
  if (span.armature) {
    // esqueleto: os elementos presos aos ossos acompanham a pose (interpolada no tween)
    const next = tweenTarget(layer, si);
    let pose = span.armature.pose || {};
    if (next?.armature && offset > 0) pose = lerpPose(pose, next.armature.pose || {}, applyEase(offset / span.duration, span.tween));
    // dinâmica: ossos que balançam sozinhos (simulados quadro a quadro desde o começo da camada)
    if (hasDynamics(span.armature)) pose = dynamicPose(layer, frame);
    elements = poseElements(elements, span.armature, pose);
  }
  return {
    span,
    index: si,
    offset,
    tweened,
    motion,
    items: elements.map((el, i) => ({ el, index: i, mcTime: el.type === 'instance' ? frame - runStart(layer, si, i, el) : 0 })),
  };
}

/** Caminho do guia de movimento desta camada (se ela for guiada), no quadro. */
export function guideFor(layer, frame, tl) {
  if (!layer.guidedBy || !tl) return null;
  const g = tl.layers.find((l) => l.id === layer.guidedBy);
  if (!g || g.type !== 'guide') return null;
  const span = getSpanAt(g, frame);
  return span ? guideFromElements(span.elements) : null;
}

// ---------- câmera, profundidade e parentesco ----------

export const DEFAULT_CAMERA = Object.freeze({ zoom: 100, rotation: 0, tint: '#000000', tintAmount: 0 });

export function cameraLayer(tl) {
  return tl.layers?.find((l) => l.type === 'camera') || null;
}

/** Estado da câmera no quadro (com tween), ou null se a cena não tem câmera. */
export function cameraAt(doc, tl, frame) {
  const cl = cameraLayer(tl);
  if (!cl) return null;
  const def = { x: doc.width / 2, y: doc.height / 2, ...DEFAULT_CAMERA };
  const si = spanIndexAt(cl, frame);
  const span = si >= 0 ? cl.frames[si] : cl.frames[cl.frames.length - 1];
  const a = { ...def, ...(span?.camera || {}) };
  const next = si >= 0 ? cl.frames[si + 1] : null;
  if (!span?.tween || !next || frame <= span.start) return a;
  const b = { ...def, ...(next.camera || {}) };
  const t = applyEase((frame - span.start) / span.duration, span.tween);
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  return { x: L('x'), y: L('y'), zoom: L('zoom'), rotation: L('rotation'), tintAmount: L('tintAmount'), tint: lerpHex(a.tint, b.tint, t) };
}

/** Matriz da câmera para uma camada com profundidade "depth" (0 = no plano da câmera). */
export function cameraMatrix(doc, cam, depth = 0) {
  if (!cam) return IDENTITY;
  const k = 1000 / (1000 + Math.max(-900, depth || 0));
  const z = (cam.zoom / 100) * k;
  return multiply(
    translation(doc.width / 2, doc.height / 2),
    multiply(rotation((-cam.rotation * Math.PI) / 180), multiply(scaling(z, z), translation(-cam.x, -cam.y))),
  );
}

/**
 * Matriz de cada camada no quadro: câmera (com profundidade) × parentesco.
 * O conteúdo de uma camada filha fica no espaço do objeto da camada mãe.
 */
export function layerMatrices(doc, tl, frame, opts = {}) {
  const cam = opts.camera === false ? null : cameraAt(doc, tl, frame);
  const byId = new Map(tl.layers.map((l) => [l.id, l]));
  const chain = new Map();
  const parentChain = (layer, seen = new Set()) => {
    if (chain.has(layer.id)) return chain.get(layer.id);
    let m = IDENTITY;
    const parent = layer.parentLayerId && byId.get(layer.parentLayerId);
    if (parent && !seen.has(parent.id)) {
      seen.add(layer.id);
      const lf = layerFrame(parent, frame, tl);
      const anchor = lf?.items[0]?.el.matrix || IDENTITY;
      m = multiply(parentChain(parent, seen), anchor);
    }
    chain.set(layer.id, m);
    return m;
  };
  const out = new Map();
  for (const l of tl.layers) {
    const P = parentChain(l);
    out.set(l.id, cam ? multiply(cameraMatrix(doc, cam, l.depth || 0), P) : P);
  }
  out.camera = cam;
  return out;
}

const isIdentity = (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;

/** A camada está escondida (ela ou alguma pasta acima dela)? */
export function isHiddenLayer(tl, layer) {
  for (let l = layer, guard = 0; l && guard < 64; guard++) {
    if (!l.visible) return true;
    l = l.folderId ? tl.layers.find((x) => x.id === l.folderId) : null;
  }
  return false;
}

/** Desde que quadro o mesmo movie clip segue aparecendo nesta posição (para ele continuar tocando). */
function runStart(layer, si, i, el) {
  let start = layer.frames[si].start;
  for (let k = si - 1; k >= 0; k--) {
    const prev = layer.frames[k].elements[i];
    if (!prev || prev.type !== 'instance' || prev.symbolId !== el.symbolId) break;
    start = layer.frames[k].start;
  }
  return start;
}

/** Quadro interno que uma instância mostra. */
export function instanceFrame(sym, el, offset, mcTime, playMC) {
  const len = timelineLength(sym);
  if (el.behavior === 'movieclip') return playMC ? mcTime % len : 0;
  const first = Math.max(0, Math.min(len - 1, el.firstFrame || 0));
  if (el.loop === 'single') return first;
  if (el.loop === 'once') return Math.min(first + offset, len - 1);
  return (first + offset) % len;
}

// ---------- Desenho ----------

const MAX_DEPTH = 24;
const scratch = new Map();

function scratchCanvas(key, w, h) {
  let c = scratch.get(key);
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    scratch.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/** Desenha algo aplicando uma transformação de cor (brilho, tom, alfa, avançado). */
function drawWithColor(ctx, ct, depth, draw) {
  if (!ct) return draw(ctx);
  const rgbIdentity = ct.rm === 1 && ct.gm === 1 && ct.bm === 1 && !ct.ro && !ct.go && !ct.bo && !ct.ao;
  if (rgbIdentity) {
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, ct.am));
    draw(ctx);
    ctx.restore();
    return;
  }
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const sc = scratchCanvas(depth, w, h);
  const s = sc.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.globalAlpha = 1;
  s.clearRect(0, 0, w, h);
  s.setTransform(ctx.getTransform());
  draw(s);
  s.setTransform(1, 0, 0, 1, 0, 0);
  let alpha = Math.max(0, Math.min(1, ct.am));
  const p = 1 - ct.rm;
  const tintLike = ct.rm === ct.gm && ct.gm === ct.bm && p > 0 && !ct.ao;
  if (tintLike) {
    // cor final = cor * (1-p) + C * p  →  pintar C por cima com opacidade p
    const c = [ct.ro / p, ct.go / p, ct.bo / p].map((v) => Math.max(0, Math.min(255, Math.round(v))));
    s.globalCompositeOperation = 'source-atop';
    s.globalAlpha = p;
    s.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    s.fillRect(0, 0, w, h);
  } else {
    const img = s.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      d[i] = d[i] * ct.rm + ct.ro;
      d[i + 1] = d[i + 1] * ct.gm + ct.go;
      d[i + 2] = d[i + 2] * ct.bm + ct.bo;
      d[i + 3] = d[i + 3] * ct.am + ct.ao;
    }
    s.putImageData(img, 0, 0);
    alpha = 1;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  ctx.drawImage(sc, 0, 0);
  ctx.restore();
}

/**
 * Desenha um elemento (forma, texto, bitmap, componente ou instância de símbolo).
 * env.outline: cor para desenhar só o contorno; env.outlinePx: espessura do contorno em pixels.
 * env.offset / env.mcTime: tempo para escolher o quadro de instâncias.
 * env.playMC: movie clips tocam (teste/export) ou ficam no 1º quadro (editor).
 * env.rt / env.path: runtime interativo (scripts, botões) e o caminho da instância.
 */
export function drawElement(ctx, doc, el, env = {}) {
  const depth = env.depth || 0;
  const rt = env.rt;
  const path = rt ? `${env.path || ''}/${el.name || el.id}` : null;
  if (rt) {
    el = rt.adjust(path, el);
    if (!el) return;
  }
  // forma escondida neste quadro: não aparece (o editor mostra só um contorno tracejado)
  if (el.hidden) return;
  if (env.outline && el.type !== 'instance') {
    const box = el.type === 'shape' ? null : localBox(el, rt, path);
    const p = box ? rectPath2D(box) : getPath2D(shapePath(el));
    const tp = new Path2D();
    tp.addPath(p, ctx.getTransform().multiply(new DOMMatrix(el.matrix)));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = env.outline;
    ctx.lineWidth = env.outlinePx || 1;
    ctx.lineJoin = 'round';
    ctx.stroke(tp);
    ctx.restore();
    return;
  }
  const ct = el.type !== 'instance' && el.color && el.color.mode !== 'none' ? colorToCT(el.color) : null;
  const body = (c) => {
    if (el.type === 'shape') drawShapeBody(c, el, getPath2D(shapePath(el)), doc, env);
    else if (el.type === 'text') { if (!el.__editing) drawText(c, el, rt ? rt.textOf(path, el) : el.text); }
    else if (el.type === 'bitmap') drawBitmap(c, doc, el);
    else if (el.type === 'component') drawComponent(c, el, rt ? rt.componentState(path, el) : {});
  };
  if (el.type === 'instance') return drawInstance(ctx, doc, el, { ...env, path }, depth);
  if (ct) drawWithColor(ctx, ct, depth, body);
  else body(ctx);
  if (rt && (el.type === 'component' || (el.type === 'text' && el.kind === 'input'))) {
    rt.register(path, el, multiply(domToArr(ctx.getTransform()), el.matrix), localBox(el, rt, path), el.type);
  }
}

const domToArr = (t) => [t.a, t.b, t.c, t.d, t.e, t.f];
const rectPath2D = (b) => {
  const p = new Path2D();
  p.rect(b.x, b.y, b.w, b.h);
  return p;
};

function localBox(el, rt, path) {
  if (el.type === 'text') return textBox(el, rt ? rt.textOf(path, el) : el.text);
  return { x: 0, y: 0, w: el.w || 0, h: el.h || 0 };
}

/** Caminho que a forma mostra (com a malha de pinos aplicada, se tiver). */
const warpCache = new WeakMap();
export function shapePath(el) {
  const pins = el.warp?.pins;
  if (!pins?.length) return el.path;
  const key = JSON.stringify(pins);
  const got = warpCache.get(el.path);
  if (got && got.key === key) return got.path;
  const subs = subpaths(el.path).map((sp) => warpPathPts(subdivideSub(sp, 3), pins));
  const path = subs.length === 1 ? subs[0] : { closed: el.path.closed, fillRule: el.path.fillRule, subs };
  warpCache.set(el.path, { key, path });
  return path;
}

function drawShapeBody(ctx, el, p, doc, env) {
  ctx.save();
  ctx.transform(...el.matrix);
  const sp = shapePath(el);
  if (el.fill && el.path.closed) fillPath(ctx, el.fill, p, el.path.fillRule || 'nonzero', doc);
  if (el.stroke && el.strokeWidth > 0) {
    if (el.brush && doc) drawBrushStroke(ctx, doc, el, sp, env);
    else if (el.widthProfile?.length) {
      const poly = new Path2D();
      for (const pl of variableStrokePolys(sp, el.strokeWidth, el.widthProfile)) {
        pl.forEach((q, i) => (i ? poly.lineTo(q.x, q.y) : poly.moveTo(q.x, q.y)));
        poly.closePath();
      }
      if (isGradient(el.strokeGradient)) fillPath(ctx, el.strokeGradient, poly, 'nonzero', doc);
      else {
        ctx.fillStyle = el.stroke;
        ctx.fill(poly, 'nonzero');
      }
    } else {
      ctx.strokeStyle = isGradient(el.strokeGradient) ? makeCanvasGradient(ctx, el.strokeGradient) : el.stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(p);
    }
  }
  ctx.restore();
}

/** Pincel de padrão (repete o símbolo ao longo do traço) ou de arte (estica o símbolo no traço). */
function drawBrushStroke(ctx, doc, el, sp, env) {
  const sym = symbolById(doc, el.brush.symbolId);
  if (!sym || (env.depth || 0) > 8) return;
  const b = quickBounds(doc, sym, 0, layerFrame, symbolById);
  if (!b) return;
  const scale = (el.brush.scale ?? 100) / 100;
  const inner = { depth: (env.depth || 0) + 1, camera: false };
  if (el.brush.type === 'pattern') {
    const step = Math.max(2, b.w * scale * (1 + (el.brush.spacing ?? 0) / 100));
    for (const pl of patternPlacements(sp, step)) {
      ctx.save();
      ctx.translate(pl.x, pl.y);
      ctx.rotate(pl.angle);
      ctx.scale(scale, scale);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
      renderTimeline(ctx, doc, sym, 0, inner);
      ctx.restore();
    }
    return;
  }
  // arte: a imagem do símbolo acompanha o caminho (largura = comprimento, altura = espessura)
  const sub = subpaths(sp)[0];
  if (!sub) return;
  const m = measure(flattenSub(sub, IDENTITY, 12));
  if (m.total < 1) return;
  const px = Math.min(4, Math.max(1, Math.sqrt(Math.abs(ctx.getTransform().a * ctx.getTransform().d)) * 1.5));
  const img = renderContent(b, px, (c) => renderTimeline(c, doc, sym, 0, inner), scratchCanvas('brush', 2, 2));
  const thick = b.h * scale;
  drawMesh(
    ctx,
    img,
    { x: 1, y: 1, w: b.w * px, h: b.h * px },
    (u, v) => {
      const p = pointAt(m, u * m.total);
      const off = (v - 0.5) * thick;
      return { x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off };
    },
    Math.max(8, Math.min(60, Math.round(m.total / 12))),
    2,
  );
}

function drawBitmap(ctx, doc, el) {
  const img = getImage(doc, el.assetId);
  ctx.save();
  ctx.transform(...el.matrix);
  if (!img) {
    ctx.fillStyle = 'rgba(128,128,128,0.25)';
    ctx.fillRect(0, 0, el.w, el.h);
  } else if (el.warp?.pins?.length) {
    const pins = el.warp.pins;
    drawMesh(ctx, img, { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }, (u, v) => mlsPoint(pins, u * el.w, v * el.h), 12, 12);
  } else {
    ctx.imageSmoothingEnabled = el.smoothing !== false;
    ctx.drawImage(img, 0, 0, el.w, el.h);
  }
  ctx.restore();
}

function perspectiveOf(doc) {
  const p = doc.perspective || {};
  return { angle: p.angle ?? 55, x: p.x ?? doc.width / 2, y: p.y ?? doc.height / 2 };
}

function drawInstance(ctx, doc, el, env, depth) {
  const sym = symbolById(doc, el.symbolId);
  if (!sym || depth >= MAX_DEPTH) return;
  let f = instanceFrame(sym, el, env.offset || 0, env.mcTime || 0, env.playMC);
  if (env.rt) f = env.rt.frameOf(env.path, el, sym, f);
  const inner = {
    outline: env.outline,
    outlinePx: env.outlinePx,
    playMC: env.playMC,
    depth: depth + 1,
    includeHidden: false,
    camera: false,
    rt: env.rt,
    path: env.path,
  };
  const content = (c) => renderTimeline(c, doc, sym, f, inner);
  if (env.rt) {
    // área de clique: o quadro "Área" do botão (4º), se tiver conteúdo; senão o que aparece
    const hb = (sym.type === 'button' && quickBounds(doc, sym, 3, layerFrame, symbolById)) || quickBounds(doc, sym, f, layerFrame, symbolById);
    if (hb) env.rt.register(env.path, el, multiply(domToArr(ctx.getTransform()), el.matrix), hb, 'instance', sym);
  }
  if (env.outline) {
    ctx.save();
    ctx.transform(...el.matrix);
    content(ctx);
    ctx.restore();
    return;
  }
  const ct = colorToCT(el.color);
  const filters = (el.filters || []).filter((x) => x.enabled !== false);
  const blend = el.blend && el.blend !== 'normal' ? BLEND_MODES[el.blend] : null;
  const special = has3D(el) || !!sym.scale9 || !!el.cacheAsBitmap;
  const drawBody = (c) => {
    if (special) {
      const b = quickBounds(doc, sym, f, layerFrame, symbolById);
      if (!b) return;
      const T0 = c.getTransform();
      const px = scaleOfTransform(T0);
      const m = el.matrix;
      const elScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      if (has3D(el)) {
        const res = Math.max(0.25, Math.min(4, px * elScale));
        const img = renderContent(b, res, content, scratchCanvas(`3d${depth}`, 2, 2));
        draw3D(c, img, b, res, el, perspectiveOf(doc), doc.width);
        return;
      }
      if (sym.scale9) {
        const res = Math.max(0.5, Math.min(4, px));
        const img = renderContent(b, res, content, scratchCanvas(`9s${depth}`, 2, 2));
        drawNineSlice(c, img, b, res, sym.scale9, m);
        return;
      }
      const res = Math.max(0.25, Math.min(4, px * elScale));
      const img = cachedContent(`${sym.id}:${f}:${JSON.stringify(el.color || '')}`, b, res, content);
      c.save();
      c.transform(...m);
      c.drawImage(img, b.x - 1 / res, b.y - 1 / res, img.width / res, img.height / res);
      c.restore();
      return;
    }
    c.save();
    c.transform(...el.matrix);
    content(c);
    c.restore();
  };
  if (!filters.length && !blend) {
    if (ct) drawWithColor(ctx, ct, depth, drawBody);
    else drawBody(ctx);
    return;
  }
  // camada própria: conteúdo + cor + filtros, depois compõe com o modo de mesclagem
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const layer = scratchCanvas(`L${depth}`, w, h);
  const lc = layer.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.globalCompositeOperation = 'source-over';
  lc.globalAlpha = 1;
  lc.filter = 'none';
  lc.clearRect(0, 0, w, h);
  lc.setTransform(ctx.getTransform());
  if (ct) drawWithColor(lc, ct, depth + 40, drawBody);
  else drawBody(lc);
  const out = filters.length ? applyFilters(layer, filters, scaleOfTransform(ctx.getTransform()), scratchCanvas, `F${depth}`) : layer;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (blend) ctx.globalCompositeOperation = blend;
  ctx.drawImage(out, 0, 0);
  ctx.restore();
}

/**
 * Desenha todas as camadas de uma timeline num quadro. Camadas de cima ficam por cima.
 * opts.layerFilter(layer) → boolean
 * opts.includeHidden: desenha também camadas ocultas
 * opts.honorOutline: respeita o modo contorno de cada camada (editor)
 * opts.outline: força contorno numa cor (onion skin em modo contorno)
 * opts.outlinePx: espessura do contorno em pixels
 * opts.skipId: não desenha o elemento com esse id (edição no lugar)
 * opts.playMC: movie clips tocam
 */
export function renderTimeline(ctx, doc, tl, frame, opts = {}) {
  const lms = layerMatrices(doc, tl, frame, opts);
  const byId = new Map(tl.layers.map((l) => [l.id, l]));
  const shown = (l) => opts.includeHidden || !isHiddenLayer(tl, l);
  const maskOn = (m) => !!m && m.type === 'mask' && shown(m) && (!opts.maskFilter || opts.maskFilter(m));

  const drawLayer = (c, layer) => {
    if (opts.layerFilter && !opts.layerFilter(layer)) return;
    const lf = shownLayerFrame(layer, frame, tl);
    if (!lf) return;
    const lm = lms.get(layer.id) || IDENTITY;
    c.save();
    if (!isIdentity(lm)) c.transform(...lm);
    const outline = opts.outline || (opts.honorOutline && layer.outline ? layer.color : null);
    for (const it of lf.items) {
      if (opts.skipId && it.el.id === opts.skipId) continue;
      drawElement(c, doc, it.el, {
        outline,
        outlinePx: opts.outlinePx,
        offset: lf.offset,
        mcTime: it.mcTime,
        playMC: opts.playMC,
        depth: opts.depth || 0,
        rt: opts.rt,
        path: opts.path,
      });
    }
    c.restore();
  };

  for (let i = tl.layers.length - 1; i >= 0; i--) {
    const layer = tl.layers[i];
    if (layer.type === 'folder' || layer.type === 'camera') continue;
    if (layer.type === 'guide' && !opts.showGuides) continue;
    if (!shown(layer)) continue;
    if (layer.maskedBy && maskOn(byId.get(layer.maskedBy))) continue; // desenhada junto com a máscara
    if (layer.type === 'mask' && maskOn(layer)) {
      const masked = tl.layers.filter((l) => l.maskedBy === layer.id && l.type !== 'folder' && shown(l)).reverse();
      drawMaskGroup(ctx, opts.depth || 0, (c) => masked.forEach((l) => drawLayer(c, l)), (c) => drawLayer(c, layer));
      continue;
    }
    drawLayer(ctx, layer);
  }
}

/** Desenha o conteúdo recortado pela forma da máscara (alfa do que a máscara desenha). */
function drawMaskGroup(ctx, depth, drawContent, drawMask) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const a = scratchCanvas(`ma${depth}`, w, h).getContext('2d');
  const b = scratchCanvas(`mb${depth}`, w, h).getContext('2d');
  for (const c of [a, b]) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, w, h);
    c.setTransform(ctx.getTransform());
  }
  drawContent(a);
  drawMask(b);
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalCompositeOperation = 'destination-in';
  a.drawImage(b.canvas, 0, 0);
  a.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(a.canvas, 0, 0);
  ctx.restore();
}

/** Tom de cor da câmera por cima de tudo que já foi desenhado na área do palco. */
export function applyCameraTint(ctx, doc, cam, transparent = false) {
  if (!cam || !(cam.tintAmount > 0)) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, cam.tintAmount / 100);
  ctx.globalCompositeOperation = transparent ? 'source-atop' : 'source-over';
  ctx.fillStyle = cam.tint || '#000000';
  ctx.fillRect(0, 0, doc.width, doc.height);
  ctx.restore();
}

// ---------- filme: várias cenas em sequência ----------
export function movieLength(doc) {
  return doc.scenes.reduce((n, s) => n + timelineLength(s), 0);
}

/** Quadro do filme inteiro → { sceneIndex, frame } */
export function movieLocate(doc, f) {
  for (let i = 0; i < doc.scenes.length; i++) {
    const len = timelineLength(doc.scenes[i]);
    if (f < len) return { sceneIndex: i, frame: f };
    f -= len;
  }
  const last = doc.scenes.length - 1;
  return { sceneIndex: last, frame: timelineLength(doc.scenes[last]) - 1 };
}

/** Desenha um quadro de uma cena inteira (fundo + conteúdo) num canvas do tamanho pedido. Base do export. */
export function renderDocumentFrame(ctx, doc, sceneIndex, frame, { width, height, transparent = false } = {}) {
  const w = width ?? doc.width, h = height ?? doc.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(w / doc.width, 0, 0, h / doc.height, 0, 0);
  if (!transparent) {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  const scene = doc.scenes[sceneIndex];
  renderTimeline(ctx, doc, scene, frame, { playMC: true });
  applyCameraTint(ctx, doc, cameraAt(doc, scene, frame), transparent);
}

// ---------- modificadores da camada (sem chaves): ciclo e ruído ----------
// layer.modifiers = { cycle?: { from, to, mode: 'loop' | 'pingpong' },
//                     noise?: { position (px), rotation (graus), scale (%), speed (quadros), seed } }
// Valem no desenho e na exportação; a edição continua nos quadros de verdade.

/** Quadro que a camada mostra com o ciclo: depois de `to`, repete [from, to] (ou vai e volta). */
export function cycleFrame(layer, frame) {
  const c = layer.modifiers?.cycle;
  if (!c || !(c.to > c.from) || frame <= c.to) return frame;
  const len = c.to - c.from + 1;
  const k = frame - c.from;
  if (c.mode === 'pingpong') {
    const period = 2 * (len - 1);
    const m = k % period;
    return c.from + (m < len ? m : period - m);
  }
  return c.from + (k % len);
}

/** Ruído suave e sempre igual (valor entre −1 e 1) no tempo t. */
function hashNoise(n, seed) {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
export function noise1(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return hashNoise(i, seed) * (1 - u) + hashNoise(i + 1, seed) * u;
}

/** Matrizes de ruído do quadro: { pre (no espaço da camada), post (no próprio elemento) } ou null. */
export function noiseAt(layer, frame) {
  const n = layer.modifiers?.noise;
  if (!n) return null;
  const pos = Number(n.position) || 0, rot = Number(n.rotation) || 0, sc = Number(n.scale) || 0;
  if (!pos && !rot && !sc) return null;
  const t = frame / Math.max(1, Number(n.speed) || 4);
  const seed = Number(n.seed) || 1;
  const pre = translation(pos * noise1(t, seed), pos * noise1(t, seed + 17));
  const s = 1 + (sc / 100) * noise1(t, seed + 47);
  const post = multiply(rotation(((rot * Math.PI) / 180) * noise1(t, seed + 31)), [s, 0, 0, s, 0, 0]);
  return { pre, post };
}

/** O que a camada mostra no quadro com os modificadores (ciclo e ruído): para desenhar e exportar. */
export function shownLayerFrame(layer, frame, tl = null) {
  const lf = layerFrame(layer, cycleFrame(layer, frame), tl);
  if (!lf) return lf;
  const nz = noiseAt(layer, frame);
  if (!nz) return lf;
  return { ...lf, items: lf.items.map((it) => ({ ...it, el: { ...it.el, matrix: multiply(nz.pre, multiply(it.el.matrix, nz.post)) } })) };
}
