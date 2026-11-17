// Etapa 2 do REFINO (desenho e seleção): estabilizador do traço, pressão da caneta e borracha
// sem surpresas (só na camada ativa; partes presas a ossos não ficam deformadas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
if (!paper.project) paper.setup(new paper.Size(1, 1));
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const { ropeStabilizer, pressureOf } = await import('../src/editor/tools-paint.js');
const R = await import('../src/player/render.js');
const { rectPath, makeShape, pathBounds } = await import('../src/model/geometry.js');

const rect = (x, y, w, h) => makeShape({ path: rectPath(w, h), cx: x + w / 2, cy: y + h / 2, fill: '#ff0000', stroke: null, strokeWidth: 0 });
const band = () => new paper.Path.Rectangle({ point: [-1000, 140], size: [3000, 20], insert: false });

test('estabilizador: tira a tremedeira e não muda nada com força zero', () => {
  // reta horizontal com tremor de ±4
  const raw = Array.from({ length: 200 }, (_, i) => ({ x: i * 2, y: 100 + (i % 2 ? 4 : -4) }));
  const out = [];
  const s = ropeStabilizer(10);
  for (const p of raw) {
    const q = s.push(p.x, p.y);
    if (q) out.push(q);
  }
  const dev = (pts) => Math.max(...pts.slice(5).map((p) => Math.abs(p.y - 100)));
  assert.ok(dev(out) < 1, `o traço estabilizado ainda treme ${dev(out).toFixed(2)}`);
  const none = ropeStabilizer(0);
  for (const p of raw) assert.deepEqual(none.push(p.x, p.y), p);
});

test('pressão: mouse e toque desenham com largura cheia; toque inicial da caneta com pressão 0 não vira bolinha', () => {
  assert.equal(pressureOf({ pointerType: 'mouse', pressure: 0.5 }, true), 1);
  assert.equal(pressureOf({ pointerType: 'touch', pressure: 0 }, true), 1);
  assert.equal(pressureOf({ pointerType: 'pen', pressure: 0 }, true), null, 'pressão 0 da caneta é "ainda não sei", não largura máxima');
  assert.equal(pressureOf({ pointerType: 'pen', pressure: 0.5 }, false), 1, 'sem usar pressão: largura cheia');
  const a = pressureOf({ pointerType: 'pen', pressure: 0.1 }, true);
  const b = pressureOf({ pointerType: 'pen', pressure: 0.5 }, true);
  const c = pressureOf({ pointerType: 'pen', pressure: 1 }, true);
  assert.ok(a > 0.1 && a < b && b < c && c <= 1, `${a} ${b} ${c}`);
});

test('borracha: só apaga na camada ativa (a não ser que peça todas)', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 100, 200, 100)]);
  ed.addLayer();
  ed.addElements([rect(0, 100, 200, 100)]);
  const r = ed.eraseRegion(band(), 'normal');
  assert.equal(r.count, 1);
  const [cima, baixo] = [ed.layers.find((l) => l.id === ed.activeLayerId), ed.layers.find((l) => l.id !== ed.activeLayerId)];
  assert.ok(cima.frames[0].elements[0].path.subs?.length === 2, 'a camada ativa devia ser cortada');
  assert.ok(!baixo.frames[0].elements[0].path.subs, 'a camada de baixo não podia ser apagada');
  ed.undo();
  assert.equal(ed.eraseRegion(band(), 'normal', { allLayers: true }).count, 2);
});

test('borracha numa parte presa a osso, num quadro posado: apaga onde aparece e guarda no desenho original', () => {
  const ed = new Editor();
  const r0 = rect(0, 100, 200, 100);
  ed.addElements([r0]);
  const b = ed.addBone({ x: 0, y: 150 }, { x: 200, y: 150 }, null, r0.id);
  // a forma desce 100 na pose (raiz movida): a faixa da borracha passa onde ela aparece agora
  ed.currentSpan().armature.pose = { __root: { x: 0, y: 100 } };
  const shown = () => R.layerFrame(ed.activeLayer, 0, ed.timeline).items[0].el;
  const before = JSON.stringify(R.applyPoint(shown().matrix, 0, 0));
  const r = ed.eraseRegion(new paper.Path.Rectangle({ point: [-1000, 240], size: [3000, 20], insert: false }), 'normal');
  assert.equal(r.count, 1);
  const el = ed.currentSpan().elements[0];
  assert.equal(el.path.subs?.length, 2, 'devia cortar em duas partes');
  assert.deepEqual(el.skinBones, [b.id], 'a parte devia continuar presa ao osso');
  // o corte ficou no lugar certo do desenho original (y 140–160), não deslocado pela pose
  const ys = el.path.subs.map((sp) => pathBounds({ ...sp }).y + el.matrix[5]);
  assert.ok(ys.some((y) => Math.abs(y - 100) < 1) && ys.some((y) => Math.abs(y - 160) < 1), `cortes em ${ys}`);
  assert.equal(JSON.stringify(R.applyPoint(shown().matrix, 0, 0)), before, 'a parte saiu do lugar');
});

test('borracha não deforma forma que dobra com vários ossos: avisa e deixa como está', () => {
  const ed = new Editor();
  const r0 = rect(0, 100, 200, 100);
  ed.addElements([r0]);
  const a = ed.addBone({ x: 0, y: 150 }, { x: 100, y: 150 }, null, r0.id);
  ed.addBone({ x: 100, y: 150 }, { x: 200, y: 150 }, a.id, r0.id);
  ed.currentSpan().armature.pose = { [ed.rigBones()[1].id]: 0.5 };
  const path = JSON.stringify(ed.currentSpan().elements[0].path);
  const r = ed.eraseRegion(band(), 'normal');
  assert.equal(r.count, 0);
  assert.equal(r.skippedRig, 1);
  assert.equal(JSON.stringify(ed.currentSpan().elements[0].path), path);
});
