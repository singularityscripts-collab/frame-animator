// Barra de ferramentas (esquerda): ferramentas e cores.

import { icons } from './icons.js';
import { cssFill } from './color-ui.js';
import { showContextMenu } from './ui-kit.js';

export const TOOLS = [
  { id: 'select', label: 'Seleção', key: 'V' },
  { id: 'subselect', label: 'Subseleção (editar pontos)', key: 'A' },
  { id: 'lasso', label: 'Laço', key: 'L' },
  {
    group: [
      { id: 'transform', label: 'Transformação livre', key: 'Q' },
      { id: 'threeD', label: 'Rotação 3D', key: 'G' },
    ],
  },
  null,
  {
    group: [
      { id: 'pen', label: 'Caneta', key: 'P' },
      { id: 'penAdd', label: 'Adicionar ponto', key: '=' },
      { id: 'penDelete', label: 'Remover ponto', key: '-' },
      { id: 'penConvert', label: 'Converter ponto', key: 'Shift+C' },
    ],
  },
  { id: 'text', label: 'Texto', key: 'T' },
  { id: 'line', label: 'Linha', key: 'N' },
  {
    group: [
      { id: 'rect', label: 'Retângulo', key: 'R' },
      { id: 'oval', label: 'Oval', key: 'O' },
      { id: 'polystar', label: 'Polígono / estrela', key: 'Shift+R' },
    ],
  },
  { id: 'pencil', label: 'Lápis', key: 'Y' },
  {
    group: [
      { id: 'brush', label: 'Pincel (pressão da caneta)', key: 'B' },
      { id: 'width', label: 'Largura do traço', key: 'U' },
    ],
  },
  null,
  { id: 'bone', label: 'Ossos (cinemática inversa)', key: 'M' },
  { id: 'warp', label: 'Malha de pinos', key: 'W' },
  { id: 'bucket', label: 'Balde de tinta', key: 'K' },
  { id: 'eraser', label: 'Borracha', key: 'E' },
  { id: 'eyedropper', label: 'Conta-gotas', key: 'I' },
  { id: 'gradient', label: 'Transformar gradiente', key: 'F' },
  { id: 'camera', label: 'Câmera', key: 'C' },
  null,
  {
    group: [
      { id: 'hand', label: 'Mão (segure Espaço)', key: 'H' },
      { id: 'rotateView', label: 'Girar a vista', key: 'Shift+H' },
    ],
  },
  { id: 'zoom', label: 'Zoom (Alt diminui)', key: 'Z' },
];

/** Lista plana de todas as ferramentas (para atalhos e nomes). */
export const ALL_TOOLS = TOOLS.filter(Boolean).flatMap((t) => t.group || [t]);

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
      const group = t.group || [t];
      const b = document.createElement('button');
      b.className = group.length > 1 ? 'tool-btn has-group' : 'tool-btn';
      const show = (m) => {
        b.innerHTML = icons[m.id] || '';
        b.title = `${m.label} (${m.key})${group.length > 1 ? ' · clique direito: outras' : ''}`;
        b.setAttribute('aria-label', m.label);
        b.dataset.tool = m.id;
      };
      show(group[0]);
      b.addEventListener('click', () => editor.setTool(b.dataset.tool));
      if (group.length > 1) {
        let timer = null;
        const menu = (e) => {
          e.preventDefault?.();
          clearTimeout(timer);
          const r = b.getBoundingClientRect();
          showContextMenu(r.right + 2, r.top, group.map((m) => ({ label: `${m.label}  (${m.key})`, run: () => editor.setTool(m.id) })));
        };
        b.addEventListener('contextmenu', menu);
        b.addEventListener('pointerdown', (e) => {
          if (e.button === 0) timer = setTimeout(() => menu(e), 450);
        });
        for (const ev of ['pointerup', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(timer));
      }
      bar.appendChild(b);
      for (const m of group) this.buttons[m.id] = { b, show: () => show(m) };
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
    for (const [id, x] of Object.entries(this.buttons)) {
      x.b.classList.remove('active');
      if (ed.tool === id) x.show();
    }
    this.buttons[ed.tool]?.b.classList.add('active');
    const s = ed.style;
    for (const k of ['fill', 'stroke']) {
      const label = this.swatches.querySelector(`.swatch.${k}`);
      label.style.background = cssFill(s[k]);
      label.classList.toggle('off', !s[k + 'On']);
      label.querySelector('input').value = (typeof s[k] === 'string' ? s[k] : s[k]?.stops?.[0]?.color || '#000000').slice(0, 7);
    }
  }
}

