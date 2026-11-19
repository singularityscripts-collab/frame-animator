// Etapa V3 (Parte 2 do REFINO): animação ponto a ponto — tween que liga ponto a ponto quando a
// estrutura é a mesma, auto-key ao editar pontos, esconder forma por quadro e operações nos pontos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
if (!paper.project) paper.setup(new paper.Size(1, 1));
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const PT = await import('../src/editor/editor-points.js');
const TW = await import('../src/player/tween.js');
const R = await import('../src/player/render.js');

const P = (x, y, ix = 0, iy = 0, ox = 0, oy = 0) => [x, y, ix, iy, ox, oy];
const square = (id = 'a', extra = {}) => ({
  id,
  type: 'shape',
  matrix: [1, 0, 0, 1, 100, 100],
  path: { closed: true, pts: [P(-50, -50), P(50, -50), P(50, 50), P(-50, 50)] },
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 2,
  ...extra,
});
const moved = (el, pi, dx, dy) => {
  const c = structuredClone(el);
  c.id = el.id + 'b';
  c.lineage = el.id; // cópia do mesmo desenho (como o F6 faz)
  c.path.pts[pi][0] += dx;
  c.path.pts[pi][1] += dy;
  return c;
};

test('mesma estrutura: o tween liga ponto a ponto (sem reamostrar)', () => {
  const a = square(), b = moved(a, 2, 40, 20);
  assert.ok(TW.sameStructure(a.path, b.path));
  assert.ok(!TW.sameStructure(a.path, { closed: true, pts: a.path.pts.slice(0, 3) }));
  const mid = TW.lerpShapeExact(a, b, 0.5);
  assert.equal(mid.path.pts.length, 4, 'continua com 4 pontos');
  assert.deepEqual(mid.path.pts[2].slice(0, 2), [70, 60]);
  assert.deepEqual(mid.path.pts[0].slice(0, 2), [-50, -50], 'quem não mexeu fica parado');
  assert.deepEqual(mid.matrix, a.matrix, 'matriz igual: fica no espaço da forma');
});

test('mesma estrutura com matrizes diferentes: interpola no espaço do palco', () => {
  const a = square(), b = moved(a, 0, 0, 0);
  b.matrix = [1, 0, 0, 1, 300, 100];
  const mid = TW.lerpShapeExact(a, b, 0.5);
  assert.deepEqual(mid.matrix, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(mid.path.pts[0].slice(0, 2), [150, 50]);
});

test('layerFrame: shape tween entre chaves de mesma estrutura anda ponto a ponto', () => {
  const a = square(), b = moved(a, 1, 0, -40);
  const layer = { id: 'L', type: 'normal', visible: true, frames: [{ start: 0, duration: 10, elements: [a], tween: { type: 'shape', ease: 0, hints: [] } }, { start: 10, duration: 1, elements: [b] }] };
  const el = R.layerFrame(layer, 5).items[0].el;
  assert.equal(el.path.pts.length, 4);
  assert.deepEqual(el.path.pts[1].slice(0, 2), [50, -70]);
});

test('largura variável: o perfil também é interpolado', () => {
  const a = square('a', { widthProfile: [{ t: 0, w: 0.2 }, { t: 1, w: 0.2 }] });
  const b = moved(a, 0, 0, 0);
  b.widthProfile = [{ t: 0, w: 1 }, { t: 1, w: 1 }];
  const mid = TW.lerpShapeExact(a, b, 0.5);
  assert.ok(Math.abs(mid.widthProfile[0].w - 0.6) < 1e-9);
});

test('auto-key: editar pontos num quadro sem keyframe cria a chave e liga o shape tween', () => {
  const ed = new Editor();
  ed.activeLayer.frames = [{ start: 0, duration: 12, elements: [square('s1')] }];
  ed.setFrame(8);
  ed.setSelection(['s1']);
  assert.equal(ed.rigState().autoKey, true, 'auto-key ligado por padrão (o mesmo dos ossos)');
  const map = ed.prepareShapeEdit();
  const fr = ed.activeLayer.frames;
  assert.deepEqual(fr.map((s) => s.start), [0, 8]);
  assert.equal(fr[0].tween?.type, 'shape', 'o keyframe de antes ganhou shape tween');
  assert.equal(map.get('s1'), fr[1].elements[0].id, 'a seleção passa para a forma do keyframe novo');
  assert.ok(ed.selection.has(fr[1].elements[0].id));
  // auto-key desligado: quadro segurado edita o keyframe de onde vem (como antes)
  const ed2 = new Editor();
  ed2.activeLayer.frames = [{ start: 0, duration: 12, elements: [square('s1')] }];
  ed2.setFrame(8);
  ed2.setSelection(['s1']);
  ed2.setRigState({ autoKey: false });
  assert.equal(ed2.prepareShapeEdit().size, 0);
  assert.equal(ed2.activeLayer.frames.length, 1);
});

test('operação nos pontos com auto-key é um passo só de desfazer', () => {
  const ed = new Editor();
  ed.activeLayer.frames = [{ start: 0, duration: 12, elements: [square('s1')] }];
  ed.setFrame(6);
  ed.setSelection(['s1']);
  const r = ed.editPoints('Ponto pontudo', new Set(['s1:0:0']), (path, pts) => PT.setCurvature(path, pts, 100));
  assert.ok(r.ok);
  assert.equal(ed.activeLayer.frames.length, 2);
  ed.undo();
  assert.equal(ed.activeLayer.frames.length, 1, 'desfazer tira a chave e a edição juntas');
});

test('esconder forma por quadro: some neste quadro e volta no próximo keyframe, sem quebrar o tween', () => {
  const ed = new Editor();
  ed.activeLayer.frames = [{ start: 0, duration: 12, elements: [square('s1')] }];
  ed.toast = () => {};
  ed.setFrame(5);
  ed.setSelection(['s1']);
  ed.toggleHideShapes();
  const fr = ed.activeLayer.frames;
  assert.equal(fr.length, 2);
  assert.equal(fr[1].elements[0].hidden, true);
  assert.ok(!fr[0].elements[0].hidden);
  // no meio do tween que sai de uma chave visível, continua visível (degrau)
  ed.setFrame(3);
  assert.ok(!ed.frameItems()[0].el.hidden);
  ed.setFrame(5);
  ed.setSelection([fr[1].elements[0].id]);
  ed.toggleHideShapes();
  assert.ok(!ed.activeLayer.frames[1].elements[0].hidden, 'repetir mostra de novo');
});

test('curvatura: 0 deixa o ponto pontudo; 100 dá alças da curva suave', () => {
  const path = square().path;
  const pts = new Map([[0, new Set([1])]]);
  const smooth = PT.setCurvature(path, pts, 100);
  assert.ok(Math.hypot(smooth.pts[1][4], smooth.pts[1][5]) > 1);
  assert.equal(PT.curvatureOf(smooth, 0, 1), 100);
  const sharp = PT.setCurvature(smooth, pts, 0);
  assert.deepEqual(sharp.pts[1].slice(2), [0, 0, 0, 0]);
  assert.equal(PT.curvatureOf(sharp, 0, 1), 0);
});

test('separar e soldar pontos', () => {
  const open = { closed: false, pts: [P(0, 0), P(10, 0), P(20, 0), P(30, 0)] };
  const two = PT.splitAtPoints(open, new Map([[0, new Set([1])]]));
  assert.equal(two.subs.length, 2);
  assert.equal(two.subs[0].pts.length, 2);
  assert.equal(two.subs[1].pts.length, 3);
  const ring = PT.splitAtPoints(square().path, new Map([[0, new Set([2])]]));
  assert.equal(ring.closed, false);
  assert.equal(ring.pts.length, 5, 'o laço abre no ponto (ele fica nas duas pontas)');
  assert.deepEqual(ring.pts[0].slice(0, 2), ring.pts[4].slice(0, 2));
  // soldar as duas pontas do mesmo caminho fecha o laço
  const closed = PT.weldPoints(open, [{ si: 0, pi: 0 }, { si: 0, pi: 3 }]);
  assert.equal(closed.closed, true);
  assert.equal(closed.pts.length, 3);
  // soldar dois pedaços volta a ser um só
  const joined = PT.weldPoints(two, [{ si: 0, pi: 1 }, { si: 1, pi: 0 }]);
  assert.equal(joined.closed, false);
  assert.equal(joined.pts.length, 4);
  assert.equal(PT.weldPoints(open, [{ si: 0, pi: 1 }, { si: 0, pi: 3 }]), null, 'ponto do meio não solda');
});

test('desenhos diferentes com o mesmo número de pontos continuam no morph (não ligam canto com canto)', () => {
  const a = square('r'), b = moved(a, 0, 0, 0);
  delete b.lineage;
  b.id = 'outro';
  assert.ok(!TW.sameDrawing(a, b));
  const layer = { id: 'L', type: 'normal', visible: true, frames: [{ start: 0, duration: 10, elements: [a], tween: { type: 'shape', ease: 0, hints: [] } }, { start: 10, duration: 1, elements: [b] }] };
  assert.ok(R.layerFrame(layer, 5).items[0].el.path.pts.length > 4, 'reamostrado como antes');
  // F6 marca a cópia como o mesmo desenho
  const ed = new Editor();
  ed.activeLayer.frames = [{ start: 0, duration: 12, elements: [square('s1')] }];
  ed.setFrame(6);
  ed.timelineOp('insertKeyframe');
  assert.equal(ed.activeLayer.frames[1].elements[0].lineage, 's1');
});
