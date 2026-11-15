// Registro único de ações: usado pelo teclado, pelo menu do Electron e pelos botões.
// Os atalhos ficam todos aqui (base para torná-los personalizáveis depois).

import { openDialog, esc } from './ui-kit.js';
import { exportDialog } from './export-ui.js';
import { SYMBOL_TYPES } from '../model/document.js';

export function createActions({ editor, stage, io, ui = {} }) {
  const ed = editor;
  let lastType = 'graphic';

  /** Diálogo de nome + tipo (+ registro ao converter). */
  async function symbolDialog(title, name, type, withRegistration) {
    const opt = (v, l, sel) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`;
    const r = await openDialog({
      title,
      body: `
        <label class="dlg-row"><span>Nome</span><input type="text" name="name" value="${esc(name)}" required maxlength="80"></label>
        <label class="dlg-row"><span>Tipo</span><select name="type">${Object.entries(SYMBOL_TYPES).map(([k, l]) => opt(k, l, type)).join('')}</select></label>
        ${
          withRegistration
            ? `<label class="dlg-row"><span>Registro</span><select name="registration">${opt('center', 'Centro', 'center')}${opt('topleft', 'Canto superior esquerdo')}</select></label>
               <p class="dlg-text">Gráfico acompanha a timeline principal (bom para animar quadro a quadro). Movie clip toca sozinho.</p>`
            : ''
        }`,
    });
    if (!r) return null;
    r.name = r.name.trim() || name;
    lastType = r.type;
    return r;
  }

  async function convertToSymbol() {
    if (!ed.selection.size) return ed.toast('Selecione algo no palco para converter em símbolo.');
    const r = await symbolDialog('Converter em símbolo', ed.nextSymbolName(), lastType, true);
    if (r) ed.convertToSymbol(r);
  }

  async function newSymbol() {
    const r = await symbolDialog('Novo símbolo', ed.nextSymbolName(), lastType, false);
    if (r) ed.newSymbol(r);
  }

  async function symbolProperties(id) {
    const sym = ed.symbol(id);
    if (!sym) return;
    const r = await symbolDialog('Propriedades do símbolo', sym.name, sym.type, false);
    if (r && (r.name !== sym.name || r.type !== sym.type)) ed.patchLibrary('items', id, { name: r.name, type: r.type }, 'Propriedades do símbolo');
  }

  function editSymbol() {
    const items = ed.selectedItems();
    if (items.length === 1 && items[0].el.type === 'instance') return ed.enterSymbol(items[0].el.symbolId, items[0]);
    if (ed.editStack.length) return ed.exitSymbol(Infinity);
    ed.toast('Selecione uma instância de símbolo para editar.');
  }

  const defs = {
    // Arquivo
    new: { keys: ['Ctrl+N'], run: () => io.newDoc() },
    open: { keys: ['Ctrl+O'], run: () => io.open() },
    save: { keys: ['Ctrl+S'], run: () => io.save(false) },
    saveAs: { keys: ['Ctrl+Shift+S'], run: () => io.save(true) },
    testScene: { keys: ['Ctrl+Enter'], run: () => io.testScene() },
    exportMedia: { keys: ['Ctrl+Alt+Shift+S'], run: () => exportDialog(ed) },
    // Símbolos e tween
    convertToSymbol: { keys: ['F8'], run: convertToSymbol },
    newSymbol: { keys: ['Ctrl+F8'], run: newSymbol },
    editSymbol: { keys: ['Ctrl+E'], run: editSymbol },
    showLibrary: { keys: ['Ctrl+L'], run: () => ui.showTab?.('library') },
    createClassicTween: { keys: [], run: () => ed.createClassicTween() },
    removeTween: { keys: [], run: () => ed.removeTween() },
    // Editar
    undo: { keys: ['Ctrl+Z'], run: () => ed.undo() },
    redo: { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], run: () => ed.redo() },
    cut: { keys: ['Ctrl+X'], run: () => ed.cut() },
    copy: { keys: ['Ctrl+C'], run: () => ed.copy() },
    paste: { keys: ['Ctrl+V'], run: () => ed.paste(false) },
    pasteInPlace: { keys: ['Ctrl+Shift+V'], run: () => ed.paste(true) },
    duplicate: { keys: ['Ctrl+D'], run: () => ed.duplicate() },
    delete: { keys: ['Delete', 'Backspace'], run: () => ed.deleteSelection() },
    selectAll: { keys: ['Ctrl+A'], run: () => ed.selectAll() },
    deselect: { keys: ['Ctrl+Shift+A'], run: () => ed.deselect() },
    escape: { keys: ['Escape'], run: () => stage.cancelDrag() || ed.deselect() },
    // Modificar
    arrangeFront: { keys: ['Ctrl+Shift+Up'], run: () => ed.arrange('front') },
    arrangeForward: { keys: ['Ctrl+Up'], run: () => ed.arrange('forward') },
    arrangeBackward: { keys: ['Ctrl+Down'], run: () => ed.arrange('backward') },
    arrangeBack: { keys: ['Ctrl+Shift+Down'], run: () => ed.arrange('back') },
    nudgeLeft: { keys: ['Left'], run: () => ed.nudge(-1, 0) },
    nudgeRight: { keys: ['Right'], run: () => ed.nudge(1, 0) },
    nudgeUp: { keys: ['Up'], run: () => ed.nudge(0, -1) },
    nudgeDown: { keys: ['Down'], run: () => ed.nudge(0, 1) },
    nudgeLeft10: { keys: ['Shift+Left'], run: () => ed.nudge(-10, 0) },
    nudgeRight10: { keys: ['Shift+Right'], run: () => ed.nudge(10, 0) },
    nudgeUp10: { keys: ['Shift+Up'], run: () => ed.nudge(0, -10) },
    nudgeDown10: { keys: ['Shift+Down'], run: () => ed.nudge(0, 10) },
    // Exibir
    zoomIn: { keys: ['Ctrl+='], run: () => stage.zoomTo(stage.view.zoom * 1.25) },
    zoomOut: { keys: ['Ctrl+-'], run: () => stage.zoomTo(stage.view.zoom / 1.25) },
    zoom100: { keys: ['Ctrl+1'], run: () => stage.actualSize() },
    zoomFit: { keys: ['Ctrl+0'], run: () => stage.fit() },
    // Controle
    togglePlay: { keys: ['Enter'], run: () => ed.togglePlay() },
    prevFrame: { keys: [','], run: () => ed.prevFrame() },
    nextFrame: { keys: ['.'], run: () => ed.nextFrame() },
    firstFrame: { keys: ['Home'], run: () => ed.firstFrame() },
    lastFrame: { keys: ['End'], run: () => ed.lastFrame() },
    toggleLoop: { keys: [], run: () => ed.setLoop(!ed.loop) },
    toggleOnion: { keys: ['Alt+Shift+O'], run: () => ed.setOnion({ enabled: !ed.onion.enabled }) },
    // Timeline
    insertFrame: { keys: ['F5'], run: () => ed.timelineOp('insertFrame') },
    removeFrame: { keys: ['Shift+F5'], run: () => ed.timelineOp('removeFrame') },
    insertKeyframe: { keys: ['F6'], run: () => ed.timelineOp('insertKeyframe') },
    clearKeyframe: { keys: ['Shift+F6'], run: () => ed.timelineOp('clearKeyframe') },
    insertBlankKeyframe: { keys: ['F7'], run: () => ed.timelineOp('insertBlankKeyframe') },
    newLayer: { keys: [], run: () => ed.addLayer() },
    deleteLayer: { keys: [], run: () => ed.deleteLayer() },
    // Ferramentas
    toolSelect: { keys: ['V'], run: () => ed.setTool('select') },
    toolRect: { keys: ['R'], run: () => ed.setTool('rect') },
    toolOval: { keys: ['O'], run: () => ed.setTool('oval') },
    toolLine: { keys: ['N'], run: () => ed.setTool('line') },
    toolPencil: { keys: ['Y'], run: () => ed.setTool('pencil') },
    toolHand: { keys: ['H'], run: () => ed.setTool('hand') },
    toolZoom: { keys: ['Z'], run: () => ed.setTool('zoom') },
  };

  // forma canônica: Ctrl+Alt+Shift+Tecla, não importa a ordem escrita acima
  function normalize(combo) {
    const parts = combo.split('+');
    const key = parts.pop() || '+';
    const mods = ['Ctrl', 'Alt', 'Shift'].filter((m) => parts.includes(m));
    return [...mods, key].join('+');
  }

  const keymap = new Map();
  for (const [id, d] of Object.entries(defs)) for (const k of d.keys) keymap.set(normalize(k), id);

  function run(id) {
    const d = defs[id];
    if (!d) return console.warn('Ação desconhecida:', id);
    try {
      const r = d.run();
      if (r?.catch) r.catch((err) => ed.toast(`Erro: ${err.message}`));
    } catch (err) {
      console.error(err);
      ed.toast(`Erro: ${err.message}`);
    }
  }

  function comboOf(e) {
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (k.startsWith('Arrow')) k = k.slice(5);
    else if (k === '+') k = '=';
    else if (k.length === 1) k = k.toUpperCase();
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(k);
    return parts.join('+');
  }

  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  /** Trata uma tecla. Retorna true se virou ação. */
  function handleKey(e) {
    if (document.querySelector('dialog[open]')) return false;
    if (isTyping(e.target)) {
      if (e.key === 'Escape') e.target.blur();
      return false;
    }
    const id = keymap.get(comboOf(e));
    if (!id) return false;
    e.preventDefault();
    run(id);
    return true;
  }

  return { defs, run, handleKey, comboOf, symbolProperties };
}
