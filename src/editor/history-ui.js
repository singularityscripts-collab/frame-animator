// Painel de histórico: lista os passos de desfazer/refazer. Clicar num passo volta (ou avança) até ele.

import { esc } from './ui-kit.js';

export class HistoryUI {
  constructor(editor, root) {
    this.editor = editor;
    this.root = root;
    root.innerHTML = `<div class="lib-head"><span>Passos</span><span class="hist-count"></span></div><div class="lib-list" role="list"></div>
      <p class="hint" style="padding:8px 12px">Clique num passo para voltar até ele. Passos em cinza podem ser refeitos.</p>`;
    this.list = root.querySelector('.lib-list');
    for (const t of ['doc', 'load']) editor.on(t, () => this.schedule());
    this.render();
  }

  schedule() {
    if (this.raf || this.root.hidden) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render() {
    const h = this.editor.history;
    const done = h.undoStack.map((c) => c.label);
    const undone = h.redoStack.map((c) => c.label).reverse();
    const current = done.length;
    const steps = ['Documento aberto', ...done, ...undone];
    this.root.querySelector('.hist-count').textContent = `${done.length}`;
    this.list.innerHTML = steps
      .map((label, i) => {
        const cls = i === current ? 'lib-row selected' : 'lib-row';
        const style = i > current ? 'opacity:.45' : '';
        return `<div class="${cls}" role="listitem" data-i="${i}" style="padding-left:12px;${style}"><span class="lib-name">${esc(label)}</span></div>`;
      })
      .join('');
    this.list.querySelectorAll('[data-i]').forEach((row) =>
      row.addEventListener('click', () => this.goTo(Number(row.dataset.i))),
    );
    this.list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  goTo(target) {
    const ed = this.editor;
    let n = target - ed.history.undoStack.length;
    while (n < 0 && ed.history.canUndo) {
      ed.undo();
      n++;
    }
    while (n > 0 && ed.history.canRedo) {
      ed.redo();
      n--;
    }
  }
}
