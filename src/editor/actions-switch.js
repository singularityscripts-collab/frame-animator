// Etapa V6: ações e diálogos da troca de desenhos, dos clipes de animação e da biblioteca de personagens.

import { openDialog, esc, confirmDialog } from './ui-kit.js';
import { isSwitch, switchDrawings, drawingIndexOf, characterPackage, CHARACTER_FORMAT, VISEMES, visemeMapFor, visemeForName } from './editor-switch.js';
import { renderTimeline } from '../player/render.js';
import { timelineBounds } from '../model/geometry.js';

export const SWITCH_LABELS = {
  createSwitch: 'Criar camada de troca',
  switchNext: 'Próximo desenho (troca)',
  switchPrev: 'Desenho anterior (troca)',
  switchAddCopy: 'Novo desenho (cópia do atual)',
  switchAddEmpty: 'Novo desenho vazio',
  switchRename: 'Renomear desenho',
  saveClip: 'Salvar quadros como clipe',
  clipsDialog: 'Clipes de animação',
  characterLibrary: 'Personagens',
  importCharacter: 'Importar personagem',
  saveCharacter: 'Salvar como personagem',
  exportCharacter: 'Exportar personagem',
};

/** Desenha o quadro `frame` do símbolo centralizado no canvas. */
export function drawSymbolThumb(canvas, doc, sym, frame = 0) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const b = timelineBounds(doc, sym, frame);
  if (!b || !(b.w > 0 || b.h > 0)) return;
  const s = Math.min((W - 8) / Math.max(1, b.w), (H - 8) / Math.max(1, b.h));
  ctx.setTransform(s, 0, 0, s, W / 2 - (b.x + b.w / 2) * s, H / 2 - (b.y + b.h / 2) * s);
  try {
    renderTimeline(ctx, doc, sym, frame, {});
  } catch {
    // símbolo quebrado: fica sem miniatura
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Seção "Troca de desenhos" do painel de propriedades (instância de troca selecionada). */
export function switchSection(ui, it) {
  const ed = ui.editor;
  const sym = ed.symbol(it.el.symbolId);
  if (!isSwitch(sym)) return;
  const ds = switchDrawings(sym);
  const cur = drawingIndexOf(sym, it.el.firstFrame || 0);
  const vm = visemeMapFor(sym);
  // o fonema só aparece quando o nome do desenho não diz qual é
  const vOf = (f, name) => {
    const v = Object.entries(vm).find(([, x]) => x === f)?.[0];
    return v && visemeForName(name) !== v ? v : null;
  };
  ui.section(
    'Troca de desenhos',
    `<div class="sw-grid">${ds
      .map(
        (d, i) => `<button type="button" class="sw-cell ${i === cur ? 'current' : ''}" data-swd="${i}" title="Mostrar “${esc(d.name)}” a partir deste quadro (duplo clique: editar o desenho)">
          <canvas width="84" height="64"></canvas><span>${esc(d.name)}${vOf(d.frame, d.name) ? ` <em>${esc(vOf(d.frame, d.name))}</em>` : ''}</span></button>`,
      )
      .join('')}</div>
    <div class="prop-grid">
      <button class="btn-flat" data-a="switchAddCopy" title="Duplica o desenho atual e mostra a cópia">+ Cópia</button>
      <button class="btn-flat" data-a="switchAddEmpty" title="Desenho novo vazio (entre no símbolo para desenhar)">+ Vazio</button>
      <button class="btn-flat" data-a="switchRename">Renomear</button>
      <button class="btn-flat" data-sw-del title="Apaga o desenho mostrado agora">Apagar</button>
      <button class="btn-flat" data-a="lipSync" style="grid-column:span 2">Lip sync automático…</button>
    </div>
    <p class="hint">Clique num desenho para trocar a partir deste quadro (cria a chave). Alt+[ e Alt+] trocam pelo teclado. Dê nomes de fonema (A, E, O, U, MBP, FV, L, S, repouso) para o lip sync escolher sozinho.</p>`,
  );
  // a troca é o que mais se usa nesta instância: a seção sobe para logo depois da primeira
  const secs = [...ui.el.querySelectorAll('.prop-section')];
  const mine = secs.find((s) => s.querySelector('.sw-grid'));
  if (mine && secs[0] && secs[0] !== mine) secs[0].after(mine);
  ui.el.querySelectorAll('[data-swd]').forEach((b) => {
    const i = Number(b.dataset.swd);
    drawSymbolThumb(b.querySelector('canvas'), ed.doc, sym, ds[i].frame);
    b.addEventListener('click', () => ed.switchTo(i));
    b.addEventListener('dblclick', () => {
      ed.switchTo(i);
      const now = ed.switchItem();
      if (now) ed.enterSymbol(now.el.symbolId, now);
    });
  });
  ui.el.querySelector('[data-sw-del]')?.addEventListener('click', async () => {
    const d = ds[cur];
    if (await confirmDialog('Apagar desenho', `Apaga “${d.name}” da troca. As chaves que mostravam ele passam a mostrar o desenho anterior. Dá para desfazer.`, 'Apagar')) ed.deleteSwitchDrawing(sym.id, cur);
  });
}

/** Assinatura para o painel saber quando refazer a seção. */
export function switchSig(ed, el) {
  if (el?.type !== 'instance') return '';
  const sym = ed.symbol(el.symbolId);
  if (!isSwitch(sym)) return '';
  return `sw:${switchDrawings(sym).map((d) => d.name).join('|')}:${drawingIndexOf(sym, el.firstFrame || 0)}:${JSON.stringify(sym.visemeMap || {})}`;
}

// ---------- armazenamento dos personagens (no app: pasta do usuário; no navegador: localStorage) ----------
const LS_KEY = 'fa-characters';
const lsAll = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
};
const lsPut = (all) => localStorage.setItem(LS_KEY, JSON.stringify(all));
const safeFile = (name) => `${String(name || 'Personagem').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Personagem'}.fachar`;

export const characterStore = {
  native: () => !!window.api?.characters,
  async list() {
    if (this.native()) return window.api.characters.list();
    return Object.entries(lsAll()).map(([file, text]) => {
      let j = {};
      try {
        j = JSON.parse(text);
      } catch {
        // estragado
      }
      return { file, name: j.name || file, thumb: j.thumb || null, symbols: j.items?.length || 0, clips: (j.items || []).reduce((n, s) => n + (s.clips?.length || 0), 0), size: text.length };
    });
  },
  async save(name, data) {
    if (this.native()) return window.api.characters.save({ name, data });
    const all = lsAll();
    all[safeFile(name)] = data;
    lsPut(all);
    return { file: safeFile(name) };
  },
  async load(file) {
    if (this.native()) return window.api.characters.load(file);
    return lsAll()[file] ?? null;
  },
  async remove(file) {
    if (this.native()) return window.api.characters.remove(file);
    const all = lsAll();
    delete all[file];
    lsPut(all);
    return true;
  },
};

/** Pacote do personagem com miniatura, pronto para gravar. */
function packCharacter(ed, symId) {
  const pkg = characterPackage(ed.doc, symId);
  if (!pkg) return null;
  try {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 120;
    drawSymbolThumb(c, ed.doc, ed.symbol(symId), 0);
    pkg.thumb = c.toDataURL('image/png');
  } catch {
    // sem miniatura
  }
  return pkg;
}

export function extendSwitchActions(actions, { editor: ed, labels }) {
  Object.assign(labels, SWITCH_LABELS);
  const { defs } = actions;
  const add = (id, keys, run) => (defs[id] = { keys, run });

  // símbolo "do personagem": o da instância selecionada no palco, ou o símbolo aberto
  const currentSymbolId = () => ed.selectedItems().find((it) => it.el.type === 'instance')?.el.symbolId || ed.editStack[ed.editStack.length - 1]?.symbolId || null;

  // ---------- troca ----------
  add('createSwitch', ['Ctrl+Alt+W'], async () => {
    if (!ed.selection.size) return ed.toast('Selecione os desenhos (bocas, mãos, olhos…). Cada objeto selecionado vira um desenho da troca.');
    const r = await openDialog({
      title: 'Criar camada de troca',
      body: `<p class="dlg-text">Cada objeto selecionado (${ed.selection.size}) vira um desenho. A camada nova mostra um desenho por vez, e cada chave da timeline escolhe qual. Ela pode ser presa a um osso como qualquer símbolo.</p>
        <label class="dlg-row"><span>Nome</span><input type="text" name="name" value="Boca" maxlength="40"></label>`,
      ok: 'Criar',
    });
    if (r) ed.createSwitchLayer(r.name);
  });
  add('switchNext', ['Alt+]'], () => ed.switchStep(1));
  add('switchPrev', ['Alt+['], () => ed.switchStep(-1));
  add('switchAddCopy', [], () => ed.addSwitchDrawing({ copy: true }));
  add('switchAddEmpty', [], async () => {
    const i = ed.addSwitchDrawing({ copy: false });
    if (typeof i === 'number') ed.toast('Desenho vazio criado. Dê duplo clique na troca para desenhar nele.');
  });
  add('switchRename', [], async () => {
    const it = ed.switchItem();
    if (!it) return ed.toast('Selecione uma camada de troca (ou a instância dela).');
    const sym = ed.symbol(it.el.symbolId);
    const i = drawingIndexOf(sym, it.el.firstFrame || 0);
    const d = switchDrawings(sym)[i];
    const r = await openDialog({
      title: 'Renomear desenho',
      body: `<label class="dlg-row"><span>Nome</span><input type="text" name="name" value="${esc(d.name)}" maxlength="40"></label>
        <p class="dlg-text">Fonemas que o lip sync reconhece pelo nome: ${Object.keys(VISEMES).map((k) => (k === 'rest' ? 'repouso' : k)).join(', ')}.</p>`,
      ok: 'Renomear',
    });
    if (r) ed.renameSwitchDrawing(sym.id, i, r.name);
  });

  // ---------- clipes ----------
  add('saveClip', [], async () => {
    const sel = ed.frameSel;
    const what = sel ? `os quadros ${sel.from + 1} a ${sel.to + 1} de ${sel.layerIds.length} camada${sel.layerIds.length === 1 ? '' : 's'}` : 'a timeline inteira (nenhum quadro selecionado)';
    const r = await openDialog({
      title: 'Salvar como clipe',
      body: `<p class="dlg-text">O clipe guarda ${what}. Depois ele entra em qualquer ponto da timeline, repetido ou misturado com o que já está lá (Inserir › Clipes de animação).</p>
        <label class="dlg-row"><span>Nome</span><input type="text" name="name" value="${esc(ed.clips().length ? `Clipe ${ed.clips().length + 1}` : 'Andar')}" maxlength="40"></label>`,
      ok: 'Salvar',
    });
    if (!r) return;
    const c = ed.saveClip(r.name);
    if (c) ed.toast(`Clipe “${c.name}” salvo (${c.length} quadros).`);
  });
  add('clipsDialog', ['Ctrl+Alt+K'], () => clipsDialog());

  async function clipsDialog() {
    const list = () => ed.clips();
    const rows = () =>
      list().length
        ? list()
            .map(
              (c) => `<div class="clip-row" data-id="${c.id}"><b>${esc(c.name)}</b><span class="clip-meta">${c.length} quadros · ${c.layers.length} camada${c.layers.length === 1 ? '' : 's'}</span>
              <button type="button" class="btn-flat" data-k="insert">Inserir</button><button type="button" class="btn-flat" data-k="rename">Renomear</button><button type="button" class="btn-flat" data-k="del">Apagar</button></div>`,
            )
            .join('')
        : '<p class="dlg-text">Nenhum clipe nesta timeline ainda. Selecione quadros na timeline e use “Salvar seleção como clipe”.</p>';
    await openDialog({
      title: 'Clipes de animação',
      body: `<div class="clip-opts">
          <label class="dlg-row"><span>Repetir</span><input type="number" name="rep" min="1" max="50" value="1"></label>
          <label class="dlg-row"><span>Modo</span><select name="mode"><option value="replace">Substituir o que está lá</option><option value="blend">Misturar (só os ossos que o clipe mexe)</option></select></label>
          <label class="dlg-row"><span>Peso (%)</span><input type="number" name="w" min="0" max="100" value="100"></label>
        </div>
        <p class="dlg-text">Inserir põe o clipe no quadro atual (${ed.frame + 1}), nas camadas de mesmo nome. Misturar mantém a animação da camada e troca só os ossos que o clipe mexe: um aceno por cima de um andar, por exemplo.</p>
        <div class="clip-list"></div>
        <button type="button" class="btn-flat" data-k="save">Salvar seleção como clipe…</button>`,
      ok: 'Fechar',
      cancel: null,
      onOpen: (dlg) => {
        const box = dlg.querySelector('.clip-list');
        const draw = () => {
          box.innerHTML = rows();
        };
        draw();
        dlg.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-k]');
          if (!b) return;
          const id = b.closest('[data-id]')?.dataset.id;
          const k = b.dataset.k;
          if (k === 'save') {
            dlg.requestSubmit();
            return actions.run('saveClip');
          }
          const clip = list().find((c) => c.id === id);
          if (!clip) return;
          if (k === 'insert') {
            const rep = Math.max(1, Math.min(50, Number(dlg.querySelector('[name="rep"]').value) || 1));
            const mode = dlg.querySelector('[name="mode"]').value;
            const w = Math.max(0, Math.min(100, Number(dlg.querySelector('[name="w"]').value) || 0)) / 100;
            const n = ed.insertClip(clip.id, { repeat: rep, mode, weight: w });
            if (n) ed.toast(`Clipe “${clip.name}” inserido em ${n} camada${n === 1 ? '' : 's'}.`);
          } else if (k === 'rename') {
            // renomeia ali mesmo (o Electron não tem prompt())
            const bEl = b.closest('[data-id]').querySelector('b');
            const inp = Object.assign(document.createElement('input'), { type: 'text', value: clip.name, maxLength: 40, className: 'clip-name-input' });
            bEl.replaceWith(inp);
            inp.focus();
            inp.select();
            const done = () => {
              if (inp.value.trim() && inp.value.trim() !== clip.name) ed.renameClip(clip.id, inp.value);
              draw();
            };
            inp.addEventListener('blur', done, { once: true });
            inp.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                inp.blur();
              }
            });
            return;
          } else if (k === 'del') {
            ed.deleteClip(clip.id);
          }
          draw();
        });
      },
    });
  }

  // ---------- personagens ----------
  async function saveCharacter(symId = currentSymbolId()) {
    const sym = symId && ed.symbol(symId);
    if (!sym) return ed.toast('Selecione no palco a instância do personagem (o símbolo com o rig, as trocas e os clipes).');
    const pkg = packCharacter(ed, sym.id);
    const existing = (await characterStore.list()).find((c) => c.name === sym.name);
    if (existing && !(await confirmDialog('Personagem já existe', `Já há um personagem “${sym.name}” na biblioteca. Substituir pelo de agora?`, 'Substituir'))) return;
    try {
      await characterStore.save(sym.name, JSON.stringify(pkg));
      ed.toast(`“${sym.name}” salvo na biblioteca de personagens (${pkg.items.length} símbolo${pkg.items.length === 1 ? '' : 's'}).`);
    } catch (err) {
      ed.toast(`Não deu para salvar o personagem: ${err.message}`);
    }
  }
  async function exportCharacter(symId = currentSymbolId()) {
    const sym = symId && ed.symbol(symId);
    if (!sym) return ed.toast('Selecione no palco a instância do personagem.');
    const data = JSON.stringify(packCharacter(ed, sym.id));
    if (window.api?.characters) {
      const r = await window.api.characters.exportFile({ name: sym.name, data });
      if (r) ed.toast(`Personagem exportado: ${r.path}`);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = `${sym.name}.fachar`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }
  const bring = (text) => {
    let pkg;
    try {
      pkg = JSON.parse(text);
    } catch {
      return ed.toast('Não deu para ler o personagem: o arquivo está danificado.');
    }
    if (pkg?.format !== CHARACTER_FORMAT) return ed.toast('Este arquivo não é um personagem do Frame Animator (.fachar).');
    const sym = ed.importCharacter(pkg);
    if (sym) ed.toast(`“${sym.name}” trazido para a biblioteca e colocado no palco.`);
  };
  async function importCharacterFile() {
    if (window.api?.characters) {
      try {
        const text = await window.api.characters.importFile();
        if (text) bring(text);
      } catch (err) {
        ed.toast(`Não deu para abrir o personagem: ${err.message}`);
      }
      return;
    }
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.fachar,application/json' });
    inp.addEventListener('change', async () => inp.files[0] && bring(await inp.files[0].text()));
    inp.click();
  }
  ed.saveCharacterToLibrary = saveCharacter;
  ed.exportCharacterFile = exportCharacter;

  add('saveCharacter', [], () => saveCharacter());
  add('exportCharacter', [], () => exportCharacter());
  add('importCharacter', [], () => importCharacterFile());
  add('characterLibrary', ['Ctrl+Shift+P'], async () => {
    const card = (c) => `<div class="char-card" data-file="${esc(c.file)}">
        <div class="char-thumb">${c.thumb ? `<img src="${esc(c.thumb)}" alt="">` : ''}</div>
        <b>${esc(c.name || c.file)}</b><span class="clip-meta">${c.broken ? 'arquivo danificado' : `${c.symbols} símbolo${c.symbols === 1 ? '' : 's'} · ${c.clips} clipe${c.clips === 1 ? '' : 's'}`}</span>
        <div class="char-btns"><button type="button" class="btn-flat" data-c="use" ${c.broken ? 'disabled' : ''}>Usar</button><button type="button" class="btn-flat" data-c="del">Apagar</button></div></div>`;
    await openDialog({
      title: 'Personagens',
      body: `<p class="dlg-text">Personagens prontos (rig, trocas de desenho e clipes) para usar em qualquer arquivo. “Usar” traz o personagem para a biblioteca deste arquivo e coloca no palco.</p>
        <div class="char-grid"><p class="dlg-text">Carregando…</p></div>
        <div class="prop-grid" style="margin-top:8px">
          <button type="button" class="btn-flat" data-c="save">Salvar o selecionado aqui</button>
          <button type="button" class="btn-flat" data-c="import">Importar arquivo .fachar…</button>
          <button type="button" class="btn-flat" data-c="export">Exportar o selecionado…</button>
          ${window.api?.characters ? '<button type="button" class="btn-flat" data-c="reveal">Abrir a pasta</button>' : ''}
        </div>`,
      ok: 'Fechar',
      cancel: null,
      onOpen: (dlg) => {
        const grid = dlg.querySelector('.char-grid');
        const load = async () => {
          const list = await characterStore.list();
          grid.innerHTML = list.length ? list.map(card).join('') : '<p class="dlg-text">Nenhum personagem salvo ainda. Selecione a instância do personagem no palco e clique em “Salvar o selecionado aqui”.</p>';
        };
        load();
        dlg.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-c]');
          if (!b) return;
          const file = b.closest('[data-file]')?.dataset.file;
          const k = b.dataset.c;
          if (k === 'save') await saveCharacter();
          else if (k === 'export') await exportCharacter();
          else if (k === 'import') await importCharacterFile();
          else if (k === 'reveal') window.api.characters.reveal();
          else if (k === 'use') {
            const text = await characterStore.load(file);
            if (text) bring(text);
          } else if (k === 'del') {
            if (await confirmDialog('Apagar personagem', `Tira “${file.replace(/\.fachar$/, '')}” da biblioteca de personagens${characterStore.native() ? ' (vai para a lixeira)' : ''}. Os arquivos que já usam ele não mudam.`, 'Apagar')) await characterStore.remove(file);
          }
          load();
        });
      },
    });
  });
}
