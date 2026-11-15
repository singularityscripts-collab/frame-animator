import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Paper.js no Node (no app ele vem por <script>)
const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');

const { Editor, applyFill } = await import('../src/editor/editor.js');
const { rectPath, ellipsePath, makeShape, pathBounds } = await import('../src/model/geometry.js');
const { parseDocument, serialize } = await import('../src/model/document.js');
const V = await import('../src/model/vector-ops.js');
const { floodFill, traceContours, polygonArea } = await import('../src/model/raster.js');
const { lerpHex, lerpFill } = await import('../src/player/tween.js');

const rect = (cx, cy, w, h, extra = {}) =>
  makeShape({ path: rectPath(w, h), cx, cy, fill: '#ff0000', stroke: null, strokeWidth: 1, ...extra });
const area = (el) => Math.abs(V.toPaper(el.path, el.matrix).area);
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

const GRAD = { type: 'linear', stops: [{ offset: 0, color: '#000000', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 0 }] };

test('cores com alfa e gradientes interpolam', () => {
  assert.equal(lerpHex('#00000000', '#ffffffff', 0.5), '#80808080');
  assert.equal(lerpHex('#000000', '#ffffff', 0.5), '#808080');
  const a = { ...GRAD, matrix: [10, 0, 0, 10, 0, 0] };
  const b = { ...GRAD, matrix: [20, 0, 0, 20, 10, 0], stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }] };
  const m = lerpFill(a, b, 0.5);
  assert.deepEqual(m.matrix, [15, 0, 0, 15, 5, 0]);
  assert.equal(m.stops[0].color, '#800000');
  near(m.stops[1].alpha, 0.5, 1e-9);
});

test('gradiente encaixa na forma e trocar só as cores mantém a posição', () => {
  const el = rect(0, 0, 200, 100);
  const g = applyFill(el, GRAD);
  assert.deepEqual(g.matrix, [100, 0, 0, 100, 0, 0]);
  const moved = { ...el, fill: { ...g, matrix: [50, 0, 0, 50, 30, 0] } };
  assert.deepEqual(applyFill(moved, { ...GRAD, stops: [{ offset: 0, color: '#00ff00', alpha: 1 }] }).matrix, [50, 0, 0, 50, 30, 0]);
});

test('booleanos: unir, interseção, perfurar e recortar', () => {
  const a = rect(50, 50, 100, 100);
  const b = rect(100, 50, 100, 100, { fill: '#0000ff' });
  const u = V.combine('union', [a, b]);
  near(area(u.add), 15000, 1);
  assert.equal(u.add.fill, '#0000ff', 'fica com o estilo da forma de cima');
  near(area(V.combine('intersect', [a, b]).add), 5000, 1);
  const p = V.combine('punch', [a, b]);
  near(area(p.replace.get(a.id)), 5000, 1);
  assert.equal(p.replace.get(b.id), null, 'a forma de cima some');
  near(area(V.combine('crop', [a, b]).replace.get(a.id)), 5000, 1);
  // furo: um círculo dentro de um quadrado vira caminho composto
  const hole = makeShape({ path: ellipsePath(40, 40), cx: 50, cy: 50, fill: '#000', stroke: null, strokeWidth: 1 });
  const ring = V.combine('punch', [a, hole]).replace.get(a.id);
  assert.equal(ring.path.subs.length, 2);
  near(area(ring), 10000 - Math.PI * 400, 2);
});

test('borracha: normal corta preenchimento e linha; "só preenchimento" deixa a linha inteira', () => {
  const el = rect(0, 0, 100, 100, { stroke: '#000000', strokeWidth: 2 });
  const band = new paper.Path.Rectangle({ point: [-10, -60], size: [20, 120], insert: false });
  const normal = V.eraseShape(el, band, 'normal');
  assert.equal(normal.length, 2);
  const [fillPart, strokePart] = normal;
  assert.equal(fillPart.stroke, null);
  near(area(fillPart), 8000, 1);
  assert.equal(strokePart.fill, null);
  assert.equal(strokePart.path.closed, false);
  assert.equal(strokePart.path.subs.length, 2, 'o contorno vira dois pedaços');
  const fillsOnly = V.eraseShape(el, band, 'fills');
  assert.equal(fillsOnly[1].path.closed, true, 'linha intacta');
  const far = new paper.Path.Rectangle({ point: [500, 500], size: [5, 5], insert: false });
  assert.equal(V.eraseShape(el, far, 'normal'), null);
});

test('balde: preenche área fechada, recusa área aberta e fecha lacunas pequenas', () => {
  const w = 40, h = 40;
  const ink = new Uint8Array(w * h);
  const box = (gapAt = -1) => {
    ink.fill(0);
    for (let i = 5; i <= 34; i++) {
      ink[5 * w + i] = ink[34 * w + i] = 1; // cima e baixo
      if (i < gapAt || i > gapAt + 2) ink[i * w + 5] = 1; // esquerda (com lacuna)
      ink[i * w + 34] = 1; // direita
    }
  };
  box();
  const r = floodFill(ink, w, h, 20, 20, 0);
  assert.equal(r.status, 'ok');
  const loops = traceContours(r.region, w, h);
  assert.equal(loops.length, 1);
  near(Math.abs(polygonArea(loops[0])), 30 * 30, 120); // entra um pouco por baixo da linha
  assert.equal(floodFill(ink, w, h, 1, 1, 0).status, 'open');
  assert.equal(floodFill(ink, w, h, 5, 20, 0).status, 'ink');
  box(18); // lacuna de 3 px na esquerda
  assert.equal(floodFill(ink, w, h, 20, 20, 0).status, 'open');
  assert.equal(floodFill(ink, w, h, 20, 20, 2).status, 'ok');
});

test('contorno do balde com furo vira caminho composto', () => {
  const w = 30, h = 30;
  const region = new Uint8Array(w * h);
  for (let y = 2; y < 28; y++) for (let x = 2; x < 28; x++) region[y * w + x] = x > 10 && x < 20 && y > 10 && y < 20 ? 0 : 1;
  const loops = traceContours(region, w, h);
  assert.equal(loops.length, 2);
  const res = V.polygonsToShapePath(loops, 0.1);
  assert.equal(res.path.subs.length, 2);
  near(Math.abs(V.toPaper(res.path).area), 26 * 26 - 9 * 9, 4);
});

test('editor: unir com desfazer, borracha com desfazer', () => {
  const ed = new Editor();
  ed.addElements([rect(50, 50, 100, 100), rect(100, 50, 100, 100)]);
  ed.selectAll();
  ed.combineSelection('union');
  assert.equal(ed.activeLayer.frames[0].elements.length, 1);
  assert.equal(ed.selection.size, 1);
  ed.undo();
  assert.equal(ed.activeLayer.frames[0].elements.length, 2);

  const n = ed.eraseRegion(new paper.Path.Rectangle({ point: [-10, 40], size: [300, 20], insert: false }), 'normal');
  assert.equal(n, 2);
  const els = ed.activeLayer.frames[0].elements;
  assert.ok(els.every((e) => e.path.subs?.length === 2), 'cada retângulo virou duas partes');
  ed.undo();
  assert.ok(ed.activeLayer.frames[0].elements.every((e) => !e.path.subs));
});

test('arquivo com gradiente, caminho composto e amostras ida e volta', () => {
  const ed = new Editor();
  ed.addElements([rect(50, 50, 100, 100), makeShape({ path: ellipsePath(40, 40), cx: 50, cy: 50, fill: '#000', stroke: null, strokeWidth: 1 })]);
  ed.selectAll();
  ed.combineSelection('punch');
  ed.selectAll();
  ed.setStyle({ fill: GRAD, fillOn: true });
  ed.addSwatch('#123456');
  const back = parseDocument(serialize(ed.doc));
  const el = back.scenes[0].layers[0].frames[0].elements[0];
  assert.equal(el.path.subs.length, 2);
  assert.equal(el.fill.type, 'linear');
  assert.equal(back.swatches.at(-1), '#123456');
  assert.ok(pathBounds(el.path).w > 99);
});

test('balde com lacuna: o preenchimento chega até o canto de dentro', () => {
  const w = 60, h = 60;
  const ink = new Uint8Array(w * h);
  for (let i = 5; i <= 54; i++) ink[5 * w + i] = ink[54 * w + i] = ink[i * w + 5] = ink[i * w + 54] = 1;
  const r = floodFill(ink, w, h, 30, 30, 8);
  assert.equal(r.status, 'ok');
  assert.equal(r.region[6 * w + 6], 1, 'pixel encostado no canto ficou preenchido');
});

test('contorno do balde não inventa curvas fora do polígono', () => {
  const quad = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 10 }];
  const res = V.polygonsToShapePath([quad], 0.5);
  const b = pathBounds(res.path);
  near(b.w, 300, 0.5);
  near(b.h, 300, 0.5);
});
