// Editor de curvas: usado pelo editor de movimento (curvas de propriedade do motion tween)
// e pelo easing personalizado do tween clássico.
// Duplo clique cria ponto; arrastar move; Delete apaga; as alças aparecem no ponto selecionado.

import { esc } from './ui-kit.js';
import { curveY, EASES, EASE_LABELS } from '../player/ease.js';

/**
 * opts.title, opts.mode: 'ease' (x e y de 0 a 1) | 'motion' (x = quadro, y = valor)
 * opts.props: [{ id, label, points, base }]  (points: [{ x, y, ix, iy, ox, oy }])
 * opts.duration (motion), opts.evaluate(id, points, x) → y (para desenhar exatamente como o player)
 * Resolve com Map(id → points) das propriedades alteradas, ou null.
 */
export function openCurveEditor(opts) {
  const dlg = document.createElement('dialog');
  dlg.className = 'fa-dialog wide';
  const props = opts.props.map((p) => ({ ...p, points: structuredClone(p.points || []), dirty: false }));
  let cur = props[0];
  let sel = -1;
  const isEase = opts.mode === 'ease';
  dlg.innerHTML = `
    <h2>${esc(opts.title)}</h2>
    <div class="curve-wrap" ${isEase ? 'style="grid-template-columns:1fr"' : ''}>
      ${isEase ? '' : '<div class="curve-props"></div>'}
      <div>
        <canvas class="curve-canvas"></canvas>
        <div class="curve-tools">
          <button class="btn-flat" data-a="smooth" title="Alças automáticas no ponto selecionado">Suavizar ponto</button>
          <button class="btn-flat" data-a="corner" title="Sem alças: muda de direção no ponto">Ponto reto</button>
          <button class="btn-flat" data-a="del">Apagar ponto</button>
          ${
            isEase
              ? `<label class="tl-opt">Partir de <select data-a="preset" class="lib-search" style="width:220px"><option value="">—</option>${Object.entries(EASE_LABELS)
                  .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`)
                  .join('')}</select></label>`
              : '<button class="btn-flat" data-a="clear">Tirar todas as keys</button>'
          }
        </div>
        <p class="dlg-text" data-info style="min-height:1.5em;margin:6px 0 0"></p>
        <p class="dlg-text" style="margin-top:6px">Duplo clique na área cria um ponto. Arraste pontos e alças. ${isEase ? 'Eixo horizontal: tempo; vertical: quanto do caminho já foi feito.' : 'Eixo horizontal: quadros do tween.'}</p>
      </div>
    </div>
    <div class="dlg-actions"><button class="btn-flat" data-cancel>Cancelar</button><button class="btn-primary" data-ok>Aplicar</button></div>`;
  document.body.appendChild(dlg);
  const canvas = dlg.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const info = dlg.querySelector('[data-info]');

  const listEl = dlg.querySelector('.curve-props');
  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = props
      .map((p, i) => `<button class="curve-prop ${p === cur ? 'on' : ''} ${p.points.length ? 'has' : ''}" data-i="${i}">${esc(p.label)}</button>`)
      .join('');
    listEl.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        cur = props[Number(b.dataset.i)];
        sel = -1;
        renderList();
        draw();
      }),
    );
  }

  // ---------- coordenadas ----------
  const PAD = 34;
  let view = { x0: 0, x1: 1, y0: 0, y1: 1 };
  function fitView() {
    if (isEase) {
      const ys = cur.points.flatMap((p) => [p.y, p.y + (p.iy || 0), p.y + (p.oy || 0)]);
      view = { x0: 0, x1: 1, y0: Math.min(-0.1, ...ys) - 0.05, y1: Math.max(1.1, ...ys) + 0.05 };
      return;
    }
    const n = Math.max(1, opts.duration - 1);
    const ys = cur.points.length ? cur.points.flatMap((p) => [p.y, p.y + (p.iy || 0), p.y + (p.oy || 0)]) : [cur.base];
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 1) {
      lo -= 10;
      hi += 10;
    }
    const m = (hi - lo) * 0.15;
    view = { x0: 0, x1: n, y0: lo - m, y1: hi + m };
  }
  const W = () => canvas.clientWidth, H = () => canvas.clientHeight;
  const sx = (x) => PAD + ((x - view.x0) / (view.x1 - view.x0 || 1)) * (W() - PAD * 1.5);
  const sy = (y) => H() - PAD + 4 - ((y - view.y0) / (view.y1 - view.y0 || 1)) * (H() - PAD * 1.4);
  const wx = (px) => view.x0 + ((px - PAD) / (W() - PAD * 1.5)) * (view.x1 - view.x0);
  const wy = (py) => view.y0 + ((H() - PAD + 4 - py) / (H() - PAD * 1.4)) * (view.y1 - view.y0);

  const valueAt = (x) => (opts.evaluate ? opts.evaluate(cur.id, cur.points, x) : curveY(cur.points, x));

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W() * dpr);
    canvas.height = Math.round(H() * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#7a7a86';
    ctx.strokeStyle = '#2e2e35';
    ctx.lineWidth = 1;
    // grade
    const stepX = isEase ? 0.25 : Math.max(1, Math.ceil((view.x1 - view.x0) / 12));
    for (let x = Math.ceil(view.x0 / stepX) * stepX; x <= view.x1 + 1e-9; x += stepX) {
      ctx.beginPath();
      ctx.moveTo(sx(x) + 0.5, 6);
      ctx.lineTo(sx(x) + 0.5, H() - PAD + 4);
      ctx.stroke();
      ctx.fillText(isEase ? x.toFixed(2) : String(Math.round(x) + 1), sx(x) - 6, H() - 14);
    }
    const ny = 5;
    for (let k = 0; k <= ny; k++) {
      const y = view.y0 + ((view.y1 - view.y0) * k) / ny;
      ctx.beginPath();
      ctx.moveTo(PAD, sy(y) + 0.5);
      ctx.lineTo(W() - 6, sy(y) + 0.5);
      ctx.stroke();
      ctx.fillText(Math.abs(y) >= 100 ? y.toFixed(0) : y.toFixed(isEase ? 2 : 1), 2, sy(y) + 3);
    }
    // curva
    ctx.strokeStyle = '#4f9dff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = Math.max(60, Math.round(W()));
    for (let i = 0; i <= steps; i++) {
      const x = view.x0 + ((view.x1 - view.x0) * i) / steps;
      const y = cur.points.length || isEase ? valueAt(x) : cur.base;
      i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y));
    }
    ctx.stroke();
    // pontos e alças
    cur.points.forEach((p, i) => {
      if (i === sel) {
        ctx.strokeStyle = '#ffd60a';
        ctx.lineWidth = 1;
        for (const [hx, hy] of [
          [p.ix || 0, p.iy || 0],
          [p.ox || 0, p.oy || 0],
        ]) {
          if (!hx && !hy) continue;
          ctx.beginPath();
          ctx.moveTo(sx(p.x), sy(p.y));
          ctx.lineTo(sx(p.x + hx), sy(p.y + hy));
          ctx.stroke();
          ctx.fillStyle = '#ffd60a';
          ctx.beginPath();
          ctx.arc(sx(p.x + hx), sy(p.y + hy), 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = i === sel ? '#ffd60a' : '#ffffff';
      ctx.strokeStyle = '#000';
      ctx.fillRect(sx(p.x) - 4, sy(p.y) - 4, 8, 8);
      ctx.strokeRect(sx(p.x) - 4, sy(p.y) - 4, 8, 8);
    });
    const p = cur.points[sel];
    info.textContent = p ? (isEase ? `tempo ${p.x.toFixed(2)} · progresso ${p.y.toFixed(2)}` : `quadro ${Math.round(p.x) + 1} · valor ${p.y.toFixed(2)}`) : cur.points.length ? '' : 'Sem keys nesta propriedade.';
  }

  // ---------- interação ----------
  function hit(px, py) {
    const p = cur.points[sel];
    if (p) {
      for (const which of ['in', 'out']) {
        const hx = which === 'in' ? p.ix || 0 : p.ox || 0, hy = which === 'in' ? p.iy || 0 : p.oy || 0;
        if ((hx || hy) && Math.hypot(sx(p.x + hx) - px, sy(p.y + hy) - py) <= 7) return { type: which, i: sel };
      }
    }
    for (let i = cur.points.length - 1; i >= 0; i--) {
      const q = cur.points[i];
      if (Math.abs(sx(q.x) - px) <= 6 && Math.abs(sy(q.y) - py) <= 6) return { type: 'point', i };
    }
    return null;
  }
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const sortPoints = () => {
    const p = cur.points[sel];
    cur.points.sort((a, b) => a.x - b.x);
    sel = cur.points.indexOf(p);
  };

  canvas.addEventListener('pointerdown', (e) => {
    const { px, py } = local(e);
    const h = hit(px, py);
    if (!h) {
      sel = -1;
      draw();
      return;
    }
    sel = h.i;
    canvas.setPointerCapture(e.pointerId);
    const p = cur.points[h.i];
    const move = (ev) => {
      const q = local(ev);
      const x = wx(q.px), y = wy(q.py);
      cur.dirty = true;
      if (h.type === 'point') {
        const prev = cur.points[h.i - 1], next = cur.points[h.i + 1];
        let nx = isEase ? x : Math.round(x);
        if (isEase && (h.i === 0 || h.i === cur.points.length - 1)) nx = p.x; // pontas fixas no tempo
        if (!isEase && h.i === 0) nx = 0;
        nx = Math.max(prev ? prev.x + (isEase ? 0.01 : 1) : view.x0, Math.min(next ? next.x - (isEase ? 0.01 : 1) : view.x1, nx));
        p.x = nx;
        p.y = isEase && (h.i === 0 || h.i === cur.points.length - 1) ? p.y : y;
        if (isEase && h.i === 0) p.y = 0;
        if (isEase && h.i === cur.points.length - 1) p.y = 1;
      } else {
        const dx = x - p.x, dy = y - p.y;
        if (h.type === 'in') {
          p.ix = Math.min(0, dx);
          p.iy = dy;
        } else {
          p.ox = Math.max(0, dx);
          p.oy = dy;
        }
      }
      draw();
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      fitView();
      draw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    draw();
  });

  canvas.addEventListener('dblclick', (e) => {
    const { px } = local(e);
    let x = wx(px);
    if (!isEase) x = Math.max(0, Math.min(view.x1, Math.round(x)));
    else x = Math.max(0.01, Math.min(0.99, x));
    if (cur.points.some((p) => Math.abs(p.x - x) < (isEase ? 0.01 : 0.5))) return;
    const y = cur.points.length || isEase ? valueAt(x) : cur.base;
    if (!cur.points.length && !isEase) {
      // primeira key: começa no quadro 0 com o valor base
      cur.points.push({ x: 0, y: cur.base });
      if (x === 0) {
        sel = 0;
        cur.dirty = true;
        renderList();
        fitView();
        return draw();
      }
    }
    cur.points.push({ x, y });
    sel = cur.points.length - 1;
    sortPoints();
    cur.dirty = true;
    renderList();
    fitView();
    draw();
  });

  function smoothSel(p, i) {
    const prev = cur.points[i - 1], next = cur.points[i + 1];
    const slope = prev && next ? (next.y - prev.y) / (next.x - prev.x || 1) : 0;
    if (prev) {
      p.ix = -(p.x - prev.x) / 3;
      p.iy = p.ix * slope;
    }
    if (next) {
      p.ox = (next.x - p.x) / 3;
      p.oy = p.ox * slope;
    }
  }

  dlg.querySelectorAll('[data-a]').forEach((b) => {
    const a = b.dataset.a;
    const ev = a === 'preset' ? 'change' : 'click';
    b.addEventListener(ev, () => {
      const p = cur.points[sel];
      if (a === 'smooth' && p) smoothSel(p, sel);
      if (a === 'corner' && p) Object.assign(p, { ix: 0, iy: 0, ox: 0, oy: 0 });
      if (a === 'del' && p) {
        if (isEase && (sel === 0 || sel === cur.points.length - 1)) return;
        cur.points.splice(sel, 1);
        sel = -1;
      }
      if (a === 'clear') {
        cur.points = [];
        sel = -1;
      }
      if (a === 'preset' && b.value) {
        const fn = EASES[b.value];
        const xs = [0, 0.2, 0.4, 0.6, 0.8, 1];
        cur.points = xs.map((x) => ({ x, y: fn(x) }));
        cur.points.forEach((q, i) => smoothSel(q, i));
        sel = -1;
        b.value = '';
      }
      cur.dirty = true;
      renderList();
      fitView();
      draw();
    });
  });

  return new Promise((resolve) => {
    const close = (v) => {
      window.removeEventListener('keydown', onKey, true);
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        e.stopPropagation();
        dlg.querySelector('[data-a="del"]').click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    dlg.querySelector('[data-ok]').addEventListener('click', () => {
      const out = new Map();
      for (const p of props) if (p.dirty) out.set(p.id, p.points);
      close(out);
    });
    dlg.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.showModal();
    renderList();
    fitView();
    requestAnimationFrame(draw);
  });
}

/** keys do motion tween ↔ pontos do editor */
export const keysToPoints = (keys = []) => keys.map((k) => ({ x: k.t, y: k.v, ix: k.it || 0, iy: k.iv || 0, ox: k.ot || 0, oy: k.ov || 0 }));
export const pointsToKeys = (pts = []) =>
  pts.map((p) => {
    const k = { t: Math.round(p.x), v: p.y };
    if (p.ix || p.iy) Object.assign(k, { it: p.ix, iv: p.iy });
    if (p.ox || p.oy) Object.assign(k, { ot: p.ox, ov: p.oy });
    return k;
  });
