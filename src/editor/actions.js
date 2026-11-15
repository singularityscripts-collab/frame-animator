// Registro único de ações: usado pelo teclado, pelo menu do Electron e pelos botões.
// Os atalhos ficam todos aqui (base para torná-los personalizáveis depois).

export function createActions({ editor, stage, io }) {
  const ed = editor;
  const defs = {
    // Arquivo
    new: { keys: ['Ctrl+N'], run: () => io.newDoc() },
    open: { keys: ['Ctrl+O'], run: () => io.open() },
    save: { keys: ['Ctrl+S'], run: () => io.save(false) },
    saveAs: { keys: ['Ctrl+Shift+S'], run: () => io.save(true) },
    testScene: { keys: ['Ctrl+Enter'], run: () => io.testScene() },
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

  return { defs, run, handleKey, comboOf };
}
