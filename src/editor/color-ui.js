// Painel de cores: preenchimento e traço, cor sólida com alfa, gradiente linear/radial e amostras.
// Mudar uma cor aqui vale para a ferramenta e para as formas selecionadas (como no editor clássico).

import { esc, showContextMenu } from './ui-kit.js';
import { isGradient } from '../player/render.js';
import { hexToRgba, rgbaToHex, lerpHex } from '../player/tween.js';

const rgbaCss = (color, alpha = 1) => {
  const [r, g, b] = hexToRgba(color);
  return `rgba(${r},${g},${b},${alpha})`;
};

/** Preenchimento → valor de `background` em CSS (para amostras e prévias). */
export function cssFill(fill) {
  if (!fill) return 'transparent';
  if (!isGradient(fill)) return fill;
  const stops = [...fill.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${rgbaCss(s.color, s.alpha ?? 1)} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  return fill.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(90deg, ${stops})`;
}

const CHECKER = 'repeating-conic-gradient(#bbb 0% 25%, #eee 0% 50%) 50% / 10px 10px';

/** Preenchimento como camada de fundo (para pôr por cima do xadrez de transparência). */
function layerOf(fill) {
  if (!fill) return 'linear-gradient(transparent, transparent)';
  return isGradient(fill) ? cssFill(fill) : `linear-gradient(${fill}, ${fill})`;
}

export class ColorUI {
  constructor(editor, root) {
    this.editor = editor;
    this.root = root;
    this.target = 'fill';
    this.stop = 0;
    this.dragging = false;
    for (const t of ['style', 'selection', 'doc', 'load']) editor.on(t, () => this.schedule());
    this.render();
  }

  schedule() {
    if (this.raf || this.root.hidden || this.dragging) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** Cores atuais: da forma selecionada, ou as da ferramenta. */
  current() {
    const ed = this.editor;
    const shape = ed.selectedItems().find((it) => it.el.type === 'shape')?.el;
    if (shape) {
      return {
        fill: shape.fill || null,
        stroke: shape.strokeGradient || shape.stroke || null,
        fromSelection: true,
        lineSelected: !!shape.stroke && shape.strokeWidth > 0,
      };
    }
    return { fill: ed.style.fillOn ? ed.style.fill : null, stroke: ed.style.strokeOn ? ed.style.stroke : null, fromSelection: false };
  }

  apply(value) {
    const ed = this.editor;
    if (this.target === 'fill') ed.setStyle(value ? { fill: value, fillOn: true } : { fillOn: false });
    else if (isGradient(value)) ed.setStrokeGradient(value);
    else ed.setStyle(value ? { stroke: value, strokeOn: true } : { strokeOn: false });
  }

  render() {
    const cur = this.current();
    const value = cur[this.target];
    const isFill = this.target === 'fill';
    const kind = !value ? 'none' : isGradient(value) ? value.type : 'solid';
    const ed = this.editor;

    let body = '';
    if (kind === 'solid') {
      const [r, g, b, a] = hexToRgba(value);
      const hex = rgbaToHex([r, g, b, 255]);
      body = `
        <div class="prop-grid">
          <label class="field"><span>Cor</span><input type="color" data-k="color" value="${hex}"></label>
          <label class="field"><span>Hex</span><input type="text" data-k="hex" value="${hex}" maxlength="7" spellcheck="false"></label>
        </div>
        <label class="field wide" style="display:block;margin-top:8px"><span>Alfa (%)</span>
          <div class="range-row"><input type="range" min="0" max="100" data-k="alpha" value="${Math.round((a / 255) * 100)}"><input type="number" min="0" max="100" data-k="alpha" value="${Math.round((a / 255) * 100)}"></div>
        </label>`;
    } else if (kind === 'linear' || kind === 'radial') {
      this.stop = Math.min(this.stop, value.stops.length - 1);
      const s = value.stops[this.stop];
      body = `
        <div class="grad-bar" data-bar style="background:${cssFill({ ...value, type: 'linear' })}, ${CHECKER}">
          ${value.stops
            .map((st, i) => `<button class="grad-stop ${i === this.stop ? 'sel' : ''}" data-stop="${i}" style="left:${st.offset * 100}%;background:${rgbaCss(st.color, 1)}" title="Arraste para mover; para baixo para remover"></button>`)
            .join('')}
        </div>
        <p class="hint" style="margin:4px 0 8px">Clique na barra para pôr uma cor. Arraste uma parada para baixo para tirar.</p>
        <div class="prop-grid">
          <label class="field"><span>Cor</span><input type="color" data-k="stopColor" value="${(s.color || '#000000').slice(0, 7)}"></label>
          <label class="field"><span>Posição</span><input type="number" min="0" max="100" data-k="stopOffset" value="${Math.round(s.offset * 100)}"></label>
        </div>
        <label class="field wide" style="display:block;margin-top:8px"><span>Alfa da parada (%)</span>
          <div class="range-row"><input type="range" min="0" max="100" data-k="stopAlpha" value="${Math.round((s.alpha ?? 1) * 100)}"><input type="number" min="0" max="100" data-k="stopAlpha" value="${Math.round((s.alpha ?? 1) * 100)}"></div>
        </label>
        <p class="hint" style="margin-top:8px">Para mover, girar ou esticar o gradiente na forma, use a ferramenta <b>Transformar gradiente (F)</b>.</p>`;
    } else {
      body = `<p class="hint">Sem ${isFill ? 'preenchimento' : 'traço'}.</p>`;
    }

    const swatches = ed.swatches
      .map((f, i) => `<button class="swatch-cell" data-sw="${i}" title="${esc(isGradient(f) ? `Gradiente ${f.type === 'radial' ? 'radial' : 'linear'}` : f)}" style="background:${layerOf(f)}, ${CHECKER}"></button>`)
      .join('');

    this.root.innerHTML = `
      <section class="prop-section">
        <div class="seg">
          <button data-target="fill" class="${isFill ? 'on' : ''}">Preenchimento</button>
          <button data-target="stroke" class="${isFill ? '' : 'on'}">Traço</button>
        </div>
        <div class="color-preview" style="background:${layerOf(value)}, ${CHECKER}"></div>
        <p class="hint" style="margin:0 0 8px">${cur.fromSelection ? 'Editando a forma selecionada.' : 'Cor da ferramenta (vale para o próximo desenho).'}</p>
        <label class="field wide" style="margin-bottom:10px"><span style="flex:1">Tipo</span>
          <select data-k="kind" style="flex:0 0 130px">
            <option value="none">Nenhum</option><option value="solid">Sólido</option>
            ${isFill || cur.lineSelected ? '<option value="linear">Gradiente linear</option><option value="radial">Gradiente radial</option>' : ''}
          </select></label>
        ${body}
      </section>
      <section class="prop-section">
        <h3>Amostras</h3>
        <div class="swatch-grid">${swatches}<button class="swatch-cell add" data-add title="Guardar a cor atual nas amostras">+</button></div>
        <p class="hint" style="margin-top:6px">Clique para usar; clique direito para remover. As amostras ficam salvas no arquivo.</p>
      </section>`;
    this.root.querySelector('[data-k="kind"]').value = kind;
    this.bind(value, kind);
  }

  bind(value, kind) {
    const q = (s) => this.root.querySelector(s);
    const qa = (s) => this.root.querySelectorAll(s);
    qa('[data-target]').forEach((b) =>
      b.addEventListener('click', () => {
        this.target = b.dataset.target;
        this.render();
      }),
    );
    q('[data-k="kind"]').addEventListener('change', (e) => {
      const k = e.target.value;
      const base = isGradient(value) ? value.stops[0].color : value || (this.target === 'fill' ? this.editor.style.fill : this.editor.style.stroke);
      const solid = typeof base === 'string' ? base.slice(0, 7) : base?.stops?.[0]?.color || '#000000';
      if (k === 'none') return this.apply(null);
      if (k === 'solid') return this.apply(solid);
      const stops = isGradient(value)
        ? value.stops
        : [
            { offset: 0, color: solid, alpha: 1 },
            { offset: 1, color: '#ffffff', alpha: 1 },
          ];
      this.apply({ type: k, stops: structuredClone(stops) });
    });

    // sólido
    const sync = (k, v) => qa(`[data-k="${k}"]`).forEach((i) => (i.value = v));
    const solidParts = () => {
      const [r, g, b] = hexToRgba(q('[data-k="color"]').value);
      const a = Math.round((Number(q('[data-k="alpha"]').value) / 100) * 255);
      return rgbaToHex([r, g, b, a]);
    };
    q('[data-k="color"]')?.addEventListener('change', () => this.apply(solidParts()));
    q('[data-k="hex"]')?.addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (!/^#?[0-9a-f]{6}$/i.test(v)) return this.render();
      q('[data-k="color"]').value = v.startsWith('#') ? v : `#${v}`;
      this.apply(solidParts());
    });
    qa('[data-k="alpha"]').forEach((i) => {
      i.addEventListener('input', () => sync('alpha', i.value));
      i.addEventListener('change', () => this.apply(solidParts()));
    });

    if (kind !== 'linear' && kind !== 'radial') return this.bindSwatches();

    // gradiente
    const grad = structuredClone(value);
    const commit = () => this.apply({ type: grad.type, stops: grad.stops });
    const st = () => grad.stops[this.stop];
    q('[data-k="stopColor"]').addEventListener('change', (e) => {
      st().color = e.target.value;
      commit();
    });
    q('[data-k="stopOffset"]').addEventListener('change', (e) => {
      st().offset = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
      commit();
    });
    qa('[data-k="stopAlpha"]').forEach((i) => {
      i.addEventListener('input', () => sync('stopAlpha', i.value));
      i.addEventListener('change', () => {
        st().alpha = Math.max(0, Math.min(100, Number(i.value) || 0)) / 100;
        commit();
      });
    });

    const bar = q('[data-bar]');
    const paintBar = () => (bar.style.background = `${cssFill({ ...grad, type: 'linear' })}, ${CHECKER}`);
    bar.addEventListener('pointerdown', (e) => {
      if (e.target !== bar) return;
      // nova parada com a cor que o gradiente já tem nesse ponto
      const r = bar.getBoundingClientRect();
      const off = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const sorted = [...grad.stops].sort((a, b) => a.offset - b.offset);
      const right = sorted.find((s) => s.offset >= off) || sorted[sorted.length - 1];
      const left = [...sorted].reverse().find((s) => s.offset <= off) || sorted[0];
      const t = right.offset === left.offset ? 0 : (off - left.offset) / (right.offset - left.offset);
      grad.stops.push({ offset: off, color: lerpHex(left.color, right.color, t), alpha: (left.alpha ?? 1) + ((right.alpha ?? 1) - (left.alpha ?? 1)) * t });
      this.stop = grad.stops.length - 1;
      commit();
    });
    qa('[data-stop]').forEach((m) =>
      m.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const i = Number(m.dataset.stop);
        this.stop = i;
        qa('[data-stop]').forEach((x) => x.classList.toggle('sel', x === m));
        m.setPointerCapture(e.pointerId);
        const r = bar.getBoundingClientRect();
        const y0 = e.clientY;
        let moved = false, remove = false;
        this.dragging = true;
        const move = (ev) => {
          moved = true;
          grad.stops[i].offset = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
          remove = grad.stops.length > 2 && ev.clientY - y0 > 36;
          m.style.left = `${grad.stops[i].offset * 100}%`;
          m.style.opacity = remove ? 0.3 : 1;
          paintBar();
        };
        const up = () => {
          m.removeEventListener('pointermove', move);
          m.removeEventListener('pointerup', up);
          this.dragging = false;
          if (remove) {
            grad.stops.splice(i, 1);
            this.stop = 0;
          }
          if (moved) commit();
          else this.render();
        };
        m.addEventListener('pointermove', move);
        m.addEventListener('pointerup', up);
      }),
    );
    this.bindSwatches();
  }

  bindSwatches() {
    const ed = this.editor;
    this.root.querySelectorAll('[data-sw]').forEach((b) => {
      const f = ed.swatches[Number(b.dataset.sw)];
      b.addEventListener('click', () => {
        if (this.target === 'stroke' && isGradient(f) && !this.current().lineSelected) return ed.toast('Gradiente no traço vale para linhas: selecione uma linha primeiro.');
        this.apply(structuredClone(f));
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [{ label: 'Remover amostra', run: () => ed.removeSwatch(Number(b.dataset.sw)) }]);
      });
    });
    this.root.querySelector('[data-add]').addEventListener('click', () => {
      const v = this.current()[this.target];
      if (!v) return ed.toast('Escolha uma cor antes de guardar.');
      ed.addSwatch(v);
    });
  }
}
