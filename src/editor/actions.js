// Registro único de ações: usado pelo teclado, pelo menu do Electron e pelos botões.
// Os atalhos ficam todos aqui (base para torná-los personalizáveis depois).

import { openDialog, esc } from './ui-kit.js';
import { exportDialog } from './export-ui.js';
import { SYMBOL_TYPES } from '../model/document.js';
import { openCurveEditor, keysToPoints, pointsToKeys } from './curve-ui.js';
import { MOTION_PROPS, MOTION_LABELS, motionPropsAt, evalKeys } from '../player/tween.js';
import { DEFAULT_EASE_CURVE } from '../player/ease.js';
import { base64ToBytes } from '../player/audio.js';

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

  // ---------- camada: propriedades ----------
  async function layerProperties(id = ed.activeLayerId) {
    const L = ed.layer(id);
    if (!L) return;
    const kind = ed.layerKind(L);
    const fixed = kind === 'folder' || kind === 'camera';
    const descendants = new Set();
    const isAncestorOf = (cand) => {
      for (let q = cand, g = 0; q && g < 64; g++) {
        if (q.id === L.id) return true;
        q = q.parentLayerId ? ed.layer(q.parentLayerId) : null;
      }
      return false;
    };
    const parents = ed.layers.filter((o) => o.id !== L.id && o.type !== 'folder' && o.type !== 'camera' && !isAncestorOf(o) && !descendants.has(o.id));
    const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
    const r = await openDialog({
      title: 'Propriedades da camada',
      body: `
        <label class="dlg-row"><span>Nome</span><input type="text" name="name" value="${esc(L.name)}"></label>
        <label class="dlg-row"><span>Tipo</span>${
          fixed
            ? `<span class="dlg-text">${kind === 'folder' ? 'Pasta' : 'Câmera'}</span>`
            : `<select name="kind">${opt('normal', 'Normal', kind)}${opt('mask', 'Máscara', kind)}${opt('masked', 'Mascarada (pela máscara de cima)', kind)}${opt('guide', 'Guia', kind)}${opt('guided', 'Guiada (pela guia de cima)', kind)}</select>`
        }</label>
        ${
          fixed
            ? ''
            : `<label class="dlg-row"><span>Pai (parentesco)</span><select name="parent">${opt('', 'Nenhum', L.parentLayerId || '')}${parents.map((o) => opt(o.id, o.name, L.parentLayerId || '')).join('')}</select></label>
               <label class="dlg-row"><span>Profundidade</span><input type="number" name="depth" value="${L.depth || 0}" step="10" min="-900"></label>
               <p class="dlg-text">A profundidade faz o efeito parallax quando a cena tem câmera: quanto maior, mais longe (menor e mais devagar).</p>`
        }
        <label class="dlg-row"><span>Cor do contorno</span><input type="color" name="color" value="${L.color}"></label>
        <div class="dlg-row"><span>Opções</span><div>
          <label><input type="checkbox" name="visible" ${L.visible ? 'checked' : ''}> Visível</label>&nbsp;&nbsp;
          <label><input type="checkbox" name="locked" ${L.locked ? 'checked' : ''}> Travada</label>&nbsp;&nbsp;
          ${fixed ? '' : `<label><input type="checkbox" name="outline" ${L.outline ? 'checked' : ''}> Contorno</label>`}
        </div></div>`,
    });
    if (!r) return;
    ed.group('Propriedades da camada', () => {
      const patch = {};
      if (r.name.trim() && r.name.trim() !== L.name) patch.name = r.name.trim();
      if (r.color !== L.color) patch.color = r.color;
      if (r.visible !== L.visible) patch.visible = r.visible;
      if (r.locked !== L.locked) patch.locked = r.locked;
      if (!fixed && r.outline !== L.outline) patch.outline = r.outline;
      if (Object.keys(patch).length) ed.setLayerProps(L.id, patch, 'Propriedades da camada');
      if (!fixed && r.kind !== kind) ed.setLayerKind(L.id, r.kind);
      if (!fixed && (r.parent || null) !== (ed.layer(L.id).parentLayerId || null)) ed.setLayerParent(L.id, r.parent || null);
      if (!fixed && Number(r.depth) !== (ed.layer(L.id).depth || 0)) ed.setLayerDepth(L.id, Number(r.depth));
    });
  }

  // ---------- editor de movimento e easing personalizado ----------
  async function motionEditor() {
    const span = ed.currentSpan();
    if (span?.tween?.type !== 'motion') return ed.toast('Clique num quadro de um motion tween (trecho azul) para abrir o editor de movimento.');
    const base = motionPropsAt(span, 0);
    const res = await openCurveEditor({
      title: 'Editor de movimento',
      mode: 'motion',
      duration: span.duration,
      props: MOTION_PROPS.map((id) => ({ id, label: MOTION_LABELS[id], points: keysToPoints(span.tween.props?.[id]), base: base[id] })),
      evaluate: (id, pts, x) => evalKeys(pts.map((q) => ({ t: q.x, v: q.y, it: q.ix, iv: q.iy, ot: q.ox, ov: q.oy })), x, span.tween),
    });
    if (!res?.size) return;
    ed.group('Editor de movimento', () => {
      for (const [id, pts] of res) ed.setMotionKeys(id, pointsToKeys(pts));
    });
  }

  async function customEase() {
    const span = ed.currentSpan();
    if (!span?.tween) return ed.toast('Clique num quadro com tween para ajustar o easing.');
    const res = await openCurveEditor({
      title: 'Easing personalizado',
      mode: 'ease',
      props: [{ id: 'ease', label: 'Easing', points: span.tween.easeCurve || DEFAULT_EASE_CURVE }],
    });
    const pts = res?.get('ease');
    if (pts) ed.setTweenProps({ easeType: 'custom', easeCurve: pts });
  }

  // ---------- som ----------
  async function importSound() {
    let file = null;
    if (window.api?.openAudio) file = await window.api.openAudio();
    else {
      file = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = () => {
          const f = input.files[0];
          if (!f) return resolve(null);
          const rd = new FileReader();
          rd.onload = () => resolve({ name: f.name, mime: f.type || 'audio/mpeg', data: String(rd.result).split(',')[1] });
          rd.readAsDataURL(f);
        };
        input.click();
      });
    }
    if (!file) return;
    let duration = 0;
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await actx.decodeAudioData(base64ToBytes(file.data).buffer);
      duration = buf.duration;
      actx.close?.();
    } catch {
      return ed.toast('Não foi possível ler esse arquivo de áudio.');
    }
    const snd = ed.importSound({ name: file.name.replace(/\.[^.]+$/, ''), mime: file.mime, data: file.data, duration });
    ui.showTab?.('library');
    ed.toast(`Som "${snd.name}" importado (${duration.toFixed(1)} s). Escolha um quadro e ponha o som em Propriedades.`);
    return snd;
  }

  // ---------- cenas ----------
  async function renameScene(i = ed.sceneIndex) {
    const sc = ed.doc.scenes[i];
    const r = await openDialog({ title: 'Renomear cena', body: `<label class="dlg-row"><span>Nome</span><input type="text" name="name" value="${esc(sc.name)}"></label>` });
    if (r) ed.renameScene(i, r.name);
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
    toolCamera: { keys: ['C'], run: () => ed.setTool('camera') },
    // Timeline (Fase 4)
    toggleMulti: { keys: [], run: () => ed.setMulti({ enabled: !ed.multi.enabled }) },
    toggleCamera: { keys: [], run: () => (ed.cameraLayer() ? ed.removeCamera() : ed.addCamera()) },
    newLayerFolder: { keys: [], run: () => ed.addLayerFolder() },
    addMotionGuide: { keys: [], run: () => ed.addMotionGuide() },
    layerProperties: { keys: [], run: () => layerProperties() },
    createMotionTween: { keys: [], run: () => ed.createMotionTween() },
    createShapeTween: { keys: [], run: () => ed.createShapeTween() },
    addShapeHint: { keys: ['Ctrl+Shift+H'], run: () => ed.addShapeHint() },
    removeShapeHints: { keys: [], run: () => ed.removeShapeHints() },
    copyFrames: { keys: ['Ctrl+Alt+C'], run: () => ed.copyFrames() },
    cutFrames: { keys: ['Ctrl+Alt+X'], run: () => ed.cutFrames() },
    pasteFrames: { keys: ['Ctrl+Alt+V'], run: () => ed.pasteFrames(false) },
    pasteFramesOverwrite: { keys: [], run: () => ed.pasteFrames(true) },
    reverseFrames: { keys: [], run: () => ed.reverseFrames() },
    distributeToKeyframes: { keys: ['Ctrl+Shift+K'], run: () => ed.distributeToKeyframes() },
    distributeToLayers: { keys: ['Ctrl+Shift+D'], run: () => ed.distributeToLayers() },
    showProperties: { keys: [], run: () => ui.showTab?.('props') },
    motionEditor: { keys: [], run: motionEditor },
    customEase: { keys: [], run: customEase },
    importSound: { keys: [], run: importSound },
    saveMotionPreset: {
      keys: [],
      run: async () => {
        const r = await openDialog({ title: 'Salvar preset de movimento', body: '<label class="dlg-row"><span>Nome</span><input type="text" name="name" value="Meu preset"></label>' });
        if (!r) return;
        const pr = ed.presetFromCurrent(r.name.trim() || 'Meu preset');
        if (!pr) return;
        ed.userPresets = [...(ed.userPresets || []), pr];
        ed.emit('presets');
        ed.toast(`Preset "${pr.name}" salvo.`);
      },
    },
    newScene: { keys: [], run: () => ed.addScene() },
    duplicateScene: { keys: [], run: () => ed.duplicateScene() },
    deleteScene: { keys: [], run: () => ed.deleteScene() },
    renameScene: { keys: [], run: () => renameScene() },
    prevScene: { keys: ['Shift+PageUp'], run: () => ed.setScene(ed.sceneIndex - 1) },
    nextScene: { keys: ['Shift+PageDown'], run: () => ed.setScene(ed.sceneIndex + 1) },
    toolBrush: { keys: ['B'], run: () => ed.setTool('brush') },
    toolBucket: { keys: ['K'], run: () => ed.setTool('bucket') },
    toolEraser: { keys: ['E'], run: () => ed.setTool('eraser') },
    toolEyedropper: { keys: ['I'], run: () => ed.setTool('eyedropper') },
    toolGradient: { keys: ['F'], run: () => ed.setTool('gradient') },
    // Combinar objetos (booleanos)
    combineUnion: { keys: [], run: () => ed.combineSelection('union') },
    combineIntersect: { keys: [], run: () => ed.combineSelection('intersect') },
    combinePunch: { keys: [], run: () => ed.combineSelection('punch') },
    combineCrop: { keys: [], run: () => ed.combineSelection('crop') },
    showColors: { keys: ['Ctrl+Shift+F9'], run: () => ui.showTab?.('colors') },
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
  let custom = {}; // ação → [atalhos] escolhidos pelo usuário
  function rebuildKeymap() {
    keymap.clear();
    for (const [id, d] of Object.entries(defs)) for (const k of custom[id] ?? d.keys) keymap.set(normalize(k), id);
  }
  function setCustomKeys(map) {
    custom = map && typeof map === 'object' ? map : {};
    rebuildKeymap();
  }
  rebuildKeymap();

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
    // a ferramenta ativa tem a primeira chance (Enter fecha o laço poligonal e a caneta, por exemplo)
    if (!e.ctrlKey && !e.metaKey && stage.currentTool?.().keydown?.(e)) {
      e.preventDefault();
      return true;
    }
    const id = keymap.get(comboOf(e));
    if (!id) return false;
    e.preventDefault();
    run(id);
    return true;
  }

  return { defs, run, handleKey, comboOf, normalize, rebuildKeymap, setCustomKeys, keysOf: (id) => custom[id] ?? defs[id]?.keys ?? [], symbolProperties, layerProperties, renameScene, importSound };
}
