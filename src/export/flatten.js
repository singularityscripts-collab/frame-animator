// "Achata" um quadro: percorre camadas, máscaras e símbolos e devolve uma lista do que aparece,
// já em coordenadas do palco. É a base dos exports vetoriais (SVG por quadro e Lottie).
//
// Itens:
//  { kind: 'shape', subs: [{ closed, pts: [[x, y, ix, iy, ox, oy]] }], fill, fillRule, stroke, strokeWidth, ct }
//  { kind: 'bitmap', assetId, w, h, matrix, ct }
//  { kind: 'text', el, matrix, ct }   (e 'component', que vira imagem)
//  { kind: 'mask', mask: [itens], items: [itens] }
// Cores ficam como estão; `ct` é a transformação de cor acumulada (aplique com applyCT).

import { layerMatrices, layerFrame, shownLayerFrame, isHiddenLayer, instanceFrame, symbolById, multiply, subpaths, shapePath, IDENTITY, isGradient } from '../player/render.js';
import { colorToCT } from '../player/tween.js';
import { variableStrokePolys, patternPlacements, quickBounds } from '../player/geom.js';

const MAX_DEPTH = 24;
const ID_CT = Object.freeze({ rm: 1, gm: 1, bm: 1, am: 1, ro: 0, go: 0, bo: 0, ao: 0 });

/** Junta duas transformações de cor: primeiro `inner`, depois `outer`. */
export function combineCT(outer, inner) {
  if (!inner) return outer;
  if (!outer) return inner;
  return {
    rm: inner.rm * outer.rm,
    gm: inner.gm * outer.gm,
    bm: inner.bm * outer.bm,
    am: inner.am * outer.am,
    ro: inner.ro * outer.rm + outer.ro,
    go: inner.go * outer.gm + outer.go,
    bo: inner.bo * outer.bm + outer.bo,
    ao: inner.ao * outer.am + outer.ao,
  };
}

export function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Cor (#hex) e alfa (0–1) depois da transformação de cor. */
export function applyCT(hex, alpha = 1, ct = null) {
  let [r, g, b] = hexToRgb(hex);
  let a = alpha;
  if (ct) {
    r = r * ct.rm + ct.ro;
    g = g * ct.gm + ct.go;
    b = b * ct.bm + ct.bo;
    a = a * ct.am + ct.ao / 255;
  }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return { r: c(r), g: c(g), b: c(b), a: Math.max(0, Math.min(1, a)), hex: `#${[r, g, b].map((v) => c(v).toString(16).padStart(2, '0')).join('')}` };
}

const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/** Leva os pontos de um caminho local para o mundo (alças como vetores). */
export function transformSubs(path, m) {
  return subpaths(path).map((sp) => ({
    closed: !!sp.closed,
    pts: sp.pts.map((q) => [
      m[0] * q[0] + m[2] * q[1] + m[4],
      m[1] * q[0] + m[3] * q[1] + m[5],
      m[0] * (q[2] || 0) + m[2] * (q[3] || 0),
      m[1] * (q[2] || 0) + m[3] * (q[3] || 0),
      m[0] * (q[4] || 0) + m[2] * (q[5] || 0),
      m[1] * (q[4] || 0) + m[3] * (q[5] || 0),
    ]),
  }));
}

/** Gradiente com a matriz já no espaço do palco. */
function worldFill(fill, m) {
  if (isGradient(fill)) return { ...fill, matrix: multiply(m, fill.matrix || IDENTITY) };
  if (fill && typeof fill === 'object' && fill.type === 'bitmap') return { ...fill, matrix: multiply(m, fill.matrix || IDENTITY) };
  return fill;
}

function flattenElement(out, doc, el, M, ct, ctx) {
  if (el.hidden) return; // forma escondida neste quadro (animação de pontos)
  if (el.type === 'shape') {
    const m = multiply(M, el.matrix);
    const elCT = combineCT(ct, el.color && el.color.mode !== 'none' ? colorToCT(el.color) : null);
    const path = shapePath(el);
    if (el.fill && el.path.closed) out.push({ kind: 'shape', subs: transformSubs(path, m), fill: worldFill(el.fill, m), fillRule: el.path.fillRule || 'nonzero', stroke: null, strokeWidth: 0, ct: elCT });
    if (el.stroke && el.strokeWidth > 0) {
      if (el.brush?.type === 'pattern' && ctx.depth < 8) {
        const sym = symbolById(doc, el.brush.symbolId);
        const b = sym && quickBounds(doc, sym, 0, layerFrame, symbolById);
        if (b) {
          const scale = (el.brush.scale ?? 100) / 100;
          const step = Math.max(2, b.w * scale * (1 + (el.brush.spacing ?? 0) / 100));
          for (const pl of patternPlacements(path, step)) {
            const c = Math.cos(pl.angle), s = Math.sin(pl.angle);
            const P = multiply(m, multiply([c, s, -s, c, pl.x, pl.y], [scale, 0, 0, scale, -(b.x + b.w / 2) * scale, -(b.y + b.h / 2) * scale]));
            flattenTimeline(out, doc, sym, 0, P, elCT, { ...ctx, depth: ctx.depth + 1, camera: false });
          }
          return;
        }
      }
      if (el.widthProfile?.length) {
        const polys = variableStrokePolys(path, el.strokeWidth, el.widthProfile);
        const local = { closed: true, subs: polys.map((pl) => ({ closed: true, pts: pl.map((q) => [q.x, q.y, 0, 0, 0, 0]) })) };
        out.push({ kind: 'shape', subs: transformSubs(local, m), fill: el.stroke, fillRule: 'nonzero', stroke: null, strokeWidth: 0, ct: elCT });
        return;
      }
      out.push({ kind: 'shape', subs: transformSubs(path, m), fill: null, fillRule: 'nonzero', stroke: el.stroke, strokeWidth: el.strokeWidth * scaleOf(m), ct: elCT });
    }
    return;
  }
  if (el.type === 'instance') {
    const sym = symbolById(doc, el.symbolId);
    if (!sym || ctx.depth >= MAX_DEPTH) return;
    const f = instanceFrame(sym, el, ctx.offset || 0, ctx.mcTime || 0, ctx.playMC !== false);
    flattenTimeline(out, doc, sym, f, multiply(M, el.matrix), combineCT(ct, colorToCT(el.color)), { ...ctx, depth: ctx.depth + 1, camera: false });
    return;
  }
  const elCT = combineCT(ct, el.color && el.color.mode !== 'none' ? colorToCT(el.color) : null);
  if (el.type === 'bitmap') out.push({ kind: 'bitmap', assetId: el.assetId, w: el.w, h: el.h, matrix: multiply(M, el.matrix), ct: elCT, el });
  else if (el.type === 'text') out.push({ kind: 'text', el, matrix: multiply(M, el.matrix), ct: elCT });
  else if (el.type === 'component') out.push({ kind: 'component', el, matrix: multiply(M, el.matrix), ct: elCT });
}

/** Achata uma timeline num quadro, empilhando de baixo para cima em `out`. */
export function flattenTimeline(out, doc, tl, frame, M = IDENTITY, ct = null, ctx = {}) {
  ctx = { depth: 0, playMC: true, ...ctx };
  const lms = layerMatrices(doc, tl, frame, { camera: ctx.camera !== false && ctx.depth === 0 });
  const byId = new Map(tl.layers.map((l) => [l.id, l]));
  const shown = (l) => !isHiddenLayer(tl, l);
  const doLayer = (dst, layer) => {
    const lf = shownLayerFrame(layer, frame, tl);
    if (!lf) return;
    const lm = multiply(M, lms.get(layer.id) || IDENTITY);
    for (const it of lf.items) flattenElement(dst, doc, it.el, lm, ct, { ...ctx, offset: lf.offset, mcTime: it.mcTime });
  };
  for (let i = tl.layers.length - 1; i >= 0; i--) {
    const layer = tl.layers[i];
    if (layer.type === 'folder' || layer.type === 'camera' || layer.type === 'guide' || !shown(layer)) continue;
    const mask = layer.maskedBy && byId.get(layer.maskedBy);
    if (mask && mask.type === 'mask' && shown(mask)) continue;
    if (layer.type === 'mask') {
      const masked = tl.layers.filter((l) => l.maskedBy === layer.id && l.type !== 'folder' && shown(l)).reverse();
      const g = { kind: 'mask', mask: [], items: [] };
      doLayer(g.mask, layer);
      for (const l of masked) doLayer(g.items, l);
      if (g.items.length) out.push(g);
      continue;
    }
    doLayer(out, layer);
  }
  return out;
}

/** Tudo que aparece num quadro de uma cena. */
export function flattenFrame(doc, sceneIndex, frame) {
  return flattenTimeline([], doc, doc.scenes[sceneIndex], frame);
}

export { ID_CT };
