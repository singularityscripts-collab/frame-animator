// Importa documentos do Animate: XFL (pasta com XML) e .fla (o mesmo XFL dentro de um zip,
// que o processo principal já abre). Converte cenas, camadas (normais, máscara, guia, pasta),
// keyframes com tweens e rótulos, formas (arestas → caminhos), símbolos, bitmaps, textos,
// filtros, sons e scripts (ActionScript → JavaScript, com conversão básica).

import { parseXML, child, children } from './xml.js';
import { createDocument, createLayer, uid, parseDocument, serialize } from './document.js';

// ---------- arestas ----------
/** Número de aresta do XFL (twips; pode vir em hex "#A1.8") → pixels. */
export function edgeNumber(tok) {
  let v;
  if (tok[0] === '#') {
    const [ip, fp = ''] = tok.slice(1).split('.');
    let i = parseInt(ip, 16);
    if (ip.length >= 8 && i & 0x80000000) i -= 0x100000000; // negativo em 32 bits
    v = i + (fp ? parseInt(fp, 16) / 16 ** fp.length : 0);
  } else v = parseFloat(tok);
  return (Number.isFinite(v) ? v : 0) / 20;
}

/** Decodifica o atributo "edges": lista de trechos { p0, c?, p1 } (c = controle quadrático). */
export function decodeEdges(str) {
  const segs = [];
  const toks = String(str || '').match(/[!|[\]/]|S\d+|#?-?[0-9A-Fa-f.]+/g) || [];
  let cur = null;
  let i = 0;
  const next = () => edgeNumber(toks[i++] || '0');
  while (i < toks.length) {
    const t = toks[i++];
    if (t[0] === 'S') continue;
    if (t === '!') {
      cur = { x: next(), y: next() };
    } else if (t === '|' || t === '/') {
      const p = { x: next(), y: next() };
      if (cur) segs.push({ p0: cur, p1: p });
      cur = p;
    } else if (t === '[' || t === ']') {
      const c = { x: next(), y: next() };
      const p = { x: next(), y: next() };
      if (cur) segs.push({ p0: cur, c, p1: p });
      cur = p;
    }
  }
  return segs;
}

const key = (p) => `${Math.round(p.x * 20)},${Math.round(p.y * 20)}`;
const reverseSeg = (s) => ({ p0: s.p1, c: s.c, p1: s.p0 });

/** Liga trechos orientados em laços fechados (para preenchimentos). */
export function chainLoops(segs) {
  const byStart = new Map();
  segs.forEach((s, i) => {
    const k = key(s.p0);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(i);
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const loop = [];
    let j = i;
    const startKey = key(segs[i].p0);
    for (let guard = 0; guard <= segs.length; guard++) {
      used[j] = 1;
      loop.push(segs[j]);
      const endKey = key(segs[j].p1);
      if (endKey === startKey) break;
      const cand = (byStart.get(endKey) || []).find((k) => !used[k]);
      if (cand == null) break;
      j = cand;
    }
    loops.push(loop);
  }
  return loops;
}

/** Liga trechos em sequências (para traços): abertos ou fechados. */
export function chainRuns(segs) {
  const runs = [];
  let run = null;
  for (const s of segs) {
    if (run && key(run[run.length - 1].p1) === key(s.p0)) run.push(s);
    else {
      run = [s];
      runs.push(run);
    }
  }
  return runs;
}

/** Sequência de trechos → subcaminho no formato do editor. */
export function segsToSub(segs, closed) {
  const pts = [];
  segs.forEach((s, i) => {
    const q = [s.p0.x, s.p0.y, 0, 0, 0, 0];
    if (s.c) {
      q[4] = ((s.c.x - s.p0.x) * 2) / 3;
      q[5] = ((s.c.y - s.p0.y) * 2) / 3;
    }
    if (i > 0 && segs[i - 1].c) {
      const prev = segs[i - 1];
      q[2] = ((prev.c.x - prev.p1.x) * 2) / 3;
      q[3] = ((prev.c.y - prev.p1.y) * 2) / 3;
    }
    pts.push(q);
  });
  const last = segs[segs.length - 1];
  if (closed) {
    if (last.c) {
      pts[0][2] = ((last.c.x - last.p1.x) * 2) / 3;
      pts[0][3] = ((last.c.y - last.p1.y) * 2) / 3;
    }
  } else {
    const q = [last.p1.x, last.p1.y, 0, 0, 0, 0];
    if (last.c) {
      q[2] = ((last.c.x - last.p1.x) * 2) / 3;
      q[3] = ((last.c.y - last.p1.y) * 2) / 3;
    }
    pts.push(q);
  }
  return { closed, pts };
}

// ---------- utilidades ----------
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const f = (v, d = 0) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : d;
};
function matrixOf(node) {
  const m = child(node, 'matrix/Matrix');
  if (!m) return [1, 0, 0, 1, 0, 0];
  const a = m.attrs;
  return [f(a.a, 1), f(a.b), f(a.c), f(a.d, 1), f(a.tx), f(a.ty)];
}
const color = (c) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : c && /^#[0-9a-f]{3}$/i.test(c) ? `#${c.slice(1).split('').map((x) => x + x).join('')}`.toLowerCase() : '#000000');
const bool = (v) => v === 'true' || v === '1';

function hexAlpha(hex, alpha) {
  if (alpha == null || alpha >= 1) return color(hex);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return color(hex) + a;
}

export function b64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Decodifica um bitmap "bin/*.dat" do .fla. JPEG e PNG vêm prontos; o formato sem perdas
 * (ARGB pré-multiplicado, comprimido com zlib em blocos) vira RGBA.
 */
export async function decodeBitmapDat(bytes, inflate) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: 'image/jpeg', bytes };
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { mime: 'image/png', bytes };
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return { mime: 'image/gif', bytes };
  if (bytes[0] !== 0x03 || bytes[1] !== 0x05) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint16(4, true), h = dv.getUint16(6, true);
  const compressed = bytes[25] === 1;
  let p = 26;
  let data;
  if (compressed) {
    const chunks = [];
    while (p + 2 <= bytes.length) {
      const len = dv.getUint16(p, true);
      p += 2;
      if (!len) break;
      chunks.push(bytes.subarray(p, p + len));
      p += len;
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const z = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      z.set(c, o);
      o += c.length;
    }
    data = await inflate(z);
  } else data = bytes.subarray(p);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4];
    const k = a ? 255 / a : 0;
    rgba[i * 4] = Math.min(255, data[i * 4 + 1] * k);
    rgba[i * 4 + 1] = Math.min(255, data[i * 4 + 2] * k);
    rgba[i * 4 + 2] = Math.min(255, data[i * 4 + 3] * k);
    rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}

/** WAV a partir de PCM cru (o formato vem no atributo "format", ex.: "44kHz 16bit Stereo"). */
export function pcmToWav(pcm, format = '') {
  const rate = { '5': 5512, '11': 11025, '22': 22050, '44': 44100, '48': 48000 }[(format.match(/(\d+)kHz/) || [])[1]] || 44100;
  const bits = (format.match(/(\d+)bit/) || [])[1] === '8' ? 8 : 16;
  const ch = /stereo/i.test(format) ? 2 : 1;
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, (rate * ch * bits) / 8, true);
  dv.setUint16(32, (ch * bits) / 8, true);
  dv.setUint16(34, bits, true);
  str(36, 'data');
  dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return { bytes: out, duration: pcm.length / ((rate * ch * bits) / 8) };
}

/** Conversão básica de ActionScript 3 para os scripts JavaScript do runtime. */
export function as3ToJS(code) {
  let s = String(code || '');
  s = s.replace(/^\s*import\s+[\w.*]+;?\s*$/gm, '');
  s = s.replace(/\b(var|const|let)\s+(\w+)\s*:\s*[\w.<>*]+/g, '$1 $2');
  s = s.replace(/function\s+(\w+)\s*\(([^)]*)\)\s*:\s*\w+/g, (m, n, args) => `function ${n}(${args.replace(/:\s*[\w.<>*]+/g, '')})`);
  // funções anônimas viram arrow functions (assim o "this" continua sendo a timeline)
  s = s.replace(/function\s*\(([^)]*)\)\s*(?::\s*\w+)?\s*\{/g, (m, args) => `(${args.replace(/:\s*[\w.<>*]+/g, '')}) => {`);
  s = s.replace(/MovieClip\(\s*(this\.)?root\s*\)/g, 'root');
  s = s.replace(/\bthis\.root\b/g, 'root');
  s = s.replace(/\.addEventListener\(\s*MouseEvent\.(CLICK|MOUSE_DOWN|MOUSE_UP|MOUSE_OVER|MOUSE_OUT|ROLL_OVER|ROLL_OUT)\s*,/g, (m, ev) => `.on('${{ CLICK: 'click', MOUSE_DOWN: 'mousedown', MOUSE_UP: 'mouseup', MOUSE_OVER: 'mouseover', MOUSE_OUT: 'mouseout', ROLL_OVER: 'mouseover', ROLL_OUT: 'mouseout' }[ev]}',`);
  // instancia.on(...) → this.getChild('instancia').on(...)
  s = s.replace(/(^|[^.\w$])(?:this\.)?(?!this\b|root\b|stage\b)([A-Za-z_]\w*)\.on\('/gm, (m, pre, id) => `${pre}this.getChild('${id}').on('`);
  s = s.replace(/(^|[^.\w$])(stop|play|gotoAndPlay|gotoAndStop|nextFrame|prevFrame)\s*\(/g, '$1this.$2(');
  s = s.replace(/(^|[^.\w$])(currentFrame|totalFrames|currentLabel)\b/g, '$1this.$2');
  s = s.replace(/new URLRequest\(([^)]*)\)/g, '$1');
  s = s.replace(/\bSoundMixer\.stopAll\(\)/g, 'stopAllSounds()');
  return `// Convertido de ActionScript (revise se algo não funcionar)\n${s.trim()}\n`;
}

// ---------- estilos ----------
const GRADIENT_SCALE = 819.2; // o gradiente do XFL ocupa -819,2..819,2 px no seu espaço

function fillOf(node, ctx) {
  if (!node) return null;
  const solid = child(node, 'SolidColor');
  if (solid) return hexAlpha(solid.attrs.color || '#000000', solid.attrs.alpha != null ? f(solid.attrs.alpha, 1) : 1);
  const grad = child(node, 'LinearGradient') || child(node, 'RadialGradient');
  if (grad) {
    const m = matrixOf(grad);
    return {
      type: grad.name === 'RadialGradient' ? 'radial' : 'linear',
      stops: children(grad, 'GradientEntry').map((g) => ({ color: color(g.attrs.color || '#000000'), alpha: g.attrs.alpha != null ? f(g.attrs.alpha, 1) : 1, offset: f(g.attrs.ratio) })),
      matrix: mul(m, [GRADIENT_SCALE, 0, 0, GRADIENT_SCALE, 0, 0]),
      ...(grad.attrs.focalPointRatio ? { focal: f(grad.attrs.focalPointRatio) } : {}),
    };
  }
  const bmp = child(node, 'BitmapFill');
  if (bmp) {
    const id = ctx.bitmapIdByName.get(bmp.attrs.bitmapPath);
    if (id) {
      const m = matrixOf(bmp);
      return { type: 'bitmap', assetId: id, matrix: [m[0] / 20, m[1] / 20, m[2] / 20, m[3] / 20, m[4], m[5]] };
    }
  }
  return '#808080';
}

const solidOfFill = (fill) => (typeof fill === 'string' ? fill : fill?.stops?.[0]?.color || '#000000');

/** Recentraliza subcaminhos e devolve { path, cx, cy }. */
function centered(subs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of subs) for (const q of sp.pts) {
    x0 = Math.min(x0, q[0]);
    y0 = Math.min(y0, q[1]);
    x1 = Math.max(x1, q[0]);
    y1 = Math.max(y1, q[1]);
  }
  const cx = (x0 + x1) / 2 || 0, cy = (y0 + y1) / 2 || 0;
  for (const sp of subs) for (const q of sp.pts) {
    q[0] -= cx;
    q[1] -= cy;
  }
  return { path: subs.length === 1 ? subs[0] : { closed: subs.every((s) => s.closed), subs }, cx, cy };
}

/** <DOMShape> → formas do editor (uma por estilo de preenchimento e uma por traço). */
export function shapeElements(node, ctx, outer = [1, 0, 0, 1, 0, 0]) {
  const M = mul(outer, bool(node.attrs.isDrawingObject) || child(node, 'matrix') ? matrixOf(node) : [1, 0, 0, 1, 0, 0]);
  const fills = new Map(), strokes = new Map();
  for (const fs of children(node, 'fills/FillStyle')) fills.set(fs.attrs.index, fillOf(fs, ctx));
  for (const ss of children(node, 'strokes/StrokeStyle')) {
    const st = ss.children[0];
    if (!st) continue;
    const fill = fillOf(child(st, 'fill'), ctx);
    strokes.set(ss.attrs.index, { color: solidOfFill(fill), width: Math.max(0.1, f(st.attrs.weight, 1)) });
  }
  const fillSegs = new Map(), strokeSegs = new Map();
  const add = (map, k, s) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  };
  for (const e of children(node, 'edges/Edge')) {
    const segs = decodeEdges(e.attrs.edges);
    const f0 = e.attrs.fillStyle0, f1 = e.attrs.fillStyle1, st = e.attrs.strokeStyle;
    for (const s of segs) {
      if (f1 && f1 !== '0') add(fillSegs, f1, s);
      if (f0 && f0 !== '0') add(fillSegs, f0, reverseSeg(s));
    }
    if (st && st !== '0') for (const run of chainRuns(segs)) add(strokeSegs, st, run);
  }
  const out = [];
  const make = (subs, extra) => {
    if (!subs.length) return;
    const c = centered(subs);
    const el = { id: uid('e'), type: 'shape', matrix: mul(M, [1, 0, 0, 1, c.cx, c.cy]), path: c.path, fill: null, stroke: null, strokeWidth: 0, ...extra(c) };
    out.push(el);
  };
  for (const [k, segs] of fillSegs) {
    const fill = fills.get(k);
    if (fill == null) continue;
    const subs = chainLoops(segs).filter((l) => l.length >= 2).map((l) => segsToSub(l, true));
    make(subs, (c) => {
      let fl = fill;
      if (fl && typeof fl === 'object' && fl.matrix) fl = { ...fl, matrix: mul([1, 0, 0, 1, -c.cx, -c.cy], fl.matrix) };
      if (c.path.subs) c.path.fillRule = 'evenodd';
      else c.path.fillRule = 'evenodd';
      return { fill: fl };
    });
  }
  for (const [k, runs] of strokeSegs) {
    const st = strokes.get(k);
    if (!st) continue;
    const subs = runs.map((r) => segsToSub(r, key(r[0].p0) === key(r[r.length - 1].p1) && r.length > 1));
    // traço não fecha o caminho para preencher: formas de traço só têm stroke
    make(subs, () => ({ stroke: st.color.slice(0, 7), strokeWidth: st.width }));
  }
  return out;
}

const shortNameOf = (n) => String(n || '').split('/').pop();

const BLEND = { multiply: 'multiply', screen: 'screen', lighten: 'lighten', darken: 'darken', difference: 'difference', add: 'add', invert: 'invert', alpha: 'alpha', erase: 'erase', overlay: 'overlay', hardlight: 'hardlight' };

function filtersOf(node) {
  const out = [];
  for (const fl of child(node, 'filters')?.children || []) {
    const a = fl.attrs;
    const blur = (f(a.blurX, 5) + f(a.blurY, 5)) / 2;
    if (fl.name === 'DropShadowFilter') out.push({ type: 'dropShadow', distance: f(a.distance, 5), angle: f(a.angle, 45), blur, color: color(a.color || '#000000'), alpha: f(a.alpha, 1) * 100, strength: f(a.strength, 1), inner: bool(a.inner), knockout: bool(a.knockout), enabled: true });
    else if (fl.name === 'BlurFilter') out.push({ type: 'blur', blur, enabled: true });
    else if (fl.name === 'GlowFilter') out.push({ type: 'glow', blur, color: color(a.color || '#ff0000'), alpha: f(a.alpha, 1) * 100, strength: f(a.strength, 1), inner: bool(a.inner), knockout: bool(a.knockout), enabled: true });
    else if (fl.name === 'BevelFilter') out.push({ type: 'bevel', distance: f(a.distance, 5), angle: f(a.angle, 45), blur, highlight: color(a.highlightColor || '#ffffff'), shadow: color(a.shadowColor || '#000000'), strength: f(a.strength, 1), enabled: true });
    else if (fl.name === 'AdjustColorFilter') out.push({ type: 'adjustColor', brightness: f(a.brightness), contrast: f(a.contrast), saturation: f(a.saturation), hue: f(a.hue), enabled: true });
  }
  return out;
}

function colorOf(node) {
  const c = child(node, 'color/Color');
  if (!c) return { mode: 'none' };
  const a = c.attrs;
  if (a.brightness != null) return { mode: 'brightness', brightness: f(a.brightness) * 100 };
  if (a.tintMultiplier != null) return { mode: 'tint', tint: color(a.tintColor || '#000000'), tintAmount: f(a.tintMultiplier) * 100 };
  const adv = ['redMultiplier', 'greenMultiplier', 'blueMultiplier', 'redOffset', 'greenOffset', 'blueOffset', 'alphaOffset'].some((k) => a[k] != null);
  if (adv) {
    return {
      mode: 'advanced',
      rm: f(a.redMultiplier, 1) * 100,
      gm: f(a.greenMultiplier, 1) * 100,
      bm: f(a.blueMultiplier, 1) * 100,
      am: f(a.alphaMultiplier, 1) * 100,
      ro: f(a.redOffset),
      go: f(a.greenOffset),
      bo: f(a.blueOffset),
      ao: f(a.alphaOffset),
    };
  }
  if (a.alphaMultiplier != null) return { mode: 'alpha', alpha: f(a.alphaMultiplier, 1) * 100 };
  return { mode: 'none' };
}

const fontName = (face) =>
  String(face || 'Arial')
    .replace(/(MT|PSMT)$/, '')
    .replace(/-(Bold|Italic|BoldItalic|Regular|Roman)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();

function textElement(node, M) {
  const runs = children(node, 'textRuns/DOMTextRun');
  const text = runs.map((r) => child(r, 'characters')?.text || '').join('').replace(/\r\n?/g, '\n');
  const at = child(runs[0] || node, 'textAttrs/DOMTextAttrs')?.attrs || {};
  const size = f(at.size, 12);
  const kind = node.name === 'DOMDynamicText' ? 'dynamic' : node.name === 'DOMInputText' ? 'input' : 'static';
  const el = {
    id: uid('e'),
    type: 'text',
    kind,
    text,
    font: fontName(at.face),
    size,
    color: color(at.fillColor || '#000000'),
    bold: bool(at.bold) || /bold/i.test(at.face || ''),
    italic: bool(at.italic) || /italic/i.test(at.face || ''),
    align: ['center', 'right'].includes(at.alignment) ? at.alignment : 'left',
    letterSpacing: f(at.letterSpacing),
    lineHeight: (size + f(at.lineSpacing, 2)) / size,
    width: node.attrs.autoExpand === 'true' ? 0 : f(node.attrs.width),
    matrix: mul(M, mul(matrixOf(node), [1, 0, 0, 1, f(node.attrs.left), 0])),
  };
  if (node.attrs.name) el.name = node.attrs.name;
  return el;
}

/** Elementos de um <elements> (achata grupos). */
function elementsOf(list, ctx, M = [1, 0, 0, 1, 0, 0]) {
  const out = [];
  for (const node of list) {
    if (node.name === 'DOMShape') out.push(...shapeElements(node, ctx, M));
    else if (node.name === 'DOMGroup') out.push(...elementsOf(child(node, 'members')?.children || [], ctx, M));
    else if (node.name === 'DOMSymbolInstance') {
      const sid = ctx.symbolIdByName.get(node.attrs.libraryItemName) || ctx.symbolIdByName.get(shortNameOf(node.attrs.libraryItemName));
      if (!sid) continue;
      const sym = ctx.symbols.get(sid);
      const st = node.attrs.symbolType ? (node.attrs.symbolType === 'movie clip' ? 'movieclip' : node.attrs.symbolType) : sym.type;
      const el = {
        id: uid('e'),
        type: 'instance',
        symbolId: sid,
        matrix: mul(M, matrixOf(node)),
        behavior: st === 'graphic' ? 'graphic' : st === 'button' ? 'button' : 'movieclip',
        loop: { 'play once': 'once', 'single frame': 'single' }[node.attrs.loop] || 'loop',
        firstFrame: Math.max(0, Math.floor(f(node.attrs.firstFrame))),
        color: colorOf(node),
      };
      if (node.attrs.name) el.name = node.attrs.name;
      const filters = filtersOf(node);
      if (filters.length) el.filters = filters;
      if (BLEND[node.attrs.blendMode]) el.blend = BLEND[node.attrs.blendMode];
      if (bool(node.attrs.cacheAsBitmap)) el.cacheAsBitmap = true;
      if (node.attrs.rotationX) el.rx = f(node.attrs.rotationX);
      if (node.attrs.rotationY) el.ry = f(node.attrs.rotationY);
      if (node.attrs.z) el.z = f(node.attrs.z);
      out.push(el);
    } else if (node.name === 'DOMBitmapInstance') {
      const b = ctx.bitmapByName.get(node.attrs.libraryItemName);
      if (!b) continue;
      out.push({ id: uid('e'), type: 'bitmap', assetId: b.id, w: b.w, h: b.h, matrix: mul(M, matrixOf(node)) });
    } else if (node.name === 'DOMStaticText' || node.name === 'DOMDynamicText' || node.name === 'DOMInputText') out.push(textElement(node, M));
  }
  return out;
}

/** <DOMTimeline> → { name, layers } */
function timelineOf(tlNode, ctx) {
  const layerNodes = children(tlNode, 'layers/DOMLayer');
  const layers = layerNodes.map((ln, i) => {
    const L = createLayer(ln.attrs.name || `Camada ${i + 1}`, i);
    if (ln.attrs.color) L.color = color(ln.attrs.color);
    L.visible = ln.attrs.visible !== 'false';
    L.locked = bool(ln.attrs.locked);
    L.outline = bool(ln.attrs.outline);
    const t = ln.attrs.layerType;
    if (t === 'mask' || t === 'guide' || t === 'folder') L.type = t;
    if (t === 'folder') L.collapsed = ln.attrs.open === 'false';
    L.frames = [];
    let pos = 0;
    for (const fn of children(ln, 'frames/DOMFrame')) {
      const start = Math.max(0, Math.floor(f(fn.attrs.index)));
      const duration = Math.max(1, Math.floor(f(fn.attrs.duration, 1)));
      if (start > pos) L.frames.push({ start: pos, duration: start - pos, elements: [] });
      const span = { start, duration, elements: L.type === 'folder' ? [] : elementsOf(child(fn, 'elements')?.children || [], ctx) };
      const tw = fn.attrs.tweenType;
      if (tw === 'motion' || tw === 'motion object') {
        span.tween = { type: 'classic', ease: Math.max(-100, Math.min(100, f(fn.attrs.acceleration))) };
        const rot = fn.attrs.motionTweenRotate;
        if (rot === 'clockwise' || rot === 'counter-clockwise') {
          span.tween.rotate = rot === 'clockwise' ? 'cw' : 'ccw';
          span.tween.rotations = Math.max(0, Math.floor(f(fn.attrs.motionTweenRotateTimes, 1)));
        }
        if (bool(fn.attrs.motionTweenOrientToPath)) span.tween.orient = true;
      } else if (tw === 'shape') span.tween = { type: 'shape', ease: Math.max(-100, Math.min(100, f(fn.attrs.acceleration))) };
      if (fn.attrs.name) {
        span.label = fn.attrs.name;
        span.labelType = fn.attrs.labelType === 'comment' ? 'comment' : fn.attrs.labelType === 'anchor' ? 'anchor' : 'name';
      }
      const script = child(fn, 'Actionscript/script')?.text;
      if (script?.trim()) span.script = as3ToJS(script);
      const snd = fn.attrs.soundName && ctx.soundIdByName.get(fn.attrs.soundName);
      if (snd) span.sound = { id: snd, sync: ['start', 'stop', 'stream'].includes(fn.attrs.soundSync) ? fn.attrs.soundSync : 'event', loops: Math.max(1, Math.floor(f(fn.attrs.soundLoop, 1))) };
      L.frames.push(span);
      pos = start + duration;
    }
    if (!L.frames.length) L.frames.push({ start: 0, duration: 1, elements: [] });
    return L;
  });
  // vínculos (parentLayerIndex aponta para a pasta, a máscara ou o guia)
  layerNodes.forEach((ln, i) => {
    const pi = ln.attrs.parentLayerIndex;
    if (pi == null) return;
    const parent = layers[Number(pi)];
    if (!parent) return;
    if (parent.type === 'folder') layers[i].folderId = parent.id;
    else if (parent.type === 'mask') layers[i].maskedBy = parent.id;
    else if (parent.type === 'guide') layers[i].guidedBy = parent.id;
  });
  // camada dentro de pasta, mascarada: a máscara costuma ser a pasta-pai do XFL antigo; já tratado acima
  return { name: tlNode.attrs.name || 'Cena', layers };
}

/**
 * files: { caminho: { text } | { base64 } }. opts.inflate(bytes) → bytes (zlib).
 * Devolve { doc, warnings, pendingImages: [{ id, w, h, rgba }] } — as imagens "pendentes"
 * (sem perdas do .dat) precisam virar PNG no navegador (o import-ui faz isso).
 */
export async function importXFL(files, opts = {}) {
  const warnings = [];
  const names = Object.keys(files);
  const docPath = names.find((n) => /(^|\/)DOMDocument\.xml$/i.test(n));
  if (!docPath) throw new Error('Não achei o DOMDocument.xml (o arquivo não parece um XFL/FLA).');
  const base = docPath.slice(0, docPath.length - 'DOMDocument.xml'.length);
  const textOf = (p) => files[p]?.text ?? (files[p]?.base64 ? new TextDecoder().decode(b64ToBytes(files[p].base64)) : null);
  const bytesOf = (p) => (files[p]?.base64 ? b64ToBytes(files[p].base64) : files[p]?.text != null ? new TextEncoder().encode(files[p].text) : null);
  const find = (rel) => {
    const want = (base + rel).toLowerCase();
    return names.find((n) => n.toLowerCase() === want) || null;
  };

  const root = parseXML(textOf(docPath));
  const a = root.attrs;
  const doc = createDocument({ width: Math.round(f(a.width, 550)), height: Math.round(f(a.height, 400)), fps: Math.round(f(a.frameRate, 24)), background: color(a.backgroundColor || '#ffffff') });
  doc.scenes = [];
  const ctx = { symbolIdByName: new Map(), symbols: new Map(), bitmapByName: new Map(), bitmapIdByName: new Map(), soundIdByName: new Map() };
  const pendingImages = [];

  // pastas da biblioteca
  const folderIds = new Map();
  const folderFor = (name) => {
    const parts = String(name).split('/');
    parts.pop();
    let parent = null, acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      if (!folderIds.has(acc)) {
        const id = uid('f');
        folderIds.set(acc, id);
        doc.library.folders.push({ id, name: p, parentId: parent });
      }
      parent = folderIds.get(acc);
    }
    return parent;
  };
  const shortName = (n) => String(n).split('/').pop();

  // mídia: bitmaps e sons
  for (const m of child(root, 'media')?.children || []) {
    const ma = m.attrs;
    if (m.name === 'DOMBitmapItem') {
      const id = uid('b');
      let w = Math.round(f(ma.frameRight) / 20) || 0, h = Math.round(f(ma.frameBottom) / 20) || 0;
      let entry = null;
      const src = ma.href && find(`LIBRARY/${ma.href}`);
      const ext = String(ma.href || ma.name || '').split('.').pop().toLowerCase();
      const mimeOfExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' }[ext];
      if (src && mimeOfExt) entry = { mime: mimeOfExt, bytes: bytesOf(src) };
      else if (ma.bitmapDataHRef && find(`bin/${ma.bitmapDataHRef}`) && opts.inflate) {
        try {
          entry = await decodeBitmapDat(bytesOf(find(`bin/${ma.bitmapDataHRef}`)), opts.inflate);
        } catch (err) {
          warnings.push(`Imagem ${ma.name}: ${err.message}`);
        }
      }
      if (!entry) {
        warnings.push(`Imagem não encontrada: ${ma.name}`);
        continue;
      }
      if (entry.rgba) {
        w = entry.w;
        h = entry.h;
        pendingImages.push({ id, w, h, rgba: entry.rgba });
      }
      if (!w || !h) {
        // tamanho do PNG pelo cabeçalho
        const b = entry.bytes;
        if (b && b[0] === 0x89) {
          w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
          h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
        }
      }
      const bmp = { id, name: shortName(ma.name || 'Imagem'), folderId: folderFor(ma.name || ''), mime: entry.rgba ? 'image/png' : entry.mime, data: entry.bytes ? bytesToB64(entry.bytes) : 'pendente', w: w || 1, h: h || 1 };
      doc.library.bitmaps.push(bmp);
      ctx.bitmapByName.set(ma.name, bmp);
      ctx.bitmapIdByName.set(ma.name, id);
    } else if (m.name === 'DOMSoundItem') {
      const id = uid('a');
      let entry = null;
      const src = ma.href && find(`LIBRARY/${ma.href}`);
      const ext = String(ma.href || ma.name || '').split('.').pop().toLowerCase();
      const mime = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', aif: 'audio/aiff', aiff: 'audio/aiff' }[ext];
      if (src && mime) entry = { mime, bytes: bytesOf(src), duration: 0 };
      else if (ma.soundDataHRef && find(`bin/${ma.soundDataHRef}`)) {
        const raw = bytesOf(find(`bin/${ma.soundDataHRef}`));
        if ((raw[0] === 0x49 && raw[1] === 0x44) || (raw[0] === 0xff && (raw[1] & 0xe0) === 0xe0)) entry = { mime: 'audio/mpeg', bytes: raw, duration: 0 };
        else {
          const wav = pcmToWav(raw, ma.format || '');
          entry = { mime: 'audio/wav', bytes: wav.bytes, duration: wav.duration };
        }
      }
      if (!entry) {
        warnings.push(`Som não encontrado: ${ma.name}`);
        continue;
      }
      doc.library.sounds.push({ id, name: shortName(ma.name || 'Som'), folderId: folderFor(ma.name || ''), mime: entry.mime, data: bytesToB64(entry.bytes), duration: entry.duration || f(ma.sampleCount) / 44100 || 0 });
      ctx.soundIdByName.set(ma.name, id);
    }
  }

  // símbolos: primeiro registra todos (podem se referir uns aos outros), depois converte
  const symNodes = [];
  for (const inc of children(root, 'symbols/Include')) {
    const p = find(`LIBRARY/${inc.attrs.href}`);
    if (!p) {
      warnings.push(`Símbolo não encontrado: ${inc.attrs.href}`);
      continue;
    }
    const node = parseXML(textOf(p));
    const name = node.attrs.name || inc.attrs.href.replace(/\.xml$/i, '');
    const id = uid('y');
    const xflType = node.attrs.symbolType || 'movie clip';
    const sym = { id, name: shortName(name), type: xflType === 'graphic' ? 'graphic' : xflType === 'button' ? 'button' : 'movieclip', folderId: folderFor(name), layers: [], xflType };
    if (node.attrs.scaleGridLeft != null) {
      const l = f(node.attrs.scaleGridLeft), r = f(node.attrs.scaleGridRight), t = f(node.attrs.scaleGridTop), b = f(node.attrs.scaleGridBottom);
      sym.scale9 = { x: l, y: t, w: Math.max(0, r - l), h: Math.max(0, b - t) };
    }
    ctx.symbolIdByName.set(name, id);
    if (!ctx.symbolIdByName.has(shortName(name))) ctx.symbolIdByName.set(shortName(name), id);
    ctx.symbols.set(id, sym);
    symNodes.push({ sym, node });
  }
  for (const { sym, node } of symNodes) {
    const tl = child(node, 'timeline/DOMTimeline');
    sym.layers = tl ? timelineOf(tl, ctx).layers : [createLayer('Camada 1')];
    delete sym.xflType;
    doc.library.items.push(sym);
  }

  for (const tl of children(root, 'timelines/DOMTimeline')) {
    const t = timelineOf(tl, ctx);
    doc.scenes.push({ id: uid('s'), name: t.name, layers: t.layers });
  }
  if (!doc.scenes.length) doc.scenes.push({ id: uid('s'), name: 'Cena 1', layers: [createLayer('Camada 1')] });

  const pendingIds = new Set(pendingImages.map((p) => p.id));
  for (const b of doc.library.bitmaps) if (pendingIds.has(b.id)) b.data = 'AA=='; // preenchido depois com o PNG
  const normalized = parseDocument(serialize(doc));
  return { doc: normalized, warnings, pendingImages };
}
