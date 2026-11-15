// Barra de ferramentas (esquerda): ferramentas e cores.

import { icons } from './icons.js';

export const TOOLS = [
  { id: 'select', label: 'Seleção', key: 'V' },
  { id: 'rect', label: 'Retângulo', key: 'R' },
  { id: 'oval', label: 'Oval', key: 'O' },
  { id: 'line', label: 'Linha', key: 'N' },
  { id: 'pencil', label: 'Lápis', key: 'Y' },
  null,
  { id: 'hand', label: 'Mão (segure Espaço)', key: 'H' },
  { id: 'zoom', label: 'Zoom (Alt diminui)', key: 'Z' },
];

export class ToolbarUI {
  constructor(editor) {
    this.editor = editor;
    const bar = document.getElementById('toolbar');
    this.buttons = {};
    for (const t of TOOLS) {
      if (!t) {
        bar.appendChild(Object.assign(document.createElement('div'), { className: 'tool-sep' }));
        continue;
      }
      const b = document.createElement('button');
      b.className = 'tool-btn';
      b.innerHTML = icons[t.id];
      b.title = `${t.label} (${t.key})`;
      b.setAttribute('aria-label', t.label);
      b.addEventListener('click', () => editor.setTool(t.id));
      bar.appendChild(b);
      this.buttons[t.id] = b;
    }
    bar.appendChild(Object.assign(document.createElement('div'), { className: 'tool-sep' }));

    const stack = document.createElement('div');
    stack.className = 'swatch-stack';
    stack.innerHTML = `
      <label class="swatch stroke" title="Cor do traço"><input type="color" data-k="stroke" aria-label="Cor do traço"></label>
      <label class="swatch fill" title="Cor do preenchimento"><input type="color" data-k="fill" aria-label="Cor do preenchimento"></label>`;
    bar.appendChild(stack);
    stack.querySelectorAll('input').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        editor.setStyle({ [k]: inp.value, [k + 'On']: true });
      }),
    );
    this.swatches = stack;

    const mini = document.createElement('div');
    mini.className = 'mini-btns';
    const mk = (icon, title, fn) => {
      const b = document.createElement('button');
      b.className = 'mini-btn';
      b.innerHTML = icons[icon];
      b.title = title;
      b.addEventListener('click', fn);
      mini.appendChild(b);
    };
    mk('reset', 'Cores padrão', () => editor.setStyle({ fill: '#ffffff', stroke: '#000000', fillOn: true, strokeOn: true }));
    mk('noColor', 'Sem preenchimento (liga/desliga)', () => editor.setStyle({ fillOn: !editor.style.fillOn }));
    mk('swap', 'Trocar cores', () => {
      const s = editor.style;
      editor.setStyle({ fill: s.stroke, stroke: s.fill });
    });
    bar.appendChild(mini);

    editor.on('tool', () => this.update());
    editor.on('style', () => this.update());
    this.update();
  }

  update() {
    const ed = this.editor;
    for (const [id, b] of Object.entries(this.buttons)) b.classList.toggle('active', ed.tool === id);
    const s = ed.style;
    for (const k of ['fill', 'stroke']) {
      const label = this.swatches.querySelector(`.swatch.${k}`);
      label.style.background = s[k];
      label.classList.toggle('off', !s[k + 'On']);
      label.querySelector('input').value = s[k];
    }
  }
}

