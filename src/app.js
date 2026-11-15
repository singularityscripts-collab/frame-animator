// Ponto de entrada do editor: cria o estado e liga as partes da interface.

import { Editor } from './editor/editor.js';
import { Stage } from './editor/stage.js';
import { TimelineUI } from './editor/timeline-ui.js';
import { ToolbarUI, PropertiesUI } from './editor/panels-ui.js';
import { createActions } from './editor/actions.js';
import { createIO } from './editor/io.js';

const editor = new Editor();
const io = createIO(editor);
const stage = new Stage(document.getElementById('stage'), editor);
const actions = createActions({ editor, stage, io });
new ToolbarUI(editor);
new PropertiesUI(editor, actions);
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
editor.on('doc', () => {
  document.getElementById('scene-name').textContent = editor.scene.name;
});

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
