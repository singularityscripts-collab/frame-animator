// Processo principal do Electron: janela, menu, diálogos de arquivo e janela de teste.

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');

// ffmpeg embutido (no app empacotado ele fica fora do .asar)
const FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const FILTERS = [
  { name: 'Frame Animator', extensions: ['fanim'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

let win = null;
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
function item(label, action, accelerator) {
  return { label, accelerator, registerAccelerator: false, click: send(action) };
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
        item('Testar cena', 'testScene', 'CmdOrCtrl+Enter'),
        item('Exportar animação…', 'exportMedia', 'CmdOrCtrl+Alt+Shift+S'),
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
      ],
    },
    {
      label: '&Inserir',
      submenu: [
        item('Novo símbolo…', 'newSymbol', 'CmdOrCtrl+F8'),
        item('Converter em símbolo…', 'convertToSymbol', 'F8'),
        { type: 'separator' },
        item('Criar tween clássico', 'createClassicTween'),
        item('Remover tween', 'removeTween'),
      ],
    },
    {
      label: '&Modificar',
      submenu: [
        item('Editar símbolo / voltar à cena', 'editSymbol', 'CmdOrCtrl+E'),
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
        item('Onion skin', 'toggleOnion', 'Alt+Shift+O'),
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
        item('Nova camada', 'newLayer'),
        item('Apagar camada', 'deleteLayer'),
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
  return { path: p, data: await fs.readFile(p, 'utf8') };
});

ipcMain.handle('file:save', async (_e, { path: target, data, defaultName }) => {
  if (typeof data !== 'string') throw new Error('Dados inválidos');
  let p = target;
  if (!p) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Salvar animação',
      defaultPath: defaultName || 'Sem título.fanim',
      filters: FILTERS,
    });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
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
    webPreferences,
  });
  previewWin.setMenu(null);
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

function ffmpegArgs(o, out) {
  const input = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', '-'];
  if (o.format === 'mp4') {
    return [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', out];
  }
  if (o.format === 'mov') {
    return o.transparent
      ? [...input, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', out]
      : [...input, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', out];
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
  };
  let out = o.path;
  if (!out) {
    const r = await dialog.showSaveDialog(win, {
      title: o.format === 'png' ? 'Exportar sequência PNG (nome base dos arquivos)' : 'Exportar animação',
      defaultPath: `${o.defaultName}.${fmt.ext}`,
      filters: [{ name: fmt.name, extensions: [fmt.ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    out = r.filePath;
  }
  const id = crypto.randomUUID();
  const job = { o, out, count: 0, stderr: '' };
  if (o.format === 'png') {
    job.base = out.replace(/\.png$/i, '');
    job.files = [];
  } else {
    const proc = spawn(FFMPEG, ffmpegArgs(o, out), { windowsHide: true });
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
});

ipcMain.on('shell:show', (_e, p) => {
  if (typeof p === 'string') shell.showItemInFolder(p);
});


app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
