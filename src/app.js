// Ponto de entrada do editor: cria o estado e liga as partes da interface.

import { Editor } from './editor/editor.js';
import { Stage } from './editor/stage.js';
import { TimelineUI } from './editor/timeline-ui.js';
import { ToolbarUI } from './editor/toolbar-ui.js';
import { PropertiesUI } from './editor/properties-ui.js';
import { LibraryUI } from './editor/library-ui.js';
import { HistoryUI } from './editor/history-ui.js';
import { icons } from './editor/icons.js';
import { esc } from './editor/ui-kit.js';
import { createActions } from './editor/actions.js';
import { createIO } from './editor/io.js';

const editor = new Editor();
const io = createIO(editor);
const stage = new Stage(document.getElementById('stage'), editor);
// ---------- abas do painel direito ----------
const tabs = document.querySelectorAll('#props .tab');
function showTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('props-page').hidden = name !== 'props';
  document.getElementById('library-page').hidden = name !== 'library';
  document.getElementById('history-page').hidden = name !== 'history';
  if (name === 'library') library.render();
  if (name === 'history') history.render();
}
tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

const actions = createActions({ editor, stage, io, ui: { showTab } });
new ToolbarUI(editor);
new PropertiesUI(editor, actions, document.getElementById('props-page'));
const library = new LibraryUI(editor, actions, document.getElementById('library-page'));
const history = new HistoryUI(editor, document.getElementById('history-page'));
new TimelineUI(editor, actions);

// ---------- teclado ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
    e.preventDefault();
    stage.setSpace(true);
    return;
  }
  actions.handleKey(e);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') stage.setSpace(false);
});
window.addEventListener('blur', () => stage.setSpace(false));

// ---------- barra do palco ----------
const zoomInput = document.getElementById('zoom-input');
document.getElementById('zoom-fit').addEventListener('click', () => stage.fit());
document.getElementById('zoom-100').addEventListener('click', () => stage.actualSize());
zoomInput.addEventListener('change', () => {
  const v = parseFloat(zoomInput.value);
  if (Number.isFinite(v) && v > 0) stage.zoomTo(v / 100);
  else zoomInput.value = `${Math.round(stage.view.zoom * 100)}%`;
});
zoomInput.addEventListener('keydown', (e) => e.key === 'Enter' && zoomInput.blur());
editor.on('view', (v) => {
  if (document.activeElement !== zoomInput) zoomInput.value = `${Math.round(v.zoom * 100)}%`;
});
// caminho: Cena 1 › Símbolo › Símbolo dentro dele (clique para voltar)
const crumbs = document.getElementById('crumbs');
function renderCrumbs() {
  const list = editor.breadcrumb;
  const depth = list.length - 1;
  crumbs.innerHTML = list
    .map((c, i) => {
      const icon = i === 0 ? icons.scene : editor.symbol(editor.editStack[i - 1].symbolId)?.type === 'movieclip' ? icons.movieclip : icons.graphic;
      const cls = i === depth ? 'crumb-btn current' : 'crumb-btn';
      return `${i ? '<span class="crumb-sep">›</span>' : ''}<button class="${cls}" data-level="${i}">${icon}${esc(c.name)}</button>`;
    })
    .join('');
  crumbs.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      const lvl = Number(b.dataset.level);
      if (lvl < depth) editor.exitSymbol(depth - lvl);
    }),
  );
}
editor.on('context', renderCrumbs);
editor.on('library', renderCrumbs);
renderCrumbs();

// ---------- avisos ----------
const toastEl = document.getElementById('toast');
let toastTimer = 0;
editor.on('toast', (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
});

// ---------- título da janela ----------
function updateTitle() {
  const title = `${editor.dirty ? '• ' : ''}${editor.fileName} — Frame Animator`;
  document.title = title;
  window.api?.setTitle(title);
}
editor.on('doc', updateTitle);
editor.on('file', updateTitle);
updateTitle();

// ---------- integração com o Electron ----------
if (window.api) {
  window.api.onMenuAction((id) => actions.run(id));
  window.api.onCloseRequested(() => io.requestClose());
  window.api.ready();
} else {
  window.addEventListener('beforeunload', (e) => {
    if (editor.dirty) e.preventDefault();
  });
}

// para depuração no console
window.__fa = { editor, stage, actions };

// botões não roubam o foco do palco (assim Enter, setas e atalhos continuam indo para o editor)
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) e.preventDefault();
});
