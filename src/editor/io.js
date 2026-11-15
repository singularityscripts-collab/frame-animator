// Salvar, abrir, novo e janela de teste.
// No Electron usa window.api (preload). No navegador cai para download/upload de arquivo.

import { createDocument, serialize, parseDocument } from '../model/document.js';

export function createIO(editor) {
  const api = window.api;

  async function confirmDiscard() {
    if (!editor.dirty) return true;
    if (api) {
      const r = await api.confirmUnsaved(editor.fileName);
      if (r === 'cancel') return false;
      if (r === 'save') return save(false);
      return true;
    }
    return window.confirm(`"${editor.fileName}" tem alterações não salvas. Descartar?`);
  }

  async function save(as = false) {
    editor.stop();
    const data = serialize(editor.doc);
    if (api) {
      let res;
      try {
        res = await api.saveFile({ path: as ? null : editor.filePath, data, defaultName: `${editor.fileName}.fanim` });
      } catch (err) {
        editor.toast(`Não foi possível salvar: ${cleanError(err)}`);
        return false;
      }
      if (!res) return false;
      editor.filePath = res.path;
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = `${editor.fileName}.fanim`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    editor.history.markSaved();
    editor.emit('file');
    editor.toast(`Salvo: ${editor.fileName}`);
    return true;
  }

  function loadText(text, path) {
    try {
      editor.load(parseDocument(text), path);
      editor.toast(`Aberto: ${editor.fileName}`);
    } catch (err) {
      editor.toast(`Não foi possível abrir: ${err.message}`);
    }
  }

  async function open() {
    if (!(await confirmDiscard())) return;
    if (api) {
      let res;
      try {
        res = await api.openFile();
      } catch (err) {
        editor.toast(`Não foi possível abrir: ${cleanError(err)}`);
        return;
      }
      if (res) loadText(res.data, res.path);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fanim,application/json';
    input.onchange = async () => {
      const f = input.files[0];
      if (f) loadText(await f.text(), f.name);
    };
    input.click();
  }

  async function newDoc() {
    if (!(await confirmDiscard())) return;
    editor.load(createDocument(), null);
  }

  /** Pedido de fechar a janela (vem do processo principal). */
  async function requestClose() {
    if (await confirmDiscard()) api?.closeConfirmed();
  }

  function testScene() {
    editor.stop();
    const data = serialize(editor.doc);
    if (api) return api.openPreview(data);
    try {
      localStorage.setItem('fa-preview', data);
    } catch {
      editor.toast('Não foi possível abrir o teste.');
      return;
    }
    window.open('preview.html', 'fa-preview', 'width=960,height=600');
  }

  return { save, open, newDoc, requestClose, testScene, confirmDiscard };
}

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
