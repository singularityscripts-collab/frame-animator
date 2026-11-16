// Seções extras do painel de propriedades (fase final): texto, componentes, bitmap,
// nome de instância, mesclagem, filtros, cache, 3D, pincel de arte/padrão e opções das ferramentas novas.

import { esc } from './ui-kit.js';
import { BLEND_LABELS, FILTER_DEFAULTS, FILTER_LABELS } from '../player/effects.js';
import { FONTS } from '../player/assets.js';
import { clone } from '../model/document.js';

export const TOOL_NAMES_FINAL = {
  subselect: 'Subseleção',
  lasso: 'Laço',
  polystar: 'Polígono / estrela',
  pen: 'Caneta',
  penAdd: 'Adicionar ponto',
  penDelete: 'Remover ponto',
  penConvert: 'Converter ponto',
  text: 'Texto',
  bone: 'Ossos',
  warp: 'Malha de pinos',
  threeD: 'Rotação 3D',
  width: 'Largura',
  transform: 'Transformação livre',
  rotateView: 'Girar a vista',
};

const optRange = (key, min, max, label) => `
  <label class="field wide" style="display:block"><span>${label}</span>
    <div class="range-row"><input type="range" min="${min}" max="${max}" data-o="${key}"><input type="number" min="${min}" max="${max}" data-o="${key}"></div>
  </label>`;
const optSelect = (key, label, opts) => `
  <label class="field wide" style="margin-bottom:6px"><span style="flex:1">${label}</span>
    <select data-o="${key}" style="flex:0 0 150px">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`;

export const TOOL_OPTIONS_FINAL = {
  pencil: `${optSelect('pencil.mode', 'Modo', [['smooth', 'Suavizar'], ['straighten', 'Endireitar'], ['ink', 'Tinta (como foi feito)']])}
    <p class="hint">Endireitar transforma o rabisco em retas e reconhece linha, retângulo e elipse.</p>`,
  lasso: `${optSelect('lasso.mode', 'Modo', [['free', 'Livre'], ['polygon', 'Poligonal']])}
    <p class="hint">Poligonal: clique ponto a ponto e feche no primeiro ponto, com duplo clique ou Enter. Shift soma à seleção.</p>`,
  polystar: `${optSelect('polystar.style', 'Estilo', [['polygon', 'Polígono'], ['star', 'Estrela']])}
    ${optRange('polystar.sides', 3, 32, 'Lados / pontas')}
    ${optRange('polystar.inner', 10, 95, 'Raio interno da estrela (%)')}
    <p class="hint">Arraste a partir do centro. Shift mantém a proporção.</p>`,
  transform: `${optSelect('transform.mode', 'Modo', [['free', 'Escala, rotação e inclinação'], ['distort', 'Distorcer (4 cantos)'], ['envelope', 'Envelope (grade curva)']])}
    <p class="hint">No modo livre, arraste a borda entre as alças para inclinar. Distorcer e envelope deformam os pontos das formas.</p>`,
  pen: '<p class="hint">Clique para pontos retos; clique e arraste para curvas. Feche clicando no primeiro ponto; Enter ou duplo clique termina um caminho aberto.</p>',
  subselect: '<p class="hint">Clique numa forma para ver os pontos. Arraste pontos e alças (Alt quebra a alça suave). Delete apaga os pontos selecionados.</p>',
  penAdd: '<p class="hint">Clique no contorno de uma forma para adicionar um ponto.</p>',
  penDelete: '<p class="hint">Clique num ponto para removê-lo.</p>',
  penConvert: '<p class="hint">Clique num ponto curvo para virar canto; arraste num canto para puxar alças.</p>',
  text: `<p class="hint">Clique no palco para escrever. Clique num texto para editar. O tipo (estático, dinâmico, de entrada) fica nas propriedades do texto.</p>`,
  bone: '<p class="hint">Arraste de um objeto para outro para ligar com um osso; arraste da ponta de um osso para continuar a cadeia. Desenhando os ossos dentro de uma forma (linha, braço), ela dobra junto com eles. Depois, arraste um objeto preso ou a forma para posar (cinemática inversa; Alt+arrastar na forma cria um osso novo): cada pose vira um keyframe; ligue o tween clássico entre poses.</p>',
  warp: '<p class="hint">Clique numa forma ou imagem para pôr pinos; arraste um pino para deformar. Alt+clique tira o pino.</p>',
  threeD: '<p class="hint">Arraste uma instância para girar em X e Y. Shift+arrastar move em Z (profundidade). A perspectiva fica nas propriedades do documento.</p>',
  width: '<p class="hint">Arraste numa linha para engrossar ou afinar naquele ponto. Alt+clique tira o ponto de largura.</p>',
  rotateView: '<p class="hint">Arraste para girar a vista do palco (Shift = passos de 15°). Duplo clique volta para 0°.</p>',
};

/** Assinatura que força reconstruir o painel quando estas seções mudam de forma. */
export function finalSig(ed, items) {
  const el = items[0]?.el;
  if (!el) return `${ed.tool}`;
  return [el.type, el.kind, (el.filters || []).map((f) => f.type).join(','), el.brush?.type, el.behavior, items.length, el.bone ? 1 : 0, el.warp?.pins?.length || 0].join(':');
}

const num = (k, label, min, max, step = 1) =>
  `<label class="field"><span title="${label}">${label}</span><input type="number" min="${min}" max="${max}" step="${step}" data-f="${k}"></label>`;

export function buildFinal(ui, items) {
  const ed = ui.editor;
  if (!items.length) {
    if (!ed.editStack.length) {
      ui.section(
        'Publicação e 3D',
        `<div class="prop-grid">
          ${num('doc.perspective.angle', 'Persp.°', 1, 179)}
          <button class="btn-flat" data-a="publishSettings">Publicação…</button>
        </div>
        <p class="hint">Ângulo de perspectiva usado pela rotação 3D dos movie clips.</p>`,
      );
    }
    return;
  }
  const single = items.length === 1 ? items[0].el : null;
  const shapes = items.filter((it) => it.el.type === 'shape');
  const insts = items.filter((it) => it.el.type === 'instance');

  if (single && (single.type === 'instance' || single.type === 'text' || single.type === 'component')) {
    ui.section(
      'Nome da instância',
      `<label class="field wide"><input type="text" data-f="name" placeholder="ex.: personagem" maxlength="60" style="flex:1"></label>
       <p class="hint">Os scripts acham o objeto por este nome: <code>root.getChild("nome")</code>.</p>`,
    );
  }

  if (single?.type === 'text') {
    ui.section(
      'Texto',
      `<div class="prop-grid">
        <label class="field wide"><span style="flex:1">Tipo</span><select data-f="kind" style="flex:0 0 130px">
          <option value="static">Estático</option><option value="dynamic">Dinâmico</option><option value="input">De entrada</option></select></label>
        <label class="field wide"><span style="flex:1">Fonte</span><select data-f="font" style="flex:0 0 150px">${FONTS.map((f) => `<option>${esc(f)}</option>`).join('')}</select></label>
        ${num('size', 'Tam.', 4, 400)}
        <label class="field"><span>Cor</span><input type="color" data-f="color"></label>
        <label class="field"><input type="checkbox" data-f="bold"><span>Negrito</span></label>
        <label class="field"><input type="checkbox" data-f="italic"><span>Itálico</span></label>
        <label class="field wide"><span style="flex:1">Alinhar</span><select data-f="align" style="flex:0 0 130px">
          <option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label>
        ${num('letterSpacing', 'Espaço', -20, 100, 0.5)}
        ${num('lineHeight', 'Linha', 0.5, 4, 0.05)}
        ${num('width', 'Larg.', 0, 4000)}
        <label class="field wide" style="grid-column:span 2"><textarea data-f="text" rows="3" style="flex:1;resize:vertical"></textarea></label>
        <button class="btn-flat" data-a="breakApart" style="grid-column:span 2">Separar em letras / formas (Ctrl+B)</button>
      </div>
      <p class="hint">Largura 0 = cresce sozinho. Dinâmico pode ser trocado por script (<code>.text</code>); de entrada vira campo editável no teste e no HTML5.</p>`,
    );
  }

  if (single?.type === 'component') {
    const p = single.props || {};
    let body = '';
    if (single.kind === 'button') body = `<label class="field wide"><span style="flex:1">Rótulo</span><input type="text" data-f="props.label" style="flex:0 0 150px"></label>`;
    if (single.kind === 'list') body = `<label class="field wide" style="display:block"><span>Itens (um por linha)</span><textarea data-f="props.items" rows="4" style="width:100%;resize:vertical"></textarea></label>`;
    if (single.kind === 'video')
      body = `<label class="field wide"><span style="flex:1">Arquivo</span><span class="hint" style="flex:0 0 120px;overflow:hidden;text-overflow:ellipsis">${esc(p.name || 'nenhum')}</span></label>
        <button class="btn-flat full" data-a="pickVideo">Escolher vídeo…</button>
        <label class="field"><input type="checkbox" data-f="props.autoplay"><span>Tocar sozinho</span></label>
        <label class="field"><input type="checkbox" data-f="props.loop"><span>Repetir</span></label>`;
    ui.section(
      `Componente: ${{ button: 'Botão', list: 'Lista', video: 'Vídeo' }[single.kind]}`,
      `<div class="prop-grid">${num('w', 'L', 10, 4000)}${num('h', 'A', 10, 4000)}</div>${body}
       <p class="hint">Funciona no teste e no HTML5. Use <code>root.getChild("${esc(single.name || 'nome')}").on("click", …)</code> nos scripts.</p>`,
    );
  }

  if (single?.type === 'bitmap') {
    const bmp = ed.doc.library.bitmaps.find((b) => b.id === single.assetId);
    ui.section(
      'Imagem',
      `<p class="hint">${esc(bmp?.name || '?')} · ${bmp?.w || 0}×${bmp?.h || 0} px</p>
       <div class="prop-grid">
        <button class="btn-flat" data-a="traceBitmap">Vetorizar…</button>
        <button class="btn-flat" data-a="breakApart" title="Vira uma forma preenchida com a imagem">Separar (Ctrl+B)</button>
       </div>`,
    );
  }

  if (shapes.length && shapes.some((it) => it.el.stroke)) {
    const syms = ed.doc.library.items;
    const b = shapes[0].el.brush || {};
    ui.section(
      'Pincel do traço',
      `<div class="prop-grid">
        <label class="field wide"><span style="flex:1">Tipo</span><select data-f="brush.type" style="flex:0 0 150px">
          <option value="">Traço comum</option><option value="art">Arte (estica o desenho)</option><option value="pattern">Padrão (repete o desenho)</option></select></label>
        ${
          b.type
            ? `<label class="field wide"><span style="flex:1">Desenho</span><select data-f="brush.symbolId" style="flex:0 0 150px">${syms.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
               ${num('brush.scale', 'Esc.%', 5, 1000)}${b.type === 'pattern' ? num('brush.spacing', 'Esp.%', 0, 500) : ''}`
            : ''
        }
        ${shapes.some((it) => it.el.widthProfile?.length) ? '<button class="btn-flat" data-a="clearWidth" style="grid-column:span 2">Tirar perfil de largura</button>' : ''}
      </div>
      ${b.type && !syms.length ? '<p class="hint">Crie um símbolo com o desenho do pincel primeiro.</p>' : ''}`,
    );
  }

  if (shapes.length || insts.length) {
    const ok = [];
    if (shapes.length === items.length) ok.push('<button class="btn-flat" data-a="optimizeCurves">Otimizar curvas…</button>');
    ok.push('<button class="btn-flat" data-a="breakApart">Separar (Ctrl+B)</button>');
    if (items.some((it) => it.el.warp)) ok.push('<button class="btn-flat" data-a="clearWarp">Tirar pinos</button>');
    if (items.some((it) => it.el.bone)) ok.push('<button class="btn-flat" data-a="unbindBone">Soltar do osso</button>');
    ui.section('Modificar', `<div class="prop-grid">${ok.join('')}</div>`);
  }

  if (insts.length === items.length) {
    const el = insts[0].el;
    const sym = ed.symbol(el.symbolId);
    const mc = el.behavior === 'movieclip' || el.behavior === 'button';
    ui.section(
      'Exibição',
      `<div class="prop-grid">
        <label class="field wide"><span style="flex:1">Mesclagem</span><select data-f="blend" style="flex:0 0 150px">${Object.entries(BLEND_LABELS)
          .map(([k, l]) => `<option value="${k}">${l}</option>`)
          .join('')}</select></label>
        <label class="field wide"><input type="checkbox" data-f="cacheAsBitmap"><span style="flex:1">Cache como bitmap</span></label>
        ${
          mc
            ? `${num('rx', 'Rot. X', -180, 180)}${num('ry', 'Rot. Y', -180, 180)}${num('z', 'Z', -5000, 5000)}
               <button class="btn-flat" data-a="reset3D">Zerar 3D</button>`
            : ''
        }
        <button class="btn-flat" data-a="scale9" style="grid-column:span 2">Escala de 9 fatias${sym?.scale9 ? ' (ligada)' : ''}…</button>
        ${el.behavior === 'graphic' || !el.behavior ? '<button class="btn-flat" data-a="framePicker" style="grid-column:span 2">Seletor de quadro…</button><button class="btn-flat" data-a="lipSync" style="grid-column:span 2">Lip-sync automático…</button>' : ''}
      </div>
      ${mc ? '' : '<p class="hint">Rotação 3D vale para movie clips e botões.</p>'}`,
    );
    const filters = el.filters || [];
    const fHtml = filters
      .map((f, i) => {
        const d = FILTER_DEFAULTS[f.type] || {};
        const fields = Object.keys(d)
          .filter((k) => k !== 'type')
          .map((k) => {
            const key = `filters.${i}.${k}`;
            const v = d[k];
            if (typeof v === 'boolean') return `<label class="field"><input type="checkbox" data-f="${key}"><span>${{ inner: 'Interno', knockout: 'Vazado' }[k] || k}</span></label>`;
            if (typeof v === 'string') return `<label class="field"><span>${{ color: 'Cor', highlight: 'Luz', shadow: 'Sombra' }[k] || k}</span><input type="color" data-f="${key}"></label>`;
            const lim = { distance: [-100, 100], angle: [-360, 360], blur: [0, 100], alpha: [0, 100], strength: [0, 10], brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100], hue: [-180, 180] }[k] || [0, 100];
            const lbl = { distance: 'Dist.', angle: 'Ângulo', blur: 'Desf.', alpha: 'Alfa', strength: 'Força', brightness: 'Brilho', contrast: 'Contr.', saturation: 'Satur.', hue: 'Matiz' }[k] || k;
            return num(key, lbl, lim[0], lim[1], k === 'strength' ? 0.1 : 1);
          })
          .join('');
        return `<div class="filter-box">
          <div class="filter-head"><label class="field"><input type="checkbox" data-f="filters.${i}.enabled"><b>${FILTER_LABELS[f.type]}</b></label>
          <button class="btn-flat" data-fx-del="${i}" title="Tirar filtro">✕</button></div>
          <div class="prop-grid">${fields}</div></div>`;
      })
      .join('');
    ui.section(
      'Filtros',
      `${fHtml || '<p class="hint">Nenhum filtro.</p>'}
       <label class="field wide" style="margin-top:6px"><select data-fx-add style="flex:1"><option value="">Adicionar filtro…</option>${Object.entries(FILTER_LABELS)
         .map(([k, l]) => `<option value="${k}">${l}</option>`)
         .join('')}</select></label>`,
    );
  }
  bindFinal(ui, items);
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function bindFinal(ui) {
  const ed = ui.editor;
  ui.el.querySelectorAll('[data-f]').forEach((inp) => {
    const key = inp.dataset.f;
    inp.addEventListener('change', () => {
      let v = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (inp.type === 'number') {
        v = Number(v);
        if (!Number.isFinite(v)) return ui.render();
        v = Math.max(Number(inp.min), Math.min(Number(inp.max), v));
      }
      if (key.startsWith('doc.')) {
        if (key === 'doc.perspective.angle') ed.setDocProps({ perspective: { ...(ed.doc.perspective || {}), angle: v } });
        return;
      }
      const [head, ...rest] = key.split('.');
      ed.updateSelection('Propriedades', (el) => {
        if (head === 'props') {
          el.props = { ...(el.props || {}) };
          if (rest[0] === 'items') v = String(v).split('\n').map((s) => s.trim()).filter(Boolean);
          el.props[rest[0]] = v;
          return;
        }
        if (head === 'brush') {
          if (el.type !== 'shape' || !el.stroke) return;
          if (rest[0] === 'type') {
            if (!v) return void delete el.brush;
            const sym = ed.doc.library.items[0];
            el.brush = { scale: 100, spacing: 0, symbolId: el.brush?.symbolId || sym?.id || null, ...(el.brush || {}), type: v };
            return;
          }
          el.brush = { ...(el.brush || {}), [rest[0]]: v };
          return;
        }
        if (head === 'filters') {
          const i = Number(rest[0]);
          el.filters = clone(el.filters || []);
          if (el.filters[i]) el.filters[i][rest[1]] = v;
          return;
        }
        if (head === 'name') {
          v = String(v).trim().replace(/[^\w$-]/g, '_');
          if (v) el.name = v;
          else delete el.name;
          return;
        }
        if (head === 'blend' && v === 'normal') return void delete el.blend;
        if (head === 'cacheAsBitmap' && !v) return void delete el.cacheAsBitmap;
        if (el.type === 'text' || head in el || ['rx', 'ry', 'z', 'blend', 'cacheAsBitmap', 'w', 'h'].includes(head)) el[head] = v;
      });
    });
  });
  ui.el.querySelectorAll('[data-fx-add]').forEach((sel) =>
    sel.addEventListener('change', () => {
      const t = sel.value;
      if (!t) return;
      ed.updateSelection('Adicionar filtro', (el) => {
        if (el.type !== 'instance') return;
        el.filters = [...clone(el.filters || []), { ...clone(FILTER_DEFAULTS[t]), enabled: true }];
      });
    }),
  );
  ui.el.querySelectorAll('[data-fx-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.fxDel);
      ed.updateSelection('Tirar filtro', (el) => {
        if (!el.filters) return;
        el.filters = el.filters.filter((_, j) => j !== i);
        if (!el.filters.length) delete el.filters;
      });
    }),
  );
}

export function fillFinal(ui, items) {
  const ed = ui.editor;
  const set = (inp, v) => {
    if (!inp || document.activeElement === inp) return;
    if (inp.type === 'checkbox') inp.checked = !!v;
    else inp.value = v ?? '';
  };
  const el = items[0]?.el;
  ui.el.querySelectorAll('[data-f]').forEach((inp) => {
    const key = inp.dataset.f;
    if (key === 'doc.perspective.angle') return set(inp, ed.doc.perspective?.angle ?? 55);
    if (!el) return;
    let v = getPath(el, key);
    if (key === 'props.items') v = (el.props?.items || []).join('\n');
    if (key.startsWith('filters.') && key.endsWith('.enabled')) v = v !== false;
    if (key === 'blend') v = el.blend || 'normal';
    if (key === 'brush.type') v = el.brush?.type || '';
    if (key === 'rx' || key === 'ry' || key === 'z') v = Math.round(el[key] || 0);
    if (key === 'lineHeight') v = el.lineHeight ?? 1.25;
    if (key === 'letterSpacing') v = el.letterSpacing ?? 0;
    set(inp, v);
  });
}
