// Interface da linha do tempo: barra de controle, lista de camadas e grade de quadros (canvas).

import { icons } from './icons.js';
import { showContextMenu } from './ui-kit.js';

const CW = 12; // largura da célula de quadro
const RH = 24; // altura da linha (igual a --row-h)

const C = {
  bg: '#222227',
  rowActive: '#2c3446',
  tint5: 'rgba(255,255,255,0.035)',
  grid: 'rgba(255,255,255,0.06)',
  rowLine: '#313138',
  spanFull: '#4b4b56',
  spanFullActive: '#56607a',
  spanEmpty: '#303037',
  spanEmptyActive: '#36405a',
  spanEdge: '#17171b',
  cellLine: 'rgba(0,0,0,0.18)',
  dot: '#dcdce4',
  tween: '#5a4a8c',
  tweenActive: '#6a5aa8',
  tweenArrow: '#e4dcff',
  tweenBroken: '#b8acd8',
  playhead: '#ff4d5e',
  selected: '#4f9dff',
};

export class TimelineUI {
  constructor(editor, actions) {
    this.editor = editor;
    this.actions = actions;
    this.scrollX = 0;
    this.$ = (id) => document.getElementById(id);
    this.framesCanvas = this.$('tl-frames');
    this.rulerCanvas = this.$('tl-ruler');
    this.hscroll = this.$('tl-hscroll');
    this.layersEl = this.$('tl-layers');
    this.scrollEl = this.$('tl-scroll');

    this.buildToolbar();
    this.buildCorner();
    this.buildFooter();
    this.bindFrames();
    this.bindResizer();

    new ResizeObserver(() => this.redraw()).observe(this.$('tl-frames-wrap'));
    new ResizeObserver(() => this.redraw()).observe(this.scrollEl);
    this.hscroll.addEventListener('scroll', () => {
      this.scrollX = this.hscroll.scrollLeft;
      this.redraw();
    });

    editor.on('doc', () => {
      this.renderLayers();
      this.updateReadout();
      this.redraw();
    });
    editor.on('layers', () => {
      // só troca a camada ativa: atualiza classes sem recriar as linhas (mantém o duplo clique)
      [...this.layersEl.children].forEach((row, i) => {
        const layer = editor.layers[i];
        const active = layer?.id === editor.activeLayerId;
        row.classList.toggle('active', active);
        const pen = row.querySelectorAll('.lr-icon')[1];
        if (pen) pen.style.visibility = active && editor.isEditable(layer) ? 'visible' : 'hidden';
      });
      this.redraw();
    });
    editor.on('frame', () => {
      this.updateReadout();
      this.keepPlayheadVisible();
      this.redraw();
    });
    editor.on('options', () => {
      this.updateToolbar();
      this.redraw();
    });
    editor.on('playing', () => this.updateToolbar());
    editor.on('load', () => {
      this.hscroll.scrollLeft = 0;
      this.scrollX = 0;
    });

    this.renderLayers();
    this.updateToolbar();
    this.updateReadout();
  }

  // ---------- barra superior ----------
  buildToolbar() {
    const bar = this.$('tl-toolbar');
    const btn = (icon, title, action) => {
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.innerHTML = icons[icon];
      b.title = title;
      b.addEventListener('click', () => this.actions.run(action));
      bar.appendChild(b);
      return b;
    };
    const sep = () => bar.appendChild(Object.assign(document.createElement('div'), { className: 'tl-sep' }));

    btn('first', 'Primeiro quadro (Home)', 'firstFrame');
    btn('prev', 'Quadro anterior (,)', 'prevFrame');
    this.playBtn = btn('play', 'Reproduzir (Enter)', 'togglePlay');
    btn('next', 'Próximo quadro (.)', 'nextFrame');
    btn('last', 'Último quadro (End)', 'lastFrame');
    this.loopBtn = btn('loop', 'Repetir reprodução', 'toggleLoop');
    sep();
    this.readout = document.createElement('div');
    this.readout.className = 'tl-readout';
    bar.appendChild(this.readout);
    sep();
    this.onionBtn = btn('onion', 'Onion skin (Alt+Shift+O)', 'toggleOnion');

    const opts = document.createElement('div');
    opts.className = 'onion-opts';
    opts.innerHTML = `
      <label class="tl-opt" title="Quadros antes"><span style="color:${this.editor.onion.beforeColor}">◀</span>
        <input class="tl-num" type="number" min="0" max="20" data-k="before"></label>
      <label class="tl-opt" title="Quadros depois">
        <input class="tl-num" type="number" min="0" max="20" data-k="after"><span style="color:${this.editor.onion.afterColor}">▶</span></label>
      <label class="tl-opt" title="Mostrar só o contorno"><input type="checkbox" data-k="outline"> Contorno</label>`;
    opts.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        if (k === 'outline') this.editor.setOnion({ outline: inp.checked });
        else this.editor.setOnion({ [k]: Math.max(0, Math.min(20, parseInt(inp.value, 10) || 0)) });
      });
    });
    bar.appendChild(opts);
    this.onionOpts = opts;

    bar.appendChild(Object.assign(document.createElement('div'), { className: 'spacer' }));
    btn('test', 'Testar cena numa janela (Ctrl+Enter)', 'testScene');
  }

  updateToolbar() {
    const ed = this.editor;
    this.playBtn.innerHTML = ed.player.playing ? icons.stop : icons.play;
    this.playBtn.title = ed.player.playing ? 'Parar (Enter)' : 'Reproduzir (Enter)';
    this.loopBtn.classList.toggle('on', ed.loop);
    this.onionBtn.classList.toggle('on', ed.onion.enabled);
    this.onionOpts.hidden = !ed.onion.enabled;
    for (const inp of this.onionOpts.querySelectorAll('input')) {
      const k = inp.dataset.k;
      if (k === 'outline') inp.checked = ed.onion.outline;
      else if (document.activeElement !== inp) inp.value = ed.onion[k];
    }
  }

  updateReadout() {
    const ed = this.editor;
    const secs = (ed.frame / ed.doc.fps).toFixed(2).replace('.', ',');
    this.readout.innerHTML = `Quadro <b>${ed.frame + 1}</b> / ${ed.length} · ${secs} s · ${ed.doc.fps} fps`;
  }

  buildCorner() {
    const corner = this.$('tl-corner');
    const mk = (icon, title, prop) => {
      const b = document.createElement('button');
      b.className = 'corner-btn';
      b.innerHTML = icon;
      b.title = title;
      b.addEventListener('click', () => this.editor.toggleAllLayers(prop));
      corner.appendChild(b);
    };
    mk(icons.eye, 'Mostrar/ocultar todas', 'visible');
    mk(icons.lock, 'Travar/destravar todas', 'locked');
    mk(icons.outline, 'Contorno em todas', 'outline');
  }

  buildFooter() {
    const foot = this.$('tl-layer-buttons');
    const mk = (icon, title, action) => {
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.innerHTML = icons[icon];
      b.title = title;
      b.addEventListener('click', () => this.actions.run(action));
      foot.appendChild(b);
    };
    mk('addLayer', 'Nova camada', 'newLayer');
    mk('trash', 'Apagar camada', 'deleteLayer');
  }

  // ---------- camadas ----------
  renderLayers() {
    const ed = this.editor;
    const el = this.layersEl;
    el.innerHTML = '';
    ed.layers.forEach((layer, index) => {
      const row = document.createElement('div');
      row.className = 'layer-row' + (layer.id === ed.activeLayerId ? ' active' : '');
      row.dataset.index = index;
      const active = layer.id === ed.activeLayerId;
      row.innerHTML = `
        <span class="lr-icon">${icons.layer}</span>
        <span class="lr-name"></span>
        <span class="lr-icon" style="visibility:${active && ed.isEditable(layer) ? 'visible' : 'hidden'}" title="Camada ativa">${icons.pencilSmall}</span>
        <button class="lr-btn ${layer.visible ? '' : 'alert'}" data-p="visible" title="Mostrar/ocultar">${layer.visible ? icons.eye : icons.eyeOff}</button>
        <button class="lr-btn ${layer.locked ? 'alert' : 'dim'}" data-p="locked" title="Travar/destravar">${layer.locked ? icons.lock : icons.unlock}</button>
        <button class="lr-btn" data-p="outline" title="Mostrar como contorno" style="color:${layer.color}">
          <span class="lr-swatch ${layer.outline ? '' : 'filled'}"></span></button>`;
      row.querySelector('.lr-name').textContent = layer.name;
      row.querySelectorAll('.lr-btn').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const p = b.dataset.p;
          ed.setLayerProps(layer.id, { [p]: !layer[p] }, { visible: 'Mostrar camada', locked: 'Travar camada', outline: 'Contorno' }[p]);
        }),
      );
      row.querySelectorAll('.lr-btn').forEach((b) => b.addEventListener('pointerdown', (e) => e.stopPropagation()));
      row.querySelector('.lr-name').addEventListener('dblclick', () => this.rename(row, layer));
      row.addEventListener('pointerdown', (e) => this.startLayerDrag(e, row, index, layer));
      el.appendChild(row);
    });
  }

  rename(row, layer) {
    const nameEl = row.querySelector('.lr-name');
    const input = document.createElement('input');
    input.value = layer.name;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== layer.name) this.editor.setLayerProps(layer.id, { name: v }, 'Renomear camada');
      else this.renderLayers();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  startLayerDrag(e, row, from, layer) {
    if (e.button !== 0 || e.target.tagName === 'INPUT') return;
    this.editor.setActiveLayer(layer.id);
    const startY = e.clientY;
    let dragging = false;
    let to = from;
    const rows = () => [...this.layersEl.children];
    const clear = () => rows().forEach((r) => r.classList.remove('drop-before', 'drop-after', 'dragging'));
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 5) return;
      if (!dragging) {
        dragging = true;
        row.classList.add('dragging');
      }
      const top = this.layersEl.getBoundingClientRect().top;
      const n = this.editor.layers.length;
      const ins = Math.max(0, Math.min(n, Math.round((ev.clientY - top) / RH)));
      to = ins > from ? ins - 1 : ins;
      clear();
      row.classList.add('dragging');
      const rs = rows();
      if (ins < n) rs[ins].classList.add('drop-before');
      else rs[n - 1].classList.add('drop-after');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clear();
      if (dragging && to !== from) this.editor.moveLayer(from, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- grade de quadros ----------
  bindFrames() {
    const fc = this.framesCanvas;
    const pick = (e) => {
      const r = fc.getBoundingClientRect();
      return {
        frame: Math.max(0, Math.floor((e.clientX - r.left + this.scrollX) / CW)),
        row: Math.floor((e.clientY - r.top) / RH),
      };
    };
    fc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const ed = this.editor;
      ed.stop();
      const { frame, row } = pick(e);
      const layer = ed.layers[row];
      if (layer) ed.setActiveLayer(layer.id);
      ed.setFrame(frame);
      fc.setPointerCapture(e.pointerId);
      const move = (ev) => ed.setFrame(pick(ev).frame);
      const up = () => {
        fc.removeEventListener('pointermove', move);
        fc.removeEventListener('pointerup', up);
      };
      fc.addEventListener('pointermove', move);
      fc.addEventListener('pointerup', up);
    });
    fc.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const ed = this.editor;
      ed.stop();
      const { frame, row } = pick(e);
      const layer = ed.layers[row];
      if (!layer) return;
      ed.setActiveLayer(layer.id);
      ed.setFrame(frame);
      const span = ed.currentSpan();
      const run = (id) => () => this.actions.run(id);
      showContextMenu(e.clientX, e.clientY, [
        span?.tween
          ? { label: 'Remover tween', run: run('removeTween') }
          : { label: 'Criar tween clássico', run: run('createClassicTween'), disabled: !span },
        '-',
        { label: 'Inserir quadro', hint: 'F5', run: run('insertFrame') },
        { label: 'Remover quadro', hint: 'Shift+F5', run: run('removeFrame'), disabled: !span },
        '-',
        { label: 'Inserir keyframe', hint: 'F6', run: run('insertKeyframe') },
        { label: 'Inserir keyframe vazio', hint: 'F7', run: run('insertBlankKeyframe') },
        { label: 'Limpar keyframe', hint: 'Shift+F6', run: run('clearKeyframe'), disabled: span?.start !== frame },
      ]);
    });
    fc.addEventListener('wheel', (e) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        this.hscroll.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
      }
    });

    const rc = this.rulerCanvas;
    rc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const ed = this.editor;
      ed.stop();
      const at = (ev) => Math.max(0, Math.floor((ev.clientX - rc.getBoundingClientRect().left + this.scrollX) / CW));
      ed.setFrame(at(e));
      rc.setPointerCapture(e.pointerId);
      const move = (ev) => ed.setFrame(at(ev));
      const up = () => {
        rc.removeEventListener('pointermove', move);
        rc.removeEventListener('pointerup', up);
      };
      rc.addEventListener('pointermove', move);
      rc.addEventListener('pointerup', up);
    });
    rc.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.hscroll.scrollLeft += e.deltaY + e.deltaX;
    });
  }

  bindResizer() {
    const handle = this.$('tl-resizer');
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = this.$('timeline').getBoundingClientRect().height;
      const move = (ev) => {
        const h = Math.max(130, Math.min(window.innerHeight * 0.7, startH - (ev.clientY - startY)));
        document.documentElement.style.setProperty('--tl-h', `${Math.round(h)}px`);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  keepPlayheadVisible() {
    const w = this.hscroll.clientWidth;
    const x = this.editor.frame * CW;
    if (x < this.scrollX) this.hscroll.scrollLeft = x - CW * 2;
    else if (x + CW > this.scrollX + w) this.hscroll.scrollLeft = x - w + CW * 4;
  }

  redraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.drawFrames();
      this.drawRuler();
    });
  }

  fitCanvas(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = `${h}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  drawFrames() {
    const ed = this.editor;
    const wrap = this.$('tl-frames-wrap');
    const w = wrap.clientWidth;
    const rows = ed.layers.length;
    const h = Math.max(rows * RH, this.scrollEl.clientHeight);
    if (!w) return;
    const ctx = this.fitCanvas(this.framesCanvas, w, h);

    // largura rolável
    const total = Math.max(ed.length + 120, ed.frame + 60, Math.ceil(w / CW) + 1);
    this.$('tl-hscroll-inner').style.width = `${total * CW}px`;

    const sx = this.scrollX;
    const f0 = Math.floor(sx / CW);
    const f1 = f0 + Math.ceil(w / CW) + 1;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    ed.layers.forEach((layer, r) => {
      const y = r * RH;
      const active = layer.id === ed.activeLayerId;
      if (active) {
        ctx.fillStyle = C.rowActive;
        ctx.fillRect(0, y, w, RH);
      }
      for (let f = f0; f <= f1; f++) {
        const x = f * CW - sx;
        if ((f + 1) % 5 === 0) {
          ctx.fillStyle = C.tint5;
          ctx.fillRect(x, y, CW, RH);
        }
        ctx.fillStyle = C.grid;
        ctx.fillRect(x + CW - 1, y, 1, RH);
      }
      layer.frames.forEach((s, si) => {
        if (s.start + s.duration < f0 || s.start > f1) return;
        const full = s.elements.length > 0;
        const x0 = s.start * CW - sx;
        const sw = s.duration * CW;
        if (s.tween) ctx.fillStyle = active ? C.tweenActive : C.tween;
        else ctx.fillStyle = full ? (active ? C.spanFullActive : C.spanFull) : active ? C.spanEmptyActive : C.spanEmpty;
        ctx.fillRect(x0, y + 1, sw, RH - 2);
        if (s.tween && s.duration > 1) {
          // seta do tween; tracejada quando não há keyframe de destino
          const ok = !!layer.frames[si + 1];
          const ay = y + RH / 2 + 4;
          const ax0 = x0 + CW, ax1 = x0 + sw - 3;
          ctx.save();
          ctx.strokeStyle = ok ? C.tweenArrow : C.tweenBroken;
          ctx.lineWidth = 1;
          if (!ok) ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(ax0, ay + 0.5);
          ctx.lineTo(ax1, ay + 0.5);
          ctx.stroke();
          if (ok) {
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(ax1 - 4, ay - 3);
            ctx.lineTo(ax1, ay + 0.5);
            ctx.lineTo(ax1 - 4, ay + 4);
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.fillStyle = C.cellLine;
        for (let i = 1; i < s.duration; i++) ctx.fillRect(x0 + i * CW - 1, y + 1, 1, RH - 2);
        ctx.fillStyle = C.spanEdge;
        ctx.fillRect(x0, y + 1, 1, RH - 2);
        ctx.fillRect(x0 + sw - 1, y + 1, 1, RH - 2);
        // keyframe
        const cx = x0 + CW / 2, cy = y + RH / 2 + 4;
        ctx.beginPath();
        ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
        if (full) {
          ctx.fillStyle = C.dot;
          ctx.fill();
        } else {
          ctx.strokeStyle = C.dot;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        // fim do trecho
        if (s.duration > 1 && !s.tween) {
          const ex = x0 + sw - CW / 2;
          ctx.strokeStyle = '#c8c8d2';
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(ex - 2.5) + 0.5, Math.round(cy - 4) + 0.5, 5, 7);
        }
      });
      ctx.fillStyle = C.rowLine;
      ctx.fillRect(0, y + RH - 1, w, 1);
    });

    // célula selecionada
    const ar = ed.layerIndex(ed.activeLayerId);
    if (ar >= 0) {
      ctx.strokeStyle = C.selected;
      ctx.lineWidth = 2;
      ctx.strokeRect(ed.frame * CW - sx + 1, ar * RH + 1, CW - 2, RH - 2);
    }
    // agulha
    const px = Math.round(ed.frame * CW - sx + CW / 2);
    ctx.fillStyle = C.playhead;
    ctx.fillRect(px - 0.5, 0, 1, h);
  }

  drawRuler() {
    const ed = this.editor;
    const w = this.$('tl-ruler-wrap').clientWidth;
    const h = 22;
    if (!w) return;
    const ctx = this.fitCanvas(this.rulerCanvas, w, h);
    const sx = this.scrollX;
    const f0 = Math.floor(sx / CW);
    const f1 = f0 + Math.ceil(w / CW) + 1;
    ctx.fillStyle = '#26262b';
    ctx.fillRect(0, 0, w, h);

    // faixa do onion skin
    if (ed.onion.enabled) {
      const o = ed.onion;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = o.beforeColor;
      const b0 = Math.max(0, ed.frame - o.before);
      ctx.fillRect(b0 * CW - sx, 0, (ed.frame - b0) * CW, h);
      ctx.fillStyle = o.afterColor;
      ctx.fillRect((ed.frame + 1) * CW - sx, 0, o.after * CW, h);
      ctx.globalAlpha = 1;
    }

    // fim da cena
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0 - sx, 0, ed.length * CW, h);

    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let f = f0; f <= f1; f++) {
      const x = f * CW - sx;
      const n = f + 1;
      const major = n === 1 || n % 5 === 0;
      ctx.fillStyle = major ? '#6a6a76' : '#44444c';
      ctx.fillRect(x + CW - 1, major ? 12 : 16, 1, major ? 10 : 6);
      if (major) {
        ctx.fillStyle = '#a6a6b2';
        ctx.fillText(String(n), x + CW / 2, 8);
      }
    }
    ctx.fillStyle = '#3a3a42';
    ctx.fillRect(0, h - 1, w, 1);

    // agulha
    const label = String(ed.frame + 1);
    const tw = Math.max(CW, ctx.measureText(label).width + 8);
    const cx = ed.frame * CW - sx + CW / 2;
    ctx.fillStyle = C.playhead;
    ctx.beginPath();
    ctx.roundRect(cx - tw / 2, 2, tw, 14, 3);
    ctx.fill();
    ctx.fillRect(Math.round(cx) - 0.5, 16, 1, h - 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, cx, 9);
  }
}
