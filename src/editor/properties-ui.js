// Painel de propriedades: muda conforme o que está selecionado.
// Forma → posição, cor e traço. Instância → símbolo, comportamento, loop e efeito de cor.
// Nada selecionado → documento, keyframe atual (tween) e ferramenta.

import { esc } from './ui-kit.js';
import { SYMBOL_TYPES, SOUND_SYNC, LABEL_TYPES } from '../model/document.js';
import { EASE_LABELS, EASES, applyEase } from '../player/ease.js';
import { BUILTIN_PRESETS } from './presets.js';
import { solidOf } from './tools-paint.js';
import { buildRig, refreshRig } from './rig-ui.js';
import { TOOL_NAMES_FINAL, TOOL_OPTIONS_FINAL, buildFinal, fillFinal, finalSig } from './properties-final.js';

const fmt = (v) => (Math.round(v * 10) / 10).toString();
const TOOL_NAMES = {
  select: 'Seleção',
  rect: 'Retângulo',
  oval: 'Oval',
  line: 'Linha',
  pencil: 'Lápis',
  camera: 'Câmera',
  brush: 'Pincel',
  bucket: 'Balde de tinta',
  eraser: 'Borracha',
  eyedropper: 'Conta-gotas',
  gradient: 'Transformar gradiente',
  hand: 'Mão',
  zoom: 'Zoom',
};

const optRange = (key, min, max, label) => `
  <label class="field wide" style="display:block"><span>${label}</span>
    <div class="range-row"><input type="range" min="${min}" max="${max}" data-o="${key}"><input type="number" min="${min}" max="${max}" data-o="${key}"></div>
  </label>`;

const TOOL_OPTIONS = {
  brush: `${optRange('brush.size', 1, 200, 'Tamanho (px)')}
    <label class="field wide" style="margin:6px 0"><input type="checkbox" data-o="brush.pressure"><span style="flex:1">Usar pressão da caneta</span></label>
    ${optRange('brush.smoothing', 0, 100, 'Estabilizar')}
    <p class="hint">Pinta com a cor de preenchimento. Estabilizar tira a tremedeira: a linha tracejada é a corda que puxa o traço. O que aparece enquanto você desenha é o traço final. Alt+clique pega a cor.</p>`,
  eraser: `${optRange('eraser.size', 2, 200, 'Tamanho (px na tela)')}
    <label class="field wide" style="margin-top:6px"><span style="flex:1">Modo</span>
      <select data-o="eraser.mode" style="flex:0 0 140px"><option value="normal">Normal</option><option value="fills">Só preenchimentos</option><option value="lines">Só linhas</option></select></label>
    <label class="field wide" style="margin-top:6px"><input type="checkbox" data-o="eraser.allLayers"><span style="flex:1">Apagar em todas as camadas destravadas</span></label>
    <p class="hint" style="margin-top:6px">Sem essa opção, a borracha só apaga na camada ativa.</p>`,
  bucket: `<label class="field wide"><span style="flex:1">Fechar lacunas</span>
      <select data-o="bucket.gap" style="flex:0 0 140px"><option value="none">Não fechar</option><option value="small">Pequenas</option><option value="medium">Médias</option><option value="large">Grandes</option></select></label>
    <p class="hint" style="margin-top:6px">Clique dentro de uma forma para trocar a cor, ou numa área cercada por linhas para criar um preenchimento por baixo delas. Alt+clique pega a cor.</p>`,
  eyedropper: '<p class="hint">Clique num preenchimento para copiar a cor; numa linha, copia o traço; em qualquer outro ponto, a cor do pixel. Shift+clique manda a cor para o traço. No pincel e no balde, Alt+clique faz o mesmo sem trocar de ferramenta.</p>',
  camera: '<p class="hint">Arraste no palco para mover a câmera. Zoom, giro e tom de cor ficam na seção Câmera.</p>',
  gradient: '<p class="hint">Selecione uma forma com gradiente. Arraste o centro para mover, o quadrado para esticar, o círculo de cima para girar e, no radial, o círculo da diagonal para o tamanho e o triângulo para o foco.</p>',
};

Object.assign(TOOL_NAMES, TOOL_NAMES_FINAL);
Object.assign(TOOL_OPTIONS, TOOL_OPTIONS_FINAL);

const STYLE_HTML = `
  <div class="prop-grid">
    <label class="field wide"><input type="checkbox" data-s="fillOn"><span style="flex:1">Preenchimento</span><input type="color" data-s="fill"></label>
    <label class="field wide"><input type="checkbox" data-s="strokeOn"><span style="flex:1">Traço</span><input type="color" data-s="stroke"></label>
    <label class="field wide"><span style="flex:1">Espessura do traço</span><input type="number" min="0" max="200" step="0.5" data-s="strokeWidth" style="flex:0 0 70px"></label>
    <button class="btn-flat full" data-a="showColors" style="grid-column:span 2">Alfa, gradientes e amostras…</button>
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
    for (const t of ['selection', 'doc', 'style', 'tool', 'load', 'layers', 'context', 'toolOptions', 'presets', 'camera', 'frameSel', 'rig']) editor.on(t, () => this.render());
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
      mode = `sel:${items.length}:${insts.length}:${i0?.symbolId}:${i0?.behavior}:${i0?.color?.mode}:${items[0].el.type}:${span?.tween?.type}:${(ed.userPresets || []).length}`;
    } else {
      const nextKf = span && ed.activeLayer.frames[ed.activeLayer.frames.indexOf(span) + 1];
      const tw = span?.tween;
      const sig = span ? [span.start, span.duration, tw?.type, tw?.easeType, !!nextKf, span.sound?.id, span.sound?.sync, span.label ? 1 : 0, tw?.hints?.length, tw?.ease, tw?.easeCurve ? JSON.stringify(tw.easeCurve) : ''].join(':') : '-';
      mode = `none:${ed.tool}:${sig}:${ed.activeLayerId}:${ed.activeLayer.type}:${ed.editStack.length}:${!!ed.cameraLayer()}:${ed.doc.library.sounds.length}`;
    }
    // o texto do intervalo selecionado muda com a seleção da timeline
    if (!items.length && ed.hasFrameRange()) mode += `|sel:${JSON.stringify(ed.frameRange())}`;
    mode += `|${finalSig(ed, items)}|${ed.tool === 'bone' ? 'rig' : ''}`;
    if (mode !== this.mode) {
      this.mode = mode;
      this.el.innerHTML = '';
      this.build(items, span);
    }
    this.fill(items, span);
    if (ed.tool === 'bone') refreshRig(this);
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
    if (ed.tool === 'bone') buildRig(this);
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
          <button class="btn-flat" data-a="distributeToKeyframes" title="Cada objeto num keyframe (Ctrl+Shift+K)">Para keyframes</button>
          <button class="btn-flat" data-a="distributeToLayers" title="Cada objeto numa camada (Ctrl+Shift+D)">Para camadas</button>
        </div>`,
      );
      if (items.length === 1) {
        const all = [...BUILTIN_PRESETS, ...(ed.userPresets || [])];
        this.section(
          'Presets de movimento',
          `<div class="prop-grid">
            <label class="field wide"><select data-preset style="flex:1">${all.map((pr) => `<option value="${pr.id}">${esc(pr.name)}${pr.user ? ' (meu)' : ''}</option>`).join('')}</select></label>
            <button class="btn-flat" data-a="applyPreset">Aplicar</button>
            <button class="btn-flat" data-a="savePreset" title="Salva o motion tween deste quadro como preset">Salvar o atual…</button>
          </div>`,
        );
      }
      if (shapes.filter((it) => it.el.path.closed).length >= 2) {
        this.section(
          'Combinar objetos',
          `<div class="prop-grid">
            <button class="btn-flat" data-a="combineUnion">Unir</button>
            <button class="btn-flat" data-a="combineIntersect">Interseção</button>
            <button class="btn-flat" data-a="combinePunch" title="A forma de cima fura as de baixo">Perfurar</button>
            <button class="btn-flat" data-a="combineCrop" title="A forma de cima recorta as de baixo">Recortar</button>
          </div>`,
        );
      }
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
      if (ed.activeLayer.type === 'camera' || ed.tool === 'camera') this.buildCamera();
      if (span) this.buildFrame(span);
      if (span && ed.activeLayer.type !== 'camera' && ed.activeLayer.type !== 'folder') this.buildSound(span);
      const extra = TOOL_OPTIONS[ed.tool] ? `<div style="margin-bottom:10px">${TOOL_OPTIONS[ed.tool]}</div>` : '';
      this.section(`Ferramenta: ${TOOL_NAMES[ed.tool]}`, extra + STYLE_HTML);
      this.section(
        'Atalhos',
        `<div class="shortcut-list">
          <span class="kbd">F5</span><span>Inserir quadro</span>
          <span class="kbd">F6</span><span>Keyframe (copia o anterior)</span>
          <span class="kbd">F7</span><span>Keyframe vazio</span>
          <span class="kbd">Shift+F5</span><span>Remover quadro</span>
          <span class="kbd">Shift+F6</span><span>Limpar keyframe</span>
          <span class="kbd">B K E I F</span><span>Pincel, balde, borracha, conta-gotas, gradiente</span>
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
    buildFinal(this, items, span);
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
    const layer = ed.activeLayer;
    const idx = layer.frames.indexOf(span);
    const hasTarget = !!layer.frames[idx + 1];
    const isCam = layer.type === 'camera';
    const sel = ed.hasFrameRange() ? ed.frameRange() : null;
    let html = `<p class="hint" style="margin-bottom:8px">${
      sel
        ? `Intervalo: quadros ${sel.from + 1} a ${sel.to + 1} em ${sel.layerIds.length} camada(s). Clique direito para copiar, inverter ou converter.`
        : `Keyframe no quadro ${span.start + 1} · ${esc(layer.name)} · ${span.duration} ${span.duration === 1 ? 'quadro' : 'quadros'}`
    }</p>
      <div class="prop-grid">
        <label class="field wide"><span style="flex:1">Rótulo</span><input type="text" data-label maxlength="60" style="flex:0 0 120px"></label>
        <label class="field wide"><span style="flex:1">Tipo do rótulo</span>
          <select data-label-type style="flex:0 0 120px">${Object.entries(LABEL_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field wide"><span style="flex:1">Tween</span>
          <select data-tw="type" style="flex:0 0 130px"><option value="">Nenhum</option><option value="classic">Clássico</option>${
            isCam ? '' : '<option value="motion">Movimento</option><option value="shape">Forma</option>'
          }</select></label>
      </div>`;
    if (tw) {
      const easeType = tw.easeType || 'classic';
      // curvinha de um easing (x = tempo, y = quanto já andou)
      const curve = (fn) => {
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          pts.push(`${(2 + t * 36).toFixed(1)},${(26 - Math.max(-0.2, Math.min(1.2, fn(t))) * 22).toFixed(1)}`);
        }
        return `<svg viewBox="0 0 40 30" width="40" height="30" aria-hidden="true"><path d="M2 26H38M2 4V26" stroke="currentColor" stroke-opacity=".25" fill="none"/><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      };
      const isLinear = easeType === 'classic' && !tw.ease;
      const quick = [
        ['linear', 'Constante', EASES.linear],
        ['quadIn', 'Entrada suave (acelera)', EASES.quadIn],
        ['quadOut', 'Saída suave (desacelera)', EASES.quadOut],
        ['quadInOut', 'Suave nos dois', EASES.quadInOut],
      ];
      html += `
        <div class="ease-quick" role="group" aria-label="Easing rápido">
          ${quick.map(([k, l, fn]) => `<button type="button" class="ease-btn ${(k === 'linear' ? isLinear : easeType === k) ? 'on' : ''}" data-ease="${k}" title="${l}">${curve(fn)}</button>`).join('')}
          <div class="ease-now" title="Curva atual deste tween">${curve((t) => applyEase(t, tw))}<span>atual</span></div>
        </div>
        <div class="prop-grid" style="margin-top:6px">
          <label class="field wide"><span style="flex:1">Easing</span>
            <select data-tw="easeType" style="flex:0 0 150px">
              <option value="classic">Clássico (−100 a 100)</option>
              ${Object.entries(EASE_LABELS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
              <option value="custom">Personalizado…</option>
            </select></label>
        </div>
        ${easeType === 'classic' ? range('ease', -100, 100, 'Intensidade (− acelera, + desacelera)').replace(/data-c=/g, 'data-tw=') : ''}
        <button class="btn-flat full" data-a="customEase" style="margin-top:6px">${easeType === 'custom' ? 'Editar a curva do easing…' : 'Desenhar easing personalizado…'}</button>`;
      if (tw.type === 'classic' && !isCam) {
        html += `
        <div class="prop-grid" style="margin-top:6px">
          <label class="field wide"><span style="flex:1">Rotação</span>
            <select data-tw="rotate" style="flex:0 0 110px"><option value="auto">Automática</option><option value="none">Nenhuma</option><option value="cw">Horária</option><option value="ccw">Anti-horária</option></select></label>
          <label class="field wide"><span style="flex:1">Voltas extras</span><input type="number" min="0" max="99" step="1" data-tw="rotations" style="flex:0 0 70px"></label>
          ${layer.guidedBy ? '<label class="field wide"><input type="checkbox" data-tw="orient"><span style="flex:1">Orientar ao caminho do guia</span></label>' : ''}
        </div>`;
      }
      if (tw.type === 'motion') {
        html += `
        <div class="prop-grid" style="margin-top:6px">
          <label class="field wide"><input type="checkbox" data-tw="orient"><span style="flex:1">Orientar ao caminho</span></label>
          <button class="btn-flat" data-a="motionEditor" style="grid-column:span 2">Editor de movimento (curvas)…</button>
        </div>
        <p class="hint" style="margin-top:6px">Mova o objeto em qualquer quadro do trecho para criar keys. Arraste os pontos do caminho no palco para mudar a trajetória.</p>`;
      }
      if (tw.type === 'shape') {
        html += `
        <div class="prop-grid" style="margin-top:6px">
          <button class="btn-flat" data-a="addShapeHint" title="Ctrl+Shift+H">Pôr dica de forma</button>
          <button class="btn-flat" data-a="removeShapeHints">Tirar dicas (${tw.hints?.length || 0})</button>
        </div>
        <p class="hint" style="margin-top:6px">As dicas (a, b, c…) dizem qual ponto vira qual: posicione cada uma na borda da forma aqui e no keyframe de destino.</p>`;
      }
      if (tw.type !== 'motion' && !hasTarget) html += '<p class="hint" style="margin-top:8px;color:#ffb44f">Falta um keyframe depois deste para o tween ter destino (F6 mais à frente).</p>';
    }
    this.section(isCam ? 'Quadro da câmera' : 'Quadro', html);
  }

  buildSound(span) {
    const ed = this.editor;
    const sounds = ed.doc.library.sounds;
    const snd = span.sound;
    let html = `<div class="prop-grid">
        <label class="field wide"><span style="flex:1">Som</span>
          <select data-snd="id" style="flex:0 0 140px"><option value="">Nenhum</option>${sounds.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`;
    if (snd) {
      html += `
        <label class="field wide"><span style="flex:1">Sincronia</span>
          <select data-snd="sync" style="flex:0 0 140px">${Object.entries(SOUND_SYNC).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field wide"><span style="flex:1">Repetir (vezes)</span><input type="number" min="1" max="999" data-snd="loops" style="flex:0 0 70px"></label>
        <label class="field wide"><span style="flex:1">Fade in (s)</span><input type="number" min="0" max="60" step="0.1" data-snd="fadeIn" style="flex:0 0 70px"></label>
        <label class="field wide"><span style="flex:1">Fade out (s)</span><input type="number" min="0" max="60" step="0.1" data-snd="fadeOut" style="flex:0 0 70px"></label>`;
    }
    html += '</div>';
    if (snd) {
      html += `${range('volume', 0, 100, 'Volume (%)').replace(/data-c=/g, 'data-snd=')}${range('pan', -100, 100, 'Esquerda / direita').replace(/data-c=/g, 'data-snd=')}
        <p class="hint">Evento: toca até o fim quando a agulha chega. Iniciar: igual, sem repetir se já estiver tocando. Parar: para esse som. Stream: preso à timeline (dá para ouvir arrastando a agulha).</p>`;
    } else {
      html += `<button class="btn-flat full" data-a="importSound" style="margin-top:6px">Importar som…</button>`;
    }
    this.section('Som do quadro', html);
  }

  buildCamera() {
    const ed = this.editor;
    if (ed.editStack.length) return;
    if (!ed.cameraLayer()) {
      this.section('Câmera', '<p class="hint">A cena não tem câmera.</p><button class="btn-flat full" data-a="toggleCamera">Adicionar câmera</button>');
      return;
    }
    this.section(
      'Câmera',
      `${range('zoom', 10, 1000, 'Zoom (%)').replace(/data-c=/g, 'data-cam=')}
       ${range('rotation', -180, 180, 'Giro (°)').replace(/data-c=/g, 'data-cam=')}
       <div class="prop-grid">
         <label class="field"><span>X</span><input type="number" step="1" data-cam="x"></label>
         <label class="field"><span>Y</span><input type="number" step="1" data-cam="y"></label>
         <label class="field wide"><span style="flex:1">Tom de cor</span><input type="color" data-cam="tint"></label>
       </div>
       ${range('tintAmount', 0, 100, 'Quantidade do tom (%)').replace(/data-c=/g, 'data-cam=')}
       <p class="hint">Mudar a câmera num quadro cria keyframe na camada da câmera; ponha tween clássico entre keyframes para animar.</p>
       <button class="btn-flat full" data-a="toggleCamera" style="margin-top:6px">Remover câmera</button>`,
    );
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
        if (k === 'type') {
          const cur = ed.currentSpan()?.tween?.type || '';
          if (inp.value === cur) return;
          return ed.group('Tipo de tween', () => {
            if (cur) ed.removeTween();
            if (inp.value === 'classic') ed.createClassicTween();
            if (inp.value === 'motion') ed.createMotionTween();
            if (inp.value === 'shape') ed.createShapeTween();
          });
        }
        if (k === 'easeType') {
          if (inp.value === 'custom') return this.actions.run('customEase');
          return ed.setTweenProps({ easeType: inp.value === 'classic' ? undefined : inp.value });
        }
        let v = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (k === 'ease') v = Math.max(-100, Math.min(100, Math.round(parseFloat(v) || 0)));
        if (k === 'rotations') v = Math.max(0, Math.min(99, parseInt(v, 10) || 0));
        ed.setTweenProps({ [k]: v });
      });
    });
    q('[data-o]').forEach((inp) => {
      const [tool, key] = inp.dataset.o.split('.');
      inp.addEventListener('input', () => {
        if (inp.type === 'range' || inp.type === 'number') q(`[data-o="${inp.dataset.o}"]`).forEach((o) => o !== inp && (o.value = inp.value));
      });
      inp.addEventListener('change', () => {
        let v = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (inp.type === 'range' || inp.type === 'number') v = Math.max(Number(inp.min), Math.min(Number(inp.max), Number(v) || Number(inp.min)));
        ed.setToolOptions(tool, { [key]: v });
      });
    });
    q('[data-label]').forEach((inp) =>
      inp.addEventListener('change', () => ed.setSpanLabel(inp.value, this.el.querySelector('[data-label-type]')?.value || 'name')),
    );
    q('[data-label-type]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const span = ed.currentSpan();
        if (span?.label) ed.setSpanLabel(span.label, sel.value);
      }),
    );
    q('[data-snd]').forEach((inp) => {
      const k = inp.dataset.snd;
      inp.addEventListener('input', () => {
        if (inp.type === 'range' || inp.type === 'number') q(`[data-snd="${k}"]`).forEach((o) => o !== inp && (o.value = inp.value));
      });
      inp.addEventListener('change', () => {
        if (k === 'id') return ed.setSpanSound(inp.value ? { id: inp.value } : null);
        let v = inp.value;
        if (inp.type === 'number' || inp.type === 'range') v = Math.max(Number(inp.min), Math.min(Number(inp.max), Number(v) || 0));
        if (k === 'loops') v = Math.max(1, Math.round(v));
        ed.setSpanSound({ [k]: v });
      });
    });
    q('[data-cam]').forEach((inp) => {
      const k = inp.dataset.cam;
      inp.addEventListener('input', () => {
        if (inp.type === 'range' || inp.type === 'number') q(`[data-cam="${k}"]`).forEach((o) => o !== inp && (o.value = inp.value));
      });
      inp.addEventListener('change', () => {
        let v = inp.value;
        if (inp.type !== 'color') {
          v = Number(v);
          if (!Number.isFinite(v)) return this.render();
          if (inp.min !== '') v = Math.max(Number(inp.min), Math.min(Number(inp.max), v));
        }
        ed.setCameraProps({ [k]: v });
      });
    });
    // easing com um clique: os quatro mais usados
    q('[data-ease]').forEach((b) => b.addEventListener('click', () => ed.setTweenProps({ easeType: b.dataset.ease === 'linear' ? undefined : b.dataset.ease, ease: 0 })));
    q('[data-a]').forEach((b) =>
      b.addEventListener('click', async () => {
        const a = b.dataset.a;
        if (a === 'applyPreset') {
          const id = this.el.querySelector('[data-preset]').value;
          const pr = [...BUILTIN_PRESETS, ...(ed.userPresets || [])].find((x) => x.id === id);
          if (pr) ed.applyMotionPreset(pr);
          return;
        }
        if (a === 'savePreset') return this.actions.run('saveMotionPreset');
        this.actions.run(a);
      }),
    );
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
      set(this.el.querySelector('[data-tw="type"]'), span.tween?.type || '');
      set(this.el.querySelector('[data-label]'), span.label || '');
      set(this.el.querySelector('[data-label-type]'), span.labelType || 'name');
      if (span.tween) {
        all('[data-tw="ease"]', span.tween.ease || 0);
        set(this.el.querySelector('[data-tw="easeType"]'), span.tween.easeType || 'classic');
        set(this.el.querySelector('[data-tw="rotate"]'), span.tween.rotate || 'auto');
        set(this.el.querySelector('[data-tw="rotations"]'), span.tween.rotations || 0);
        set(this.el.querySelector('[data-tw="orient"]'), !!span.tween.orient);
      }
      const snd = span.sound;
      set(this.el.querySelector('[data-snd="id"]'), snd?.id || '');
      if (snd) {
        for (const k of ['sync', 'loops', 'fadeIn', 'fadeOut']) set(this.el.querySelector(`[data-snd="${k}"]`), snd[k] ?? (k === 'loops' ? 1 : k === 'sync' ? 'event' : 0));
        all('[data-snd="volume"]', snd.volume ?? 100);
        all('[data-snd="pan"]', snd.pan ?? 0);
      }
    }
    const cam = ed.cameraState?.();
    if (cam) {
      for (const k of ['zoom', 'rotation', 'tintAmount']) all(`[data-cam="${k}"]`, fmt(cam[k]));
      set(this.el.querySelector('[data-cam="x"]'), fmt(cam.x));
      set(this.el.querySelector('[data-cam="y"]'), fmt(cam.y));
      set(this.el.querySelector('[data-cam="tint"]'), cam.tint || '#000000');
    }
    for (const k of ['fillOn', 'strokeOn', 'strokeWidth']) set(this.el.querySelector(`[data-s="${k}"]`), style[k]);
    for (const k of ['fill', 'stroke']) set(this.el.querySelector(`[data-s="${k}"]`), solidOf(style[k]).slice(0, 7));
    this.el.querySelectorAll('[data-o]').forEach((inp) => {
      const [tool, key] = inp.dataset.o.split('.');
      set(inp, ed.toolOptions[tool]?.[key]);
    });
    fillFinal(this, items);
  }
}

function angleOf(m) {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}
