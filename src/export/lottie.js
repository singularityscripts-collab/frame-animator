// Exporta para Lottie (JSON do bodymovin). Cada quadro vira camadas de forma "assadas";
// quadros iguais em sequência são juntados numa camada só (arquivo menor).
// Máscaras viram "track matte"; imagens viram assets; textos e componentes viram imagens
// (via opts.rasterize, que só existe no navegador/Electron).

import { flattenFrame, applyCT } from './flatten.js';
import { movieLength, movieLocate, sceneLength, isGradient, multiply } from '../player/render.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const st = (k) => ({ a: 0, k });

function color(hex, ct, alpha = 1) {
  const c = applyCT(hex, alpha, ct);
  return { rgba: [r3(c.r / 255), r3(c.g / 255), r3(c.b / 255), 1], opacity: r3(c.a * 100) };
}

function pathShape(sp) {
  const v = [], i = [], o = [];
  for (const q of sp.pts) {
    v.push([r3(q[0]), r3(q[1])]);
    i.push([r3(q[2] || 0), r3(q[3] || 0)]);
    o.push([r3(q[4] || 0), r3(q[5] || 0)]);
  }
  return { ty: 'sh', ks: st({ i, o, v, c: !!sp.closed }) };
}

const TR = { ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100), sk: st(0), sa: st(0) };

function gradientFill(fill, ct, rule) {
  const m = fill.matrix;
  const at = (x, y) => [r3(m[0] * x + m[2] * y + m[4]), r3(m[1] * x + m[3] * y + m[5])];
  const stops = [...(fill.stops || [])].sort((a, b) => a.offset - b.offset);
  const cols = [], alphas = [];
  for (const s of stops) {
    const c = applyCT(s.color, s.alpha ?? 1, ct);
    cols.push(r3(s.offset), r3(c.r / 255), r3(c.g / 255), r3(c.b / 255));
    alphas.push(r3(s.offset), r3(c.a));
  }
  const g = { ty: 'gf', o: st(100), r: rule, s: st(at(0, 0)), e: st(at(1, 0)), t: fill.type === 'radial' ? 2 : 1, g: { p: stops.length, k: st([...cols, ...alphas]) } };
  if (fill.type === 'radial') {
    g.h = st(r3((fill.focal || 0) * 100));
    g.a = st(0);
  } else g.s = st(at(-1, 0));
  return g;
}

/** Grupo Lottie de um item de forma achatado. */
function shapeGroup(it, white = false) {
  const its = it.subs.filter((sp) => sp.pts.length).map(pathShape);
  if (!its.length) return null;
  if (it.stroke) {
    const c = white ? { rgba: [1, 1, 1, 1], opacity: 100 } : color(it.stroke, it.ct);
    its.push({ ty: 'st', c: st(c.rgba), o: st(c.opacity), w: st(r3(it.strokeWidth)), lc: 2, lj: 2, ml: 4 });
  } else {
    const rule = it.fillRule === 'evenodd' ? 2 : 1;
    if (!white && isGradient(it.fill)) its.push(gradientFill(it.fill, it.ct, rule));
    else {
      const c = white ? { rgba: [1, 1, 1, 1], opacity: 100 } : typeof it.fill === 'string' ? color(it.fill, it.ct) : { rgba: [0.5, 0.5, 0.5, 1], opacity: 50 };
      its.push({ ty: 'fl', c: st(c.rgba), o: st(c.opacity), r: rule });
    }
  }
  its.push(TR);
  return { ty: 'gr', it: its, np: its.length };
}

function decompose(m) {
  const sx = Math.hypot(m[0], m[1]) || 1e-6;
  const det = m[0] * m[3] - m[1] * m[2];
  return { p: [r3(m[4]), r3(m[5]), 0], r: r3((Math.atan2(m[1], m[0]) * 180) / Math.PI), s: [r3(sx * 100), r3((det / sx) * 100), 100] };
}

/**
 * Monta o JSON Lottie.
 * opts: { allScenes, sceneIndex, from, to, rasterize(item) → { url, w, h, matrix } | null, name }
 */
export function toLottie(doc, opts = {}) {
  const sceneIndex = opts.sceneIndex || 0;
  const total = opts.allScenes ? movieLength(doc) : sceneLength(doc.scenes[sceneIndex]);
  const from = Math.max(0, opts.from ?? 0), to = Math.min(total - 1, opts.to ?? total - 1);
  const assets = [];
  const assetByUrl = new Map();
  const imageAsset = (url, w, h) => {
    if (assetByUrl.has(url)) return assetByUrl.get(url);
    const id = `img_${assets.length}`;
    assets.push({ id, w: Math.round(w), h: Math.round(h), u: '', p: url, e: 1 });
    assetByUrl.set(url, id);
    return id;
  };
  const bitmapUrl = (id) => {
    const b = doc.library.bitmaps.find((x) => x.id === id);
    return b ? { url: `data:${b.mime || 'image/png'};base64,${b.data}`, w: b.w, h: b.h } : null;
  };

  /** Converte a lista achatada em "especificações de camada" (de cima para baixo). */
  function layersOf(items) {
    const specs = [];
    let shapes = [];
    const flush = () => {
      if (shapes.length) specs.push({ ty: 4, shapes: shapes.reverse() });
      shapes = [];
    };
    const image = (url, w, h, matrix, ct) => {
      flush();
      const t = decompose(matrix);
      specs.push({ ty: 2, refId: imageAsset(url, w, h), t, o: ct ? r3(Math.max(0, Math.min(1, ct.am)) * 100) : 100 });
    };
    for (const it of items) {
      if (it.kind === 'shape') {
        const g = shapeGroup(it);
        if (g) shapes.push(g);
      } else if (it.kind === 'bitmap') {
        const b = bitmapUrl(it.assetId);
        if (b) image(b.url, b.w, b.h, multiply(it.matrix, [it.w / b.w, 0, 0, it.h / b.h, 0, 0]), it.ct);
      } else if ((it.kind === 'text' || it.kind === 'component') && opts.rasterize) {
        const r = opts.rasterize(it);
        if (r) image(r.url, r.w, r.h, r.matrix, null);
      } else if (it.kind === 'mask') {
        flush();
        const maskShapes = it.mask.filter((x) => x.kind === 'shape').map((x) => shapeGroup(x, true)).filter(Boolean).reverse();
        const inner = layersOf(it.items);
        if (!maskShapes.length) continue;
        // cada camada de conteúdo precisa da sua cópia da matte logo acima dela
        // (specs vão de baixo para cima e são invertidas no fim: a matte termina logo acima do conteúdo)
        for (const spec of [...inner].reverse()) specs.push({ ...spec, tt: 1 }, { ty: 4, shapes: maskShapes, td: 1 });
      }
    }
    flush();
    return specs.reverse(); // Lottie: a primeira camada fica por cima
  }

  const runs = []; // { specs, key, ip, op }
  for (let f = from; f <= to; f++) {
    let si = sceneIndex, lf = f;
    if (opts.allScenes) ({ sceneIndex: si, frame: lf } = movieLocate(doc, f));
    const specs = layersOf(flattenFrame(doc, si, lf));
    const key = JSON.stringify(specs);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.op = f - from + 1;
    else runs.push({ specs, key, ip: f - from, op: f - from + 1 });
  }

  const layers = [];
  let ind = 1;
  // runs posteriores não se sobrepõem no tempo, então a ordem entre runs não importa;
  // dentro de um run, a ordem das specs é a de empilhamento.
  for (const run of runs) {
    for (const spec of run.specs) {
      const base = { ddd: 0, ind: ind++, sr: 1, ao: 0, ip: run.ip, op: run.op, st: 0, bm: 0 };
      if (spec.ty === 2) {
        layers.push({ ...base, ty: 2, nm: `Imagem ${base.ind}`, refId: spec.refId, ks: { o: st(spec.o), r: st(spec.t.r), p: st(spec.t.p), a: st([0, 0, 0]), s: st(spec.t.s) } });
      } else {
        const L = { ...base, ty: 4, nm: `Quadro ${run.ip + from + 1}`, ks: { o: st(100), r: st(0), p: st([0, 0, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) }, shapes: spec.shapes };
        if (spec.td) L.td = 1;
        if (spec.tt) L.tt = 1;
        layers.push(L);
      }
    }
  }
  if (!opts.transparent) {
    const W = doc.width, H = doc.height;
    const c = color(doc.background, null);
    const rect = { ty: 'sh', ks: st({ i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], v: [[0, 0], [W, 0], [W, H], [0, H]], c: true }) };
    layers.push({
      ddd: 0, ind: ind++, ty: 4, nm: 'Fundo', sr: 1, ao: 0, ip: 0, op: to - from + 1, st: 0, bm: 0,
      ks: { o: st(100), r: st(0), p: st([0, 0, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) },
      shapes: [{ ty: 'gr', it: [rect, { ty: 'fl', c: st(c.rgba), o: st(100), r: 1 }, TR], np: 3 }],
    });
  }
  return {
    v: '5.7.4',
    fr: doc.fps,
    ip: 0,
    op: to - from + 1,
    w: doc.width,
    h: doc.height,
    nm: opts.name || 'Frame Animator',
    ddd: 0,
    assets,
    layers,
    markers: [],
  };
}
