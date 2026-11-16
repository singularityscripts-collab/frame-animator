// Processo principal do Electron: janela, menu, diálogos de arquivo e janela de teste.

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { html5Files } = require('./bundler.cjs');

// ffmpeg embutido (no app empacotado ele fica fora do .asar)
const FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const FILTERS = [
  { name: 'Frame Animator', extensions: ['fanim'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

let win = null;

// Caminhos que a interface pode gravar sem perguntar: só arquivos e pastas que o próprio usuário
// escolheu num diálogo (ou abriu). Qualquer outro caminho vindo da página é recusado.
const granted = new Set();
const grant = (p) => p && granted.add(path.resolve(p));
function isGranted(p) {
  if (typeof p !== 'string' || !p) return false;
  const r = path.resolve(p);
  for (const g of granted) {
    if (r === g) return true;
    const rel = path.relative(g, r);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}
/** Dentro da pasta, sem escapar com "../" (nem para uma pasta vizinha de nome parecido). */
function inside(dir, target) {
  const rel = path.relative(dir, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
let previewWin = null;
let previewData = null;
let closeConfirmed = false;
let rendererReady = false; // só pergunta sobre salvar se a interface carregou

const webPreferences = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1c1c20',
    title: 'Frame Animator',
    show: false,
    webPreferences,
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    if (closeConfirmed || !rendererReady || win.webContents.isCrashed()) return;
    e.preventDefault();
    win.webContents.send('app:close-requested');
  });
  win.on('closed', () => {
    win = null;
    previewWin?.close();
  });

  // links externos nunca abrem dentro do app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.FA_SMOKE || process.argv.includes('--smoke')) smokeTest();
}

// Teste automático: sobe o editor, salva em disco pela ponte IPC, abre a janela de teste e fecha.
// Uso: npm run smoke
function smokeTest() {
  const log = (name) => (e) => console.log(`[${name}:${e.level}] ${e.message}`);
  win.webContents.on('console-message', log('editor'));
  app.on('browser-window-created', (_e, w) => w.webContents.on('console-message', log('teste')));
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  grant(app.getPath('temp')); // só no smoke test
  win.webContents.once('did-finish-load', async () => {
    const fail = (msg) => {
      console.log(`SMOKE FALHOU: ${msg}`);
      process.exitCode = 1;
    };
    try {
      await wait(800);
      if (!(await js(`!!window.__fa && document.querySelectorAll('.layer-row').length > 0`))) throw new Error('editor não iniciou');
      console.log('ok: editor iniciou');

      const file = path.join(app.getPath('temp'), `fa-smoke-${Date.now()}.fanim`);
      const saved = await js(`(async () => {
        const { editor } = window.__fa;
        const g = await import('./model/geometry.js');
        editor.addElements([g.makeShape({ path: g.ellipsePath(100, 100), cx: 200, cy: 200, fill: '#f00', stroke: null, strokeWidth: 1 })]);
        editor.timelineOp('insertKeyframe');
        const doc = await import('./model/document.js');
        const r = await window.api.saveFile({ path: ${JSON.stringify(file)}, data: doc.serialize(editor.doc) });
        return r && r.path;
      })()`);
      const back = JSON.parse(await fs.readFile(saved, 'utf8'));
      const frames = back.scenes[0].layers[0].frames;
      if (frames.length !== 2 || frames[1].elements.length !== 1) throw new Error('arquivo salvo não confere');
      await fs.unlink(saved);
      console.log('ok: salvou e releu o arquivo');

      await js(`window.api.openPreview(JSON.stringify(window.__fa.editor.doc))`);
      await wait(1500);
      if (!previewWin) throw new Error('janela de teste não abriu');
      const info = await previewWin.webContents.executeJavaScript(`document.getElementById('info').textContent`);
      if (!/2 quadros/.test(info)) throw new Error(`janela de teste: "${info}"`);
      console.log(`ok: janela de teste tocando (${info})`);

      // Fase 2: símbolo gráfico com tween clássico + efeito de cor, e um movie clip animado por dentro
      const pixel = await js(`(async () => {
        const { editor: e } = window.__fa;
        const g = await import('./model/geometry.js');
        const R = await import('./player/render.js');
        e.load((await import('./model/document.js')).createDocument({ width: 320, height: 180, fps: 12 }), null);
        e.addElements([g.makeShape({ path: g.ellipsePath(60, 60), cx: 40, cy: 90, fill: '#0000ff', stroke: null, strokeWidth: 1 })]);
        e.selectAll();
        e.convertToSymbol({ name: 'Bola', type: 'graphic' });
        e.setFrame(11);
        e.timelineOp('insertKeyframe');
        e.selectAll();
        e.nudge(240, 0);
        e.setInstanceProps({ color: { mode: 'tint', tint: '#ff0000', tintAmount: 100 } });
        e.setFrame(0);
        e.createClassicTween();
        // movie clip que pisca dentro de si mesmo
        e.addLayer();
        const rect = g.makeShape({ path: g.rectPath(20, 20), cx: 160, cy: 20, fill: '#00ff00', stroke: null, strokeWidth: 1 });
        e.addElements([rect]);
        e.setSelection([rect.id]);
        e.convertToSymbol({ name: 'Pisca', type: 'movieclip' });
        // confere a cor no meio do tween: metade azul, metade vermelho
        const c = new OffscreenCanvas(320, 180);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        R.renderDocumentFrame(ctx, e.doc, 0, 6, {});
        const lf = R.layerFrame(e.doc.scenes[0].layers[1], 6);
        const m = lf.items[0].el.matrix;
        return [...ctx.getImageData(Math.round(m[4]), Math.round(m[5]), 1, 1).data];
      })()`);
      if (!(pixel[0] > 90 && pixel[0] < 170 && pixel[2] > 90 && pixel[2] < 170)) throw new Error(`cor do tween errada: ${pixel}`);
      console.log(`ok: tween clássico com efeito de cor (pixel no meio do caminho: rgb ${pixel.slice(0, 3)})`);

      const dir = path.join(app.getPath('temp'), `fa-smoke-export-${Date.now()}`);
      await fs.mkdir(dir, { recursive: true });
      for (const format of ['mp4', 'mov', 'gif', 'png']) {
        const out = path.join(dir, `teste.${format}`);
        const res = await js(`(async () => {
          const m = await import('./editor/export-ui.js');
          return m.runExport(window.__fa.editor, { format: '${format}', path: ${JSON.stringify(out)}, quiet: true, transparent: ${format !== 'mp4'} });
        })()`);
        if (!res || res.frames !== 12) throw new Error(`${format}: export devolveu ${JSON.stringify(res)}`);
        // decodifica com o próprio ffmpeg para garantir que o arquivo é válido
        const check = await new Promise((resolve) => {
          const p = spawn(FFMPEG, ['-v', 'error', '-i', res.path, '-f', 'null', '-'], { windowsHide: true });
          let err = '';
          p.stderr.on('data', (d) => (err += d));
          p.on('close', (code) => resolve({ code, err }));
        });
        if (check.code !== 0) throw new Error(`${format}: arquivo inválido: ${check.err}`);
        const size = (await fs.stat(res.path)).size;
        console.log(`ok: export ${format.toUpperCase()} (${res.frames} quadros, ${(size / 1024).toFixed(1)} KB)`);
      }
      const pngs = (await fs.readdir(dir)).filter((f) => /^teste\d{4}\.png$/.test(f));
      if (pngs.length !== 12) throw new Error(`sequência PNG com ${pngs.length} arquivos`);
      await fs.rm(dir, { recursive: true, force: true });

      // Fase 3: Paper.js carregado no app, gradiente + perfurar, pincel e balde
      const p3 = await js(`(async () => {
        const { editor: e, stage } = window.__fa;
        if (typeof paper === 'undefined') return { erro: 'Paper.js não carregou' };
        const g = await import('./model/geometry.js');
        const R = await import('./player/render.js');
        const V = await import('./model/vector-ops.js');
        const T = await import('./model/raster.js');
        e.load((await import('./model/document.js')).createDocument({ width: 200, height: 100 }), null);
        const grad = { type: 'linear', stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#0000ff', alpha: 1 }] };
        const a = g.makeShape({ path: g.rectPath(100, 80), cx: 60, cy: 50, fill: grad, stroke: null, strokeWidth: 1 });
        const b = g.makeShape({ path: g.ellipsePath(60, 60), cx: 110, cy: 50, fill: '#00ff00', stroke: null, strokeWidth: 1 });
        e.addElements([a, b]);
        e.selectAll();
        e.combineSelection('punch');
        const c = new OffscreenCanvas(200, 100);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        R.renderDocumentFrame(ctx, e.doc, 0, 0, {});
        const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
        const brush = V.fromPaper(V.cleanOutline(V.strokeOutline([{ x: 0, y: 0, w: 10 }, { x: 50, y: 0, w: 20 }]), 0.1));
        const ink = new Uint8Array(20 * 20);
        for (let i = 2; i < 18; i++) ink[2 * 20 + i] = ink[17 * 20 + i] = ink[i * 20 + 2] = ink[i * 20 + 17] = 1;
        const fill = T.floodFill(ink, 20, 20, 10, 10, 0);
        return { left: px(15, 50), right: px(75, 50), hole: px(100, 50), brush: !!brush, bucket: fill.status };
      })()`);
      if (p3.erro) throw new Error(p3.erro);
      const [l, r2, hole] = [p3.left, p3.right, p3.hole];
      if (!(l[0] > 200 && l[2] < 60)) throw new Error(`gradiente: esquerda devia ser vermelha, veio ${l}`);
      if (!(r2[2] > r2[0])) throw new Error(`gradiente: direita devia puxar para o azul, veio ${r2}`);
      if (hole.join() !== '255,255,255') throw new Error(`perfurar: o furo devia mostrar o fundo branco, veio ${hole}`);
      if (!p3.brush || p3.bucket !== 'ok') throw new Error(`pincel/balde: ${JSON.stringify(p3)}`);
      console.log(`ok: Paper.js no app, gradiente (${l} → ${r2}), perfurar (furo ${hole}), pincel e balde`);

      const gifOut = path.join(app.getPath('temp'), `fa-smoke-grad-${Date.now()}.gif`);
      const gres = await js(`(async () => (await import('./editor/export-ui.js')).runExport(window.__fa.editor, { format: 'gif', path: ${JSON.stringify(gifOut)}, quiet: true }))()`);
      if (!gres || gres.frames !== 1) throw new Error('export do gradiente falhou');
      await fs.unlink(gres.path);
      console.log('ok: export com gradiente');

      // Fase 4: máscara, câmera, som e várias cenas
      const p4 = await js(`(async () => {
        const { editor: e } = window.__fa;
        const g = await import('./model/geometry.js');
        const R = await import('./player/render.js');
        const A = await import('./player/audio.js');
        e.load((await import('./model/document.js')).createDocument({ width: 200, height: 100, fps: 10 }), null);
        const sq = (cx, cy, w, h, fill) => g.makeShape({ path: g.rectPath(w, h), cx, cy, fill, stroke: null, strokeWidth: 1 });
        e.addElements([sq(100, 50, 200, 100, '#ff0000')]);          // conteúdo: tudo vermelho
        e.addLayer();
        e.addElements([sq(50, 50, 100, 100, '#000000')]);           // máscara: só a metade esquerda
        e.setLayerKind(e.layers[0].id, 'mask');
        const c = new OffscreenCanvas(200, 100);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3).join();
        R.renderDocumentFrame(ctx, e.doc, 0, 0, {});
        const mask = { inside: px(25, 50), outside: px(175, 50) };
        // câmera com zoom 200 no canto: o quadrado vermelho enche a tela
        e.setLayerKind(e.layers[0].id, 'normal');
        e.deleteLayer(e.layers[0].id);
        e.addCamera();
        e.setCameraProps({ zoom: 200, x: 50, y: 25 });
        R.renderDocumentFrame(ctx, e.doc, 0, 0, {});
        const cam = px(190, 90);
        // som de 0,5 s e uma segunda cena
        const oac = new OfflineAudioContext(1, 11025, 22050);
        const osc = oac.createOscillator(); osc.connect(oac.destination); osc.start(); osc.stop(0.5);
        const wav = A.encodeWav(await oac.startRendering());
        let bin = ''; new Uint8Array(wav).forEach((b) => (bin += String.fromCharCode(b)));
        const snd = e.importSound({ name: 'bip', mime: 'audio/wav', data: btoa(bin), duration: 0.5 });
        e.setActiveLayer(e.layers[1].id);
        e.setSpanSound({ id: snd.id, sync: 'event' });
        e.setFrame(9); e.timelineOp('insertFrame');
        e.addScene();
        e.addElements([sq(100, 50, 50, 50, '#00ff00')]);
        e.setFrame(4); e.timelineOp('insertFrame');
        e.setScene(0);
        return { mask, cam, movie: R.movieLength(e.doc) };
      })()`);
      if (p4.mask.inside !== '255,0,0' || p4.mask.outside !== '255,255,255') throw new Error(`máscara errada: ${JSON.stringify(p4.mask)}`);
      if (p4.cam !== '255,0,0') throw new Error(`câmera errada: ${p4.cam}`);
      if (p4.movie !== 15) throw new Error(`filme com ${p4.movie} quadros`);
      console.log(`ok: máscara (dentro ${p4.mask.inside}, fora ${p4.mask.outside}) e câmera com zoom`);
      const mp4 = path.join(app.getPath('temp'), `fa-smoke-som-${Date.now()}.mp4`);
      const sres = await js(`(async () => (await import('./editor/export-ui.js')).runExport(window.__fa.editor, { format: 'mp4', path: ${JSON.stringify(mp4)}, quiet: true, allScenes: true }))()`);
      if (!sres || sres.frames !== 15) throw new Error(`export de todas as cenas: ${JSON.stringify(sres)}`);
      const probe = await new Promise((resolve) => {
        const pr = spawn(FFMPEG, ['-hide_banner', '-i', sres.path], { windowsHide: true });
        let err = '';
        pr.stderr.on('data', (d) => (err += d));
        pr.on('close', () => resolve(err));
      });
      if (!/Audio: aac/.test(probe)) throw new Error('o MP4 saiu sem faixa de áudio');
      await fs.unlink(sres.path);
      console.log('ok: export de todas as cenas (15 quadros) com áudio AAC no MP4');

      // Fase 5: ferramentas e painéis novos, exports HTML5/Lottie/SVG/sprite sheet e o pacote HTML5 rodando
      const p5 = await js(`(async () => {
        const { editor: e, stage, actions, panels } = window.__fa;
        const g = await import('./model/geometry.js');
        e.load((await import('./model/document.js')).createDocument({ width: 200, height: 100, fps: 10 }), null);
        const sq = g.makeShape({ path: g.rectPath(40, 40), cx: 50, cy: 50, fill: '#ff0000', stroke: '#000000', strokeWidth: 2 });
        e.addElements([sq]);
        e.setSelection([sq.id]);
        e.convertToSymbol({ name: 'Botao', type: 'button' });
        e.updateSelection('n', (el) => { el.name = 'botao'; el.filters = [{ type: 'dropShadow', distance: 4, angle: 45, blur: 4, color: '#000000', alpha: 60, strength: 1, enabled: true }]; });
        e.addText(100, 10, 'Oi', { kind: 'dynamic', name: 'placar' });
        e.setFrame(9); e.timelineOp('insertFrame'); e.setFrame(0);
        e.setSpanScript("this.stop(); this.getChild('botao').on('click', () => { this.getChild('placar').text = 'clicou'; this.gotoAndStop(5); });");
        const tools = Object.keys(stage.tools).length;
        const tabs = document.querySelectorAll('.dock .tab').length;
        panels.show('actions');
        const code = document.querySelector('.ap-code').value;
        const L = await import('./export/lottie.js');
        const S = await import('./export/svg.js');
        const lottie = L.toLottie(e.doc, {});
        const svg = S.frameToSVG(e.doc, 0, 0, {});
        return { tools, tabs, code, lottieLayers: lottie.layers.length, svgPaths: (svg.match(/<path/g) || []).length };
      })()`);
      if (p5.tools < 27 || !/this\.stop/.test(p5.code) || p5.lottieLayers < 2 || p5.svgPaths < 2) throw new Error(`fase 5 no editor: ${JSON.stringify(p5)}`);
      console.log(`ok: ${p5.tools} ferramentas, painéis encaixáveis, painel Ações com o script, Lottie (${p5.lottieLayers} camadas) e SVG`);
      const h5dir = path.join(app.getPath('temp'), `fa-smoke-html5-${Date.now()}`);
      const h5 = await js(`window.api.exportHTML5({ doc: JSON.stringify(window.__fa.editor.doc), options: { loop: true, scale: 'fit', title: 'Smoke' }, dir: ${JSON.stringify(h5dir)} })`);
      if (!h5?.path) throw new Error('export HTML5 não devolveu caminho');
      const h5win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
      const h5errors = [];
      h5win.webContents.on('console-message', (e) => e.level === 'error' && h5errors.push(e.message));
      await h5win.loadFile(h5.path);
      await wait(700);
      const before = await h5win.webContents.executeJavaScript(`({ ok: !!window.faRuntime, frame: window.faRuntime && window.faRuntime.frame, w: document.getElementById('fa-stage').width })`);
      // clica no botão (o runtime registra a área de clique ao desenhar)
      const hit = await h5win.webContents.executeJavaScript(`(() => {
        const rt = window.faRuntime, c = document.getElementById('fa-stage');
        const h = rt.hits.find((x) => x.path.endsWith('/botao'));
        if (!h) return { erro: 'sem área de clique' };
        const r = c.getBoundingClientRect();
        const p = { x: h.m[0] * (h.box.x + h.box.w / 2) + h.m[2] * (h.box.y + h.box.h / 2) + h.m[4], y: h.m[1] * (h.box.x + h.box.w / 2) + h.m[3] * (h.box.y + h.box.h / 2) + h.m[5] };
        const cx = r.left + (p.x * r.width) / c.width, cy = r.top + (p.y * r.height) / c.height;
        for (const t of ['pointerdown', 'pointerup']) (t === 'pointerup' ? window : c).dispatchEvent(new PointerEvent(t, { clientX: cx, clientY: cy, bubbles: true }));
        return { frame: rt.frame, text: rt.texts.get('/' + (rt.doc.scenes[0].layers[0].frames[0].elements.find((x) => x.name === 'placar') ? 'placar' : '')) };
      })()`);
      h5win.destroy();
      await fs.rm(h5dir, { recursive: true, force: true });
      if (!before.ok || before.frame !== 0 || !before.w) throw new Error(`HTML5 não iniciou: ${JSON.stringify(before)}`);
      if (hit.erro || hit.frame !== 4) throw new Error(`HTML5: clique no botão não funcionou: ${JSON.stringify(hit)}`);
      if (h5errors.length) throw new Error(`HTML5 com erros no console: ${h5errors.join(' | ')}`);
      console.log(`ok: pacote HTML5 roda sozinho (parado no quadro 1 pelo script; clique no botão → quadro ${hit.frame + 1})`);
      const files5 = await js(`(async () => {
        const SP = await import('./export/spritesheet.js');
        const { canvas, json } = await SP.buildSpriteSheet(window.__fa.editor.doc, { trim: true });
        return { w: canvas.width, h: canvas.height, frames: Object.keys(json.frames).length };
      })()`);
      if (files5.frames !== 10 || !files5.w) throw new Error(`sprite sheet: ${JSON.stringify(files5)}`);
      console.log(`ok: sprite sheet ${files5.w}×${files5.h} com ${files5.frames} quadros`);
      console.log('SMOKE OK');
    } catch (err) {
      fail(err.message);
    }
    closeConfirmed = true;
    app.quit();
  });
}

function send(action) {
  return () => win?.webContents.send('menu:action', action);
}

// Os atalhos aparecem no menu, mas quem trata as teclas é o editor (registerAccelerator: false),
// para que funcionem igual no menu, nos botões e dentro de campos de texto.
let customKeys = {}; // ação → atalho (vindo da tela de atalhos)
function item(label, action, accelerator) {
  const custom = customKeys[action];
  return { label, accelerator: custom === undefined ? accelerator : custom || undefined, registerAccelerator: false, click: send(action) };
}

function buildMenu() {
  const template = [
    {
      label: '&Arquivo',
      submenu: [
        item('Novo', 'new', 'CmdOrCtrl+N'),
        item('Abrir…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Salvar', 'save', 'CmdOrCtrl+S'),
        item('Salvar como…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Importar imagem…', 'importImage', 'CmdOrCtrl+Alt+I'),
        item('Importar som…', 'importSound'),
        item('Importar do Animate (.fla / XFL)…', 'importAnimate'),
        { type: 'separator' },
        item('Testar filme', 'testScene', 'CmdOrCtrl+Enter'),
        {
          label: 'Exportar',
          submenu: [
            item('Vídeo, GIF ou PNG…', 'exportMedia', 'CmdOrCtrl+Alt+Shift+S'),
            item('HTML5 Canvas (interativo)…', 'exportHTML5'),
            item('Lottie (JSON)…', 'exportLottie'),
            item('Sprite sheet + JSON…', 'exportSprites'),
            item('SVG por quadro…', 'exportSVG'),
          ],
        },
        item('Configurações de publicação…', 'publishSettings', 'CmdOrCtrl+Shift+F12'),
        item('Publicar', 'publish', 'Shift+F12'),
        { type: 'separator' },
        { label: 'Sair', role: 'quit' },
      ],
    },
    {
      label: '&Editar',
      submenu: [
        item('Desfazer', 'undo', 'CmdOrCtrl+Z'),
        item('Refazer', 'redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        item('Recortar', 'cut', 'CmdOrCtrl+X'),
        item('Copiar', 'copy', 'CmdOrCtrl+C'),
        item('Colar', 'paste', 'CmdOrCtrl+V'),
        item('Colar no lugar', 'pasteInPlace', 'CmdOrCtrl+Shift+V'),
        item('Duplicar', 'duplicate', 'CmdOrCtrl+D'),
        item('Apagar', 'delete', 'Delete'),
        { type: 'separator' },
        item('Selecionar tudo', 'selectAll', 'CmdOrCtrl+A'),
        item('Desmarcar tudo', 'deselect', 'CmdOrCtrl+Shift+A'),
        { type: 'separator' },
        item('Localizar e substituir…', 'findReplace', 'CmdOrCtrl+F'),
        item('Atalhos de teclado…', 'keyboardShortcuts'),
        item('Scripts do editor…', 'editorScripts'),
      ],
    },
    {
      label: '&Inserir',
      submenu: [
        item('Novo símbolo…', 'newSymbol', 'CmdOrCtrl+F8'),
        item('Converter em símbolo…', 'convertToSymbol', 'F8'),
        { type: 'separator' },
        item('Criar tween clássico', 'createClassicTween'),
        item('Criar motion tween', 'createMotionTween'),
        item('Criar shape tween', 'createShapeTween'),
        item('Remover tween', 'removeTween'),
        item('Dica de forma', 'addShapeHint', 'CmdOrCtrl+Shift+H'),
        item('Editor de movimento…', 'motionEditor'),
        item('Easing personalizado…', 'customEase'),
        { type: 'separator' },
        item('Nova cena', 'newScene'),
        item('Duplicar cena', 'duplicateScene'),
        item('Renomear cena…', 'renameScene'),
        item('Apagar cena', 'deleteScene'),
        { type: 'separator' },
        item('Câmera (liga/desliga)', 'toggleCamera'),
        { type: 'separator' },
        item('Texto', 'toolText', 'T'),
        {
          label: 'Componente',
          submenu: [item('Botão', 'insertButtonComponent'), item('Lista', 'insertListComponent'), item('Vídeo', 'insertVideoComponent')],
        },
      ],
    },
    {
      label: '&Modificar',
      submenu: [
        item('Editar símbolo / voltar à cena', 'editSymbol', 'CmdOrCtrl+E'),
        { type: 'separator' },
        item('Distribuir para keyframes', 'distributeToKeyframes', 'CmdOrCtrl+Shift+K'),
        item('Distribuir para camadas', 'distributeToLayers', 'CmdOrCtrl+Shift+D'),
        { type: 'separator' },
        item('Separar (break apart)', 'breakApart', 'CmdOrCtrl+B'),
        item('Otimizar curvas…', 'optimizeCurves', 'CmdOrCtrl+Alt+Shift+C'),
        item('Vetorizar bitmap…', 'traceBitmap'),
        item('Desenho de objeto (liga/desliga)', 'toggleObjectDrawing', 'J'),
        { type: 'separator' },
        item('Escala de 9 fatias…', 'scale9'),
        item('Seletor de quadro…', 'framePicker'),
        item('Lip-sync automático…', 'lipSync'),
        {
          label: 'Alinhar',
          submenu: [
            item('Esquerda', 'alignLeft', 'CmdOrCtrl+Alt+1'),
            item('Centro horizontal', 'alignHCenter', 'CmdOrCtrl+Alt+2'),
            item('Direita', 'alignRight', 'CmdOrCtrl+Alt+3'),
            item('Topo', 'alignTop', 'CmdOrCtrl+Alt+4'),
            item('Centro vertical', 'alignVCenter', 'CmdOrCtrl+Alt+5'),
            item('Base', 'alignBottom', 'CmdOrCtrl+Alt+6'),
            { type: 'separator' },
            item('Distribuir na horizontal', 'distributeH', 'CmdOrCtrl+Alt+7'),
            item('Distribuir na vertical', 'distributeV', 'CmdOrCtrl+Alt+9'),
            item('Mesma largura', 'matchWidth'),
            item('Mesma altura', 'matchHeight'),
          ],
        },
        {
          label: 'Combinar objetos',
          submenu: [
            item('Unir', 'combineUnion'),
            item('Interseção', 'combineIntersect'),
            item('Perfurar', 'combinePunch'),
            item('Recortar', 'combineCrop'),
          ],
        },
        { type: 'separator' },
        item('Trazer para a frente', 'arrangeFront', 'CmdOrCtrl+Shift+Up'),
        item('Trazer um nível', 'arrangeForward', 'CmdOrCtrl+Up'),
        item('Enviar um nível', 'arrangeBackward', 'CmdOrCtrl+Down'),
        item('Enviar para trás', 'arrangeBack', 'CmdOrCtrl+Shift+Down'),
      ],
    },
    {
      label: 'E&xibir',
      submenu: [
        item('Aumentar zoom', 'zoomIn', 'CmdOrCtrl+='),
        item('Diminuir zoom', 'zoomOut', 'CmdOrCtrl+-'),
        item('100%', 'zoom100', 'CmdOrCtrl+1'),
        item('Ajustar à janela', 'zoomFit', 'CmdOrCtrl+0'),
        { type: 'separator' },
        item('Girar a vista para 0°', 'resetRotation'),
        { type: 'separator' },
        item('Réguas', 'toggleRulers', 'CmdOrCtrl+Alt+Shift+R'),
        item('Grade', 'toggleGrid', "CmdOrCtrl+'"),
        item('Guias', 'toggleGuides', 'CmdOrCtrl+;'),
        item('Travar guias', 'lockGuides', 'CmdOrCtrl+Alt+;'),
        item('Limpar guias', 'clearGuides'),
        item('Grade e guias…', 'gridSettings'),
        {
          label: 'Encaixar',
          submenu: [item('Na grade', 'snapGrid', "CmdOrCtrl+Shift+'"), item('Nas guias', 'snapGuides', 'CmdOrCtrl+Shift+;'), item('Em objetos', 'snapObjects', 'CmdOrCtrl+Shift+/')],
        },
        { type: 'separator' },
        item('Onion skin', 'toggleOnion', 'Alt+Shift+O'),
        { type: 'separator' },
        item('Cores', 'showColors', 'CmdOrCtrl+Shift+F9'),
        item('Biblioteca', 'showLibrary', 'CmdOrCtrl+L'),
      ],
    },
    {
      label: '&Controle',
      submenu: [
        item('Reproduzir / parar', 'togglePlay', 'Enter'),
        item('Repetir reprodução', 'toggleLoop'),
        { type: 'separator' },
        item('Quadro anterior', 'prevFrame', ','),
        item('Próximo quadro', 'nextFrame', '.'),
        item('Primeiro quadro', 'firstFrame', 'Home'),
        item('Último quadro', 'lastFrame', 'End'),
      ],
    },
    {
      label: '&Timeline',
      submenu: [
        item('Inserir quadro', 'insertFrame', 'F5'),
        item('Remover quadro', 'removeFrame', 'Shift+F5'),
        { type: 'separator' },
        item('Inserir keyframe', 'insertKeyframe', 'F6'),
        item('Inserir keyframe vazio', 'insertBlankKeyframe', 'F7'),
        item('Limpar keyframe', 'clearKeyframe', 'Shift+F6'),
        { type: 'separator' },
        item('Recortar quadros', 'cutFrames', 'CmdOrCtrl+Alt+X'),
        item('Copiar quadros', 'copyFrames', 'CmdOrCtrl+Alt+C'),
        item('Colar quadros', 'pasteFrames', 'CmdOrCtrl+Alt+V'),
        item('Colar e substituir quadros', 'pasteFramesOverwrite'),
        item('Inverter quadros', 'reverseFrames'),
        item('Editar vários quadros', 'toggleMulti'),
        { type: 'separator' },
        item('Nova camada', 'newLayer'),
        item('Nova pasta de camadas', 'newLayerFolder'),
        item('Guia de movimento', 'addMotionGuide'),
        item('Propriedades da camada…', 'layerProperties'),
        item('Apagar camada', 'deleteLayer'),
        { type: 'separator' },
        item('Cena anterior', 'prevScene', 'Shift+PageUp'),
        item('Próxima cena', 'nextScene', 'Shift+PageDown'),
      ],
    },
    {
      label: '&Janela',
      submenu: [
        item('Ações (código do quadro)', 'showActions', 'F9'),
        item('Alinhar', 'showAlign', 'CmdOrCtrl+K'),
        item('Explorador de cenas', 'showSceneExplorer', 'Alt+F3'),
        item('Componentes', 'showComponents', 'CmdOrCtrl+F7'),
        item('Propriedades', 'showProps', 'CmdOrCtrl+F3'),
        { type: 'separator' },
        item('Salvar layout…', 'saveLayout'),
        item('Layouts salvos…', 'manageLayouts'),
        item('Restaurar layout padrão', 'resetLayout'),
      ],
    },
    {
      label: 'Desenvol&vedor',
      submenu: [
        { label: 'Recarregar', role: 'forceReload', accelerator: 'CmdOrCtrl+R' },
        { label: 'Ferramentas do desenvolvedor', role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Abrir animação', filters: FILTERS, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  grant(p);
  return { path: p, data: await fs.readFile(p, 'utf8') };
});

ipcMain.handle('file:save', async (_e, { path: target, data, defaultName }) => {
  if (typeof data !== 'string') throw new Error('Dados inválidos');
  let p = target && isGranted(target) ? target : null;
  if (!p) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Salvar animação',
      defaultPath: defaultName || 'Sem título.fanim',
      filters: FILTERS,
    });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
    grant(p);
  }
  // grava num arquivo temporário e renomeia, para não corromper o original se algo falhar
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, p);
  app.addRecentDocument(p);
  return { path: p };
});

ipcMain.handle('app:confirm-unsaved', async (_e, name) => {
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Salvar', 'Não salvar', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'Frame Animator',
    message: `Salvar as alterações em "${name}"?`,
    detail: 'Se não salvar, as alterações serão perdidas.',
  });
  return ['save', 'discard', 'cancel'][r.response];
});

ipcMain.on('app:close-confirmed', () => {
  closeConfirmed = true;
  win?.close();
});

ipcMain.on('app:ready', () => (rendererReady = true));

ipcMain.on('app:set-title', (_e, title) => {
  if (typeof title === 'string') win?.setTitle(title);
});

ipcMain.on('preview:open', (_e, data) => {
  previewData = data;
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.webContents.reload();
    previewWin.focus();
    return;
  }
  previewWin = new BrowserWindow({
    width: 960,
    height: 600,
    parent: win,
    backgroundColor: '#111114',
    title: 'Testar cena',
    autoHideMenuBar: true,
    webPreferences: { ...webPreferences, preload: path.join(__dirname, 'preload-preview.cjs') },
  });
  previewWin.setMenu(null);
  // os scripts do filme não levam esta janela para outra página; links abrem no navegador
  previewWin.webContents.on('will-navigate', (e) => e.preventDefault());
  previewWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  previewWin.loadFile(path.join(__dirname, 'src', 'preview.html'));
  previewWin.on('closed', () => (previewWin = null));
});

ipcMain.handle('preview:get-data', () => previewData);

// ---------- Exportar ----------
const EXPORTS = {
  mp4: { ext: 'mp4', name: 'Vídeo MP4' },
  mov: { ext: 'mov', name: 'Vídeo QuickTime' },
  gif: { ext: 'gif', name: 'GIF animado' },
  png: { ext: 'png', name: 'Imagem PNG' },
};
const jobs = new Map();

function ffmpegArgs(o, out, wav) {
  let input = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', '-'];
  // som mixado pelo editor entra como segunda entrada; o vídeo manda na duração
  const audio = (codec) => (wav ? ['-map', '0:v', '-map', '1:a', '-c:a', ...codec, '-af', 'apad', '-shortest'] : []);
  if (wav) input = [...input, '-i', wav];
  if (o.format === 'mp4') {
    return [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', ...audio(['aac', '-b:a', '192k']), '-movflags', '+faststart', out];
  }
  if (o.format === 'mov') {
    return o.transparent
      ? [...input, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', ...audio(['pcm_s16le']), out]
      : [...input, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', ...audio(['pcm_s16le']), out];
  }
  // gif: paleta própria gerada a partir da animação inteira
  const palette = `palettegen=stats_mode=full:reserve_transparent=${o.transparent ? 1 : 0}`;
  return [...input, '-filter_complex', `[0:v]split[a][b];[a]${palette}[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', String(o.gifLoop), out];
}

ipcMain.handle('export:begin', async (_e, o) => {
  const fmt = EXPORTS[o?.format];
  if (!fmt) throw new Error('Formato desconhecido');
  const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  o = {
    format: o.format,
    width: int(o.width, 1, 8192),
    height: int(o.height, 1, 8192),
    fps: int(o.fps, 1, 120),
    transparent: !!o.transparent,
    gifLoop: o.gifLoop === -1 ? -1 : 0,
    path: typeof o.path === 'string' ? o.path : null,
    defaultName: String(o.defaultName || 'Animação'),
    audio: (o.format === 'mp4' || o.format === 'mov') && o.audio && o.audio.byteLength > 44 ? Buffer.from(o.audio) : null,
  };
  let out = o.path && isGranted(o.path) ? o.path : null;
  if (!out) {
    const r = await dialog.showSaveDialog(win, {
      title: o.format === 'png' ? 'Exportar sequência PNG (nome base dos arquivos)' : 'Exportar animação',
      defaultPath: `${o.defaultName}.${fmt.ext}`,
      filters: [{ name: fmt.name, extensions: [fmt.ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    out = r.filePath;
    grant(out);
  }
  const id = crypto.randomUUID();
  const job = { o, out, count: 0, stderr: '' };
  if (o.format === 'png') {
    job.base = out.replace(/\.png$/i, '');
    job.files = [];
  } else {
    if (o.audio) {
      job.wav = path.join(app.getPath('temp'), `fa-audio-${id}.wav`);
      await fs.writeFile(job.wav, o.audio);
    }
    const proc = spawn(FFMPEG, ffmpegArgs(o, out, job.wav), { windowsHide: true });
    job.proc = proc;
    job.exit = new Promise((resolve) => {
      proc.on('error', (err) => {
        job.stderr += err.message;
        resolve(-1);
      });
      proc.on('close', (code) => resolve(code));
    });
    proc.stderr.on('data', (d) => (job.stderr = (job.stderr + d).slice(-4000)));
    proc.stdin.on('error', () => {}); // o erro real aparece no código de saída
  }
  jobs.set(id, job);
  return { id, path: out };
});

ipcMain.handle('export:frame', async (_e, id, data) => {
  const job = jobs.get(id);
  if (!job) throw new Error('Exportação não encontrada');
  const buf = Buffer.from(data);
  job.count++;
  if (job.base) {
    const file = `${job.base}${String(job.count).padStart(4, '0')}.png`;
    await fs.writeFile(file, buf);
    job.files.push(file);
    return;
  }
  if (job.proc.exitCode !== null) throw new Error(`ffmpeg parou: ${job.stderr.trim() || 'erro desconhecido'}`);
  if (!job.proc.stdin.write(buf)) await Promise.race([once(job.proc.stdin, 'drain'), job.exit]);
});

ipcMain.handle('export:end', async (_e, id) => {
  const job = jobs.get(id);
  if (!job) throw new Error('Exportação não encontrada');
  jobs.delete(id);
  if (job.base) return { path: job.files[0] || job.out, frames: job.count };
  job.proc.stdin.end();
  const code = await job.exit;
  if (job.wav) await fs.unlink(job.wav).catch(() => {});
  if (code !== 0) {
    await fs.unlink(job.out).catch(() => {});
    throw new Error(`ffmpeg falhou (${code}): ${job.stderr.trim().split('\n').pop() || 'sem detalhes'}`);
  }
  return { path: job.out, frames: job.count };
});

ipcMain.handle('export:cancel', async (_e, id) => {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  if (job.base) {
    await Promise.all(job.files.map((f) => fs.unlink(f).catch(() => {})));
    return;
  }
  job.proc.kill();
  await job.exit;
  await fs.unlink(job.out).catch(() => {});
  if (job.wav) await fs.unlink(job.wav).catch(() => {});
});

const AUDIO_TYPES = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' };
ipcMain.handle('file:open-audio', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importar som',
    filters: [{ name: 'Áudio', extensions: Object.keys(AUDIO_TYPES) }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const stat = await fs.stat(p);
  if (stat.size > 200 * 1024 * 1024) throw new Error('Arquivo de áudio muito grande (máximo 200 MB).');
  const ext = path.extname(p).slice(1).toLowerCase();
  return { name: path.basename(p), mime: AUDIO_TYPES[ext] || 'audio/mpeg', data: (await fs.readFile(p)).toString('base64') };
});

// ---------- fase final: imagens, vídeo, Animate, exports em pasta, atalhos ----------
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
async function openBinary(title, types, maxMB) {
  const r = await dialog.showOpenDialog(win, { title, filters: [{ name: title, extensions: Object.keys(types) }], properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return null;
  const out = [];
  for (const p of r.filePaths) {
    const stat = await fs.stat(p);
    if (stat.size > maxMB * 1024 * 1024) throw new Error(`${path.basename(p)} é muito grande (máximo ${maxMB} MB).`);
    const ext = path.extname(p).slice(1).toLowerCase();
    out.push({ name: path.basename(p, path.extname(p)), mime: types[ext] || 'application/octet-stream', data: (await fs.readFile(p)).toString('base64') });
  }
  return out;
}
ipcMain.handle('file:open-image', () => openBinary('Imagens', IMAGE_TYPES, 60));
ipcMain.handle('file:open-video', async () => (await openBinary('Vídeos', { mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime' }, 150))?.[0] || null);

/** Lê um zip (o .fla é um zip com o XFL dentro). Devolve { caminho: Buffer }. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo .fla inválido (não é um zip).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const lstart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(lstart, lstart + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
  }
  return files;
}

async function readDirRec(dir, base = dir, out = {}) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await readDirRec(full, base, out);
    else out[path.relative(base, full).split(path.sep).join('/')] = await fs.readFile(full);
  }
  return out;
}

ipcMain.handle('file:open-animate', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importar do Animate',
    filters: [{ name: 'Animate (.fla, .xfl)', extensions: ['fla', 'xfl'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const raw = path.extname(p).toLowerCase() === '.fla' ? readZip(await fs.readFile(p)) : await readDirRec(path.dirname(p));
  // XML vai como texto; o resto (imagens, sons) como base64
  const files = {};
  for (const [k, v] of Object.entries(raw)) files[k] = /\.(xml|xfl)$/i.test(k) ? { text: v.toString('utf8') } : { base64: v.toString('base64') };
  return { name: path.basename(p, path.extname(p)), files };
});

/** Grava vários arquivos numa pasta nova (o usuário escolhe o nome) ou um arquivo só. */
ipcMain.handle('export:write', async (_e, o) => {
  const single = o.files.length === 1 && !o.folder;
  const r = await dialog.showSaveDialog(win, {
    title: o.title || 'Exportar',
    defaultPath: single ? o.files[0].name : o.defaultName,
    filters: single ? [{ name: o.filterName || 'Arquivo', extensions: [path.extname(o.files[0].name).slice(1)] }] : [{ name: 'Pasta', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePath) return null;
  if (single) {
    const f = o.files[0];
    await fs.writeFile(r.filePath, f.base64 ? Buffer.from(f.base64, 'base64') : f.text);
    grant(r.filePath);
    return { path: r.filePath };
  }
  const dir = r.filePath.replace(/\.[^\\/.]+$/, '');
  await fs.mkdir(dir, { recursive: true });
  grant(dir);
  for (const f of o.files) {
    const target = path.join(dir, f.name);
    if (!inside(dir, target)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, f.base64 ? Buffer.from(f.base64, 'base64') : f.text);
  }
  return { path: path.join(dir, o.files[0].name) };
});

ipcMain.handle('export:html5', async (_e, o) => {
  const doc = JSON.parse(o.doc);
  const files = html5Files(path.join(__dirname, 'src', 'player'), doc, o.options || {});
  let dir = o.dir && isGranted(o.dir) ? o.dir : null;
  if (!dir) {
    const r = await dialog.showSaveDialog(win, { title: 'Exportar HTML5 (nome da pasta)', defaultPath: o.defaultName || 'animacao-html5' });
    if (r.canceled || !r.filePath) return null;
    dir = r.filePath.replace(/\.[^\\/.]+$/, '');
    grant(dir);
  }
  await fs.mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  return { path: path.join(dir, 'index.html') };
});

ipcMain.on('keys:set', (_e, map) => {
  customKeys = map && typeof map === 'object' ? map : {};
  buildMenu();
});

ipcMain.on('shell:show', (_e, p) => {
  if (typeof p === 'string') shell.showItemInFolder(p);
});


app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
