// Exporta um quadro como SVG (vetorial). Formas, gradientes, máscaras, imagens e textos.
// Filtros, modos de mesclagem e 3D não existem no SVG simples e ficam de fora.

import { flattenFrame, applyCT } from './flatten.js';
import { cameraAt, isGradient } from '../player/render.js';
import { textLines, lineHeight, measureText } from '../player/assets.js';

const n = (v) => (Math.round(v * 100) / 100).toString();
const escXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);

/** Texto "d" do SVG a partir de subcaminhos já no mundo. */
export function subsToD(subs) {
  let d = '';
  for (const sp of subs) {
    const p = sp.pts;
    if (!p.length) continue;
    d += `M${n(p[0][0])} ${n(p[0][1])}`;
    const segs = sp.closed ? p.length : p.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (a[4] || a[5] || b[2] || b[3]) d += `C${n(a[0] + a[4])} ${n(a[1] + a[5])} ${n(b[0] + b[2])} ${n(b[1] + b[3])} ${n(b[0])} ${n(b[1])}`;
      else d += `L${n(b[0])} ${n(b[1])}`;
    }
    if (sp.closed) d += 'Z';
  }
  return d;
}

/** Valores que vêm do arquivo e vão para atributos: só aceitam o formato esperado. */
const safeColor = (c, def) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : def);
const safeMime = (m) => (typeof m === 'string' && /^image\/[\w.+-]+$/i.test(m) ? m : 'image/png');
const safeB64 = (d) => (typeof d === 'string' && /^[A-Za-z0-9+/=\s]*$/.test(d) ? d.replace(/\s/g, '') : '');
const safeUrl = (u) => (typeof u === 'string' && /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]*$/.test(u) ? u : '');

const mat = (m) => `matrix(${m.map(n).join(' ')})`;

/**
 * SVG de um quadro.
 * opts.scale (%), opts.transparent, opts.rasterize(item) → dataURL para componentes (opcional).
 */
export function frameToSVG(doc, sceneIndex, frame, opts = {}) {
  const s = (opts.scale ?? 100) / 100;
  const W = Math.round(doc.width * s), H = Math.round(doc.height * s);
  const defs = [];
  let uid = 0;
  const id = (p) => `${p}${++uid}`;

  function paint(fill, ct, forceWhite) {
    if (forceWhite) return 'fill="#ffffff"';
    if (isGradient(fill)) {
      const gid = id('g');
      const stops = [...(fill.stops || [])]
        .sort((a, b) => a.offset - b.offset)
        .map((st) => {
          const c = applyCT(st.color, st.alpha ?? 1, ct);
          return `<stop offset="${n(st.offset)}" stop-color="${c.hex}"${c.a < 1 ? ` stop-opacity="${n(c.a)}"` : ''}/>`;
        })
        .join('');
      const m = fill.matrix;
      if (fill.type === 'radial') defs.push(`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" fx="${n(Math.max(-0.98, Math.min(0.98, fill.focal || 0)))}" fy="0" gradientTransform="${mat(m)}">${stops}</radialGradient>`);
      else defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="-1" y1="0" x2="1" y2="0" gradientTransform="${mat(m)}">${stops}</linearGradient>`);
      return `fill="url(#${gid})"`;
    }
    if (fill && typeof fill === 'object') return 'fill="#808080" fill-opacity="0.5"'; // preenchimento de bitmap: aproximado
    const c = applyCT(fill, 1, ct);
    return `fill="${c.hex}"${c.a < 1 ? ` fill-opacity="${n(c.a)}"` : ''}`;
  }

  function item(it, white = false) {
    if (it.kind === 'shape') {
      const d = subsToD(it.subs);
      if (!d) return '';
      if (it.stroke) {
        const c = white ? { hex: '#ffffff', a: 1 } : applyCT(it.stroke, 1, it.ct);
        return `<path d="${d}" fill="none" stroke="${c.hex}"${c.a < 1 ? ` stroke-opacity="${n(c.a)}"` : ''} stroke-width="${n(it.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return `<path d="${d}" ${paint(it.fill, it.ct, white)}${it.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`;
    }
    if (it.kind === 'bitmap') {
      const b = doc.library.bitmaps.find((x) => x.id === it.assetId);
      if (!b) return '';
      const a = it.ct ? Math.max(0, Math.min(1, it.ct.am)) : 1;
      return `<image transform="${mat(it.matrix)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none" href="data:${safeMime(b.mime)};base64,${safeB64(b.data)}"${a < 1 ? ` opacity="${n(a)}"` : ''}/>`;
    }
    if (it.kind === 'text') {
      const el = it.el;
      const lines = textLines(el);
      const lh = lineHeight(el);
      const c = white ? { hex: '#ffffff', a: 1 } : applyCT(el.color, 1, it.ct);
      const bw = el.width > 0 ? el.width : Math.max(4, ...lines.map((l) => measureText(el, l)));
      const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
      const x = el.align === 'center' ? bw / 2 : el.align === 'right' ? bw : 0;
      const tspans = lines.map((l, i) => `<tspan x="${n(x)}" y="${n(i * lh + (lh - el.size) / 2 + el.size * 0.8)}">${escXml(l)}</tspan>`).join('');
      // el.matrix já está em it.matrix
      return `<text transform="${mat(it.matrix)}" font-family="${escXml(el.font || 'Arial')}" font-size="${n(el.size)}"${el.bold ? ' font-weight="bold"' : ''}${el.italic ? ' font-style="italic"' : ''}${el.letterSpacing ? ` letter-spacing="${n(el.letterSpacing)}"` : ''} text-anchor="${anchor}" fill="${c.hex}"${c.a < 1 ? ` fill-opacity="${n(c.a)}"` : ''} xml:space="preserve">${tspans}</text>`;
    }
    if (it.kind === 'component' && opts.rasterize) {
      const url = opts.rasterize(it);
      return url ? `<image transform="${mat(it.matrix)}" width="${n(it.el.w)}" height="${n(it.el.h)}" href="${safeUrl(url)}"/>` : '';
    }
    if (it.kind === 'mask') {
      const mid = id('m');
      defs.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">${it.mask.map((x) => item(x, true)).join('')}</mask>`);
      return `<g mask="url(#${mid})">${it.items.map((x) => item(x, white)).join('')}</g>`;
    }
    return '';
  }

  const items = flattenFrame(doc, sceneIndex, frame);
  const body = items.map((x) => item(x)).join('\n');
  const cam = cameraAt(doc, doc.scenes[sceneIndex], frame);
  const tint = cam && cam.tintAmount > 0 ? `<rect width="${doc.width}" height="${doc.height}" fill="${safeColor(cam.tint, '#000000')}" opacity="${n(Math.min(1, cam.tintAmount / 100))}"/>` : '';
  const bg = opts.transparent ? '' : `<rect width="${doc.width}" height="${doc.height}" fill="${safeColor(doc.background, '#ffffff')}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${doc.width} ${doc.height}">
<defs>${defs.join('')}</defs>
<clipPath id="stage"><rect width="${doc.width}" height="${doc.height}"/></clipPath>
<g clip-path="url(#stage)">
${bg}
${body}
${tint}
</g>
</svg>
`;
}
