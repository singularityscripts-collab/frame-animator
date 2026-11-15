// Imagens (bitmaps da biblioteca), texto e componentes de interface: tudo que o player desenha
// além das formas vetoriais.

// ---------- bitmaps ----------
const images = new Map(); // id → { img, ready }
let onLoad = null;

/** Quem desenha avisa aqui para redesenhar quando uma imagem terminar de carregar. */
export function setAssetListener(fn) {
  onLoad = fn;
}

export function bitmapById(doc, id) {
  return doc.library?.bitmaps?.find((b) => b.id === id) || null;
}

export function getImage(doc, id) {
  const b = bitmapById(doc, id);
  if (!b) return null;
  const key = `${id}:${b.data.length}`;
  let rec = images.get(key);
  if (!rec) {
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    rec = { img, ready: false };
    images.set(key, rec);
    img.onload = () => {
      rec.ready = true;
      onLoad?.();
    };
    img.src = `data:${b.mime || 'image/png'};base64,${b.data}`;
  }
  return rec.ready ? rec.img : null;
}

/** Espera todos os bitmaps carregarem (export e player começam depois disso). */
export async function preloadBitmaps(doc) {
  const list = doc.library?.bitmaps || [];
  await Promise.all(
    list.map(
      (b) =>
        new Promise((resolve) => {
          if (getImage(doc, b.id)) return resolve();
          const key = `${b.id}:${b.data.length}`;
          const rec = images.get(key);
          if (!rec) return resolve();
          if (rec.img.complete && rec.img.naturalWidth) {
            rec.ready = true;
            return resolve();
          }
          rec.img.addEventListener('load', () => resolve(), { once: true });
          rec.img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  );
}

// ---------- texto ----------
export const FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];

export function fontOf(el) {
  return `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.size || 24}px "${el.font || 'Arial'}"`;
}

let measureCtx = null;
function measurer() {
  if (measureCtx) return measureCtx;
  if (typeof OffscreenCanvas !== 'undefined') measureCtx = new OffscreenCanvas(4, 4).getContext('2d');
  else if (typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Largura de um texto (sem canvas, estima pelo tamanho da fonte). */
export function measureText(el, s) {
  const m = measurer();
  const extra = (el.letterSpacing || 0) * s.length;
  if (!m) return s.length * (el.size || 24) * 0.55 + extra;
  m.font = fontOf(el);
  return m.measureText(s).width + extra;
}

/** Linhas do texto, quebrando na largura da caixa (se tiver). */
export function textLines(el, value = el.text) {
  const raw = String(value ?? '').split('\n');
  if (!(el.width > 0)) return raw;
  const out = [];
  for (const para of raw) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (line && measureText(el, test) > el.width) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function lineHeight(el) {
  return (el.size || 24) * (el.lineHeight || 1.25);
}

/** Caixa do texto no espaço local (origem no canto de cima à esquerda). */
export function textBox(el, value) {
  const lines = textLines(el, value);
  const w = el.width > 0 ? el.width : Math.max(4, ...lines.map((l) => measureText(el, l)));
  return { x: 0, y: 0, w, h: Math.max(lineHeight(el), lines.length * lineHeight(el)) };
}

export function drawText(ctx, el, value = el.text) {
  const lines = textLines(el, value);
  const box = textBox(el, value);
  ctx.save();
  ctx.transform(...el.matrix);
  ctx.font = fontOf(el);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;
  ctx.fillStyle = el.color || '#000000';
  ctx.textBaseline = 'top';
  const lh = lineHeight(el);
  lines.forEach((line, i) => {
    const w = measureText(el, line);
    const x = el.align === 'center' ? (box.w - w) / 2 : el.align === 'right' ? box.w - w : 0;
    ctx.fillText(line, x, i * lh + (lh - (el.size || 24)) / 2);
  });
  if (el.kind === 'input' && el.border !== false) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-2, -2, box.w + 4, box.h + 4);
  }
  ctx.restore();
}

// ---------- componentes de interface ----------
// el = { type: 'component', kind: 'button'|'list'|'video', w, h, props: {...}, matrix, name }

export function drawComponent(ctx, el, state = {}) {
  const { w = 120, h = 40 } = el;
  const p = el.props || {};
  ctx.save();
  ctx.transform(...el.matrix);
  ctx.font = `${p.fontSize || 14}px "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  if (el.kind === 'button') {
    const bg = state.down ? p.downColor || '#1e5fbf' : state.over ? p.overColor || '#3f8bff' : p.color || '#2f74e0';
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, Math.min(8, h / 3));
    ctx.fill();
    ctx.fillStyle = p.textColor || '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(p.label ?? 'Botão', w / 2, h / 2 + 1);
  } else if (el.kind === 'list') {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#9aa0a6';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const items = p.items || [];
    const rh = (p.fontSize || 14) + 10;
    const scroll = state.scroll || 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(1, 1, w - 2, h - 2);
    ctx.clip();
    items.forEach((it, i) => {
      const y = i * rh - scroll;
      if (y > h || y + rh < 0) return;
      const sel = (state.selected ?? p.selected ?? -1) === i;
      if (sel) {
        ctx.fillStyle = '#2f74e0';
        ctx.fillRect(1, y, w - 2, rh);
      }
      ctx.fillStyle = sel ? '#ffffff' : '#1d1d21';
      ctx.textAlign = 'left';
      ctx.fillText(String(it), 8, y + rh / 2);
    });
    ctx.restore();
  } else if (el.kind === 'video') {
    if (state.video && state.video.readyState >= 2) ctx.drawImage(state.video, 0, 0, w, h);
    else {
      ctx.fillStyle = '#111114';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffffcc';
      ctx.beginPath();
      ctx.moveTo(w / 2 - 12, h / 2 - 16);
      ctx.lineTo(w / 2 + 16, h / 2);
      ctx.lineTo(w / 2 - 12, h / 2 + 16);
      ctx.closePath();
      ctx.fill();
      ctx.font = '11px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name || 'Vídeo', w / 2, h - 12);
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
