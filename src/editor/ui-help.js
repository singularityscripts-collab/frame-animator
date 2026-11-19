// Ajuda na própria interface (Etapa 4 do REFINO): barra de status que explica a ferramenta e os
// modificadores, menu de clique direito no palco, folha de atalhos (tecla ?), arrastar sobre o nome
// de um campo numérico para mudar o valor (scrub) e cursores próprios por ferramenta.

import { esc, showContextMenu } from './ui-kit.js';
import { ACTION_LABELS } from './actions-final.js';
import { ALL_TOOLS } from './toolbar-ui.js';

// ---------- o que cada ferramenta faz (barra de status) ----------
// Cada linha: [ação, explicação]. A primeira é a principal; as outras são modificadores.
const TOOL_HELP = {
  select: [['Clique', 'seleciona'], ['Arraste', 'move ou seleciona com retângulo'], ['Shift', 'soma'], ['Alt', 'tira'], ['Duplo clique', 'entra no símbolo / edita pontos']],
  subselect: [['Clique', 'mostra os pontos'], ['Arraste', 'move pontos e alças'], ['Alt', 'quebra a alça'], ['Delete', 'apaga pontos']],
  lasso: [['Arraste', 'seleciona à mão livre'], ['Shift', 'soma à seleção']],
  transform: [['Arraste as alças', 'escala e gira'], ['Borda', 'inclina'], ['Shift', 'proporção'], ['Alt', 'do centro']],
  threeD: [['Arraste', 'gira em X e Y'], ['Shift', 'move em profundidade']],
  pen: [['Clique', 'ponto reto'], ['Arraste', 'ponto curvo'], ['Enter / duplo clique', 'termina']],
  penAdd: [['Clique no contorno', 'adiciona ponto']],
  penDelete: [['Clique no ponto', 'remove']],
  penConvert: [['Clique', 'curva ↔ canto'], ['Arraste', 'puxa alças']],
  text: [['Clique', 'novo texto'], ['Clique num texto', 'edita'], ['Esc', 'termina']],
  line: [['Arraste', 'desenha a linha'], ['Shift', 'ângulos de 45°']],
  rect: [['Arraste', 'desenha'], ['Shift', 'quadrado'], ['Alt', 'do centro'], ['Ctrl', 'sem encaixe']],
  oval: [['Arraste', 'desenha'], ['Shift', 'círculo'], ['Alt', 'do centro'], ['Ctrl', 'sem encaixe']],
  polystar: [['Arraste', 'desenha do centro'], ['Shift', 'proporção']],
  pencil: [['Arraste', 'desenha a linha'], ['Alt+clique', 'pega a cor do traço']],
  brush: [['Arraste', 'pinta'], ['Alt+clique', 'pega a cor'], ['Caneta', 'a pressão muda a largura']],
  width: [['Arraste numa linha', 'engrossa ou afina'], ['Alt+clique', 'tira o ponto']],
  bucket: [['Clique', 'pinta a forma ou a área fechada'], ['Alt+clique', 'pega a cor']],
  eraser: [['Arraste', 'apaga na camada ativa']],
  eyedropper: [['Clique', 'pega a cor do preenchimento'], ['Shift+clique', 'pega para o traço']],
  gradient: [['Clique', 'escolhe a forma'], ['Arraste as alças', 'move, estica e gira'], ['Shift', 'passos de 15°']],
  camera: [['Arraste', 'move a câmera']],
  hand: [['Arraste', 'move a vista'], ['Espaço', 'mão rápida em qualquer ferramenta']],
  rotateView: [['Arraste', 'gira a vista'], ['Shift', 'passos de 15°'], ['Duplo clique', 'volta para 0°']],
  zoom: [['Clique', 'aproxima'], ['Alt+clique', 'afasta'], ['Ctrl+roda', 'zoom em qualquer ferramenta']],
  warp: [['Clique', 'põe pino'], ['Arraste o pino', 'deforma'], ['Alt+clique', 'tira o pino']],
};
const BONE_HELP = {
  edit: [['Arraste', 'desenha osso'], ['Da ponta', 'continua a cadeia'], ['Alt+arraste na junta', 'move'], ['Ctrl+clique', 'prende/solta a parte'], ['Delete', 'apaga'], ['M', 'Posar']],
  pose: [['Arraste', 'posa (IK)'], ['Ctrl', 'gira só o osso (FK)'], ['Quadrado', 'move tudo'], ['Duplo clique na junta', 'fixa'], ['M', 'Editar rig']],
};

const toolLabel = (id) => ALL_TOOLS.find((t) => t.id === id)?.label || id;
const toolKey = (id) => ALL_TOOLS.find((t) => t.id === id)?.key || '';

/**
 * Barra embaixo do palco: ferramenta e o que cada ação faz (à esquerda); posição do cursor,
 * seleção e zoom (à direita). Uma ferramenta pode trocar o texto por um mais específico
 * (stage.statusHint, por exemplo ao passar o mouse numa alça).
 */
export function installStatusBar(editor, stage) {
  const bar = document.createElement('div');
  bar.id = 'status-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<div class="sb-tool"></div><div class="sb-help"></div><div class="sb-info"></div>';
  document.getElementById('stage-area').appendChild(bar);
  const toolEl = bar.querySelector('.sb-tool');
  const helpEl = bar.querySelector('.sb-help');
  const infoEl = bar.querySelector('.sb-info');
  let lastHelp = '';
  const renderHelp = () => {
    const id = editor.tool;
    const items = stage.statusHint || (id === 'bone' ? BONE_HELP[editor.rigMode?.() || 'edit'] : TOOL_HELP[id]) || [];
    const html = items.map(([k, v]) => `<span class="sb-item"><b>${esc(k)}</b> ${esc(v)}</span>`).join('');
    const key = toolKey(id);
    const toolHtml = `${esc(toolLabel(id))}${key ? ` <kbd>${esc(key)}</kbd>` : ''}${id === 'bone' ? ` <span class="sb-mode sb-${editor.rigMode?.()}">${editor.rigMode?.() === 'pose' ? 'Posar' : 'Editar rig'}</span>` : ''}`;
    if (html + toolHtml === lastHelp) return;
    lastHelp = html + toolHtml;
    toolEl.innerHTML = toolHtml;
    helpEl.innerHTML = html;
  };
  const renderInfo = () => {
    const p = stage.lastPointer;
    const n = editor.selection.size;
    const parts = [];
    if (p) parts.push(`x ${Math.round(p.wx)}  y ${Math.round(p.wy)}`);
    if (n) parts.push(`${n} ${n === 1 ? 'objeto selecionado' : 'objetos selecionados'}`);
    parts.push(`${Math.round(stage.view.zoom * 100)}%`);
    infoEl.textContent = parts.join('   ·   ');
  };
  for (const t of ['tool', 'rig', 'load']) editor.on(t, () => {
    stage.statusHint = null;
    renderHelp();
  });
  editor.on('selection', renderInfo);
  editor.on('view', renderInfo);
  let raf = 0;
  stage.canvas.addEventListener('pointermove', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderHelp();
      renderInfo();
    });
  });
  stage.canvas.addEventListener('pointerleave', () => {
    stage.lastPointer = null;
    renderInfo();
  });
  renderHelp();
  renderInfo();
  return { refresh: renderHelp };
}

// ---------- menu de clique direito no palco ----------
export function installStageMenu(editor, stage, actions) {
  const canvas = stage.canvas;
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (stage.active) return;
    const ev = stage.makeEvent(e);
    const hit = stage.hitTest(ev.wx, ev.wy);
    if (hit && !editor.selection.has(hit.el.id)) editor.setSelection([hit.el.id]);
    const items = editor.selectedItems();
    const run = (id) => () => actions.run(id);
    const k = (id) => actions.keysOf(id)[0] || '';
    const el = items.length === 1 ? items[0].el : null;
    if (items.length) {
      showContextMenu(e.clientX, e.clientY, [
        ...(el?.type === 'instance' ? [{ label: 'Editar símbolo', hint: k('editSymbol'), run: run('editSymbol') }, '-'] : []),
        ...(el?.type === 'shape' ? [{ label: 'Editar pontos', hint: 'A', run: () => editor.setTool('subselect') }, '-'] : []),
        { label: 'Recortar', hint: k('cut'), run: run('cut') },
        { label: 'Copiar', hint: k('copy'), run: run('copy') },
        { label: 'Colar', hint: k('paste'), run: run('paste'), disabled: !editor.clipboard },
        { label: 'Duplicar', hint: k('duplicate'), run: run('duplicate') },
        { label: 'Apagar', hint: k('delete'), run: run('delete') },
        ...(el?.type === 'shape' ? [{ label: 'Selecionar mesma cor', hint: k('selectSameColor'), run: run('selectSameColor') }] : []),
        ...(items.some((it) => it.el.type === 'shape')
          ? [{ label: items.every((it) => it.el.hidden) ? 'Mostrar forma neste quadro' : 'Esconder forma neste quadro', hint: k('toggleHideShape'), run: run('toggleHideShape') }]
          : []),
        ...(editor.tool === 'subselect' && editor.pointSel?.size
          ? [
              '-',
              { label: 'Pontos pontudos', hint: k('pointsSharp'), run: run('pointsSharp') },
              { label: 'Pontos suaves', hint: k('pointsSmooth'), run: run('pointsSmooth') },
              { label: 'Separar no ponto', hint: k('pointsSplit'), run: run('pointsSplit') },
              { label: 'Soldar pontas', hint: k('pointsWeld'), run: run('pointsWeld'), disabled: editor.pointSel.size !== 2 },
            ]
          : []),
        '-',
        { label: 'Converter em símbolo…', hint: k('convertToSymbol'), run: run('convertToSymbol') },
        { label: 'Separar', hint: k('breakApart'), run: run('breakApart') },
        { label: 'Distribuir para camadas', hint: k('distributeToLayers'), run: run('distributeToLayers'), disabled: items.length < 2 },
        '-',
        { label: 'Trazer para a frente', hint: k('arrangeFront'), run: run('arrangeFront') },
        { label: 'Enviar para trás', hint: k('arrangeBack'), run: run('arrangeBack') },
        '-',
        { label: 'Criar motion tween', run: run('createMotionTween'), disabled: items.length !== 1 },
        ...(items.some((it) => (it.src || it.el).bone || (it.src || it.el).skin) ? [{ label: 'Soltar do osso', run: run('unbindBone') }] : []),
      ]);
      return;
    }
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Colar', hint: k('paste'), run: run('paste'), disabled: !editor.clipboard },
      { label: 'Colar no lugar', hint: k('pasteInPlace'), run: run('pasteInPlace'), disabled: !editor.clipboard },
      { label: 'Selecionar tudo', hint: k('selectAll'), run: run('selectAll') },
      '-',
      { label: 'Ajustar à janela', hint: k('zoomFit'), run: run('zoomFit') },
      { label: 'Zoom 100%', hint: k('zoom100'), run: run('zoom100') },
      '-',
      { label: 'Réguas', run: run('toggleRulers') },
      { label: 'Grade', run: run('toggleGrid') },
      { label: 'Guias', run: run('toggleGuides') },
      '-',
      { label: 'Propriedades do documento', run: () => {
        editor.deselect();
        actions.run('showProperties');
      } },
    ]);
  });
}

// ---------- folha de atalhos (tecla ?) ----------
const KEY_NAMES = { Left: '←', Right: '→', Up: '↑', Down: '↓', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', Backspace: '⌫', Enter: 'Enter', Space: 'Espaço' };
export const prettyKey = (k) => k.split('+').map((p) => KEY_NAMES[p] || p).join('+');
const GROUPS = [
  ['Arquivo', /^(new|open|save|saveAs|export|publish|import|testScene)/],
  ['Editar', /^(undo|redo|cut|copy|paste|duplicate|delete|selectAll|selectSameColor|deselect|escape|findReplace)$/],
  ['Ferramentas', /^tool/],
  ['Timeline', /(Frame|Keyframe|Tween|Play|Loop|Onion|Layer|Range|togglePlay|Multi|Scene)/],
  ['Objetos', /^(arrange|nudge|align|distribute|match|combine|convertToSymbol|newSymbol|editSymbol|breakApart|optimize|trace)/],
  ['Vista', /^(zoom|toggleRulers|toggleGrid|toggleGuides|resetRotation|snap)/],
];

export function openShortcutSheet(actions) {
  if (document.querySelector('.ks-sheet')) return;
  const ids = Object.keys(actions.defs).filter((id) => actions.keysOf(id).length && ACTION_LABELS[id]);
  const groups = GROUPS.map(([name]) => ({ name, items: [] }));
  const other = { name: 'Outros', items: [] };
  for (const id of ids) {
    const gi = GROUPS.findIndex(([, re]) => re.test(id));
    (gi >= 0 ? groups[gi] : other).items.push(id);
  }
  const all = [...groups, other].filter((g) => g.items.length);
  const wrap = document.createElement('div');
  wrap.className = 'ks-sheet';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'Atalhos de teclado');
  wrap.innerHTML = `
    <div class="ks-card">
      <header><h2>Atalhos de teclado</h2><input type="search" placeholder="Procurar…" aria-label="Procurar atalho">
        <button class="ks-edit btn-flat" title="Trocar os atalhos">Personalizar…</button><button class="ks-close" aria-label="Fechar" title="Fechar (Esc)">×</button></header>
      <div class="ks-cols">${all
        .map(
          (g) => `<section><h3>${esc(g.name)}</h3>${g.items
            .map((id) => `<div class="ks-line"><span>${esc(ACTION_LABELS[id])}</span><span class="ks-keys">${actions.keysOf(id).map((k) => `<kbd>${esc(prettyKey(k))}</kbd>`).join(' ')}</span></div>`)
            .join('')}</section>`,
        )
        .join('')}
        <section><h3>No palco e na timeline</h3>
          <div class="ks-line"><span>Mão (segurar)</span><span class="ks-keys"><kbd>Espaço</kbd></span></div>
          <div class="ks-line"><span>Zoom no palco</span><span class="ks-keys"><kbd>Ctrl+roda</kbd></span></div>
          <div class="ks-line"><span>Zoom da timeline</span><span class="ks-keys"><kbd>Ctrl+roda</kbd></span></div>
          <div class="ks-line"><span>Intervalo de quadros</span><span class="ks-keys"><kbd>Shift+clique</kbd></span></div>
          <div class="ks-line"><span>Copiar quadros arrastando</span><span class="ks-keys"><kbd>Alt+arraste</kbd></span></div>
          <div class="ks-line"><span>Mudar um número</span><span class="ks-keys"><kbd>arraste o nome do campo</kbd></span></div>
          <div class="ks-line"><span>Esta folha</span><span class="ks-keys"><kbd>?</kbd> <kbd>F1</kbd></span></div>
        </section>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => {
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 140);
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  wrap.addEventListener('pointerdown', (e) => e.target === wrap && close());
  wrap.querySelector('.ks-close').addEventListener('click', close);
  wrap.querySelector('.ks-edit').addEventListener('click', () => {
    close();
    actions.run('keyboardShortcuts');
  });
  const search = wrap.querySelector('input');
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    wrap.querySelectorAll('.ks-line').forEach((l) => (l.hidden = !!q && !l.textContent.toLowerCase().includes(q)));
    wrap.querySelectorAll('.ks-cols section').forEach((s) => (s.hidden = ![...s.querySelectorAll('.ks-line')].some((l) => !l.hidden)));
  });
  setTimeout(() => search.focus(), 0);
}

// ---------- scrub: arrastar o nome de um campo numérico muda o valor ----------
/**
 * Em qualquer campo numérico com rótulo (.field > span + input[type=number]): arrastar o rótulo
 * para os lados muda o valor (Shift: 10×, Alt: 0,1×). O documento muda ao vivo e o arraste
 * inteiro vira um passo só de desfazer.
 */
export function enableNumberScrub(editor) {
  const inputOf = (span) => {
    const f = span.closest('.field');
    return f && span.parentElement === f ? f.querySelector('input[type="number"]') : null;
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const span = e.target.closest('.field > span');
    const inp = span && inputOf(span);
    if (!inp || inp.disabled) return;
    e.preventDefault();
    const n0 = editor.history.undoStack.length;
    const step = Number(inp.step) > 0 ? Number(inp.step) : 1;
    const min = inp.min === '' ? -Infinity : Number(inp.min);
    const max = inp.max === '' ? Infinity : Number(inp.max);
    const v0 = Number(inp.value) || 0;
    const x0 = e.clientX;
    let last = v0;
    let moved = false;
    document.body.classList.add('scrubbing');
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const mul = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      let v = v0 + Math.round(dx / 2) * step * mul;
      v = Math.max(min, Math.min(max, v));
      const dec = (String(step * mul).split('.')[1] || '').length;
      v = Number(v.toFixed(Math.min(4, dec)));
      if (v === last) return;
      last = v;
      inp.value = v;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('scrubbing');
      const n = editor.history.undoStack.length - n0;
      if (n > 1) editor.history.squash(n, editor.history.undoStack.at(-1)?.label || 'Ajustar valor');
      if (!moved) inp.focus();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// ---------- cursores por ferramenta ----------
const svgCursor = (body, hx, hy, fallback = 'crosshair') =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`)}") ${hx} ${hy}, ${fallback}`;
// contorno branco grosso por baixo e traço escuro por cima: aparece em qualquer fundo
const twice = (d, extra = '') =>
  `<path d="${d}" fill="none" stroke="#fff" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#111" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
export const TOOL_CURSORS = {
  bucket: svgCursor(`${twice('M5 11 11 5l7 7-6 6z M11 5 9 3 M18 12c1 2 1.5 3.5 1.5 4.5a1.5 1.5 0 0 1-3 0c0-1 .5-2.5 1.5-4.5z')}<circle cx="3" cy="21" r="1.6" fill="#111" stroke="#fff"/>`, 3, 21),
  eyedropper: svgCursor(twice('M3 21l1.5-4.5L14 7l3 3-9.5 9.5z M14 7l2-2a2.1 2.1 0 0 1 3 3l-2 2'), 3, 21, 'copy'),
  pen: svgCursor(twice('M3 21l2-7 9-9 5 5-9 9z M3 21l5-5 M14 5l5 5'), 3, 21),
  pencil: svgCursor(twice('M3 21l1-5L16 4l4 4L8 20z M14 6l4 4'), 3, 21),
  brush: null,
  text: 'text',
};

/** Usa os cursores próprios no lugar da cruz genérica para as ferramentas que têm um. */
export function installToolCursors(editor, stage) {
  const base = stage.setCursor.bind(stage);
  stage.setCursor = (c) => base(c === 'crosshair' && TOOL_CURSORS[editor.tool] ? TOOL_CURSORS[editor.tool] : c);
  for (const [id, c] of Object.entries(TOOL_CURSORS)) if (c && stage.tools[id]) stage.tools[id].cursor = c;
  stage.updateCursor();
}
