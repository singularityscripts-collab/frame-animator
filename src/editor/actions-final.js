// Ações e diálogos da fase final: ferramentas novas, importar imagem/Animate, exports (HTML5,
// Lottie, sprite sheet, SVG), publicação, localizar e substituir, atalhos personalizáveis,
// alinhar, réguas/grade/guias, 9 fatias, seletor de quadro, lip-sync, vetorizar e painéis.

import { openDialog, openProgress, esc, confirmDialog } from './ui-kit.js';
import { serialize, clone, uid } from '../model/document.js';
import { sceneLength, movieLength, renderTimeline, timelineLength, multiply, translation } from '../player/render.js';
import { drawText, textBox, drawComponent } from '../player/assets.js';
import { decodeSound } from '../player/audio.js';
import { toLottie } from '../export/lottie.js';
import { frameToSVG } from '../export/svg.js';
import { buildSpriteSheet } from '../export/spritesheet.js';
import { importXFL } from '../model/xfl.js';
import { traceImage, traceImageAsync } from '../model/trace.js';
import { analyzeLipSync, VISEMES } from '../model/lipsync.js';
import { timelineBounds } from '../model/geometry.js';
import { runExport } from './export-ui.js';
import { ALL_TOOLS } from './toolbar-ui.js';

const api = () => window.api || null;
const baseName = (editor) => (editor.filePath ? editor.filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'animacao');
const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');

/** Lê um File (ou blob) como base64. */
function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result).split(',')[1]);
    rd.onerror = () => reject(rd.error);
    rd.readAsDataURL(file);
  });
}

/** Seletor de arquivo do navegador (quando não há Electron). */
function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

/** Tamanho de uma imagem em base64. */
function imageSize(mime, data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1, img });
    img.onerror = () => reject(new Error('Imagem inválida ou formato não suportado.'));
    img.src = `data:${mime};base64,${data}`;
  });
}

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });

/** Texto ou componente → imagem (para Lottie): { url, w, h, matrix }. */
function rasterizeItem(item, k = 2) {
  const el = item.el;
  const box = item.kind === 'text' ? textBox(el) : { x: 0, y: 0, w: el.w, h: el.h };
  const c = canvas((box.w + 8) * k, (box.h + 8) * k);
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, (4 - box.x) * k, (4 - box.y) * k);
  if (item.kind === 'text') drawText(ctx, { ...el, matrix: [1, 0, 0, 1, 0, 0] });
  else {
    ctx.save();
    drawComponent(ctx, { ...el, matrix: [1, 0, 0, 1, 0, 0] }, {});
    ctx.restore();
  }
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height, matrix: multiply(item.matrix, multiply(translation(box.x - 4, box.y - 4), [1 / k, 0, 0, 1 / k, 0, 0])) };
}

async function inflateZlib(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

export const ACTION_LABELS = {
  new: 'Novo documento', open: 'Abrir', save: 'Salvar', saveAs: 'Salvar como', testScene: 'Testar filme', exportMedia: 'Exportar vídeo/GIF/PNG',
  convertToSymbol: 'Converter em símbolo', newSymbol: 'Novo símbolo', editSymbol: 'Editar símbolo', showLibrary: 'Biblioteca', createClassicTween: 'Tween clássico',
  removeTween: 'Remover tween', undo: 'Desfazer', redo: 'Refazer', cut: 'Recortar', copy: 'Copiar', paste: 'Colar', pasteInPlace: 'Colar no lugar', duplicate: 'Duplicar',
  delete: 'Apagar', selectAll: 'Selecionar tudo', deselect: 'Desmarcar', escape: 'Cancelar / desmarcar', arrangeFront: 'Trazer para a frente', arrangeForward: 'Trazer um nível',
  arrangeBackward: 'Enviar um nível', arrangeBack: 'Enviar para trás', nudgeLeft: 'Mover 1px ←', nudgeRight: 'Mover 1px →', nudgeUp: 'Mover 1px ↑', nudgeDown: 'Mover 1px ↓',
  nudgeLeft10: 'Mover 10px ←', nudgeRight10: 'Mover 10px →', nudgeUp10: 'Mover 10px ↑', nudgeDown10: 'Mover 10px ↓', zoomIn: 'Aumentar zoom', zoomOut: 'Diminuir zoom',
  zoom100: 'Zoom 100%', zoomFit: 'Ajustar à janela', togglePlay: 'Reproduzir / parar', prevFrame: 'Quadro anterior', nextFrame: 'Próximo quadro', firstFrame: 'Primeiro quadro',
  lastFrame: 'Último quadro', toggleLoop: 'Repetir reprodução', toggleOnion: 'Onion skin', insertFrame: 'Inserir quadro', removeFrame: 'Remover quadro', insertKeyframe: 'Inserir keyframe',
  clearKeyframe: 'Limpar keyframe', insertBlankKeyframe: 'Keyframe vazio', newLayer: 'Nova camada', deleteLayer: 'Apagar camada', toggleMulti: 'Editar vários quadros',
  toggleCamera: 'Câmera', newLayerFolder: 'Nova pasta de camadas', addMotionGuide: 'Guia de movimento', layerProperties: 'Propriedades da camada', createMotionTween: 'Motion tween',
  createShapeTween: 'Shape tween', addShapeHint: 'Dica de forma', removeShapeHints: 'Tirar dicas de forma', copyFrames: 'Copiar quadros', cutFrames: 'Recortar quadros',
  pasteFrames: 'Colar quadros', pasteFramesOverwrite: 'Colar e substituir quadros', reverseFrames: 'Inverter quadros', distributeToKeyframes: 'Distribuir para keyframes',
  distributeToLayers: 'Distribuir para camadas', showProperties: 'Propriedades', motionEditor: 'Editor de movimento', customEase: 'Easing personalizado', importSound: 'Importar som',
  newScene: 'Nova cena', duplicateScene: 'Duplicar cena', deleteScene: 'Apagar cena', renameScene: 'Renomear cena', prevScene: 'Cena anterior', nextScene: 'Próxima cena',
  combineUnion: 'Unir formas', combineIntersect: 'Interseção', combinePunch: 'Perfurar', combineCrop: 'Recortar formas', showColors: 'Cores',
  importImage: 'Importar imagem', importAnimate: 'Importar do Animate', exportHTML5: 'Exportar HTML5', exportLottie: 'Exportar Lottie', exportSprites: 'Exportar sprite sheet',
  exportSVG: 'Exportar SVG', publishSettings: 'Configurações de publicação', publish: 'Publicar', findReplace: 'Localizar e substituir', keyboardShortcuts: 'Atalhos de teclado',
  editorScripts: 'Scripts do editor', insertButtonComponent: 'Inserir botão', insertListComponent: 'Inserir lista', insertVideoComponent: 'Inserir vídeo', breakApart: 'Separar',
  optimizeCurves: 'Otimizar curvas', traceBitmap: 'Vetorizar bitmap', toggleObjectDrawing: 'Desenho de objeto / mesclado', scale9: 'Escala de 9 fatias', framePicker: 'Seletor de quadro',
  lipSync: 'Lip-sync automático', alignLeft: 'Alinhar à esquerda', alignHCenter: 'Centro horizontal', alignRight: 'Alinhar à direita', alignTop: 'Alinhar ao topo',
  alignVCenter: 'Centro vertical', alignBottom: 'Alinhar à base', distributeH: 'Distribuir na horizontal', distributeV: 'Distribuir na vertical', matchWidth: 'Mesma largura',
  matchHeight: 'Mesma altura', resetRotation: 'Girar a vista para 0°', toggleRulers: 'Réguas', toggleGrid: 'Grade', toggleGuides: 'Guias', lockGuides: 'Travar guias',
  clearGuides: 'Limpar guias', gridSettings: 'Grade e guias', snapGrid: 'Encaixar na grade', snapGuides: 'Encaixar nas guias', snapObjects: 'Encaixar em objetos',
  showActions: 'Painel Ações', showAlign: 'Painel Alinhar', showSceneExplorer: 'Explorador de cenas', showComponents: 'Painel Componentes', showProps: 'Painel Propriedades',
  saveLayout: 'Salvar layout', manageLayouts: 'Layouts salvos', resetLayout: 'Layout padrão', removeArmature: 'Tirar esqueleto', clearWidth: 'Tirar perfil de largura',
  clearWarp: 'Tirar pinos', unbindBone: 'Soltar do osso', reset3D: 'Zerar 3D', pickVideo: 'Escolher vídeo',
};
for (const t of ALL_TOOLS) ACTION_LABELS[`tool${t.id[0].toUpperCase()}${t.id.slice(1)}`] = `Ferramenta: ${t.label}`;

export function extendActions(actions, { editor: ed, stage, io, panels }) {
  const { defs } = actions;
  const add = (id, keys, run) => (defs[id] = { keys, run });

  // ---------- ferramentas ----------
  for (const t of ALL_TOOLS) {
    const id = `tool${t.id[0].toUpperCase()}${t.id.slice(1)}`;
    if (!defs[id]) add(id, [t.key], () => ed.setTool(t.id));
    else defs[id].keys = [t.key];
  }

  // Delete com a subseleção apaga pontos; Enter/Esc vão para a ferramenta (laço, caneta) quando ela quer
  const del = defs.delete.run;
  defs.delete.run = () => {
    if (ed.tool === 'subselect' && stage.tools.subselect.deleteSelection()) return;
    del();
  };

  // ---------- importar ----------
  ed.importImageFiles = async (files, x, y) => {
    let k = 0;
    for (const f of files) {
      const data = await fileToB64(f);
      const mime = f.type || 'image/png';
      const { w, h } = await imageSize(mime, data);
      const bmp = ed.importBitmap({ name: f.name.replace(/\.[^.]+$/, ''), mime, data, w, h }, false);
      ed.placeBitmap(bmp.id, (x ?? ed.doc.width / 2) - w / 2 + k * 12, (y ?? ed.doc.height / 2) - h / 2 + k * 12);
      k++;
    }
  };
  add('importImage', ['Ctrl+Alt+I'], async () => {
    let list;
    if (api()?.openImage) list = await api().openImage();
    else {
      const files = await pickFiles('image/*', true);
      if (files.length) return ed.importImageFiles(files);
      return;
    }
    if (!list?.length) return;
    let k = 0;
    for (const f of list) {
      const { w, h } = await imageSize(f.mime, f.data);
      const bmp = ed.importBitmap({ ...f, w, h }, false);
      ed.placeBitmap(bmp.id, ed.doc.width / 2 - w / 2 + k * 12, ed.doc.height / 2 - h / 2 + k * 12);
      k++;
    }
  });

  add('importAnimate', [], async () => {
    if (!api()?.openAnimate) return ed.toast('Importar .fla/XFL funciona no aplicativo (npm start).');
    if (!(await io.confirmDiscard())) return;
    const src = await api().openAnimate();
    if (!src) return;
    const prog = openProgress('Importando do Animate');
    try {
      const { doc, warnings, pendingImages } = await importXFL(src.files, { inflate: inflateZlib });
      for (const p of pendingImages) {
        const c = canvas(p.w, p.h);
        c.getContext('2d').putImageData(new ImageData(p.rgba, p.w, p.h), 0, 0);
        const b = doc.library.bitmaps.find((x) => x.id === p.id);
        if (b) b.data = c.toDataURL('image/png').split(',')[1];
      }
      ed.load(doc, null);
      ed.toast(warnings.length ? `Importado com ${warnings.length} aviso(s): ${warnings.slice(0, 3).join('; ')}` : `"${src.name}" importado.`);
    } catch (err) {
      ed.toast(`Não deu para importar: ${err.message}`);
    } finally {
      prog.close();
    }
  });

  // ---------- exports ----------
  async function writeFiles(title, files, { folder = true, defaultName } = {}) {
    if (!api()?.exportWrite) {
      // navegador: baixa os arquivos um a um
      for (const f of files) {
        const blob = f.base64 ? new Blob([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))]) : new Blob([f.text]);
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: f.name.replace(/\//g, '_') });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      return { path: files[0]?.name };
    }
    return api().exportWrite({ title, files, folder, defaultName: defaultName || baseName(ed) });
  }
  const done = (r, what) => {
    if (!r) return;
    ed.toast(`${what} exportado: ${r.path}`);
    if (r.path && api()?.showInFolder) api().showInFolder(r.path);
  };

  function lottieJSON(o = {}) {
    return JSON.stringify(toLottie(ed.doc, { sceneIndex: ed.sceneIndex, allScenes: !!o.allScenes, transparent: !!o.transparent, rasterize: (it) => rasterizeItem(it), name: baseName(ed) }));
  }
  function svgFiles(o = {}) {
    const len = sceneLength(ed.doc.scenes[ed.sceneIndex]);
    const from = Math.max(0, (o.from ?? 1) - 1), to = Math.min(len - 1, (o.to ?? len) - 1);
    const files = [];
    for (let f = from; f <= to; f++) files.push({ name: `${baseName(ed)}_${String(f + 1).padStart(4, '0')}.svg`, text: frameToSVG(ed.doc, ed.sceneIndex, f, { scale: o.scale ?? 100, transparent: !!o.transparent, rasterize: (it) => rasterizeItem(it).url }) });
    return files;
  }
  async function spriteFiles(o = {}) {
    const prog = openProgress('Montando o sprite sheet');
    try {
      const { canvas: sheet, json } = await buildSpriteSheet(ed.doc, { sceneIndex: ed.sceneIndex, scale: o.scale ?? 100, trim: o.trim !== false, padding: o.padding ?? 2, layout: o.layout || 'pack', name: baseName(ed), onProgress: (i, n) => prog.update(i / n, `Quadro ${i} de ${n}`) });
      return [
        { name: `${baseName(ed)}.png`, base64: sheet.toDataURL('image/png').split(',')[1] },
        { name: `${baseName(ed)}.json`, text: JSON.stringify(json, null, 1) },
      ];
    } finally {
      prog.close();
    }
  }
  async function html5(dir) {
    if (!api()?.exportHTML5) {
      ed.toast('O pacote HTML5 é gerado pelo aplicativo (npm start).');
      return null;
    }
    ed.stop();
    return api().exportHTML5({ doc: serialize(ed.doc), options: { ...(ed.doc.publish?.html5 || {}), title: baseName(ed) }, defaultName: `${baseName(ed)}-html5`, dir });
  }

  add('exportHTML5', [], async () => done(await html5(), 'HTML5'));
  add('exportLottie', [], async () => {
    const r = await openDialog({
      title: 'Exportar Lottie (JSON)',
      body: `<label class="dlg-row"><span>Cenas</span><select name="scope"><option value="scene">Só esta cena</option><option value="all">Todas as cenas</option></select></label>
        <label class="dlg-row"><span>Fundo</span><select name="bg"><option value="solid">Cor do documento</option><option value="none">Transparente</option></select></label>
        <p class="dlg-text">Cada quadro vira formas vetoriais (quadros iguais são juntados). Máscaras viram "track matte"; textos viram imagens. Filtros e modos de mesclagem não existem no Lottie.</p>`,
      ok: 'Exportar',
    });
    if (!r) return;
    done(await writeFiles('Exportar Lottie', [{ name: `${baseName(ed)}.json`, text: lottieJSON({ allScenes: r.scope === 'all', transparent: r.bg === 'none' }) }], { folder: false }), 'Lottie');
  });
  add('exportSprites', [], async () => {
    const sp = ed.doc.publish?.sprites || {};
    const r = await openDialog({
      title: 'Exportar sprite sheet',
      body: `<label class="dlg-row"><span>Escala (%)</span><input type="number" name="scale" min="5" max="400" value="${sp.scale ?? 100}"></label>
        <label class="dlg-row"><span>Arranjo</span><select name="layout"><option value="pack">Compacto</option><option value="grid">Grade</option><option value="row">Uma linha</option></select></label>
        <label class="dlg-row"><span>Espaço entre quadros</span><input type="number" name="padding" min="0" max="64" value="${sp.padding ?? 2}"></label>
        <label class="dlg-row"><span>Cortar transparência</span><input type="checkbox" name="trim" ${sp.trim !== false ? 'checked' : ''}></label>
        <p class="dlg-text">Gera uma imagem PNG com todos os quadros desta cena e um JSON (formato "hash", lido por Phaser, PixiJS, Godot etc.). Quadros repetidos usam o mesmo lugar na folha.</p>`,
      ok: 'Exportar',
    });
    if (!r) return;
    const files = await spriteFiles({ scale: Number(r.scale), layout: r.layout, padding: Number(r.padding), trim: r.trim });
    done(await writeFiles('Exportar sprite sheet (nome da pasta)', files, { defaultName: `${baseName(ed)}-sprites` }), 'Sprite sheet');
  });
  add('exportSVG', [], async () => {
    const len = sceneLength(ed.doc.scenes[ed.sceneIndex]);
    const r = await openDialog({
      title: 'Exportar SVG por quadro',
      body: `<label class="dlg-row"><span>Do quadro</span><input type="number" name="from" min="1" max="${len}" value="1"></label>
        <label class="dlg-row"><span>Até</span><input type="number" name="to" min="1" max="${len}" value="${len}"></label>
        <label class="dlg-row"><span>Escala (%)</span><input type="number" name="scale" min="5" max="800" value="100"></label>
        <label class="dlg-row"><span>Fundo transparente</span><input type="checkbox" name="transparent"></label>
        <p class="dlg-text">Um arquivo SVG vetorial por quadro (formas, gradientes, máscaras, imagens e textos).</p>`,
      ok: 'Exportar',
    });
    if (!r) return;
    done(await writeFiles('Exportar SVG (nome da pasta)', svgFiles({ from: Number(r.from), to: Number(r.to), scale: Number(r.scale), transparent: r.transparent }), { defaultName: `${baseName(ed)}-svg` }), 'SVG');
  });

  // ---------- publicação ----------
  const FORMAT_LABELS = { html5: 'HTML5 Canvas (interativo)', mp4: 'Vídeo MP4', gif: 'GIF animado', png: 'Sequência PNG', svg: 'SVG por quadro', sprites: 'Sprite sheet + JSON', lottie: 'Lottie (JSON)' };
  add('publishSettings', ['Ctrl+Shift+F12'], async () => {
    const p = ed.doc.publish;
    const r = await openDialog({
      title: 'Configurações de publicação',
      body: `<p class="dlg-text">Marque os formatos que o "Publicar" (Shift+F12) gera de uma vez, na mesma pasta.</p>
        <div class="pub-grid">${Object.entries(FORMAT_LABELS).map(([k, l]) => `<label><input type="checkbox" name="f_${k}" ${p.formats[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <h3 class="dlg-sub">HTML5</h3>
        <label class="dlg-row"><span>Repetir</span><input type="checkbox" name="h_loop" ${p.html5.loop !== false ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Tamanho na página</span><select name="h_scale"><option value="fit" ${p.html5.scale === 'fit' ? 'selected' : ''}>Ajustar à janela</option><option value="stretch" ${p.html5.scale === 'stretch' ? 'selected' : ''}>Esticar</option><option value="none" ${p.html5.scale === 'none' ? 'selected' : ''}>Tamanho original</option></select></label>
        <h3 class="dlg-sub">Vídeo, GIF e PNG</h3>
        <label class="dlg-row"><span>Escala (%)</span><input type="number" name="v_scale" min="10" max="400" value="${p.video.scale ?? 100}"></label>
        <h3 class="dlg-sub">Sprite sheet</h3>
        <label class="dlg-row"><span>Escala (%)</span><input type="number" name="s_scale" min="5" max="400" value="${p.sprites.scale ?? 100}"></label>
        <label class="dlg-row"><span>Cortar transparência</span><input type="checkbox" name="s_trim" ${p.sprites.trim !== false ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Arranjo</span><select name="s_layout"><option value="pack" ${p.sprites.layout === 'pack' ? 'selected' : ''}>Compacto</option><option value="grid" ${p.sprites.layout === 'grid' ? 'selected' : ''}>Grade</option><option value="row" ${p.sprites.layout === 'row' ? 'selected' : ''}>Uma linha</option></select></label>
        <h3 class="dlg-sub">SVG</h3>
        <label class="dlg-row"><span>Escala (%)</span><input type="number" name="g_scale" min="5" max="800" value="${p.svg.scale ?? 100}"></label>`,
      ok: 'Salvar',
    });
    if (!r) return;
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const pub = clone(p);
    for (const k of Object.keys(FORMAT_LABELS)) pub.formats[k] = !!r[`f_${k}`];
    pub.html5 = { loop: r.h_loop, scale: r.h_scale };
    pub.video = { scale: num(r.v_scale, 100) };
    pub.sprites = { ...pub.sprites, scale: num(r.s_scale, 100), trim: r.s_trim, layout: r.s_layout };
    pub.svg = { scale: num(r.g_scale, 100) };
    ed.setDocProps({ publish: pub });
    ed.toast('Configurações de publicação salvas no documento.');
  });
  add('publish', ['Shift+F12'], async () => {
    const p = ed.doc.publish;
    const on = Object.keys(FORMAT_LABELS).filter((k) => p.formats[k]);
    if (!on.length) return actions.run('publishSettings');
    ed.stop();
    const files = [{ name: 'publicacao.json', text: JSON.stringify({ app: 'Frame Animator', documento: baseName(ed), formatos: on, data: new Date().toISOString() }, null, 2) }];
    if (p.formats.lottie) files.push({ name: `${baseName(ed)}.json`, text: lottieJSON() });
    if (p.formats.svg) files.push(...svgFiles({ scale: p.svg.scale }).map((f) => ({ ...f, name: `svg/${f.name}` })));
    if (p.formats.sprites) files.push(...(await spriteFiles(p.sprites)).map((f) => ({ ...f, name: `sprites/${f.name}` })));
    const w = await writeFiles('Publicar (nome da pasta)', files, { defaultName: `${baseName(ed)}-publicado` });
    if (!w) return;
    const dir = dirOf(w.path);
    if (p.formats.html5) await html5(`${dir}/html5`);
    const sep = dir.includes('\\') ? '\\' : '/';
    for (const fmt of ['mp4', 'gif', 'png']) {
      if (!p.formats[fmt]) continue;
      const ext = fmt === 'png' ? `${sep}${baseName(ed)}_.png` : `${sep}${baseName(ed)}.${fmt}`;
      await runExport(ed, { format: fmt, scale: p.video.scale || 100, path: dir + ext, quiet: true, allScenes: true, to: movieLength(ed.doc) - 1 });
    }
    ed.toast(`Publicado em ${dir}`);
    api()?.showInFolder?.(w.path);
  });

  // ---------- componentes ----------
  add('insertButtonComponent', [], () => ed.addComponent('button'));
  add('insertListComponent', [], () => ed.addComponent('list'));
  add('insertVideoComponent', [], () => ed.addComponent('video'));
  add('pickVideo', [], async () => {
    let f;
    if (api()?.openVideo) f = await api().openVideo();
    else {
      const [file] = await pickFiles('video/*');
      if (file) f = { name: file.name, mime: file.type || 'video/mp4', data: await fileToB64(file) };
    }
    if (!f) return;
    ed.updateSelection('Vídeo', (el) => {
      if (el.type !== 'component' || el.kind !== 'video') return;
      el.props = { ...(el.props || {}), name: f.name, src: `data:${f.mime};base64,${f.data}` };
    });
  });

  // ---------- modificar ----------
  async function textToShapes(it) {
    // desenha a letra grande e vetoriza o contorno
    const el = it.el;
    const k = 4;
    const box = textBox(el);
    const c = canvas((box.w + 8) * k, (box.h + 8) * k);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(k, 0, 0, k, 4 * k, 4 * k);
    drawText(ctx, { ...el, matrix: [1, 0, 0, 1, 0, 0], kind: 'static' });
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const traced = traceImage(img, { colors: 1, minArea: 4, tolerance: 0.8, smoothing: 0.7 });
    return traced.map((t) => shapeFromTrace(t, el.color, multiply(el.matrix, multiply(translation(-4, -4), [1 / k, 0, 0, 1 / k, 0, 0]))));
  }
  function shapeFromTrace(t, fill, M) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sp of t.subs) for (const q of sp.pts) {
      x0 = Math.min(x0, q[0]);
      y0 = Math.min(y0, q[1]);
      x1 = Math.max(x1, q[0]);
      y1 = Math.max(y1, q[1]);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const subs = t.subs.map((sp) => ({ closed: true, pts: sp.pts.map((q) => [q[0] - cx, q[1] - cy, q[2], q[3], q[4], q[5]]) }));
    return { id: uid('e'), type: 'shape', matrix: multiply(M, translation(cx, cy)), path: subs.length === 1 ? subs[0] : { closed: true, fillRule: 'nonzero', subs }, fill: fill || t.color, stroke: null, strokeWidth: 0 };
  }
  add('breakApart', ['Ctrl+B'], () => ed.breakApart(textToShapes));
  add('optimizeCurves', ['Ctrl+Alt+Shift+C'], async () => {
    if (!ed.selectedItems().some((it) => it.el.type === 'shape')) return ed.toast('Selecione formas para otimizar.');
    const r = await openDialog({
      title: 'Otimizar curvas',
      body: `<label class="dlg-row"><span>Suavizar</span><input type="range" name="amount" min="0" max="100" value="50"></label>
        <p class="dlg-text">Tira pontos que sobram nas curvas (bom para desenhos a mão e formas vetorizadas). Mais suavização = menos pontos.</p>`,
      ok: 'Otimizar',
    });
    if (!r) return;
    const before = ed.selectedItems().reduce((n, it) => n + (it.el.path?.subs || [it.el.path]).reduce((m, sp) => m + (sp?.pts?.length || 0), 0), 0);
    ed.optimizeCurves(Number(r.amount));
    const after = ed.selectedItems().reduce((n, it) => n + (it.el.path?.subs || [it.el.path]).reduce((m, sp) => m + (sp?.pts?.length || 0), 0), 0);
    ed.toast(`Pontos: ${before} → ${after}`);
  });
  add('traceBitmap', [], async () => {
    const it = ed.selectedItems().find((x) => x.el.type === 'bitmap');
    if (!it) return ed.toast('Selecione uma imagem no palco.');
    const r = await openDialog({
      title: 'Vetorizar bitmap',
      body: `<label class="dlg-row"><span>Cores</span><input type="number" name="colors" min="2" max="64" value="8"></label>
        <label class="dlg-row"><span>Menor área (px²)</span><input type="number" name="minArea" min="1" max="10000" value="12"></label>
        <label class="dlg-row"><span>Precisão das curvas (px)</span><input type="number" name="tolerance" min="0.3" max="10" step="0.1" value="1.2"></label>
        <label class="dlg-row"><span>Suavizar cantos</span><input type="range" name="smoothing" min="0" max="100" value="60"></label>
        <p class="dlg-text">A imagem vira formas vetoriais de cor sólida (uma por cor). Imagens grandes demoram um pouco.</p>`,
      ok: 'Vetorizar',
    });
    if (!r) return;
    const bmp = ed.doc.library.bitmaps.find((b) => b.id === it.el.assetId);
    if (!bmp) return;
    const prog = openProgress('Vetorizando');
    try {
      const { img } = await imageSize(bmp.mime, bmp.data);
      const maxSide = 1200;
      const s = Math.min(1, maxSide / Math.max(bmp.w, bmp.h));
      const c = canvas(bmp.w * s, bmp.h * s);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const traced = await traceImageAsync(
        ctx.getImageData(0, 0, c.width, c.height),
        { colors: Number(r.colors), minArea: Number(r.minArea), tolerance: Number(r.tolerance), smoothing: Number(r.smoothing) / 100 },
        (done, total) => {
          prog.update(done / total, `Cor ${Math.min(done + 1, total)} de ${total}`);
          return prog.cancelled;
        },
      );
      if (!traced) return ed.toast('Vetorização cancelada.');
      const M = multiply(it.el.matrix, [it.el.w / c.width, 0, 0, it.el.h / c.height, 0, 0]);
      const shapes = traced.map((t) => shapeFromTrace(t, t.color, M));
      if (!shapes.length) return ed.toast('Nada para vetorizar (imagem transparente?).');
      ed.replaceItem(it, shapes, 'Vetorizar bitmap');
      ed.toast(`${shapes.length} forma(s) criada(s).`);
    } finally {
      prog.close();
    }
  });
  add('toggleObjectDrawing', ['J'], () => {
    ed.setObjectDrawing(!ed.objectDrawing);
    ed.toast(ed.objectDrawing ? 'Desenho de objeto: cada forma nova fica separada.' : 'Desenho mesclado: formas novas se fundem com as de baixo.');
  });
  add('clearWidth', [], () => ed.updateSelection('Tirar perfil de largura', (el) => void delete el.widthProfile));
  add('clearWarp', [], () => ed.updateSelection('Tirar pinos', (el) => void delete el.warp));
  add('unbindBone', [], () => ed.unbindSelection());
  add('reset3D', [], () =>
    ed.updateSelection('Zerar 3D', (el) => {
      delete el.rx;
      delete el.ry;
      delete el.z;
    }),
  );
  add('removeArmature', [], () => ed.removeArmature());

  add('scale9', [], async () => {
    const inst = ed.selectedItems().find((x) => x.el.type === 'instance');
    const sym = inst ? ed.symbol(inst.el.symbolId) : ed.editingSymbol;
    if (!sym) return ed.toast('Selecione uma instância (ou abra um símbolo) para ligar a escala de 9 fatias.');
    const b = timelineBounds(ed.doc, sym, 0) || { x: 0, y: 0, w: 100, h: 100 };
    const g = sym.scale9 || { x: b.x + b.w * 0.25, y: b.y + b.h * 0.25, w: b.w * 0.5, h: b.h * 0.5 };
    const r = await openDialog({
      title: `Escala de 9 fatias: ${sym.name}`,
      body: `<label class="dlg-row"><span>Ligada</span><input type="checkbox" name="on" ${sym.scale9 || !inst ? 'checked' : 'checked'}></label>
        <p class="dlg-text">As linhas guia (em coordenadas do símbolo) separam os cantos, que não esticam, do meio, que estica. Símbolo: x ${Math.round(b.x)}…${Math.round(b.x + b.w)}, y ${Math.round(b.y)}…${Math.round(b.y + b.h)}.</p>
        <label class="dlg-row"><span>Esquerda</span><input type="number" step="1" name="l" value="${Math.round(g.x)}"></label>
        <label class="dlg-row"><span>Direita</span><input type="number" step="1" name="r" value="${Math.round(g.x + g.w)}"></label>
        <label class="dlg-row"><span>Topo</span><input type="number" step="1" name="t" value="${Math.round(g.y)}"></label>
        <label class="dlg-row"><span>Base</span><input type="number" step="1" name="b" value="${Math.round(g.y + g.h)}"></label>`,
      ok: 'Aplicar',
    });
    if (!r) return;
    if (!r.on) return ed.setScale9(sym.id, null);
    const l = Number(r.l), rr = Number(r.r), t = Number(r.t), bb = Number(r.b);
    ed.setScale9(sym.id, { x: Math.min(l, rr), y: Math.min(t, bb), w: Math.abs(rr - l), h: Math.abs(bb - t) });
  });

  add('framePicker', [], async () => {
    const it = ed.selectedItems().find((x) => x.el.type === 'instance');
    const sym = it && ed.symbol(it.el.symbolId);
    if (!sym) return ed.toast('Selecione uma instância de símbolo gráfico (ex.: as bocas ou as expressões).');
    const n = timelineLength(sym);
    const b = timelineBounds(ed.doc, sym, 0) || { x: 0, y: 0, w: 100, h: 100 };
    const cells = [];
    for (let f = 0; f < Math.min(n, 120); f++) cells.push(`<button type="button" class="fp-cell" data-f="${f}" title="Quadro ${f + 1}"><canvas width="96" height="72"></canvas><span>${f + 1}</span></button>`);
    await openDialog({
      title: `Seletor de quadro: ${sym.name}`,
      body: `<p class="dlg-text">Clique no quadro que esta instância deve mostrar a partir do quadro atual (cria um keyframe). Ótimo para trocar boca e expressões.</p>
        <label class="dlg-row"><span>Criar keyframe aqui</span><input type="checkbox" name="kf" checked></label>
        <div class="fp-grid">${cells.join('')}</div>`,
      ok: 'Fechar',
      onOpen: (dlg) => {
        dlg.querySelectorAll('.fp-cell').forEach((btn) => {
          const f = Number(btn.dataset.f);
          const c = btn.querySelector('canvas');
          const ctx = c.getContext('2d');
          const bb = timelineBounds(ed.doc, sym, f) || b;
          const s = Math.min(88 / Math.max(1, bb.w), 64 / Math.max(1, bb.h));
          ctx.setTransform(s, 0, 0, s, 48 - (bb.x + bb.w / 2) * s, 36 - (bb.y + bb.h / 2) * s);
          renderTimeline(ctx, ed.doc, sym, f, {});
          if ((it.el.firstFrame || 0) === f) btn.classList.add('current');
          btn.addEventListener('click', () => {
            dlg.querySelectorAll('.fp-cell').forEach((x) => x.classList.toggle('current', x === btn));
            ed.setFirstFrame(f, dlg.querySelector('[name="kf"]').checked);
          });
        });
      },
    });
  });

  add('lipSync', [], async () => {
    const it = ed.selectedItems().find((x) => x.el.type === 'instance');
    const sym = it && ed.symbol(it.el.symbolId);
    if (!sym) return ed.toast('Selecione a instância da boca (um símbolo gráfico com um quadro para cada boca).');
    const sounds = ed.doc.library.sounds;
    if (!sounds.length) return ed.toast('Importe a fala (Arquivo › Importar som) primeiro.');
    const n = timelineLength(sym);
    const opts = (def) => Array.from({ length: n }, (_, f) => `<option value="${f}" ${f === def ? 'selected' : ''}>Quadro ${f + 1}</option>`).join('');
    const layerSound = ed.layers.map((l) => l.frames.find((s) => s.sound)?.sound?.id).find(Boolean);
    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem(`fa-lipsync-${sym.id}`) || '{}');
      } catch {
        return {};
      }
    })();
    const keys = Object.keys(VISEMES);
    const r = await openDialog({
      title: `Lip-sync automático: ${sym.name}`,
      body: `<label class="dlg-row"><span>Fala</span><select name="snd">${sounds.map((s) => `<option value="${s.id}" ${s.id === layerSound ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <p class="dlg-text">Diga qual quadro do símbolo tem cada boca. Os keyframes são criados nesta camada a partir do quadro atual (${ed.frame + 1}).</p>
        <div class="ls-grid">${keys.map((k, i) => `<label><span>${esc(VISEMES[k])}</span><select name="v_${k}">${opts(saved[k] ?? Math.min(i, n - 1))}</select></label>`).join('')}</div>
        <label class="dlg-row"><span>Duração mínima (quadros)</span><input type="number" name="min" min="1" max="12" value="2"></label>
        <label class="dlg-row"><span>Sensibilidade ao silêncio (%)</span><input type="number" name="sil" min="2" max="50" value="12"></label>`,
      ok: 'Gerar',
    });
    if (!r) return;
    const map = {};
    for (const k of keys) map[k] = Number(r[`v_${k}`]);
    try {
      localStorage.setItem(`fa-lipsync-${sym.id}`, JSON.stringify(map));
    } catch {
      // sem armazenamento
    }
    const snd = sounds.find((s) => s.id === r.snd);
    const prog = openProgress('Analisando a fala');
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await decodeSound(actx, snd);
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
      }
      actx.close?.();
      const segs = analyzeLipSync(mono, buf.sampleRate, ed.doc.fps, { minLength: Number(r.min), silence: Number(r.sil) / 100 });
      ed.applyLipSync(it, segs.map((s) => ({ at: s.at, length: s.length, frame: map[s.viseme] ?? 0 })));
      ed.toast(`Lip-sync: ${segs.length} trocas de boca em ${Math.round(buf.duration * ed.doc.fps)} quadros.`);
    } catch (err) {
      ed.toast(`Não deu para analisar o som: ${err.message}`);
    } finally {
      prog.close();
    }
  });

  // ---------- alinhar ----------
  const align = (k) => () => ed.alignSelection(k, !!ed.alignToStage);
  add('alignLeft', ['Ctrl+Alt+1'], align('left'));
  add('alignHCenter', ['Ctrl+Alt+2'], align('hcenter'));
  add('alignRight', ['Ctrl+Alt+3'], align('right'));
  add('alignTop', ['Ctrl+Alt+4'], align('top'));
  add('alignVCenter', ['Ctrl+Alt+5'], align('vcenter'));
  add('alignBottom', ['Ctrl+Alt+6'], align('bottom'));
  add('distributeH', ['Ctrl+Alt+7'], align('distH'));
  add('distributeV', ['Ctrl+Alt+9'], align('distV'));
  add('matchWidth', [], align('matchW'));
  add('matchHeight', [], align('matchH'));

  // ---------- réguas, grade, guias, encaixe e vista ----------
  const setGrid = (patch, label) => ed.setDocProps({ grid: { ...ed.doc.grid, ...patch } }, label);
  const setGuides = (patch) => ed.setDocProps({ guides: { ...ed.doc.guides, ...patch } });
  add('resetRotation', [], () => stage.setRotation(0));
  add('toggleRulers', ['Ctrl+Alt+Shift+R'], () => {
    ed.showRulers = !ed.showRulers;
    stage.invalidate();
  });
  add('toggleGrid', ["Ctrl+'"], () => setGrid({ show: !ed.doc.grid.show }));
  add('toggleGuides', ['Ctrl+;'], () => setGuides({ show: !ed.doc.guides.show }));
  add('lockGuides', ['Ctrl+Alt+;'], () => setGuides({ locked: !ed.doc.guides.locked }));
  add('clearGuides', [], () => setGuides({ items: [] }));
  add('snapGrid', ["Ctrl+Shift+'"], () => {
    setGrid({ snap: !ed.doc.grid.snap });
    ed.toast(ed.doc.grid.snap ? 'Encaixar na grade: ligado' : 'Encaixar na grade: desligado');
  });
  add('snapGuides', ['Ctrl+Shift+;'], () => {
    setGuides({ snap: !ed.doc.guides.snap });
    ed.toast(ed.doc.guides.snap ? 'Encaixar nas guias: ligado' : 'Encaixar nas guias: desligado');
  });
  add('snapObjects', ['Ctrl+Shift+/'], () => {
    ed.snapObjects = ed.snapObjects === false;
    ed.toast(ed.snapObjects ? 'Encaixar em objetos: ligado' : 'Encaixar em objetos: desligado');
  });
  add('gridSettings', [], async () => {
    const g = ed.doc.grid, gu = ed.doc.guides;
    const r = await openDialog({
      title: 'Grade e guias',
      body: `<label class="dlg-row"><span>Mostrar grade</span><input type="checkbox" name="show" ${g.show ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Tamanho (px)</span><input type="number" name="size" min="2" max="500" value="${g.size}"></label>
        <label class="dlg-row"><span>Cor</span><input type="color" name="color" value="${g.color}"></label>
        <label class="dlg-row"><span>Encaixar na grade</span><input type="checkbox" name="snap" ${g.snap ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Mostrar réguas</span><input type="checkbox" name="rulers" ${ed.showRulers ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Mostrar guias</span><input type="checkbox" name="gshow" ${gu.show ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Travar guias</span><input type="checkbox" name="glock" ${gu.locked ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Encaixar nas guias</span><input type="checkbox" name="gsnap" ${gu.snap ? 'checked' : ''}></label>
        <label class="dlg-row"><span>Encaixar em objetos</span><input type="checkbox" name="osnap" ${ed.snapObjects !== false ? 'checked' : ''}></label>
        <p class="dlg-text">Arraste de uma régua para criar uma guia; arraste a guia de volta para a régua para tirá-la.</p>`,
    });
    if (!r) return;
    ed.group('Grade e guias', () => {
      setGrid({ show: r.show, size: Math.max(2, Number(r.size) || 20), color: r.color, snap: r.snap });
      setGuides({ show: r.gshow, locked: r.glock, snap: r.gsnap });
    });
    ed.showRulers = r.rulers;
    ed.snapObjects = r.osnap;
    stage.invalidate();
  });

  // ---------- localizar e substituir ----------
  add('findReplace', ['Ctrl+F'], async () => {
    await openDialog({
      title: 'Localizar e substituir',
      ok: 'Fechar',
      cancel: null,
      body: `<div class="fr-tabs"><label><input type="radio" name="mode" value="text" checked> Texto</label><label><input type="radio" name="mode" value="color"> Cor</label></div>
        <div class="fr-text">
          <label class="dlg-row"><span>Procurar</span><input type="text" name="q" autocomplete="off"></label>
          <label class="dlg-row"><span>Trocar por</span><input type="text" name="rep" autocomplete="off"></label>
          <div class="fr-opts"><label><input type="checkbox" name="cs"> Diferenciar maiúsculas</label><label><input type="checkbox" name="whole"> Palavra inteira</label></div>
          <div class="fr-btns"><button type="button" class="btn-flat" data-find>Localizar</button><button type="button" class="btn-flat" data-repl>Substituir tudo</button></div>
          <div class="fr-results"></div>
        </div>
        <div class="fr-color" hidden>
          <label class="dlg-row"><span>Cor atual</span><input type="color" name="from" value="${typeof ed.style.fill === 'string' ? ed.style.fill.slice(0, 7) : '#ff0000'}"></label>
          <label class="dlg-row"><span>Nova cor</span><input type="color" name="to" value="#00aaff"></label>
          <div class="fr-btns"><button type="button" class="btn-flat" data-color>Trocar em todo o documento</button></div>
          <p class="dlg-text fr-color-out"></p>
        </div>
        <p class="dlg-text">Procura em textos, nomes de instância, camadas, rótulos, scripts, símbolos e cenas, em todas as timelines.</p>`,
      onOpen: (dlg) => {
        const v = (n) => dlg.querySelector(`[name="${n}"]`);
        const out = dlg.querySelector('.fr-results');
        dlg.querySelectorAll('[name="mode"]').forEach((r) =>
          r.addEventListener('change', () => {
            dlg.querySelector('.fr-text').hidden = r.value !== 'text' || !r.checked;
            dlg.querySelector('.fr-color').hidden = r.value !== 'color' || !r.checked;
          }),
        );
        const opts = () => ({ caseSensitive: v('cs').checked, whole: v('whole').checked });
        const find = () => {
          const q = v('q').value;
          if (!q) return (out.innerHTML = '');
          const res = ed.findAll(q, opts());
          out.innerHTML = res.length
            ? res.map((x, i) => `<button type="button" class="fr-row" data-i="${i}"><b>${esc(x.kind)}</b> ${esc(String(x.text).slice(0, 60))}<span>${esc(x.where || '')}</span></button>`).join('')
            : '<div class="hint">Nada encontrado.</div>';
          out.querySelectorAll('.fr-row').forEach((b) => b.addEventListener('click', () => ed.reveal(res[Number(b.dataset.i)])));
        };
        v('q').addEventListener('input', find);
        v('q').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            find();
          }
        });
        dlg.querySelector('[data-find]').addEventListener('click', find);
        dlg.querySelector('[data-repl]').addEventListener('click', () => {
          const n = ed.replaceAll(v('q').value, v('rep').value, opts());
          ed.toast(`${n || 0} troca(s).`);
          find();
        });
        dlg.querySelector('[data-color]').addEventListener('click', () => {
          const n = ed.replaceColor(v('from').value, v('to').value);
          dlg.querySelector('.fr-color-out').textContent = `${n || 0} lugar(es) trocado(s).`;
        });
        setTimeout(() => v('q').focus(), 30);
      },
    });
  });

  // ---------- atalhos personalizáveis ----------
  const KEYS = 'fa-keys';
  const loadKeys = () => {
    try {
      return JSON.parse(localStorage.getItem(KEYS) || '{}') || {};
    } catch {
      return {};
    }
  };
  const toAccel = (k) => (k ? k.replace(/^Ctrl\+/, 'CmdOrCtrl+').replace(/\+Ctrl\+/, '+CmdOrCtrl+') : '');
  function applyKeys(map) {
    actions.setCustomKeys(map);
    const menu = {};
    for (const [id, keys] of Object.entries(map)) menu[id] = toAccel(keys[0] || '');
    api()?.setKeys?.(menu);
  }
  applyKeys(loadKeys());
  add('keyboardShortcuts', [], async () => {
    const custom = loadKeys();
    const ids = Object.keys(defs).sort((a, b) => (ACTION_LABELS[a] || a).localeCompare(ACTION_LABELS[b] || b));
    const keyOf = (id) => (custom[id] ?? defs[id].keys).join(', ');
    const r = await openDialog({
      title: 'Atalhos de teclado',
      ok: 'Salvar',
      body: `<input type="search" class="ks-filter" placeholder="Filtrar ações…">
        <p class="dlg-text">Clique no campo e aperte a combinação. Apague o campo para ficar sem atalho. Vários atalhos: separe por vírgula.</p>
        <div class="ks-list">${ids
          .map((id) => `<label class="ks-row" data-id="${id}"><span>${esc(ACTION_LABELS[id] || id)}</span><input type="text" name="k_${id}" value="${esc(keyOf(id))}" data-default="${esc(defs[id].keys.join(', '))}"></label>`)
          .join('')}</div>
        <p class="ks-conflict dlg-text"></p>
        <button type="button" class="btn-flat" data-reset>Restaurar todos os padrões</button>`,
      onOpen: (dlg) => {
        const filter = dlg.querySelector('.ks-filter');
        filter.addEventListener('input', () => {
          const q = filter.value.toLowerCase();
          dlg.querySelectorAll('.ks-row').forEach((row) => (row.hidden = q && !row.textContent.toLowerCase().includes(q) && !row.querySelector('input').value.toLowerCase().includes(q)));
        });
        const check = () => {
          const seen = new Map();
          const bad = [];
          dlg.querySelectorAll('.ks-row input').forEach((inp) => {
            inp.classList.remove('conflict');
            for (const k of inp.value.split(',').map((s) => s.trim()).filter(Boolean)) {
              const n = actions.normalize(k);
              if (seen.has(n)) {
                bad.push(k);
                inp.classList.add('conflict');
                seen.get(n).classList.add('conflict');
              } else seen.set(n, inp);
            }
          });
          dlg.querySelector('.ks-conflict').textContent = bad.length ? `Atalho repetido: ${[...new Set(bad)].join(', ')}` : '';
        };
        dlg.querySelectorAll('.ks-row input').forEach((inp) =>
          inp.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Tab' || e.key === 'Enter') return;
            e.preventDefault();
            if (e.key === 'Backspace' || e.key === 'Delete') inp.value = '';
            else if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) inp.value = actions.comboOf(e);
            check();
          }),
        );
        dlg.querySelector('[data-reset]').addEventListener('click', () => {
          dlg.querySelectorAll('.ks-row input').forEach((inp) => (inp.value = inp.dataset.default));
          check();
        });
        check();
      },
    });
    if (!r) return;
    const map = {};
    for (const id of ids) {
      const v = (r[`k_${id}`] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (v.join(',') !== defs[id].keys.join(',')) map[id] = v;
    }
    try {
      localStorage.setItem(KEYS, JSON.stringify(map));
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
    applyKeys(map);
    ed.toast('Atalhos salvos.');
  });

  // ---------- painéis e layouts ----------
  add('editorScripts', [], () => panels.show('scripts'));
  add('showActions', ['F9'], () => panels.show('actions'));
  add('showAlign', ['Ctrl+K'], () => panels.show('align'));
  add('showSceneExplorer', ['Alt+F3'], () => panels.show('scenes'));
  add('showComponents', ['Ctrl+F7'], () => panels.show('components'));
  add('showProps', ['Ctrl+F3'], () => panels.show('props'));
  add('saveLayout', [], async () => {
    const r = await openDialog({ title: 'Salvar layout', body: '<label class="dlg-row"><span>Nome</span><input type="text" name="name" required maxlength="40" value="Meu layout"></label>', ok: 'Salvar' });
    if (!r?.name?.trim()) return;
    panels.saveLayout(r.name.trim());
    ed.toast(`Layout "${r.name.trim()}" salvo.`);
  });
  add('manageLayouts', [], async () => {
    const names = Object.keys(panels.layouts());
    await openDialog({
      title: 'Layouts salvos',
      ok: 'Fechar',
      cancel: null,
      body: names.length
        ? `<div class="ly-list">${names.map((n) => `<div class="ly-row"><span>${esc(n)}</span><button type="button" class="btn-flat" data-load="${esc(n)}">Usar</button><button type="button" class="btn-flat" data-del="${esc(n)}">Apagar</button></div>`).join('')}</div>`
        : '<p class="dlg-text">Nenhum layout salvo ainda (Janela › Salvar layout…).</p>',
      onOpen: (dlg) => {
        dlg.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => panels.loadLayout(b.dataset.load)));
        dlg.querySelectorAll('[data-del]').forEach((b) =>
          b.addEventListener('click', () => {
            panels.deleteLayout(b.dataset.del);
            b.closest('.ly-row').remove();
          }),
        );
      },
    });
  });
  add('resetLayout', [], async () => {
    if (await confirmDialog('Layout padrão', 'Volta os painéis para o lugar de fábrica.', 'Restaurar')) panels.resetLayout();
  });

  actions.rebuildKeymap();
}
