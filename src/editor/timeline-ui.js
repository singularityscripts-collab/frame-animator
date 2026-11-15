// Interface da linha do tempo: barra de controle, lista de camadas (com pastas, máscaras, guias,
// câmera e parentesco) e a grade de quadros (canvas) com tweens, rótulos, sons e seleção de intervalo.

import { icons } from './icons.js';
import { showContextMenu } from './ui-kit.js';
import { soundById, decodeSound, computePeaks } from '../player/audio.js';

const CW = 12; // largura da célula de quadro
const RH = 24; // altura da linha (igual a --row-h)
const INDENT = 14;

const C = {
  bg: '#222227',
  rowActive: '#2c3446',
  folderRow: '#29292f',
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
  classic: ['#5a4a8c', '#6a5aa8'],
  motion: ['#2f5f93', '#3b74b0'],
  shape: ['#3a7550', '#468c61'],
  camera: ['#4d5157', '#5d636b'],
  tweenArrow: '#e4dcff',
  tweenBroken: '#b8acd8',
  key: '#ffd60a',
  label: '#ff6b6b',
  wave: 'rgba(170, 220, 255, 0.75)',
  range: 'rgba(79,157,255,0.28)',
  playhead: '#ff4d5e',
  selected: '#4f9dff',
};

const KIND_ICON = { folder: 'folder', mask: 'mask', masked: 'maskedLayer', guide: 'guide', guided: 'guidedLayer', camera: 'camera', normal: 'layer' };
const KIND_TITLE = {
  folder: 'Pasta',
  mask: 'Máscara (trave para ver o recorte no palco)',
  masked: 'Mascarada',
  guide: 'Guia (não sai no export)',
  guided: 'Guiada (segue o caminho da guia)',
  camera: 'Câmera',
  normal: 'Camada',
};

// formas de onda: decodificadas uma vez por som
const peaksCache = new Map();
let waveCtx = null;

export class TimelineUI {
  constructor(editor, actions) {
    this.editor = editor;
    this.actions = actions;
    this.scrollX = 0;
    this.rows = [];
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
        const layer = this.rows[i]?.layer;
        const active = layer?.id === editor.activeLayerId;
        row.classList.toggle('active', active);
        const pen = row.querySelector('.lr-pen');
        if (pen) pen.style.visibility = active && layer && editor.isEditable(layer) ? 'visible' : 'hidden';
      });
      this.redraw();
    });
    editor.on('frame', () => {
      this.updateReadout();
      this.keepPlayheadVisible();
      this.redraw();
    });
    editor.on('frameSel', () => this.redraw());
    editor.on('options', () => {
      this.updateToolbar();
      this.redraw();
    });
    editor.on('playing', () => this.updateToolbar());
    editor.on('library', () => this.redraw());
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
    this.onionOpts = this.rangeInputs(bar, this.editor.onion, (patch) => this.editor.setOnion(patch), true);
    this.multiBtn = btn('multi', 'Editar vários quadros', 'toggleMulti');
    this.multiOpts = this.rangeInputs(bar, this.editor.multi, (patch) => this.editor.setMulti(patch), false);
    sep();
    this.cameraBtn = btn('camera', 'Câmera da cena (liga/desliga)', 'toggleCamera');

    bar.appendChild(Object.assign(document.createElement('div'), { className: 'spacer' }));
    btn('test', 'Testar filme numa janela (Ctrl+Enter)', 'testScene');
  }

  rangeInputs(bar, state, apply, withOutline) {
    const opts = document.createElement('div');
    opts.className = 'onion-opts';
    opts.innerHTML = `
      <label class="tl-opt" title="Quadros antes"><span style="color:${state.beforeColor || '#9a9aa6'}">◀</span>
        <input class="tl-num" type="number" min="0" max="50" data-k="before"></label>
      <label class="tl-opt" title="Quadros depois">
        <input class="tl-num" type="number" min="0" max="50" data-k="after"><span style="color:${state.afterColor || '#9a9aa6'}">▶</span></label>
      ${withOutline ? '<label class="tl-opt" title="Mostrar só o contorno"><input type="checkbox" data-k="outline"> Contorno</label>' : ''}`;
    opts.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        if (k === 'outline') apply({ outline: inp.checked });
        else apply({ [k]: Math.max(0, Math.min(50, parseInt(inp.value, 10) || 0)) });
      });
    });
    bar.appendChild(opts);
    return opts;
  }

  updateToolbar() {
    const ed = this.editor;
    this.playBtn.innerHTML = ed.player.playing ? icons.stop : icons.play;
    this.playBtn.title = ed.player.playing ? 'Parar (Enter)' : 'Reproduzir (Enter)';
    this.loopBtn.classList.toggle('on', ed.loop);
    this.onionBtn.classList.toggle('on', ed.onion.enabled);
    this.onionOpts.hidden = !ed.onion.enabled;
    this.multiBtn.classList.toggle('on', ed.multi.enabled);
    this.multiOpts.hidden = !ed.multi.enabled;
    this.cameraBtn.classList.toggle('on', !!ed.cameraLayer?.());
    for (const [box, state] of [
      [this.onionOpts, ed.onion],
      [this.multiOpts, ed.multi],
    ]) {
      for (const inp of box.querySelectorAll('input')) {
        const k = inp.dataset.k;
        if (k === 'outline') inp.checked = state.outline;
        else if (document.activeElement !== inp) inp.value = state[k];
      }
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
    mk('folder', 'Nova pasta de camadas', 'newLayerFolder');
    mk('guide', 'Guia de movimento para a camada ativa', 'addMotionGuide');
    mk('gear', 'Propriedades da camada', 'layerProperties');
    mk('trash', 'Apagar camada', 'deleteLayer');
  }

  // ---------- camadas ----------
  /** Linhas visíveis: camadas fora de pastas recolhidas, com o recuo de cada uma. */
  computeRows() {
    const ed = this.editor;
    const byId = new Map(ed.layers.map((l) => [l.id, l]));
    const depthOf = (l) => {
      let d = 0;
      for (let p = l.folderId && byId.get(l.folderId); p && d < 32; p = p.folderId && byId.get(p.folderId)) d++;
      return d;
    };
    const hidden = (l) => {
      for (let p = l.folderId && byId.get(l.folderId), g = 0; p && g < 32; p = p.folderId && byId.get(p.folderId), g++) if (p.collapsed) return true;
      return false;
    };
    return ed.layers.map((layer, index) => ({ layer, index, depth: depthOf(layer) })).filter((r) => !hidden(r.layer));
  }

  renderLayers() {
    const ed = this.editor;
    const el = this.layersEl;
    this.rows = this.computeRows();
    el.innerHTML = '';
    this.rows.forEach((r, rowIndex) => {
      const { layer, index, depth } = r;
      const kind = ed.layerKind(layer);
      const row = document.createElement('div');
      const active = layer.id === ed.activeLayerId;
      row.className = 'layer-row' + (active ? ' active' : '') + (kind === 'folder' ? ' folder' : '');
      row.dataset.index = index;
      const indent = depth * INDENT + (kind === 'masked' || kind === 'guided' ? INDENT : 0);
      const parent = layer.parentLayerId && ed.layer(layer.parentLayerId);
      const special = kind === 'folder' || kind === 'camera';
      row.innerHTML = `
        <span style="width:${indent}px;flex:none"></span>
        ${kind === 'folder' ? `<button class="lr-caret" title="Abrir/fechar pasta">${layer.collapsed ? '▶' : '▼'}</button>` : ''}
        <span class="lr-icon lr-kind" title="${KIND_TITLE[kind]} · duplo clique: propriedades">${icons[KIND_ICON[kind]] || icons.layer}</span>
        <span class="lr-name"></span>
        ${parent ? `<span class="lr-icon lr-link" title="Pai: ${parent.name.replace(/"/g, '&quot;')}">${icons.link}</span>` : ''}
        ${layer.depth ? `<span class="lr-depth" title="Profundidade (parallax da câmera)">${Math.round(layer.depth)}</span>` : ''}
        <span class="lr-icon lr-pen" style="visibility:${active && ed.isEditable(layer) ? 'visible' : 'hidden'}" title="Camada ativa">${icons.pencilSmall}</span>
        <button class="lr-btn ${layer.visible ? '' : 'alert'}" data-p="visible" title="Mostrar/ocultar">${layer.visible ? icons.eye : icons.eyeOff}</button>
        <button class="lr-btn ${layer.locked ? 'alert' : 'dim'}" data-p="locked" title="Travar/destravar">${layer.locked ? icons.lock : icons.unlock}</button>
        <button class="lr-btn" data-p="outline" title="Mostrar como contorno" style="color:${layer.color};${special ? 'visibility:hidden' : ''}">
          <span class="lr-swatch ${layer.outline ? '' : 'filled'}"></span></button>`;
      row.querySelector('.lr-name').textContent = layer.name;
      row.querySelectorAll('.lr-btn').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const p = b.dataset.p;
          ed.setLayerProps(layer.id, { [p]: !layer[p] }, { visible: 'Mostrar camada', locked: 'Travar camada', outline: 'Contorno' }[p]);
        });
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
      });
      const caret = row.querySelector('.lr-caret');
      caret?.addEventListener('pointerdown', (e) => e.stopPropagation());
      caret?.addEventListener('click', (e) => {
        e.stopPropagation();
        ed.toggleFolder(layer.id);
      });
      row.querySelector('.lr-kind').addEventListener('dblclick', () => this.actions.layerProperties(layer.id));
      row.querySelector('.lr-name').addEventListener('dblclick', () => this.rename(row, layer));
      row.addEventListener('pointerdown', (e) => this.startLayerDrag(e, row, rowIndex));
      row.addEventListener('contextmenu', (e) => this.layerMenu(e, layer));
      el.appendChild(row);
    });
  }

  layerMenu(e, layer) {
    e.preventDefault();
    const ed = this.editor;
    ed.setActiveLayer(layer.id);
    const kind = ed.layerKind(layer);
    const run = (id) => () => this.actions.run(id);
    const items = [
      { label: 'Propriedades…', run: () => this.actions.layerProperties(layer.id) },
      { label: 'Renomear', run: () => this.rename(this.layersEl.children[this.rows.findIndex((r) => r.layer === layer)], layer) },
      '-',
      { label: 'Nova camada', run: run('newLayer') },
      { label: 'Nova pasta', run: run('newLayerFolder') },
    ];
    if (kind !== 'folder' && kind !== 'camera') {
      items.push(
        '-',
        { label: kind === 'mask' ? 'Deixar de ser máscara' : 'Máscara', run: () => ed.setLayerKind(layer.id, kind === 'mask' ? 'normal' : 'mask') },
        { label: kind === 'guide' ? 'Deixar de ser guia' : 'Guia', run: () => ed.setLayerKind(layer.id, kind === 'guide' ? 'normal' : 'guide') },
        { label: 'Adicionar guia de movimento', run: run('addMotionGuide'), disabled: kind !== 'normal' },
      );
    }
    items.push('-', { label: kind === 'folder' ? 'Apagar pasta (e o conteúdo)' : 'Apagar camada', run: run('deleteLayer') });
    showContextMenu(e.clientX, e.clientY, items);
  }

  rename(row, layer) {
    if (!row) return;
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

  /** Arrastar camada: entre linhas reordena; no meio de uma pasta, põe dentro dela. */
  startLayerDrag(e, row, rowIndex) {
    if (e.button !== 0 || e.target.tagName === 'INPUT') return;
    const ed = this.editor;
    const src = this.rows[rowIndex];
    ed.setActiveLayer(src.layer.id);
    const startY = e.clientY;
    let dragging = false;
    let target = null;
    const els = () => [...this.layersEl.children];
    const clear = () => els().forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging'));
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 5) return;
      dragging = true;
      clear();
      row.classList.add('dragging');
      const top = this.layersEl.getBoundingClientRect().top;
      const y = ev.clientY - top;
      const n = this.rows.length;
      const over = Math.max(0, Math.min(n - 1, Math.floor(y / RH)));
      const frac = y / RH - over;
      const overRow = this.rows[over];
      if (overRow?.layer.type === 'folder' && frac > 0.3 && frac < 0.7 && overRow !== src) {
        target = { insert: overRow.index + 1, folderId: overRow.layer.id };
        els()[over].classList.add('drop-into');
        return;
      }
      const ins = Math.max(0, Math.min(n, Math.round(y / RH)));
      const below = this.rows[ins];
      target = { insert: below ? below.index : ed.layers.length, folderId: below ? below.layer.folderId || null : null };
      if (ins < n) els()[ins].classList.add('drop-before');
      else els()[n - 1].classList.add('drop-after');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clear();
      if (dragging && target) ed.moveLayerBlock(src.index, target.insert, target.folderId);
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
        row: Math.max(0, Math.min(this.rows.length - 1, Math.floor((e.clientY - r.top) / RH))),
      };
    };
    const layersBetween = (a, b) =>
      this.rows
        .slice(Math.min(a, b), Math.max(a, b) + 1)
        .map((r) => r.layer)
        .filter((l) => l.type !== 'folder')
        .map((l) => l.id);

    fc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const ed = this.editor;
      ed.stop();
      const { frame, row } = pick(e);
      const layer = this.rows[row]?.layer;
      // Shift: estende o intervalo a partir do que já estava
      const anchor = e.shiftKey && ed.frameSel ? { frame: ed.frame, row: this.rows.findIndex((r) => r.layer.id === ed.activeLayerId) } : { frame, row };
      if (layer) ed.setActiveLayer(layer.id);
      if (e.shiftKey && ed.frameSel) ed.setFrameSelection({ from: ed.frameSel.from, to: frame, layerIds: layersBetween(anchor.row, row) });
      else ed.setFrameSelection(null);
      ed.setFrame(frame);
      fc.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const p = pick(ev);
        if (p.frame !== anchor.frame || p.row !== anchor.row) {
          ed.setFrameSelection({ from: anchor.frame, to: p.frame, layerIds: layersBetween(anchor.row, p.row) });
        }
        ed.setFrame(p.frame);
      };
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
      const layer = this.rows[row]?.layer;
      if (!layer) return;
      const sel = ed.frameSel;
      const inside = sel && frame >= sel.from && frame <= sel.to && sel.layerIds.includes(layer.id);
      if (!inside) ed.setFrameSelection(null);
      ed.setActiveLayer(layer.id);
      ed.setFrame(frame);
      this.frameMenu(e.clientX, e.clientY, frame);
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
      ed.setFrameSelection(null);
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

  frameMenu(x, y, frame) {
    const ed = this.editor;
    const span = ed.currentSpan();
    const layer = ed.activeLayer;
    const run = (id) => () => this.actions.run(id);
    const range = ed.hasFrameRange();
    const isCam = layer.type === 'camera';
    const tweenItems = span?.tween
      ? [{ label: 'Remover tween', run: run('removeTween') }]
      : [
          { label: 'Criar tween clássico', run: run('createClassicTween'), disabled: !span },
          { label: 'Criar motion tween', run: run('createMotionTween'), disabled: !span || isCam },
          { label: 'Criar shape tween', run: run('createShapeTween'), disabled: !span || isCam },
        ];
    showContextMenu(x, y, [
      ...tweenItems,
      '-',
      { label: 'Inserir quadro', hint: 'F5', run: run('insertFrame') },
      { label: range ? 'Remover quadros' : 'Remover quadro', hint: 'Shift+F5', run: run('removeFrame'), disabled: !span },
      '-',
      { label: range ? 'Converter em keyframes' : 'Inserir keyframe', hint: 'F6', run: run('insertKeyframe') },
      { label: range ? 'Converter em keyframes vazios' : 'Inserir keyframe vazio', hint: 'F7', run: run('insertBlankKeyframe') },
      { label: 'Limpar keyframe', hint: 'Shift+F6', run: run('clearKeyframe'), disabled: span?.start !== frame },
      '-',
      { label: 'Recortar quadros', hint: 'Ctrl+Alt+X', run: run('cutFrames') },
      { label: 'Copiar quadros', hint: 'Ctrl+Alt+C', run: run('copyFrames') },
      { label: 'Colar quadros', hint: 'Ctrl+Alt+V', run: run('pasteFrames'), disabled: !ed.frameClipboard },
      { label: 'Colar e substituir quadros', run: run('pasteFramesOverwrite'), disabled: !ed.frameClipboard },
      { label: 'Inverter quadros', run: run('reverseFrames'), disabled: !range },
      '-',
      { label: 'Rótulo e som do quadro…', run: run('showProperties') },
    ]);
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

  /** Picos da forma de onda (decodifica em segundo plano na primeira vez). */
  peaksFor(snd) {
    const key = `${snd.id}:${snd.data.length}`;
    const got = peaksCache.get(key);
    if (got) return got === 'loading' ? null : got;
    peaksCache.set(key, 'loading');
    try {
      waveCtx ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      decodeSound(waveCtx, snd)
        .then((buf) => {
          peaksCache.set(key, computePeaks(buf, 200));
          this.redraw();
        })
        .catch(() => peaksCache.set(key, { peaks: new Float32Array(0), rate: 200 }));
    } catch {
      peaksCache.set(key, { peaks: new Float32Array(0), rate: 200 });
    }
    return null;
  }

  drawFrames() {
    const ed = this.editor;
    const wrap = this.$('tl-frames-wrap');
    const w = wrap.clientWidth;
    const rows = this.rows;
    const h = Math.max(rows.length * RH, this.scrollEl.clientHeight);
    if (!w) return;
    const ctx = this.fitCanvas(this.framesCanvas, w, h);

    const total = Math.max(ed.length + 120, ed.frame + 60, Math.ceil(w / CW) + 1);
    this.$('tl-hscroll-inner').style.width = `${total * CW}px`;

    const sx = this.scrollX;
    const f0 = Math.floor(sx / CW);
    const f1 = f0 + Math.ceil(w / CW) + 1;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    rows.forEach(({ layer }, r) => {
      const y = r * RH;
      const active = layer.id === ed.activeLayerId;
      if (layer.type === 'folder') {
        ctx.fillStyle = active ? C.rowActive : C.folderRow;
        ctx.fillRect(0, y, w, RH);
        ctx.fillStyle = C.rowLine;
        ctx.fillRect(0, y + RH - 1, w, 1);
        return;
      }
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
        this.drawSpan(ctx, layer, s, si, y, active, sx);
      });
      ctx.fillStyle = C.rowLine;
      ctx.fillRect(0, y + RH - 1, w, 1);
    });

    // intervalo selecionado
    const sel = ed.frameSel;
    if (sel) {
      ctx.fillStyle = C.range;
      rows.forEach(({ layer }, r) => {
        if (!sel.layerIds.includes(layer.id)) return;
        ctx.fillRect(sel.from * CW - sx, r * RH, (sel.to - sel.from + 1) * CW, RH - 1);
      });
    }
    // célula selecionada
    const ar = rows.findIndex((r) => r.layer.id === ed.activeLayerId);
    if (ar >= 0) {
      ctx.strokeStyle = C.selected;
      ctx.lineWidth = 2;
      ctx.strokeRect(ed.frame * CW - sx + 1, ar * RH + 1, CW - 2, RH - 2);
    }
    const px = Math.round(ed.frame * CW - sx + CW / 2);
    ctx.fillStyle = C.playhead;
    ctx.fillRect(px - 0.5, 0, 1, h);
  }

  drawSpan(ctx, layer, s, si, y, active, sx) {
    const ed = this.editor;
    const full = s.elements.length > 0 || layer.type === 'camera';
    const x0 = s.start * CW - sx;
    const sw = s.duration * CW;
    const kind = layer.type === 'camera' && !s.tween ? 'camera' : s.tween?.type;
    if (kind && C[kind]) ctx.fillStyle = C[kind][active ? 1 : 0];
    else ctx.fillStyle = full ? (active ? C.spanFullActive : C.spanFull) : active ? C.spanEmptyActive : C.spanEmpty;
    ctx.fillRect(x0, y + 1, sw, RH - 2);

    // forma de onda do som
    const snd = s.sound && soundById(ed.doc, s.sound.id);
    if (snd) {
      const pk = this.peaksFor(snd);
      if (pk?.peaks.length) {
        const mid = y + RH / 2;
        ctx.fillStyle = C.wave;
        const fps = ed.doc.fps;
        const loops = Math.max(1, s.sound.loops || 1);
        const vol = (s.sound.volume ?? 100) / 100;
        for (let px = 0; px < sw; px++) {
          const t = px / CW / fps;
          if (t >= snd.duration * loops) break;
          const i = Math.floor((t % snd.duration) * pk.rate);
          const a = (pk.peaks[i] || 0) * vol * (RH / 2 - 3);
          ctx.fillRect(x0 + px, mid - a, 1, Math.max(1, a * 2));
        }
      }
    }

    if (s.tween && s.duration > 1 && s.tween.type !== 'motion') {
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
    // keys do motion tween (losangos)
    if (s.tween?.type === 'motion') {
      const ts = new Set();
      for (const keys of Object.values(s.tween.props || {})) for (const k of keys || []) if (k.t > 0) ts.add(k.t);
      ctx.fillStyle = C.key;
      for (const t of ts) {
        const kx = x0 + t * CW + CW / 2;
        ctx.beginPath();
        ctx.moveTo(kx, cy - 4);
        ctx.lineTo(kx + 3.5, cy);
        ctx.lineTo(kx, cy + 4);
        ctx.lineTo(kx - 3.5, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
    // script do quadro: um "a" pequeno no topo do keyframe
    if (s.script?.trim()) {
      ctx.save();
      ctx.font = 'bold 9px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffd60a';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillText('a', x0 + CW / 2, y + 1);
      ctx.restore();
    }
    // esqueleto (ossos) no keyframe: um pontinho laranja embaixo
    if (s.armature?.bones?.length) {
      ctx.fillStyle = '#ff9f0a';
      ctx.fillRect(x0 + CW / 2 - 1.5, y + RH - 5, 3, 3);
    }
    // rótulo
    if (s.label) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y, sw, RH);
      ctx.clip();
      ctx.fillStyle = s.labelType === 'comment' ? '#7cc4ff' : s.labelType === 'anchor' ? '#ffd60a' : C.label;
      ctx.fillRect(x0 + 2, y + 3, 2, 9);
      ctx.beginPath();
      ctx.moveTo(x0 + 4, y + 3);
      ctx.lineTo(x0 + 9, y + 5.5);
      ctx.lineTo(x0 + 4, y + 8);
      ctx.fill();
      ctx.font = '10px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#f2f2f6';
      ctx.textBaseline = 'top';
      ctx.fillText((s.labelType === 'comment' ? '// ' : '') + s.label, x0 + 11, y + 2);
      ctx.restore();
    }
    // fim do trecho
    if (s.duration > 1 && !s.tween) {
      const ex = x0 + sw - CW / 2;
      ctx.strokeStyle = '#c8c8d2';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(ex - 2.5) + 0.5, Math.round(cy - 4) + 0.5, 5, 7);
    }
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

    const band = (from, to, color, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(from * CW - sx, 0, (to - from) * CW, h);
      ctx.globalAlpha = 1;
    };
    if (ed.onion.enabled) {
      const o = ed.onion;
      band(Math.max(0, ed.frame - o.before), ed.frame, o.beforeColor, 0.35);
      band(ed.frame + 1, ed.frame + 1 + o.after, o.afterColor, 0.35);
    }
    if (ed.multi.enabled) {
      band(Math.max(0, ed.frame - ed.multi.before), ed.frame + ed.multi.after + 1, '#ffffff', 0.12);
      ctx.fillStyle = '#c8c8d2';
      ctx.fillRect(Math.max(0, ed.frame - ed.multi.before) * CW - sx, h - 4, 2, 4);
      ctx.fillRect((ed.frame + ed.multi.after + 1) * CW - sx - 2, h - 4, 2, 4);
    }

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
