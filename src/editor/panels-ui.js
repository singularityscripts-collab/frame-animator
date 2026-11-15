// Barra de ferramentas (esquerda) e painel de propriedades (direita).

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

// ---------- Propriedades ----------

const fmt = (v) => (Math.round(v * 10) / 10).toString();

export class PropertiesUI {
  constructor(editor, actions) {
    this.editor = editor;
    this.actions = actions;
    this.el = document.getElementById('props');
    this.mode = null;
    for (const t of ['selection', 'doc', 'style', 'tool', 'load']) editor.on(t, () => this.render());
    this.render();
  }

  render() {
    const ed = this.editor;
    const items = ed.selectedItems();
    const mode = items.length ? `sel:${items.length}` : `none:${ed.tool}`;
    if (mode !== this.mode) {
      this.mode = mode;
      this.el.innerHTML = '';
      this.build(items);
    }
    this.fill(items);
  }

  section(title, html) {
    const s = document.createElement('section');
    s.className = 'prop-section';
    s.innerHTML = `<h3>${title}</h3>${html}`;
    this.el.appendChild(s);
    return s;
  }

  build(items) {
    const ed = this.editor;
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Propriedades';
    this.el.appendChild(title);

    const styleHtml = `
      <div class="prop-grid">
        <label class="field wide"><input type="checkbox" data-s="fillOn"><span style="flex:1">Preenchimento</span><input type="color" data-s="fill"></label>
        <label class="field wide"><input type="checkbox" data-s="strokeOn"><span style="flex:1">Traço</span><input type="color" data-s="stroke"></label>
        <label class="field wide"><span style="flex:1">Espessura do traço</span><input type="number" min="0" max="200" step="0.5" data-s="strokeWidth" style="flex:0 0 70px"></label>
      </div>`;

    if (items.length) {
      this.section(
        items.length === 1 ? 'Forma' : `${items.length} objetos`,
        `<div class="prop-grid">
          <label class="field"><span>X</span><input type="number" step="1" data-b="x"></label>
          <label class="field"><span>Y</span><input type="number" step="1" data-b="y"></label>
          <label class="field"><span>L</span><input type="number" step="1" min="0.1" data-b="w"></label>
          <label class="field"><span>A</span><input type="number" step="1" min="0.1" data-b="h"></label>
          ${items.length === 1 ? '<label class="field wide"><span style="flex:1">Rotação (°)</span><input type="number" step="1" data-r style="flex:0 0 70px"></label>' : ''}
        </div>`,
      );
      this.section('Preenchimento e traço', styleHtml);
      this.section(
        'Organizar',
        `<div class="prop-grid">
          <button class="btn-flat" data-a="arrangeFront">Trazer p/ frente</button>
          <button class="btn-flat" data-a="arrangeBack">Enviar p/ trás</button>
          <button class="btn-flat" data-a="duplicate">Duplicar</button>
          <button class="btn-flat" data-a="delete">Apagar</button>
        </div>`,
      );
    } else {
      this.section(
        'Documento',
        `<div class="prop-grid">
          <label class="field"><span>L</span><input type="number" min="1" max="16000" data-d="width"></label>
          <label class="field"><span>A</span><input type="number" min="1" max="16000" data-d="height"></label>
          <label class="field"><span>FPS</span><input type="number" min="1" max="120" data-d="fps"></label>
          <label class="field"><span>Fundo</span><input type="color" data-d="background"></label>
        </div>`,
      );
      const tool = { select: 'Seleção', rect: 'Retângulo', oval: 'Oval', line: 'Linha', pencil: 'Lápis', hand: 'Mão', zoom: 'Zoom' }[ed.tool];
      this.section(`Ferramenta: ${tool}`, styleHtml);
      this.section(
        'Atalhos',
        `<div class="shortcut-list">
          <span class="kbd">F5</span><span>Inserir quadro</span>
          <span class="kbd">F6</span><span>Keyframe (copia o anterior)</span>
          <span class="kbd">F7</span><span>Keyframe vazio</span>
          <span class="kbd">Shift+F5</span><span>Remover quadro</span>
          <span class="kbd">Shift+F6</span><span>Limpar keyframe</span>
          <span class="kbd">, .</span><span>Quadro anterior / próximo</span>
          <span class="kbd">Enter</span><span>Reproduzir / parar</span>
          <span class="kbd">Espaço</span><span>Arrastar a vista</span>
          <span class="kbd">Ctrl+roda</span><span>Zoom</span>
          <span class="kbd">Shift</span><span>Proporção / ângulo fixo</span>
          <span class="kbd">Alt</span><span>Desenhar/escalar do centro</span>
        </div>`,
      );
    }

    // eventos
    this.el.querySelectorAll('[data-s]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.s;
        let v = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (k === 'strokeWidth') v = Math.max(0, Math.min(200, parseFloat(v) || 0));
        const patch = { [k]: v };
        if (k === 'fill') patch.fillOn = true;
        if (k === 'stroke') patch.strokeOn = true;
        ed.setStyle(patch);
      }),
    );
    this.el.querySelectorAll('[data-b]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) ed.setSelectionBounds({ [inp.dataset.b]: v });
        else this.fill(ed.selectedItems());
      }),
    );
    const rot = this.el.querySelector('[data-r]');
    rot?.addEventListener('change', () => {
      const v = parseFloat(rot.value);
      const it = ed.selectedItems()[0];
      if (Number.isFinite(v) && it) ed.rotateSelection(v - angleOf(it.el.matrix));
    });
    this.el.querySelectorAll('[data-d]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.d;
        if (k === 'background') return ed.setDocProps({ background: inp.value });
        const lim = k === 'fps' ? [1, 120] : [1, 16000];
        const v = Math.round(parseFloat(inp.value));
        if (!Number.isFinite(v)) return this.fill([]);
        ed.setDocProps({ [k]: Math.max(lim[0], Math.min(lim[1], v)) });
      }),
    );
    this.el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => this.actions.run(b.dataset.a)));
    this.el.querySelectorAll('input').forEach((inp) =>
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur();
      }),
    );
  }

  fill(items) {
    const ed = this.editor;
    const set = (inp, v) => {
      if (!inp || document.activeElement === inp) return;
      if (inp.type === 'checkbox') inp.checked = !!v;
      else inp.value = v;
    };
    let style = ed.style;
    if (items.length) {
      const el = items[0].el;
      style = {
        fill: el.fill || ed.style.fill,
        fillOn: !!el.fill,
        stroke: el.stroke || ed.style.stroke,
        strokeOn: !!el.stroke,
        strokeWidth: el.strokeWidth,
      };
      const b = ed.selectionBounds();
      for (const k of ['x', 'y', 'w', 'h']) set(this.el.querySelector(`[data-b="${k}"]`), fmt(b[k]));
      set(this.el.querySelector('[data-r]'), fmt(angleOf(el.matrix)));
      const fillCheck = this.el.querySelector('[data-s="fillOn"]');
      if (fillCheck) fillCheck.disabled = items.every((it) => !it.el.path.closed);
    } else {
      for (const k of ['width', 'height', 'fps', 'background']) set(this.el.querySelector(`[data-d="${k}"]`), ed.doc[k]);
    }
    for (const k of ['fill', 'fillOn', 'stroke', 'strokeOn', 'strokeWidth']) set(this.el.querySelector(`[data-s="${k}"]`), style[k]);
  }
}

function angleOf(m) {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}
