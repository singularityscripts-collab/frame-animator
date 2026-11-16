// Sonda (Electron): um script dentro do documento, rodando na janela "Testar filme",
// consegue usar a ponte window.api do editor? E abrir/navegar para outra página com ela?
// Rodar: npx electron bug-hunt/probe-preview.cjs
// Só grava num arquivo da pasta temporária do sistema.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const target = path.join(os.tmpdir(), `fa-bughunt-${Date.now()}.txt`);
const pageUrl = 'file:///' + path.join(__dirname, 'probe-page.html').replace(/\\/g, '/');

require('../main.cjs'); // registra o IPC e abre o editor normalmente

const NAVEGAR = process.argv.includes('--navegar');
// cada tentativa num try, para uma falha não esconder a próxima
const script = [
  "trace('api na janela de teste:', typeof window.api, typeof (window.api && window.api.saveFile));",
  `try { window.api.saveFile({ path: ${JSON.stringify(target)}, data: 'gravado por um script do documento' }).then((r) => trace('gravou:', r && r.path)); } catch (e) { trace('saveFile bloqueado'); }`,
  `try { window.open(${JSON.stringify(pageUrl)}); } catch (e) {}`,
  NAVEGAR ? `setTimeout(() => { location.href = ${JSON.stringify(pageUrl)}; }, 300);` : '',
].join('\n');

app.whenReady().then(async () => {
  const logs = [];
  app.on('browser-window-created', (_e, w) => w.webContents.on('console-message', (e) => logs.push(e.message)));
  await new Promise((r) => setTimeout(r, 2500));
  const editor = BrowserWindow.getAllWindows()[0];
  editor.webContents.on('console-message', (e) => logs.push('[editor] ' + e.message));
  await editor.webContents.executeJavaScript(`(async () => {
    const { editor } = window.__fa;
    const g = await import('./model/geometry.js');
    editor.addElements([g.makeShape({ path: g.rectPath(40, 40), cx: 50, cy: 50, fill: '#f00', stroke: null, strokeWidth: 1 })]);
    editor.setSpanScript(${JSON.stringify(script)});
    window.api.openPreview(JSON.stringify(editor.doc));
  })()`);
  await new Promise((r) => setTimeout(r, 3500));
  const titles = BrowserWindow.getAllWindows().map((w) => w.getTitle());
  console.log('RESULTADO');
  console.log('janelas abertas:', JSON.stringify(titles));
  console.log('arquivo gravado pelo script:', fs.existsSync(target) ? `SIM (${target})` : 'não');
  for (const l of logs.filter((x) => /api|gravou|PAGINA/.test(x))) console.log('log:', l);
  try {
    fs.unlinkSync(target);
  } catch {}
  app.exit(0);
});
