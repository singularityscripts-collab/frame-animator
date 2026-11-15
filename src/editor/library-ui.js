// Painel da biblioteca: símbolos e pastas, busca, contagem de uso, prévia,
// arrastar para o palco e para pastas.

import { icons } from './icons.js';
import { esc, showContextMenu, confirmDialog } from './ui-kit.js';
import { SYMBOL_MIME } from './stage.js';
import { SYMBOL_TYPES } from '../model/document.js';
import { timelineBounds } from '../model/geometry.js';
import { renderTimeline } from '../player/render.js';
import { AudioEngine, decodeSound, computePeaks } from '../player/audio.js';

const preview = new AudioEngine();

const LIB_MIME = 'application/x-frame-animator-lib';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class LibraryUI {
  constructor(editor, actions, root) {
    this.editor = editor;
    this.actions = actions;
    this.root = root;
    this.selected = null; // { kind, id }
    this.expanded = new Set();
    this.query = '';
    root.innerHTML = `
      <div class="lib-preview"><canvas></canvas><div class="lib-preview-name"></div></div>
      <div class="lib-tools">
        <input class="lib-search" type="search" placeholder="Buscar na biblioteca" aria-label="Buscar na biblioteca">
        <span class="lib-count"></span>
      </div>
      <div class="lib-head"><span>Nome</span><span>Usos</span></div>
      <div class="lib-list" role="tree"></div>
      <div class="lib-foot"></div>`;
    this.list = root.querySelector('.lib-list');
    this.preview = root.querySelector('.lib-preview canvas');
    this.previewName = root.querySelector('.lib-preview-name');
    root.querySelector('.lib-search').addEventListener('input', (e) => {
      this.query = e.target.value.trim();
      this.render();
    });

    const foot = root.querySelector('.lib-foot');
    const mk = (icon, title, fn) => {
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.innerHTML = icons[icon];
      b.title = title;
      b.addEventListener('click', fn);
      foot.appendChild(b);
    };
    mk('newSymbol', 'Novo símbolo (Ctrl+F8)', () => actions.run('newSymbol'));
    mk('newFolder', 'Nova pasta', () => this.newFolder());
    mk('speaker', 'Importar som…', () => actions.importSound());
    mk('gear', 'Propriedades do símbolo', () => this.selected?.kind === 'items' && this.properties(this.selected.id));
    mk('trash', 'Apagar', () => this.selected && this.remove(this.selected.kind, this.selected.id));

    // soltar na área vazia: volta para a raiz
    this.list.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes(LIB_MIME)) e.preventDefault();
    });
    this.list.addEventListener('drop', (e) => {
      const data = e.dataTransfer.getData(LIB_MIME);
      if (!data) return;
      e.preventDefault();
      const [kind, id] = data.split(':');
      editor.moveToFolder(kind, id, null);
    });
    this.list.addEventListener('contextmenu', (e) => {
      if (e.target === this.list) {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Novo símbolo…', hint: 'Ctrl+F8', run: () => actions.run('newSymbol') },
          { label: 'Nova pasta', run: () => this.newFolder() },
          { label: 'Importar som…', run: () => actions.importSound() },
        ]);
      }
    });

    for (const t of ['library', 'load', 'doc']) editor.on(t, () => this.schedule());
    this.render();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render() {
    const lib = this.editor.doc.library;
    if (this.selected && !lib[this.selected.kind].some((x) => x.id === this.selected.id)) this.selected = null;
    const usage = this.editor.usage();
    for (const [id, n] of this.editor.soundUsage()) usage.set(id, n);
    const count = lib.items.length + lib.sounds.length;
    this.root.querySelector('.lib-count').textContent = `${count} ${count === 1 ? 'item' : 'itens'}`;
    this.list.innerHTML = '';

    if (!lib.items.length && !lib.folders.length && !lib.sounds.length) {
      this.list.innerHTML = `<div class="lib-empty">A biblioteca está vazia.<br>Selecione algo no palco e aperte <span class="kbd">F8</span> para criar um símbolo.</div>`;
    } else if (this.query) {
      const q = norm(this.query);
      const hits = lib.items.filter((s) => norm(s.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      const sounds = lib.sounds.filter((s) => norm(s.name).includes(q));
      if (!hits.length && !sounds.length) this.list.innerHTML = `<div class="lib-empty">Nada encontrado.</div>`;
      for (const s of hits) this.list.appendChild(this.itemRow(s, 0, usage));
      for (const s of sounds) this.list.appendChild(this.soundRow(s, 0, usage));
    } else {
      this.renderFolder(null, 0, usage);
    }
    this.drawPreview();
  }

  renderFolder(parentId, depth, usage) {
    const lib = this.editor.doc.library;
    const folders = lib.folders.filter((f) => (f.parentId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name));
    for (const f of folders) {
      this.list.appendChild(this.folderRow(f, depth));
      if (this.expanded.has(f.id)) this.renderFolder(f.id, depth + 1, usage);
    }
    const items = lib.items.filter((s) => (s.folderId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name));
    for (const s of items) this.list.appendChild(this.itemRow(s, depth, usage));
    const sounds = lib.sounds.filter((s) => (s.folderId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name));
    for (const s of sounds) this.list.appendChild(this.soundRow(s, depth, usage));
  }

  baseRow(kind, entry, depth) {
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.setAttribute('role', 'treeitem');
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.draggable = true;
    if (this.selected?.kind === kind && this.selected.id === entry.id) row.classList.add('selected');
    row.addEventListener('pointerdown', () => {
      this.selected = { kind, id: entry.id };
      this.list.querySelectorAll('.lib-row.selected').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      this.drawPreview();
    });
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(LIB_MIME, `${kind}:${entry.id}`);
      if (kind === 'items') e.dataTransfer.setData(SYMBOL_MIME, entry.id);
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    return row;
  }

  folderRow(f, depth) {
    const row = this.baseRow('folders', f, depth);
    const open = this.expanded.has(f.id);
    row.innerHTML = `<span class="caret">${open ? '▼' : '▶'}</span><span class="lib-icon folder">${icons.folder}</span><span class="lib-name">${esc(f.name)}</span><span class="lib-uses"></span>`;
    const toggle = () => {
      if (open) this.expanded.delete(f.id);
      else this.expanded.add(f.id);
      this.render();
    };
    row.querySelector('.caret').addEventListener('click', toggle);
    row.querySelector('.lib-icon').addEventListener('dblclick', toggle);
    row.querySelector('.lib-name').addEventListener('dblclick', () => this.rename(row, 'folders', f));
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes(LIB_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      const data = e.dataTransfer.getData(LIB_MIME);
      row.classList.remove('drop-target');
      if (!data) return;
      e.preventDefault();
      e.stopPropagation();
      const [kind, id] = data.split(':');
      this.expanded.add(f.id);
      this.editor.moveToFolder(kind, id, f.id);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Renomear', run: () => this.rename(row, 'folders', f) },
        { label: 'Nova pasta dentro', run: () => this.newFolder(f.id) },
        '-',
        { label: 'Apagar pasta', run: () => this.remove('folders', f.id) },
      ]);
    });
    return row;
  }

  itemRow(s, depth, usage) {
    const row = this.baseRow('items', s, depth);
    const mc = s.type === 'movieclip';
    row.title = `${s.name} · ${SYMBOL_TYPES[s.type]} · duplo clique no ícone para editar`;
    row.innerHTML = `<span class="caret"></span><span class="lib-icon ${mc ? 'mc' : 'gr'}">${mc ? icons.movieclip : icons.graphic}</span><span class="lib-name">${esc(s.name)}</span><span class="lib-uses">${usage.get(s.id) || 0}</span>`;
    row.querySelector('.lib-icon').addEventListener('dblclick', () => this.editor.enterSymbol(s.id));
    row.querySelector('.lib-name').addEventListener('dblclick', () => this.rename(row, 'items', s));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.selected = { kind: 'items', id: s.id };
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Editar símbolo', run: () => this.editor.enterSymbol(s.id) },
        { label: 'Renomear', run: () => this.rename(row, 'items', s) },
        { label: 'Propriedades…', run: () => this.properties(s.id) },
        { label: 'Duplicar', run: () => this.editor.duplicateSymbol(s.id) },
        '-',
        { label: 'Apagar', run: () => this.remove('items', s.id) },
      ]);
    });
    return row;
  }

  soundRow(snd, depth, usage) {
    const row = this.baseRow('sounds', snd, depth);
    row.title = `${snd.name} · ${snd.duration.toFixed(1)} s · duplo clique para ouvir`;
    row.innerHTML = `<span class="caret"></span><span class="lib-icon snd">${icons.speaker}</span><span class="lib-name">${esc(snd.name)}</span><span class="lib-uses">${usage.get(snd.id) || 0}</span>`;
    const play = () => preview.play(this.editor.doc, [{ soundId: snd.id, at: 0, offset: 0, until: snd.duration, volume: 1, pan: 0, fadeIn: 0, fadeOut: 0 }]);
    row.querySelector('.lib-icon').addEventListener('dblclick', play);
    row.querySelector('.lib-name').addEventListener('dblclick', () => this.rename(row, 'sounds', snd));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.selected = { kind: 'sounds', id: snd.id };
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Ouvir', run: play },
        { label: 'Parar', run: () => preview.stop() },
        { label: 'Renomear', run: () => this.rename(row, 'sounds', snd) },
        '-',
        { label: 'Apagar', run: () => this.remove('sounds', snd.id) },
      ]);
    });
    return row;
  }

  rename(row, kind, entry) {
    const nameEl = row.querySelector('.lib-name');
    const input = document.createElement('input');
    input.value = entry.name;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
    row.draggable = false;
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== entry.name) this.editor.patchLibrary(kind, entry.id, { name: v }, 'Renomear');
      else this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  newFolder(parentId = null) {
    const f = this.editor.addFolder(null, parentId);
    if (parentId) this.expanded.add(parentId);
    this.selected = { kind: 'folders', id: f.id };
    this.render();
    const row = this.list.querySelector('.lib-row.selected');
    if (row) this.rename(row, 'folders', f);
  }

  properties(id) {
    this.actions.symbolProperties(id);
  }

  async remove(kind, id) {
    const ed = this.editor;
    if (kind === 'sounds') {
      const snd = ed.doc.library.sounds.find((x) => x.id === id);
      const n = ed.soundUsage().get(id) || 0;
      if (n > 0 && !(await confirmDialog('Apagar som', `"${snd.name}" está em ${n} quadro(s). O som sai deles também. Dá para desfazer com Ctrl+Z.`, 'Apagar'))) return;
    }
    if (kind === 'items') {
      const s = ed.symbol(id);
      const n = ed.usage().get(id) || 0;
      if (n > 0) {
        const ok = await confirmDialog(
          'Apagar símbolo',
          `"${s.name}" tem ${n} ${n === 1 ? 'instância' : 'instâncias'} em uso. Elas também serão removidas. Dá para desfazer com Ctrl+Z.`,
          'Apagar',
        );
        if (!ok) return;
      }
    }
    ed.deleteLibraryEntry(kind, id);
  }

  drawPreview() {
    const c = this.preview;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.selected?.kind === 'sounds') return this.drawWave(ctx, c, dpr, w, h);
    const sel = this.selected?.kind === 'items' ? this.editor.symbol(this.selected.id) : null;
    this.previewName.textContent = sel ? `${sel.name} · ${SYMBOL_TYPES[sel.type]}` : '';
    if (!sel) return;
    const doc = this.editor.doc;
    const b = timelineBounds(doc, sel, 0);
    if (!b || (!b.w && !b.h)) return;
    const pad = 12;
    const s = Math.min((w - pad * 2) / Math.max(b.w, 1), (h - pad * 2) / Math.max(b.h, 1), 4);
    const ox = (w - b.w * s) / 2 - b.x * s, oy = (h - b.h * s) / 2 - b.y * s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    renderTimeline(ctx, doc, sel, 0, {});
  }
}

LibraryUI.prototype.drawWave = function (ctx, c, dpr, w, h) {
  const snd = this.editor.doc.library.sounds.find((x) => x.id === this.selected.id);
  this.previewName.textContent = snd ? `${snd.name} · ${snd.duration.toFixed(1)} s` : '';
  if (!snd) return;
  const key = snd.id + ':' + snd.data.length;
  this.waves ||= new Map();
  const pk = this.waves.get(key);
  if (!pk) {
    this.waves.set(key, 'loading');
    this.waveCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    decodeSound(this.waveCtx, snd)
      .then((buf) => {
        this.waves.set(key, computePeaks(buf, Math.max(20, (w * 2) / Math.max(0.1, buf.duration))));
        this.drawPreview();
      })
      .catch(() => {});
    return;
  }
  if (pk === 'loading') return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#7cc4ff';
  const n = pk.peaks.length;
  for (let x = 0; x < w; x++) {
    const v = pk.peaks[Math.floor((x / w) * n)] || 0;
    const a = v * (h / 2 - 8);
    ctx.fillRect(x, h / 2 - a, 1, Math.max(1, a * 2));
  }
};
