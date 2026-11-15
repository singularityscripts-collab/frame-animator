// Painéis da fase final: Ações (código por quadro + trechos prontos), Alinhar, Explorador de cenas,
// Componentes e Scripts do editor.

import { esc } from './ui-kit.js';
import { icons } from './icons.js';
import { runEditorScript, SAMPLE_SCRIPTS } from './scripting.js';

// ---------- trechos de código prontos ----------
export const SNIPPETS = [
  { name: 'Parar neste quadro', code: 'this.stop();' },
  { name: 'Tocar', code: 'this.play();' },
  { name: 'Ir para o quadro e parar', code: 'this.gotoAndStop(1);' },
  { name: 'Ir para o rótulo e tocar', code: "this.gotoAndPlay('inicio');" },
  { name: 'Clique: ir para o quadro', code: "this.getChild('botao').on('click', () => {\n  this.gotoAndStop(10);\n});" },
  { name: 'Clique: abrir site', code: "this.getChild('botao').on('click', () => {\n  navigateToURL('https://example.com');\n});" },
  { name: 'Clique: esconder o objeto', code: "this.getChild('objeto').on('click', function () {\n  this.visible = false;\n});" },
  { name: 'Clique: contar cliques no texto', code: "let n = 0;\nthis.getChild('botao').on('click', () => {\n  n++;\n  this.getChild('placar').text = 'Cliques: ' + n;\n});" },
  { name: 'Teclas: mover com as setas', code: "const alvo = this.getChild('personagem');\nstage.on('keydown', (e) => {\n  if (e.key === 'ArrowLeft') alvo.x -= 10;\n  if (e.key === 'ArrowRight') alvo.x += 10;\n  if (e.key === 'ArrowUp') alvo.y -= 10;\n  if (e.key === 'ArrowDown') alvo.y += 10;\n});" },
  { name: 'Lista: mostrar o item escolhido', code: "const lista = this.getChild('lista');\nlista.on('change', () => {\n  this.getChild('saida').text = lista.selectedItem;\n});" },
  { name: 'Tocar um som da biblioteca', code: "playSound('Som 1');" },
  { name: 'Parar todos os sons', code: 'stopAllSounds();' },
  { name: 'Mostrar mensagem no teste', code: "trace('Chegou no quadro', this.currentFrame);" },
  { name: 'Movie clip: parar o filho', code: "this.getChild('animacao').stop();" },
];

const API_HELP = `<b>this</b> = a timeline onde o script está.<br>
<code>this.stop()</code> <code>this.play()</code> <code>this.gotoAndPlay(quadro|'rótulo')</code> <code>this.gotoAndStop(…)</code>
<code>this.nextFrame()</code> <code>this.currentFrame</code> <code>this.totalFrames</code><br>
<code>this.getChild('nome')</code> → <code>x y rotation scaleX scaleY alpha visible text</code>, <code>on('click'|'mouseover'|'mouseout'|'mousedown'|'mouseup'|'change', fn)</code><br>
<code>root</code> <code>stage.on('keydown'|'keyup'|'mousemove', fn)</code> <code>trace(…)</code> <code>navigateToURL(url)</code> <code>playSound('nome')</code> <code>stopAllSounds()</code>`;

export class ActionsPanel {
  constructor(editor, actions, el) {
    this.editor = editor;
    this.actions = actions;
    this.el = el;
    el.classList.add('actions-panel');
    el.innerHTML = `
      <div class="ap-head"><span class="ap-where"></span></div>
      <div class="ap-tools">
        <select class="ap-snippet" title="Inserir trecho pronto"><option value="">Trechos prontos…</option>${SNIPPETS.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select>
        <button class="btn-flat ap-apply" title="Grava o código no keyframe (também grava ao sair do campo)">Aplicar</button>
        <button class="btn-flat ap-test" title="Testar filme (Ctrl+Enter)">Testar</button>
        <button class="btn-flat ap-help-btn" title="Ajuda da API">?</button>
      </div>
      <p class="hint ap-help" hidden>${API_HELP}</p>
      <textarea class="ap-code" spellcheck="false" placeholder="// JavaScript deste quadro. Ex.: this.stop();"></textarea>
      <div class="ap-list-title">Scripts desta timeline</div>
      <div class="ap-list"></div>`;
    this.code = el.querySelector('.ap-code');
    this.where = el.querySelector('.ap-where');
    this.list = el.querySelector('.ap-list');
    this.dirty = false;
    this.code.addEventListener('input', () => (this.dirty = true));
    this.code.addEventListener('blur', () => this.commit());
    this.code.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        e.preventDefault();
        this.insert('  ');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.commit();
      }
    });
    el.querySelector('.ap-apply').addEventListener('click', () => this.commit());
    el.querySelector('.ap-test').addEventListener('click', () => {
      this.commit();
      actions.run('testScene');
    });
    el.querySelector('.ap-help-btn').addEventListener('click', () => {
      const h = el.querySelector('.ap-help');
      h.hidden = !h.hidden;
    });
    const sel = el.querySelector('.ap-snippet');
    sel.addEventListener('change', () => {
      const s = SNIPPETS[Number(sel.value)];
      sel.value = '';
      if (!s) return;
      this.insert((this.code.value && !this.code.value.endsWith('\n') ? '\n' : '') + s.code + '\n');
      this.commit();
    });
    for (const t of ['frame', 'layers', 'doc', 'load', 'context']) editor.on(t, () => this.refresh());
    this.refresh();
  }

  insert(text) {
    const c = this.code;
    const a = c.selectionStart ?? c.value.length, b = c.selectionEnd ?? c.value.length;
    c.value = c.value.slice(0, a) + text + c.value.slice(b);
    c.selectionStart = c.selectionEnd = a + text.length;
    this.dirty = true;
  }

  commit() {
    if (!this.dirty) return;
    this.dirty = false;
    this.editor.setSpanScript(this.code.value);
  }

  refresh() {
    if (!this.el.isConnected || this.el.hidden) return;
    const ed = this.editor;
    const layer = ed.activeLayer;
    const span = ed.currentSpan();
    const key = `${ed.timeline.id}:${layer.id}:${span?.start}`;
    if (key !== this.key) {
      this.commitTo?.();
      this.key = key;
      this.dirty = false;
    }
    if (document.activeElement !== this.code || !this.dirty) this.code.value = span?.script || '';
    const onKey = span && span.start === ed.frame;
    this.where.innerHTML = `${esc(layer.name)} · quadro ${ed.frame + 1}${span && !onKey ? ` <span class="hint">(o script vai para um keyframe novo aqui)</span>` : ''}`;
    this.code.disabled = !span || layer.type === 'folder';
    // lista de todos os scripts desta timeline
    const rows = [];
    for (const L of ed.timeline.layers) for (const s of L.frames) if (s.script?.trim()) rows.push({ L, s });
    this.list.innerHTML = rows.length
      ? rows.map((r, i) => `<button class="ap-row" data-i="${i}"><b>${esc(r.L.name)}</b> · ${r.s.start + 1}<span>${esc(r.s.script.trim().split('\n')[0].slice(0, 40))}</span></button>`).join('')
      : '<div class="hint">Nenhum script nesta timeline.</div>';
    this.list.querySelectorAll('.ap-row').forEach((b) =>
      b.addEventListener('click', () => {
        const r = rows[Number(b.dataset.i)];
        ed.setActiveLayer(r.L.id);
        ed.setFrame(r.s.start);
      }),
    );
  }
}

// ---------- Alinhar ----------
export class AlignPanel {
  constructor(editor, el) {
    this.editor = editor;
    el.classList.add('align-panel');
    const b = (k, label, title) => `<button class="btn-flat" data-k="${k}" title="${title}">${label}</button>`;
    el.innerHTML = `
      <section class="prop-section"><h3>Alinhar</h3><div class="align-grid">
        ${b('left', '⇤ Esq.', 'Alinhar à esquerda (Ctrl+Alt+1)')}${b('hcenter', '↔ Centro', 'Centro horizontal (Ctrl+Alt+2)')}${b('right', 'Dir. ⇥', 'Alinhar à direita (Ctrl+Alt+3)')}
        ${b('top', '⤒ Topo', 'Alinhar ao topo (Ctrl+Alt+4)')}${b('vcenter', '↕ Meio', 'Centro vertical (Ctrl+Alt+5)')}${b('bottom', 'Base ⤓', 'Alinhar à base (Ctrl+Alt+6)')}
      </div></section>
      <section class="prop-section"><h3>Distribuir e espaçar</h3><div class="align-grid">
        ${b('distH', 'Centros ↔', 'Distribuir os centros na horizontal')}${b('distV', 'Centros ↕', 'Distribuir os centros na vertical')}<span></span>
        ${b('spaceH', 'Espaço ↔', 'Espaço igual na horizontal')}${b('spaceV', 'Espaço ↕', 'Espaço igual na vertical')}<span></span>
      </div></section>
      <section class="prop-section"><h3>Mesmo tamanho</h3><div class="align-grid">
        ${b('matchW', 'Largura', 'Mesma largura')}${b('matchH', 'Altura', 'Mesma altura')}${b('matchWH', 'As duas', 'Mesma largura e altura')}
      </div></section>
      <label class="field wide" style="padding:8px 12px"><input type="checkbox" data-stage><span>Relativo ao palco</span></label>`;
    const stageBox = el.querySelector('[data-stage]');
    stageBox.checked = !!editor.alignToStage;
    stageBox.addEventListener('change', () => (editor.alignToStage = stageBox.checked));
    el.querySelectorAll('[data-k]').forEach((btn) => btn.addEventListener('click', () => editor.alignSelection(btn.dataset.k, !!editor.alignToStage)));
  }
}

// ---------- Explorador de cenas ----------
export class ScenesPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    el.classList.add('scenes-panel');
    el.innerHTML = `<div class="sp-tools"><input type="search" class="lib-search" placeholder="Filtrar (nome, texto, símbolo)"></div><div class="sp-tree" role="tree"></div>`;
    this.tree = el.querySelector('.sp-tree');
    this.filter = '';
    this.open = new Set();
    el.querySelector('input').addEventListener('input', (e) => {
      this.filter = e.target.value.trim().toLowerCase();
      this.render();
    });
    for (const t of ['doc', 'load', 'layers', 'library', 'context']) editor.on(t, () => this.schedule());
  }

  schedule() {
    if (this.raf || !this.el.isConnected || this.el.hidden) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render() {
    const ed = this.editor;
    const doc = ed.doc;
    const q = this.filter;
    const html = [];
    const row = (depth, icon, text, data, extra = '') =>
      `<div class="sp-row" style="padding-left:${6 + depth * 14}px" ${Object.entries(data)
        .map(([k, v]) => `data-${k}="${esc(String(v))}"`)
        .join(' ')}><span class="sp-icon">${icon}</span><span class="sp-text">${esc(text)}</span>${extra}</div>`;
    const descr = (el) => {
      if (el.type === 'instance') return `${ed.symbol(el.symbolId)?.name || '?'}${el.name ? ` (${el.name})` : ''}`;
      if (el.type === 'text') return `“${String(el.text).slice(0, 30)}”${el.name ? ` (${el.name})` : ''}`;
      if (el.type === 'bitmap') return doc.library.bitmaps.find((b) => b.id === el.assetId)?.name || 'Imagem';
      if (el.type === 'component') return `${{ button: 'Botão', list: 'Lista', video: 'Vídeo' }[el.kind]}${el.name ? ` (${el.name})` : ''}`;
      return 'Forma';
    };
    const iconOf = (el) => (el.type === 'instance' ? icons[ed.symbol(el.symbolId)?.type === 'movieclip' ? 'movieclip' : 'graphic'] : el.type === 'text' ? icons.text : el.type === 'bitmap' ? icons.image : el.type === 'component' ? icons.component : icons.rect);
    const timeline = (tl, depth) => {
      for (const L of tl.layers) {
        const items = [];
        for (const s of L.frames) {
          for (const el of s.elements) {
            const d = descr(el);
            if (q && !d.toLowerCase().includes(q) && !L.name.toLowerCase().includes(q)) continue;
            items.push(row(depth + 1, iconOf(el), d, { tl: tl.id, layer: L.id, frame: s.start, el: el.id }, `<span class="sp-frame">${s.start + 1}</span>`));
          }
          if (s.script?.trim() && (!q || 'script'.includes(q))) items.push(row(depth + 1, icons.script, `Script: ${s.script.trim().split('\n')[0].slice(0, 30)}`, { tl: tl.id, layer: L.id, frame: s.start }, `<span class="sp-frame">${s.start + 1}</span>`));
        }
        if (q && !items.length && !L.name.toLowerCase().includes(q)) continue;
        html.push(row(depth, icons.layer, L.name, { tl: tl.id, layer: L.id, frame: 0 }));
        html.push(...items.slice(0, 200));
      }
    };
    html.push('<div class="sp-group">Cenas</div>');
    doc.scenes.forEach((s) => {
      html.push(row(0, icons.scene, s.name, { tl: s.id, frame: 0 }, `<span class="sp-frame">${s.id === ed.scene.id ? '●' : ''}</span>`));
      timeline(s, 1);
    });
    if (doc.library.items.length) {
      html.push('<div class="sp-group">Símbolos</div>');
      for (const s of doc.library.items) {
        html.push(row(0, icons[s.type === 'movieclip' ? 'movieclip' : 'graphic'], s.name, { tl: s.id, frame: 0 }));
        timeline(s, 1);
      }
    }
    this.tree.innerHTML = html.join('');
    this.tree.querySelectorAll('.sp-row').forEach((r) =>
      r.addEventListener('click', () => ed.reveal({ tlId: r.dataset.tl, layerId: r.dataset.layer, frame: Number(r.dataset.frame) || 0, elId: r.dataset.el })),
    );
  }
}

// ---------- Componentes ----------
export class ComponentsPanel {
  constructor(editor, el) {
    el.classList.add('components-panel');
    const card = (kind, title, text) => `<div class="comp-card"><div class="comp-icon">${icons.component}</div><div><b>${title}</b><p class="hint">${text}</p></div><button class="btn-flat" data-kind="${kind}">Inserir</button></div>`;
    el.innerHTML = `
      ${card('button', 'Botão', 'Botão com rótulo e estados (normal, sobre, pressionado). Evento: click.')}
      ${card('list', 'Lista', 'Lista de itens; o usuário escolhe um. Eventos: change. Propriedades: selectedIndex, selectedItem.')}
      ${card('video', 'Vídeo', 'Toca um arquivo de vídeo (MP4/WebM) no teste e no HTML5.')}
      <p class="hint" style="padding:0 12px">Dê um nome de instância nas propriedades e use nos scripts: <code>this.getChild('nome')</code>.</p>`;
    el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => editor.addComponent(b.dataset.kind)));
  }
}

// ---------- Scripts do editor (automação) ----------
const SCRIPTS_KEY = 'fa-editor-scripts';
export class ScriptsPanel {
  constructor(editor, actions, el) {
    this.editor = editor;
    this.actions = actions;
    el.classList.add('scripts-panel');
    el.innerHTML = `
      <div class="ap-tools">
        <select class="sc-list" title="Scripts salvos"></select>
        <button class="btn-flat sc-run" title="Rodar (Ctrl+Enter)">▶ Rodar</button>
        <button class="btn-flat sc-save" title="Salvar com nome">Salvar…</button>
        <button class="btn-flat sc-del" title="Apagar o script salvo">Apagar</button>
        <button class="btn-flat sc-help-btn" title="Ajuda da API">?</button>
      </div>
      <p class="hint sc-help" hidden>O script recebe <code>fa</code>: <code>fa.rect(x,y,l,a,{fill})</code> <code>fa.oval</code> <code>fa.line</code> <code>fa.polygon</code> <code>fa.text</code>
      <code>fa.selection()</code> <code>fa.select(ids)</code> <code>fa.move(dx,dy)</code> <code>fa.rotate(g)</code> <code>fa.scale(sx,sy)</code> <code>fa.align(tipo,palco)</code>
      <code>fa.gotoFrame(n)</code> <code>fa.keyframe()</code> <code>fa.tween()</code> <code>fa.newLayer(nome)</code> <code>fa.toSymbol(nome,tipo)</code> <code>fa.place(símbolo,x,y)</code>
      <code>fa.run('ação')</code> <code>fa.log(…)</code>. Tudo vira um passo só no Desfazer.</p>
      <textarea class="ap-code sc-code" spellcheck="false"></textarea>
      <pre class="sc-out"></pre>`;
    this.code = el.querySelector('.sc-code');
    this.out = el.querySelector('.sc-out');
    this.sel = el.querySelector('.sc-list');
    this.load();
    this.renderList();
    this.code.value = Object.values(this.saved)[0] || '';
    this.sel.addEventListener('change', () => (this.code.value = this.saved[this.sel.value] ?? this.code.value));
    this.code.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.run();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const a = this.code.selectionStart;
        this.code.setRangeText('  ', a, this.code.selectionEnd, 'end');
      }
    });
    el.querySelector('.sc-run').addEventListener('click', () => this.run());
    el.querySelector('.sc-help-btn').addEventListener('click', () => {
      const h = el.querySelector('.sc-help');
      h.hidden = !h.hidden;
    });
    el.querySelector('.sc-save').addEventListener('click', () => {
      const name = prompt('Nome do script:', this.sel.value || 'Meu script');
      if (!name) return;
      this.saved[name] = this.code.value;
      this.store();
      this.renderList(name);
    });
    el.querySelector('.sc-del').addEventListener('click', () => {
      delete this.saved[this.sel.value];
      this.store();
      this.renderList();
    });
  }

  load() {
    try {
      this.saved = JSON.parse(localStorage.getItem(SCRIPTS_KEY) || 'null') || { ...SAMPLE_SCRIPTS };
    } catch {
      this.saved = { ...SAMPLE_SCRIPTS };
    }
  }
  store() {
    try {
      localStorage.setItem(SCRIPTS_KEY, JSON.stringify(this.saved));
    } catch {
      // sem armazenamento
    }
  }
  renderList(pick) {
    this.sel.innerHTML = Object.keys(this.saved)
      .map((n) => `<option ${n === pick ? 'selected' : ''}>${esc(n)}</option>`)
      .join('');
  }
  run() {
    this.out.textContent = '';
    const log = (s) => (this.out.textContent += `${s}\n`);
    const r = runEditorScript(this.editor, this.actions, this.code.value, log);
    if (r.ok && !this.out.textContent) log('OK');
  }
}
