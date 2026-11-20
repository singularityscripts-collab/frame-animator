// Etapa V7 (Parte 2 do REFINO): pendências vetoriais das etapas V1–V5 — borracha que respeita a
// espessura, gradiente na linha, pares do tween pela origem, colar que liga o desenho, Smart Bone que
// gira outros ossos e ciclo que estende a camada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
if (!paper.project) paper.setup(new paper.Size(1, 1));
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const V = await import('../src/model/vector-ops.js');
const T = await import('../src/player/tween.js');
const B = await import('../src/player/bones.js');
const R = await import('../src/player/render.js');
const { rectPath, makeShape } = await import('../src/model/geometry.js');

/** Linha horizontal de 0 a 200 em y = 0, com 20 de espessura. */
const linha = () => makeShape({ path: { closed: false, pts: [[-100, 0, 0, 0, 0, 0], [100, 0, 0, 0, 0, 0]] }, cx: 100, cy: 0, fill: null, stroke: '#000000', strokeWidth: 20 });
const circle = (x, y, r) => new paper.Path.Circle({ center: [x, y], radius: r, insert: false });

test('borracha: corta a linha onde encosta na borda dela, não só no centro', () => {
  const el = linha();
  // a borracha (raio 4) passa em y = 12: encosta na borda (a linha vai até y = 10), longe do centro
  const eraser = circle(100, 12, 4);
  assert.equal(V.eraseShape(el, eraser, 'normal'), null, 'sem engordar: o centro não foi tocado, nada muda');
  const grown = circle(100, 12, 4 + 10);
  const out = V.eraseShape(el, eraser, 'normal', grown);
  assert.ok(out, 'engordada pela meia largura: corta');
  const parts = R.subpaths(out[0].path);
  assert.equal(parts.length, 2, 'a linha vira dois pedaços');
  // e longe da linha continua sem efeito
  assert.equal(V.eraseShape(el, circle(100, 40, 4), 'normal', circle(100, 40, 14)), null);
});

test('borracha no editor: a largura de cada linha engorda a borracha só para ela', () => {
  const ed = new Editor();
  ed.addElements([linha()]);
  let asked = [];
  const r = ed.eraseRegion(circle(100, 12, 4), 'normal', { grow: (pad) => (asked.push(pad), circle(100, 12, 4 + pad)) });
  assert.equal(r.count, 1);
  assert.deepEqual(asked, [10], 'meia largura da linha (20 / 2)');
  assert.equal(ed.activeLayer.frames[0].elements.length, 1, 'a linha cortada fica como uma forma com dois pedaços');
  assert.equal(R.subpaths(ed.activeLayer.frames[0].elements[0].path).length, 2);
});

test('gradiente na linha: entra pela seleção e sai quando escolhe cor sólida', () => {
  const ed = new Editor();
  ed.toast = () => {};
  ed.addElements([linha()]);
  ed.selectAll();
  const g = { type: 'linear', stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#0000ff', alpha: 1 }] };
  ed.setStrokeGradient(g);
  const el = ed.activeLayer.frames[0].elements[0];
  assert.equal(el.strokeGradient.type, 'linear');
  assert.ok(Array.isArray(el.strokeGradient.matrix), 'encaixado no tamanho da linha');
  assert.equal(el.stroke, '#ff0000', 'cor sólida de reserva');
  ed.setStyle({ stroke: '#00ff00' });
  assert.equal(ed.activeLayer.frames[0].elements[0].strokeGradient, undefined);
  ed.undo();
  assert.ok(ed.activeLayer.frames[0].elements[0].strokeGradient);
});

test('tween: os pares seguem a origem, mesmo com a ordem trocada numa chave', () => {
  const a = makeShape({ path: rectPath(10, 10), cx: 0, cy: 0, fill: '#f00', stroke: null, strokeWidth: 0 });
  const b = makeShape({ path: rectPath(10, 10), cx: 50, cy: 0, fill: '#00f', stroke: null, strokeWidth: 0 });
  const a2 = { ...a, id: 'a2', lineage: a.id, matrix: [1, 0, 0, 1, 0, 100] };
  const b2 = { ...b, id: 'b2', lineage: b.id, matrix: [1, 0, 0, 1, 50, 100] };
  // na segunda chave a ordem está invertida (b2 trazido para trás)
  const span = { start: 0, duration: 10, elements: [a, b], tween: { type: 'classic', ease: 0 } };
  const next = { start: 10, duration: 1, elements: [b2, a2] };
  assert.deepEqual(T.tweenPairs(span.elements, next.elements), [1, 0]);
  const mid = T.tweenElements(span, next, 5);
  assert.equal(mid[0].matrix[4], 0, 'o vermelho continua em x = 0 (não vai para o lugar do azul)');
  assert.equal(mid[0].matrix[5], 50);
  assert.equal(mid[1].matrix[4], 50);
  // símbolos: pareados pelo símbolo quando cada um aparece uma vez
  const i1 = { id: 'i1', type: 'instance', symbolId: 'S1', matrix: [1, 0, 0, 1, 0, 0] };
  const i2 = { id: 'i2', type: 'instance', symbolId: 'S2', matrix: [1, 0, 0, 1, 0, 0] };
  assert.deepEqual(T.tweenPairs([i1, i2], [{ ...i2, id: 'x' }, { ...i1, id: 'y' }]), [1, 0]);
  // sem origem conhecida: pela posição
  const c = { id: 'c', type: 'text', matrix: [1, 0, 0, 1, 0, 0] };
  assert.deepEqual(T.tweenPairs([c], [{ ...c, id: 'd' }]), [0]);
});

test('colar uma forma em outra chave liga o desenho (tween ponto a ponto)', () => {
  const ed = new Editor();
  ed.toast = () => {};
  const s = makeShape({ path: rectPath(40, 40), cx: 0, cy: 0, fill: '#f00', stroke: null, strokeWidth: 0 });
  ed.addElements([s]);
  ed.selectAll();
  ed.copy();
  ed.setFrame(10);
  ed.timelineOp('insertBlankKeyframe');
  ed.paste(true);
  const pasted = ed.activeLayer.frames[1].elements[0];
  assert.equal(pasted.lineage, s.id);
  assert.ok(T.sameDrawing(ed.activeLayer.frames[0].elements[0], pasted));
});

test('Smart Bone: a correção também gira outro osso, com o peso do ângulo', () => {
  const arm = {
    bones: [
      { id: 'coxa', parentId: null, x: 0, y: 0, angle: Math.PI / 2, length: 100 },
      { id: 'canela', parentId: 'coxa', angle: Math.PI / 2, length: 100 },
      { id: 'pe', parentId: 'canela', angle: 0, length: 30 },
    ],
    smart: [{ id: 'c1', bone: 'canela', angle: Math.PI / 2, shapes: {}, bones: { pe: -0.4 } }],
  };
  assert.deepEqual(B.smartPose(arm, {}), {}, 'joelho reto: nada muda');
  const half = B.smartPose(arm, { canela: Math.PI / 4 });
  assert.ok(Math.abs(half.pe - -0.2) < 1e-9, 'meio caminho: metade do giro');
  const full = B.smartPose(arm, { canela: Math.PI / 2, pe: 0.1 });
  assert.ok(Math.abs(full.pe - -0.3) < 1e-9, 'soma ao giro com keys do pé');
  // o desenho preso ao pé acompanha
  const foot = { id: 'f', type: 'shape', bone: 'pe', path: rectPath(10, 10), matrix: [1, 0, 0, 1, 100, 200] };
  const [a] = B.poseElements([foot], arm, { canela: Math.PI / 2 });
  const [b] = B.poseElements([foot], { ...arm, smart: [] }, { canela: Math.PI / 2 });
  assert.notDeepEqual(a.matrix, b.matrix, 'com a correção o pé gira a mais');
});

test('Smart Bone no editor: gravar e tirar o giro de outro osso', () => {
  const ed = new Editor();
  ed.toast = () => {};
  const arm = makeShape({ path: rectPath(200, 20), cx: 100, cy: 100, fill: '#4f9dff', stroke: null, strokeWidth: 0 });
  ed.addElements([arm]);
  const ombro = ed.addBone({ x: 0, y: 100 }, { x: 100, y: 100 }, null, arm.id, { name: 'Ombro' });
  const ante = ed.addBone({ x: 100, y: 100 }, { x: 200, y: 100 }, ombro.id, arm.id, { name: 'Antebraço' });
  ed.activeLayer.frames[0].armature.pose = { [ombro.id]: Math.PI / 3 };
  ed.setRigState({ selected: ombro.id });
  const c = ed.addSmartCorrection();
  ed.addSmartBoneDeltas(c.id, { [ante.id]: 0.5 });
  assert.deepEqual(ed.smartCorrections()[0].bones, { [ante.id]: 0.5 });
  ed.addSmartBoneDeltas(c.id, { [ante.id]: -0.5 });
  assert.equal(ed.smartCorrections()[0].bones, undefined, 'somou zero: some');
  ed.addSmartBoneDeltas(c.id, { [ante.id]: 0.25 });
  ed.clearSmartBones(c.id);
  assert.equal(ed.smartCorrections()[0].bones, undefined);
  ed.undo();
  assert.deepEqual(ed.smartCorrections()[0].bones, { [ante.id]: 0.25 });
});

test('ciclo pela seleção estende a camada para o ciclo aparecer', () => {
  const ed = new Editor();
  ed.toast = () => {};
  ed.addElements([makeShape({ path: rectPath(10, 10), cx: 0, cy: 0, fill: '#f00', stroke: null, strokeWidth: 0 })]);
  ed.setFrame(9);
  ed.timelineOp('insertKeyframe');
  ed.setFrameSelection({ from: 0, to: 9, layerIds: [ed.activeLayerId] });
  ed.cycleFromSelection('loop');
  assert.ok(R.layerLength(ed.activeLayer) >= 40, `a camada foi estendida (${R.layerLength(ed.activeLayer)} quadros)`);
  assert.deepEqual(ed.activeLayer.modifiers.cycle, { from: 0, to: 9, mode: 'loop' });
  ed.undo();
  assert.equal(R.layerLength(ed.activeLayer), 10, 'um passo de desfazer');
  assert.equal(ed.activeLayer.modifiers, undefined);
});
