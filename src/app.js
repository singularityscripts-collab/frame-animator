// Ponto de entrada do editor: cria o estado e liga as partes da interface.

import { Editor } from './editor/editor.js';
import './editor/editor-pro.js';
import './editor/editor-final.js';
import { extendActions } from './editor/actions-final.js';
import { Panels } from './editor/panels.js';
import { ActionsPanel, AlignPanel, ScenesPanel, ComponentsPanel, ScriptsPanel } from './editor/panels-ui.js';
import { AudioEngine, sceneSchedule } from './player/audio.js';
import { showContextMenu } from './editor/ui-kit.js';
import { Stage } from './editor/stage.js';
import { TimelineUI } from './editor/timeline-ui.js';
import { ToolbarUI } from './editor/toolbar-ui.js';
import { PropertiesUI } from './editor/properties-ui.js';
import { LibraryUI } from './editor/library-ui.js';
import { HistoryUI } from './editor/history-ui.js';
import { ColorUI } from './editor/color-ui.js';
import { icons } from './editor/icons.js';
import { esc } from './editor/ui-kit.js';
import { createActions } from './editor/actions.js';
import { createIO } from './editor/io.js';
import { installUpdates } from './editor/update-ui.js';
import { installStatusBar, installStageMenu, openShortcutSheet, enableNumberScrub, installToolCursors } from './editor/ui-help.js';

const editor = new Editor();
const io = createIO(editor);
const stage = new Stage(document.getElementById('stage'), editor);
// ---------- painéis encaixáveis ----------
const panels = new Panels();
const showTab = (name) => panels.show(name);
const page = (id) => {
  const el = document.createElement('div');
  el.id = `${id}-page`;
  el.hidden = true;
  return el;
};

const actions = createActions({ editor, stage, io, ui: { showTab } });
extendActions(actions, { editor, stage, io, panels });
new ToolbarUI(editor);
new PropertiesUI(editor, actions, document.getElementById('props-page'));
const library = new LibraryUI(editor, actions, document.getElementById('library-page'));
const history = new HistoryUI(editor, document.getElementById('history-page'));
const colors = new ColorUI(editor, document.getElementById('colors-page'));
new TimelineUI(editor, actions);
installStatusBar(editor, stage);
installStageMenu(editor, stage, actions);
enableNumberScrub(editor);
installToolCursors(editor, stage);
actions.defs.shortcutSheet = { keys: [], run: () => openShortcutSheet(actions) };
installUpdates({ editor, actions, io });

const actionsPage = page('actions'), alignPage = page('align'), scenesPage = page('scenes'), compPage = page('components'), scriptsPage = page('scripts');
const actionsPanel = new ActionsPanel(editor, actions, actionsPage);
new AlignPanel(editor, alignPage);
const scenesPanel = new ScenesPanel(editor, scenesPage);
new ComponentsPanel(editor, compPage);
new ScriptsPanel(editor, actions, scriptsPage);
panels.register('props', 'Propriedades', document.getElementById('props-page'));
panels.register('colors', 'Cores', document.getElementById('colors-page'), () => colors.render());
panels.register('library', 'Biblioteca', document.getElementById('library-page'), () => library.render());
panels.register('history', 'Histórico', document.getElementById('history-page'), () => history.render());
panels.register('actions', 'Ações', actionsPage, () => actionsPanel.refresh());
panels.register('align', 'Alinhar', alignPage);
panels.register('scenes', 'Cenas', scenesPage, () => scenesPanel.render());
panels.register('components', 'Componentes', compPage);
panels.register('scripts', 'Scripts', scriptsPage);
panels.apply();
document.getElementById('tl-resizer').addEventListener('pointerup', () => {
  const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tl-h'));
  if (Number.isFinite(h)) panels.setTimelineHeight(h);
});

// ---------- teclado ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
    e.preventDefault();
    stage.setSpace(true);
    return;
  }
  // ? ou F1: folha de atalhos
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
  if (!typing && !document.querySelector('dialog[open]') && (e.key === '?' || e.key === 'F1')) {
    e.preventDefault();
    return openShortcutSheet(actions);
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
// ---------- som junto com a reprodução ----------
const audio = new AudioEngine();
let lastScrub = -1;
function startAudio() {
  const s = editor.scene;
  if (editor.editStack.length) return;
  const b = editor.playBounds();
  const from = editor.frame < b.from || editor.frame >= b.to ? b.from : editor.frame;
  audio.play(editor.doc, sceneSchedule(editor.doc, s, from, b.to, editor.doc.fps));
}
editor.on('playing', () => (editor.player.playing ? startAudio() : audio.stop()));
editor.on('loop', () => {
  audio.stop();
  const b = editor.playBounds();
  if (!editor.editStack.length) audio.play(editor.doc, sceneSchedule(editor.doc, editor.scene, b.from, b.to, editor.doc.fps));
});
// scrub: ao arrastar a agulha, toca um pedacinho dos sons "stream"
editor.on('frame', () => {
  if (editor.player.playing || editor.editStack.length || editor.frame === lastScrub) return;
  lastScrub = editor.frame;
  if (scrubbing) audio.scrub(editor.doc, editor.scene, editor.frame);
});
let scrubbing = false;
for (const id of ['tl-ruler', 'tl-frames']) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', () => (scrubbing = true));
  window.addEventListener('pointerup', () => (scrubbing = false));
}

// ---------- presets de movimento do usuário (ficam neste computador) ----------
try {
  editor.userPresets = JSON.parse(localStorage.getItem('fa-user-presets') || '[]');
} catch {
  editor.userPresets = [];
}
editor.on('presets', () => {
  try {
    localStorage.setItem('fa-user-presets', JSON.stringify(editor.userPresets));
  } catch {
    // sem armazenamento: os presets valem só nesta sessão
  }
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
      const caret = i === 0 ? ' <span class="crumb-caret" title="Cenas">▾</span>' : '';
      return `${i ? '<span class="crumb-sep">›</span>' : ''}<button class="${cls}" data-level="${i}">${icon}${esc(c.name)}${caret}</button>`;
    })
    .join('');
  crumbs.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', (e) => {
      const lvl = Number(b.dataset.level);
      if (lvl === 0 && (e.target.closest('.crumb-caret') || depth === 0)) return sceneMenu(e);
      if (lvl < depth) editor.exitSymbol(depth - lvl);
    }),
  );
}

/** Menu de cenas: trocar, criar, duplicar, renomear, mover e apagar. */
function sceneMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const i = editor.sceneIndex;
  const n = editor.doc.scenes.length;
  showContextMenu(r.left, r.bottom + 4, [
    ...editor.doc.scenes.map((s, k) => ({ label: `${k === i ? '● ' : ''}${s.name}`, run: () => editor.setScene(k) })),
    '-',
    { label: 'Nova cena', run: () => actions.run('newScene') },
    { label: 'Duplicar esta cena', run: () => actions.run('duplicateScene') },
    { label: 'Renomear…', run: () => actions.run('renameScene') },
    { label: 'Mover para antes', run: () => editor.moveScene(i, i - 1), disabled: i === 0 },
    { label: 'Mover para depois', run: () => editor.moveScene(i, i + 1), disabled: i === n - 1 },
    '-',
    { label: 'Apagar esta cena', run: () => actions.run('deleteScene'), disabled: n <= 1 },
  ]);
}
editor.on('scenes', renderCrumbs);
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
  // tempo para ler: mensagens longas ficam mais tempo na tela
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), Math.min(7000, 1800 + String(msg).length * 45));
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
window.__fa = { editor, stage, actions, panels };

// botões não roubam o foco do palco (assim Enter, setas e atalhos continuam indo para o editor)
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) e.preventDefault();
});
