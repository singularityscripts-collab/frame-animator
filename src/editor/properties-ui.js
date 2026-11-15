// Painel de propriedades: muda conforme o que está selecionado.
// Forma → posição, cor e traço. Instância → símbolo, comportamento, loop e efeito de cor.
// Nada selecionado → documento, keyframe atual (tween) e ferramenta.

import { esc } from './ui-kit.js';
import { SYMBOL_TYPES } from '../model/document.js';

const fmt = (v) => (Math.round(v * 10) / 10).toString();
const TOOL_NAMES = { select: 'Seleção', rect: 'Retângulo', oval: 'Oval', line: 'Linha', pencil: 'Lápis', hand: 'Mão', zoom: 'Zoom' };

const STYLE_HTML = `
  <div class="prop-grid">
    <label class="field wide"><input type="checkbox" data-s="fillOn"><span style="flex:1">Preenchimento</span><input type="color" data-s="fill"></label>
    <label class="field wide"><input type="checkbox" data-s="strokeOn"><span style="flex:1">Traço</span><input type="color" data-s="stroke"></label>
    <label class="field wide"><span style="flex:1">Espessura do traço</span><input type="number" min="0" max="200" step="0.5" data-s="strokeWidth" style="flex:0 0 70px"></label>
  </div>`;

const range = (key, min, max, label, step = 1) => `
  <label class="field wide" style="display:block"><span>${label}</span>
    <div class="range-row"><input type="range" min="${min}" max="${max}" step="${step}" data-c="${key}"><input type="number" min="${min}" max="${max}" step="${step}" data-c="${key}"></div>
  </label>`;

export class PropertiesUI {
  constructor(editor, actions, el) {
    this.editor = editor;
    this.actions = actions;
    this.el = el;
    this.mode = null;
    for (const t of ['selection', 'doc', 'style', 'tool', 'load', 'layers', 'context']) editor.on(t, () => this.render());
    editor.on('frame', () => {
      if (!editor.player.playing) this.render();
    });
    this.render();
  }

  render() {
    const ed = this.editor;
    const items = ed.selectedItems();
    const span = ed.currentSpan();
    let mode;
    if (items.length) {
      const insts = items.filter((it) => it.el.type === 'instance');
      const i0 = insts[0]?.el;
      mode = `sel:${items.length}:${insts.length}:${i0?.symbolId}:${i0?.behavior}:${i0?.color?.mode}:${items[0].el.type}`;
    } else {
      const nextKf = span && ed.activeLayer.frames[ed.activeLayer.frames.indexOf(span) + 1];
      mode = `none:${ed.tool}:${span ? `${span.start}:${span.duration}:${!!span.tween}:${!!nextKf}` : '-'}:${ed.activeLayerId}:${ed.editStack.length}`;
    }
    if (mode !== this.mode) {
      this.mode = mode;
      this.el.innerHTML = '';
      this.build(items, span);
    }
    this.fill(items, span);
  }

  section(title, html) {
    const s = document.createElement('section');
    s.className = 'prop-section';
    s.innerHTML = `<h3>${esc(title)}</h3>${html}`;
    this.el.appendChild(s);
    return s;
  }

  build(items, span) {
    const ed = this.editor;
    if (items.length) {
      const shapes = items.filter((it) => it.el.type === 'shape');
      const insts = items.filter((it) => it.el.type === 'instance');
      const single = items.length === 1 ? items[0].el : null;
      let title = `${items.length} objetos`;
      if (single?.type === 'shape') title = 'Forma';
      if (single?.type === 'instance') title = `Instância de ${ed.symbol(single.symbolId)?.name || '?'}`;
      this.section(
        title,
        `<div class="prop-grid">
          <label class="field"><span>X</span><input type="number" step="1" data-b="x"></label>
          <label class="field"><span>Y</span><input type="number" step="1" data-b="y"></label>
          <label class="field"><span>L</span><input type="number" step="1" min="0.1" data-b="w"></label>
          <label class="field"><span>A</span><input type="number" step="1" min="0.1" data-b="h"></label>
          ${single ? '<label class="field wide"><span style="flex:1">Rotação (°)</span><input type="number" step="1" data-r style="flex:0 0 70px"></label>' : ''}
        </div>`,
      );
      if (insts.length === items.length) this.buildInstance(insts);
      if (shapes.length) this.section('Preenchimento e traço', STYLE_HTML);
      this.section(
        'Organizar',
        `<div class="prop-grid">
          <button class="btn-flat" data-a="arrangeFront">Trazer p/ frente</button>
          <button class="btn-flat" data-a="arrangeBack">Enviar p/ trás</button>
          <button class="btn-flat" data-a="duplicate">Duplicar</button>
          <button class="btn-flat" data-a="delete">Apagar</button>
          <button class="btn-flat" data-a="convertToSymbol" style="grid-column:span 2">Converter em símbolo (F8)</button>
        </div>`,
      );
    } else {
      if (!ed.editStack.length) {
        this.section(
          'Documento',
          `<div class="prop-grid">
            <label class="field"><span>L</span><input type="number" min="1" max="16000" data-d="width"></label>
            <label class="field"><span>A</span><input type="number" min="1" max="16000" data-d="height"></label>
            <label class="field"><span>FPS</span><input type="number" min="1" max="120" data-d="fps"></label>
            <label class="field"><span>Fundo</span><input type="color" data-d="background"></label>
          </div>`,
        );
      } else {
        const sym = ed.editingSymbol;
        this.section(
          `Símbolo: ${sym.name}`,
          `<p class="hint">${SYMBOL_TYPES[sym.type]} · ${ed.length} ${ed.length === 1 ? 'quadro' : 'quadros'}.<br>
           Duplo clique numa área vazia (ou Ctrl+E) volta para a cena.</p>`,
        );
      }
      if (span) this.buildFrame(span);
      this.section(`Ferramenta: ${TOOL_NAMES[ed.tool]}`, STYLE_HTML);
      this.section(
        'Atalhos',
        `<div class="shortcut-list">
          <span class="kbd">F5</span><span>Inserir quadro</span>
          <span class="kbd">F6</span><span>Keyframe (copia o anterior)</span>
          <span class="kbd">F7</span><span>Keyframe vazio</span>
          <span class="kbd">Shift+F5</span><span>Remover quadro</span>
          <span class="kbd">Shift+F6</span><span>Limpar keyframe</span>
          <span class="kbd">F8</span><span>Converter em símbolo</span>
          <span class="kbd">Ctrl+E</span><span>Editar símbolo / voltar</span>
          <span class="kbd">, .</span><span>Quadro anterior / próximo</span>
          <span class="kbd">Enter</span><span>Reproduzir / parar</span>
          <span class="kbd">Espaço</span><span>Arrastar a vista</span>
          <span class="kbd">Shift</span><span>Proporção / ângulo fixo</span>
          <span class="kbd">Alt</span><span>Desenhar/escalar do centro</span>
        </div>`,
      );
    }
    this.bind();
  }

  buildInstance(insts) {
    const el = insts[0].el;
    const graphic = el.behavior !== 'movieclip';
    this.section(
      'Comportamento',
      `<div class="prop-grid">
        <label class="field wide"><span style="flex:1">Tipo</span>
          <select data-i="behavior" style="flex:0 0 130px"><option value="graphic">Gráfico</option><option value="movieclip">Movie clip</option></select></label>
        ${
          graphic
            ? `<label class="field wide"><span style="flex:1">Repetição</span>
                <select data-i="loop" style="flex:0 0 130px"><option value="loop">Loop</option><option value="once">Tocar uma vez</option><option value="single">Quadro único</option></select></label>
               <label class="field wide"><span style="flex:1">Primeiro quadro</span><input type="number" min="1" step="1" data-i="firstFrame" style="flex:0 0 70px"></label>`
            : `<p class="hint" style="grid-column:span 2">O movie clip toca sozinho no teste e no export. No editor ele fica no 1º quadro.</p>`
        }
        ${insts.length === 1 ? '<button class="btn-flat" data-a="editSymbol" style="grid-column:span 2">Editar símbolo (Ctrl+E)</button>' : ''}
      </div>`,
    );
    const mode = el.color?.mode || 'none';
    let fields = '';
    if (mode === 'brightness') fields = range('brightness', -100, 100, 'Brilho (%)');
    if (mode === 'tint')
      fields = `<label class="field wide"><span style="flex:1">Cor do tom</span><input type="color" data-c="tint"></label>${range('tintAmount', 0, 100, 'Quantidade (%)')}`;
    if (mode === 'alpha') fields = range('alpha', 0, 100, 'Alfa (%)');
    if (mode === 'advanced') {
      const pair = (m, o, label) =>
        `<label class="field"><span>${label}×</span><input type="number" step="1" data-c="${m}" title="${label}: multiplicador (%)"></label>
         <label class="field"><span>+</span><input type="number" step="1" min="-255" max="255" data-c="${o}" title="${label}: deslocamento"></label>`;
      fields = `<div class="prop-grid">${pair('rm', 'ro', 'R')}${pair('gm', 'go', 'G')}${pair('bm', 'bo', 'B')}${pair('am', 'ao', 'A')}</div>`;
    }
    this.section(
      'Efeito de cor',
      `<div class="prop-grid" style="margin-bottom:8px">
        <label class="field wide"><span style="flex:1">Estilo</span>
          <select data-cmode style="flex:0 0 130px">
            <option value="none">Nenhum</option><option value="brightness">Brilho</option><option value="tint">Tom</option>
            <option value="alpha">Alfa</option><option value="advanced">Avançado</option>
          </select></label>
      </div>${fields}`,
    );
  }

  buildFrame(span) {
    const ed = this.editor;
    const tw = span.tween;
    const idx = ed.activeLayer.frames.indexOf(span);
    const hasTarget = !!ed.activeLayer.frames[idx + 1];
    let html = `<p class="hint" style="margin-bottom:8px">Keyframe no quadro ${span.start + 1} · ${esc(ed.activeLayer.name)} · ${span.duration} ${span.duration === 1 ? 'quadro' : 'quadros'}</p>
      <div class="prop-grid">
        <label class="field wide"><span style="flex:1">Tween</span>
          <select data-tw="type" style="flex:0 0 130px"><option value="">Nenhum</option><option value="classic">Clássico</option></select></label>
      </div>`;
    if (tw) {
      html += `
        ${range('ease', -100, 100, 'Easing (− acelera, + desacelera)').replace(/data-c=/g, 'data-tw=')}
        <div class="prop-grid">
          <label class="field wide"><span style="flex:1">Rotação</span>
            <select data-tw="rotate" style="flex:0 0 110px"><option value="auto">Automática</option><option value="none">Nenhuma</option><option value="cw">Horária</option><option value="ccw">Anti-horária</option></select></label>
          <label class="field wide"><span style="flex:1">Voltas extras</span><input type="number" min="0" max="99" step="1" data-tw="rotations" style="flex:0 0 70px"></label>
        </div>
        ${hasTarget ? '' : '<p class="hint" style="margin-top:8px;color:#ffb44f">Falta um keyframe depois deste para o tween ter destino (F6 mais à frente).</p>'}`;
    }
    this.section('Quadro', html);
  }

  bind() {
    const ed = this.editor;
    const q = (sel) => this.el.querySelectorAll(sel);
    q('[data-s]').forEach((inp) =>
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
    q('[data-b]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) ed.setSelectionBounds({ [inp.dataset.b]: v });
        else this.render();
      }),
    );
    q('[data-r]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        const it = ed.selectedItems()[0];
        if (Number.isFinite(v) && it) ed.rotateSelection(v - angleOf(it.el.matrix));
      }),
    );
    q('[data-d]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.d;
        if (k === 'background') return ed.setDocProps({ background: inp.value });
        const lim = k === 'fps' ? [1, 120] : [1, 16000];
        const v = Math.round(parseFloat(inp.value));
        if (!Number.isFinite(v)) return this.render();
        ed.setDocProps({ [k]: Math.max(lim[0], Math.min(lim[1], v)) });
      }),
    );
    q('[data-i]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.i;
        let v = inp.value;
        if (k === 'firstFrame') v = Math.max(0, (parseInt(v, 10) || 1) - 1);
        ed.setInstanceProps({ [k]: v }, k === 'behavior' ? 'Tipo da instância' : 'Repetição');
      }),
    );
    q('[data-cmode]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const defaults = {
          none: { mode: 'none' },
          brightness: { mode: 'brightness', brightness: 0 },
          tint: { mode: 'tint', tint: '#ff0000', tintAmount: 50 },
          alpha: { mode: 'alpha', alpha: 50 },
          advanced: { mode: 'advanced', rm: 100, gm: 100, bm: 100, am: 100, ro: 0, go: 0, bo: 0, ao: 0 },
        };
        ed.setInstanceProps({ color: defaults[sel.value] }, 'Efeito de cor');
      }),
    );
    // efeito de cor: o controle deslizante mostra ao vivo e grava ao soltar
    q('[data-c]').forEach((inp) => {
      const k = inp.dataset.c;
      const value = () => (inp.type === 'color' ? inp.value : parseFloat(inp.value));
      inp.addEventListener('input', () => {
        q(`[data-c="${k}"]`).forEach((o) => o !== inp && (o.value = inp.value));
      });
      inp.addEventListener('change', () => {
        const v = value();
        if (inp.type !== 'color' && !Number.isFinite(v)) return this.render();
        const cur = ed.selectedItems()[0]?.el.color || { mode: 'none' };
        ed.setInstanceProps({ color: { ...cur, [k]: v } }, 'Efeito de cor');
      });
    });
    q('[data-tw]').forEach((inp) => {
      const k = inp.dataset.tw;
      inp.addEventListener('input', () => {
        if (k === 'ease') q('[data-tw="ease"]').forEach((o) => o !== inp && (o.value = inp.value));
      });
      inp.addEventListener('change', () => {
        if (k === 'type') return inp.value ? ed.createClassicTween() : ed.removeTween();
        let v = inp.value;
        if (k === 'ease') v = Math.max(-100, Math.min(100, Math.round(parseFloat(v) || 0)));
        if (k === 'rotations') v = Math.max(0, Math.min(99, parseInt(v, 10) || 0));
        ed.setTweenProps({ [k]: v });
      });
    });
    q('[data-a]').forEach((b) => b.addEventListener('click', () => this.actions.run(b.dataset.a)));
    q('input').forEach((inp) =>
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur();
      }),
    );
  }

  fill(items, span) {
    const ed = this.editor;
    const set = (inp, v) => {
      if (!inp || document.activeElement === inp) return;
      if (inp.type === 'checkbox') inp.checked = !!v;
      else inp.value = v;
    };
    const all = (sel, v) => this.el.querySelectorAll(sel).forEach((i) => set(i, v));
    let style = ed.style;
    if (items.length) {
      const shape = items.find((it) => it.el.type === 'shape')?.el;
      if (shape) {
        style = {
          fill: shape.fill || ed.style.fill,
          fillOn: !!shape.fill,
          stroke: shape.stroke || ed.style.stroke,
          strokeOn: !!shape.stroke,
          strokeWidth: shape.strokeWidth,
        };
      }
      const b = ed.selectionBounds();
      for (const k of ['x', 'y', 'w', 'h']) set(this.el.querySelector(`[data-b="${k}"]`), fmt(b[k]));
      set(this.el.querySelector('[data-r]'), fmt(angleOf(items[0].el.matrix)));
      const fillCheck = this.el.querySelector('[data-s="fillOn"]');
      if (fillCheck) fillCheck.disabled = items.every((it) => it.el.type !== 'shape' || !it.el.path.closed);
      const inst = items[0].el.type === 'instance' ? items[0].el : null;
      if (inst) {
        set(this.el.querySelector('[data-i="behavior"]'), inst.behavior);
        set(this.el.querySelector('[data-i="loop"]'), inst.loop);
        set(this.el.querySelector('[data-i="firstFrame"]'), (inst.firstFrame || 0) + 1);
        const c = inst.color || { mode: 'none' };
        set(this.el.querySelector('[data-cmode]'), c.mode || 'none');
        for (const k of ['brightness', 'tint', 'tintAmount', 'alpha', 'rm', 'gm', 'bm', 'am', 'ro', 'go', 'bo', 'ao']) {
          if (c[k] != null) all(`[data-c="${k}"]`, typeof c[k] === 'number' ? fmt(c[k]) : c[k]);
        }
      }
    } else if (!ed.editStack.length) {
      for (const k of ['width', 'height', 'fps', 'background']) set(this.el.querySelector(`[data-d="${k}"]`), ed.doc[k]);
    }
    if (span) {
      set(this.el.querySelector('[data-tw="type"]'), span.tween ? 'classic' : '');
      if (span.tween) {
        all('[data-tw="ease"]', span.tween.ease || 0);
        set(this.el.querySelector('[data-tw="rotate"]'), span.tween.rotate || 'auto');
        set(this.el.querySelector('[data-tw="rotations"]'), span.tween.rotations || 0);
      }
    }
    for (const k of ['fill', 'fillOn', 'stroke', 'strokeOn', 'strokeWidth']) set(this.el.querySelector(`[data-s="${k}"]`), style[k]);
  }
}

function angleOf(m) {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}
