// Testes de regressão dos bugs achados na caça (bug-hunt/RELATORIO.md).
// Cada um falhava antes da correção; agora rodam com o npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const D = await import('../src/model/document.js');
const R = await import('../src/player/render.js');
const X = await import('../src/model/xfl.js');
const { linePath, makeShape } = await import('../src/model/geometry.js');
const { solveIK } = await import('../src/player/bones.js');
const { frameToSVG } = await import('../src/export/svg.js');

const FORMAT = JSON.parse(D.serialize(D.createDocument())).format;
const docJSON = (scenes) => JSON.stringify({ format: FORMAT, version: 5, width: 100, height: 100, fps: 12, background: '#fff', scenes });
const oneShape = (el) => docJSON([{ layers: [{ frames: [{ duration: 1, elements: [el] }] }] }]);

test('B1: script do documento na janela de teste não pode ter a ponte de arquivos do editor', () => {
  const main = fs.readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
  const block = main.slice(main.indexOf("ipcMain.on('preview:open'"), main.indexOf("ipcMain.handle('preview:get-data'"));
  // hoje a janela de teste usa o mesmo webPreferences (preload com saveFile, exportHTML5…) e não bloqueia navegação
  assert.doesNotMatch(block, /\n\s*webPreferences,\n/, 'a janela de teste usa o mesmo preload do editor');
  assert.match(block, /will-navigate|setWindowOpenHandler/, 'a janela de teste não bloqueia navegação nem window.open');
});

test('B2: ponto nulo no caminho não pode quebrar o desenho do palco', () => {
  const d = D.parseDocument(oneShape({ type: 'shape', path: { closed: true, pts: [null, [10, 10, 0, 0, 0, 0], [50, 10, 0, 0, 0, 0]] }, fill: '#f00' }));
  const el = d.scenes[0].layers[0].frames[0].elements[0];
  const ok = !el || R.subpaths(el.path).every((sp) => sp.pts.every((q) => Array.isArray(q) && q.length >= 2 && q.every(Number.isFinite)));
  assert.ok(ok, `caminho aceito do jeito que veio: ${JSON.stringify(el?.path.pts)}`);
});

test('B3: arquivo com estrutura errada dá mensagem legível (não TypeError)', () => {
  // vale consertar o que dá (e abrir) ou recusar com mensagem; só não pode estourar um TypeError
  for (const scenes of [[{}], [{ layers: null }], [null], [{ layers: [{ frames: [null] }] }], [{ layers: [null] }], 'x']) {
    try {
      const d = D.parseDocument(docJSON(scenes));
      assert.ok(d.scenes.every((s) => Array.isArray(s.layers) && s.layers.length && s.layers.every((l) => l.frames.every((f) => f && Array.isArray(f.elements)))));
    } catch (e) {
      assert.ok(!(e instanceof TypeError), `scenes = ${JSON.stringify(scenes)}: ${e.message}`);
    }
  }
  assert.doesNotThrow(() => D.parseDocument(docJSON([{ layers: [] }]).replace('"scenes"', '"library":{"items":[{"id":"y","layers":[null]}]},"scenes"')));
});

test('B4: matriz com valores que não são números é corrigida ao abrir', () => {
  const d = D.parseDocument(oneShape({ type: 'shape', matrix: ['a', 0, 0, 1, 0, 0], path: { closed: true, pts: [[0, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0], [5, 5, 0, 0, 0, 0]] }, fill: '#f00' }));
  assert.ok(d.scenes[0].layers[0].frames[0].elements[0].matrix.every(Number.isFinite));
});

test('B5: SVG exportado escapa cor de fundo e tipo da imagem vindos do arquivo', () => {
  const d = D.createDocument();
  d.background = '#fff"/><script>alert(1)</script><rect fill="#000';
  d.library.bitmaps.push({ id: 'b1', name: 'x', mime: 'image/png" onload="alert(1)', data: 'AA==', w: 1, h: 1 });
  d.scenes[0].layers[0].frames[0].elements.push({ id: 'e', type: 'bitmap', assetId: 'b1', w: 1, h: 1, matrix: [1, 0, 0, 1, 0, 0] });
  const svg = frameToSVG(d, 0, 0, {});
  assert.doesNotMatch(svg, /<script>/);
  assert.doesNotMatch(svg, /onload=/);
});

test('B6: ossos (osso no meio de uma forma): a linha dobra junto com a corrente', () => {
  // mesma sequência da ferramenta de ossos: o 1º osso começa e termina na própria linha (não prende nada);
  // os seguintes saem da ponta e terminam na linha (cada um prende a linha inteira a si, trocando o anterior)
  const ed = new Editor();
  const { path: p, cx, cy } = linePath(100, 300, 700, 300);
  const line = makeShape({ path: p, cx, cy, fill: null, stroke: '#000000', strokeWidth: 4 });
  ed.addElements([line]);
  const b1 = ed.addBone({ x: 100, y: 300 }, { x: 300, y: 300 }, null, null);
  const b2 = ed.addBone({ x: 300, y: 300 }, { x: 500, y: 300 }, b1.id, line.id);
  ed.addBone({ x: 500, y: 300 }, { x: 700, y: 300 }, b2.id, line.id);
  // dobra só o 2º osso: o trecho da linha em cima do 1º osso (x = 200) devia ficar parado
  const span = ed.currentSpan();
  span.armature = { ...span.armature, pose: { [b2.id]: 0.6 } };
  const lf = R.layerFrame(ed.activeLayer, 0, ed.timeline);
  const posed = lf.items.find((i) => i.el.id === line.id).el;
  // pontos da linha mostrada, no espaço da camada
  const pts = R.subpaths(R.shapePath(posed)).flatMap((sp) => sp.pts.map((q) => R.applyPoint(posed.matrix, q[0], q[1])));
  const near = (x, y, tol) => pts.some((p) => Math.hypot(p.x - x, p.y - y) < tol);
  const start = pts[0], end = pts[pts.length - 1];
  assert.ok(Math.hypot(start.x - 100, start.y - 300) < 1, `o começo da linha saiu do lugar: (${start.x.toFixed(1)}, ${start.y.toFixed(1)})`);
  assert.ok(near(200, 300, 2), 'o trecho em cima do 1º osso (x = 200) devia ficar parado: a linha gira inteira presa a um osso só');
  // a ponta gira 0,6 rad em volta da junta (300, 300)
  const ex = 300 + 400 * Math.cos(0.6), ey = 300 + 400 * Math.sin(0.6);
  assert.ok(Math.hypot(end.x - ex, end.y - ey) < 3, `a ponta devia ir para (${ex.toFixed(1)}, ${ey.toFixed(1)}), foi para (${end.x.toFixed(1)}, ${end.y.toFixed(1)})`);
  // dobrou de verdade: tem ponto perto da junta e o caminho tem mais que os 2 pontos originais
  assert.ok(near(300, 300, 3) && pts.length > 2, 'a linha não dobrou na junta');
});

test('B7: osso com pais em ciclo (arquivo corrompido) não quebra a cinemática inversa', () => {
  const arm = { bones: [{ id: 'a', parentId: 'b', x: 0, y: 0, angle: 0, length: 10 }, { id: 'b', parentId: 'a', x: 0, y: 0, angle: 0, length: 10 }] };
  assert.doesNotThrow(() => solveIK(arm, {}, 'a', { x: 5, y: 5 }));
});

test('B8: XFL com quadros fora de ordem mantém cada quadro no lugar', async () => {
  const xml = '<DOMDocument><timelines><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="5" duration="2"/><DOMFrame index="0" duration="3" name="primeiro"/></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>';
  const { doc } = await X.importXFL({ 'DOMDocument.xml': { text: xml } }, {});
  const first = doc.scenes[0].layers[0].frames.find((f) => f.label === 'primeiro');
  assert.equal(first.start, 0);
});

test('B9: export em pasta não deixa um nome "../" escapar para uma pasta vizinha', () => {
  // usa a checagem que está de verdade em main.cjs (export:write)
  const main = fs.readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
  const block = main.slice(main.indexOf("ipcMain.handle('export:write'"), main.indexOf("ipcMain.handle('export:html5'"));
  assert.doesNotMatch(block, /target\.startsWith\(dir\)/, 'export:write ainda usa startsWith');
  const src = main.match(/function inside\(dir, target\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'main.cjs não tem a função inside()');
  const inside = new Function('path', `${src}; return inside;`)(path);
  const dir = path.join('C:', 'saida', 'pasta');
  assert.equal(inside(dir, path.join(dir, '..', 'pasta2', 'x.txt')), false);
  assert.equal(inside(dir, path.join(dir, '..', 'x.txt')), false);
  assert.equal(inside(dir, path.join(dir, 'svg', 'a.svg')), true);
});
