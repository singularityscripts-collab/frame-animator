// Processo principal do Electron: janela, menu, diálogos de arquivo e janela de teste.

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

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
      label: '&Modificar',
      submenu: [
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

app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
