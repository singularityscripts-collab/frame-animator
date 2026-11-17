// Etapa 1 do REFINO (rigging): rig único por camada, vínculo da arte, IK com limites e pinos,
// poses (auto-key, copiar/colar/espelhar/zerar) e edição de partes presas a ossos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const R = await import('../src/player/render.js');
const B = await import('../src/player/bones.js');
const { bonePairs } = await import('../src/editor/rig.js');
const { rectPath, linePath, makeShape } = await import('../src/model/geometry.js');

const near = (a, b, tol = 0.5) => Math.hypot(a.x - b.x, a.y - b.y) < tol;
const rect = (x, y, w, h) => {
  const s = makeShape({ path: rectPath(w, h), cx: x + w / 2, cy: y + h / 2, fill: '#4f9dff', stroke: null, strokeWidth: 0 });
  return s;
};
/** Boneco: tronco, coxa e canela; ossos quadril → joelho → pé, prendendo coxa e canela. */
function boneco() {
  const ed = new Editor();
  const tronco = rect(90, 0, 20, 100), coxa = rect(95, 100, 10, 50), canela = rect(95, 150, 10, 50);
  ed.addElements([tronco, coxa, canela]);
  const quadril = ed.addBone({ x: 100, y: 100 }, { x: 100, y: 150 }, null, coxa.id, { name: 'Coxa' });
  const joelho = ed.addBone({ x: 100, y: 150 }, { x: 100, y: 200 }, quadril.id, canela.id, { name: 'Canela' });
  return { ed, tronco, coxa, canela, quadril, joelho };
}
/** Ponto do desenho original (x, y no palco, em descanso) no sistema local do elemento. */
const loc = (el, x, y) => R.applyPoint(R.invert(el.matrix), x, y);
const shown = (ed, id) => R.layerFrame(ed.activeLayer, ed.frame, ed.timeline).items.find((i) => i.el.id === id)?.el;
const goTo = (ed, f) => {
  ed.frame = f;
};

test('rig único: osso criado depois de posar aparece em todos os keyframes da camada', () => {
  const { ed, quadril } = boneco();
  goTo(ed, 6);
  ed.setPose('Pose', (p) => ({ ...p, [quadril.id]: 0.4 }));
  assert.equal(ed.activeLayer.frames.filter((f) => f.armature).length, 2, 'devia haver dois keyframes de pose');
  ed.addBone({ x: 100, y: 20 }, { x: 100, y: 0 }, null, null, { name: 'Cabeça' });
  for (const f of ed.activeLayer.frames) assert.equal(f.armature.bones.length, 3, `keyframe ${f.start} ficou com ${f.armature.bones.length} ossos`);
  // a pose do quadro 7 continua lá
  assert.equal(ed.activeLayer.frames.find((f) => f.start === 6).armature.pose[quadril.id], 0.4);
  ed.undo();
  for (const f of ed.activeLayer.frames) assert.equal(f.armature.bones.length, 2, 'desfazer devia tirar o osso de todos os keyframes');
});

test('osso preso a uma forma só: a forma gira inteira (sem dobrar) e a pele só usa os ossos dela', () => {
  const { ed, coxa, canela, quadril } = boneco();
  const span = ed.currentSpan();
  assert.deepEqual(span.elements.find((e) => e.id === coxa.id).skinBones, [quadril.id]);
  span.armature.pose = { [quadril.id]: Math.PI / 2 };
  // a coxa gira 90° em volta do quadril (100,100): o retângulo vertical vira horizontal para a esquerda
  const el = shown(ed, coxa.id);
  const base = loc(ed.currentSpan().elements.find((e) => e.id === coxa.id), 100, 150); // ponta de baixo da coxa
  const p = R.applyPoint(el.matrix, base.x, base.y);
  assert.ok(near(p, { x: 50, y: 100 }, 1), `ponta da coxa foi para (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  // a canela segue o joelho (filho), não a pele misturada com a coxa
  const c = shown(ed, canela.id);
  const cb = loc(ed.currentSpan().elements.find((e) => e.id === canela.id), 100, 200);
  const q = R.applyPoint(c.matrix, cb.x, cb.y);
  assert.ok(near(q, { x: 0, y: 100 }, 1), `ponta da canela foi para (${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
});

test('apagar osso: o filho passa para o pai e a parte presa vai junto', () => {
  const { ed, canela, quadril, joelho } = boneco();
  const pe = ed.addBone({ x: 100, y: 200 }, { x: 120, y: 200 }, joelho.id, null, { name: 'Pé' });
  ed.deleteBone(joelho.id);
  const bones = ed.rigBones();
  assert.equal(bones.length, 2);
  const novoPe = bones.find((b) => b.id === pe.id);
  assert.equal(novoPe.parentId, quadril.id, 'o pé devia passar para a coxa');
  const s = B.solveBones({ bones }, {}).get(pe.id);
  assert.ok(near(s.restTail, { x: 120, y: 200 }), 'a ponta do pé não pode sair do lugar');
  assert.deepEqual(ed.currentSpan().elements.find((e) => e.id === canela.id).skinBones, [quadril.id], 'a canela devia passar para o osso pai');
});

test('mover junta vale para a camada toda e a arte presa não pula', () => {
  const { ed, quadril, coxa } = boneco();
  goTo(ed, 4);
  ed.setPose('Pose', (p) => p); // cria o keyframe 5
  goTo(ed, 0);
  const antes = R.applyPoint(shown(ed, coxa.id).matrix, 0, 0);
  ed.moveJoint(quadril.id, 'tail', { x: 100, y: 160 });
  for (const f of ed.activeLayer.frames) {
    const s = B.solveBones(f.armature, {}).get(quadril.id);
    assert.ok(near(s.restTail, { x: 100, y: 160 }), `keyframe ${f.start}: junta não moveu`);
  }
  const el = shown(ed, coxa.id);
  assert.ok(near(R.applyPoint(el.matrix, 0, 0), antes), 'a coxa pulou ao mover a junta sem pose');
});

test('IK: o ponto agarrado vai até o alvo, respeitando limites e pinos', () => {
  const arm = {
    bones: [
      { id: 'a', parentId: null, x: 0, y: 0, angle: 0, length: 100 },
      { id: 'b', parentId: 'a', x: 100, y: 0, angle: 0, length: 100 },
    ],
  };
  // ponto no meio do osso b vai para (100, 50)
  let p = B.solveIK(arm, {}, 'b', { x: 100, y: 50 }, 40, { local: { x: 50, y: 0 } });
  const s = B.solveBones(arm, p).get('b');
  assert.ok(near(B.bonePoint(s, { x: 50, y: 0 }), { x: 100, y: 50 }, 1), 'o ponto agarrado não chegou no alvo');
  // limite: b não passa de 30°
  arm.bones[1].min = -Math.PI / 6;
  arm.bones[1].max = Math.PI / 6;
  p = B.solveIK(arm, {}, 'b', { x: 0, y: 150 }, 40);
  assert.ok(p.b <= Math.PI / 6 + 1e-9 && p.b >= -Math.PI / 6 - 1e-9, `o giro do osso passou do limite: ${p.b}`);
  // alvo em cima da junta: nada de NaN
  p = B.solveIK(arm, {}, 'b', { x: 0, y: 0 }, 40);
  assert.ok(Object.values(p).every(Number.isFinite));
  // pino: com a ponta de a fixada, arrastar b não gira a
  delete arm.bones[1].min;
  delete arm.bones[1].max;
  arm.bones[0].pin = true;
  p = B.solveIK(arm, {}, 'b', { x: 50, y: 120 }, 40);
  assert.ok(!p.a, 'osso fixado girou');
});

test('mover o esqueleto pela raiz deixa o pé fixado no lugar (o joelho dobra)', () => {
  const arm = {
    bones: [
      { id: 'q', parentId: null, x: 0, y: 0, angle: Math.PI / 2, length: 10 },
      { id: 'c', parentId: 'q', x: 0, y: 10, angle: Math.PI / 2, length: 50 },
      { id: 'k', parentId: 'c', x: 0, y: 60, angle: Math.PI / 2, length: 50, pin: true },
    ],
  };
  const before = B.solveBones(arm, {}).get('k').tail;
  const p = B.moveRoot(arm, {}, 0, 20);
  const after = B.solveBones(arm, p).get('k').tail;
  assert.ok(near(before, after, 1.5), `o pé fixado saiu do lugar: (${after.x.toFixed(1)}, ${after.y.toFixed(1)})`);
  assert.ok(Math.abs(p.c || 0) > 0.05, 'o joelho devia dobrar');
});

test('mexer numa parte presa a osso num quadro posado: grava no original, sem a forma dobrada', () => {
  const ed = new Editor();
  const { path: lp, cx, cy } = linePath(0, 0, 200, 0);
  const linha = makeShape({ path: lp, cx, cy, fill: null, stroke: '#000000', strokeWidth: 4 });
  ed.addElements([linha]);
  const a = ed.addBone({ x: 0, y: 0 }, { x: 100, y: 0 }, null, linha.id);
  ed.addBone({ x: 100, y: 0 }, { x: 200, y: 0 }, a.id, linha.id);
  const span = ed.currentSpan();
  const pathAntes = JSON.stringify(span.elements[0].path);
  span.armature.pose = { [ed.rigBones()[1].id]: 0.8 };
  ed.setSelection([linha.id]);
  ed.updateSelection('Cor e traço', (el) => (el.stroke = '#ff0000'));
  const el = ed.currentSpan().elements[0];
  assert.equal(el.stroke, '#ff0000');
  assert.equal(JSON.stringify(el.path), pathAntes, 'a forma dobrada foi gravada por cima da original');
});

test('mover uma parte presa a osso com a seleção move de verdade (antes gravava "Mover" sem mexer)', () => {
  const { ed, coxa, quadril } = boneco();
  ed.currentSpan().armature.pose = { [quadril.id]: 0.5 };
  const antes = R.applyPoint(shown(ed, coxa.id).matrix, 0, 0);
  ed.setSelection([coxa.id]);
  const items = ed.selectedItems();
  const snap = ed.beginLiveEdit(items);
  for (const it of items) ed.setLiveMatrix(it, R.multiply(R.translation(30, 0), it.el.matrix));
  ed.endLiveEdit('Mover', snap);
  const depois = R.applyPoint(shown(ed, coxa.id).matrix, 0, 0);
  assert.ok(near(depois, { x: antes.x + 30, y: antes.y }, 0.5), `a coxa foi de (${antes.x.toFixed(1)}, ${antes.y.toFixed(1)}) para (${depois.x.toFixed(1)}, ${depois.y.toFixed(1)})`);
  ed.undo();
  assert.ok(near(R.applyPoint(shown(ed, coxa.id).matrix, 0, 0), antes, 0.5), 'desfazer não voltou');
});

test('espelhar pose: troca esquerda e direita pelo nome ou pelos dois galhos do mesmo pai', () => {
  const nomes = [
    { id: 'q', name: 'Quadril' },
    { id: '1', name: 'Perna esq' },
    { id: '2', name: 'Perna dir' },
  ];
  assert.deepEqual(bonePairs(nomes), [['1', '2']]);
  const galhos = [
    { id: 'q', parentId: null },
    { id: 'a', parentId: 'q' },
    { id: 'a2', parentId: 'a' },
    { id: 'b', parentId: 'q' },
    { id: 'b2', parentId: 'b' },
  ];
  assert.deepEqual(bonePairs(galhos), [['a', 'b'], ['a2', 'b2']]);

  const ed = new Editor();
  ed.addElements([rect(0, 0, 10, 10)]);
  const q = ed.addBone({ x: 0, y: 0 }, { x: 0, y: 10 }, null, null);
  const l = ed.addBone({ x: 0, y: 10 }, { x: -5, y: 40 }, q.id, null, { name: 'Perna esq' });
  const r = ed.addBone({ x: 0, y: 10 }, { x: 5, y: 40 }, q.id, null, { name: 'Perna dir' });
  ed.setPose('Pose', (p) => ({ ...p, [l.id]: 0.3, [r.id]: -0.2 }));
  ed.mirrorPose();
  const pose = ed.currentSpan().armature.pose;
  assert.equal(pose[l.id], -0.2);
  assert.equal(pose[r.id], 0.3);
});

test('copiar, colar e zerar pose; auto-key desligado mexe no keyframe que segura o quadro', () => {
  const { ed, quadril, joelho } = boneco();
  ed.setPose('Pose', (p) => ({ ...p, [quadril.id]: 0.5, [joelho.id]: -0.4 }));
  ed.copyPose();
  goTo(ed, 9);
  ed.pastePose();
  const k10 = ed.activeLayer.frames.find((f) => f.start === 9);
  assert.ok(k10, 'colar com auto-key devia criar o keyframe 10');
  assert.equal(k10.armature.pose[quadril.id], 0.5);
  ed.setRigState({ selected: joelho.id });
  ed.resetPose();
  assert.equal(k10.armature.pose[joelho.id], undefined, 'zerar o osso devia tirar o giro dele');
  assert.equal(ed.activeLayer.frames.find((f) => f.start === 9).armature.pose[quadril.id], 0.5, 'zerar o osso não pode mexer no pai');
  // auto-key desligado: no quadro 12 (sem keyframe) a pose vai para o keyframe 10
  ed.setRigState({ autoKey: false, selected: null });
  goTo(ed, 11);
  ed.timelineOp('insertFrame'); // estende a camada até o quadro 12 (sem keyframe novo)
  const n = ed.activeLayer.frames.length;
  ed.setPose('Pose', (p) => ({ ...p, [quadril.id]: 1 }));
  assert.equal(ed.activeLayer.frames.length, n, 'sem auto-key não pode criar keyframe');
  assert.equal(ed.activeLayer.frames.find((f) => f.start === 9).armature.pose[quadril.id], 1);
});

test('keyframe de pose no meio do tween guarda a pose com o easing (igual ao que aparece)', () => {
  const { ed, quadril } = boneco();
  goTo(ed, 10);
  ed.setPose('Pose', (p) => ({ ...p, [quadril.id]: 1 }));
  goTo(ed, 0);
  const span = ed.currentSpan();
  span.tween = { type: 'classic', ease: 100, rotate: 'auto', rotations: 0 };
  goTo(ed, 5);
  const mostrado = ed.poseAt().pose[quadril.id];
  ed.poseKeyframeHere();
  assert.ok(Math.abs(ed.currentSpan().armature.pose[quadril.id] - mostrado) < 1e-9, 'a pose do keyframe novo pulou');
});

test('galho: osso que sai do meio do pai (braço no ombro) acompanha o giro do pai', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0, 10, 10)]);
  // tronco: do quadril (0,100) para cima até (0,0); braço sai do ombro (0,10) para a direita
  const tronco = ed.addBone({ x: 0, y: 100 }, { x: 0, y: 0 }, null, null);
  const braco = ed.addBone({ x: 0, y: 10 }, { x: 40, y: 10 }, tronco.id, null, { branch: true });
  assert.equal(braco.offset, true);
  let s = B.solveBones(ed.currentSpan().armature, {});
  assert.ok(near(s.get(braco.id).head, { x: 0, y: 10 }), 'o galho devia começar no ombro');
  // o tronco inclina 90°: o ombro gira em volta do quadril e o braço vai junto
  s = B.solveBones(ed.currentSpan().armature, { [tronco.id]: Math.PI / 2 });
  assert.ok(near(s.get(braco.id).head, { x: 90, y: 100 }, 0.01), `ombro foi para (${s.get(braco.id).head.x}, ${s.get(braco.id).head.y})`);
  assert.ok(near(s.get(braco.id).tail, { x: 90, y: 140 }, 0.01), 'o braço não girou junto com o tronco');
});

test('IK: puxar o pé mexe só a perna (a cadeia para no quadril, não gira o tronco)', () => {
  const arm = {
    bones: [
      { id: 'tronco', parentId: null, x: 0, y: 100, angle: -Math.PI / 2, length: 100 },
      { id: 'coxa', parentId: 'tronco', offset: true, x: 0, y: 100, angle: Math.PI / 2, length: 50 },
      { id: 'canela', parentId: 'coxa', x: 0, y: 150, angle: Math.PI / 2, length: 50 },
      { id: 'cabeca', parentId: 'tronco', x: 0, y: 0, angle: -Math.PI / 2, length: 20 },
    ],
  };
  const p = B.solveIK(arm, {}, 'canela', { x: 40, y: 180 }, 30);
  assert.ok(!p.tronco, 'o tronco girou ao puxar o pé');
  assert.ok(p.coxa && p.canela, 'a perna devia dobrar');
  const p2 = B.solveIK(arm, {}, 'cabeca', { x: 20, y: -10 }, 30);
  assert.ok(!p2.tronco, 'puxar a cabeça girou o tronco');
});

test('prender arte automaticamente: cada parte solta vai para o osso mais perto', () => {
  const { ed, tronco, quadril } = boneco();
  const n = ed.autoBind();
  assert.equal(n, 1);
  assert.deepEqual(ed.currentSpan().elements.find((e) => e.id === tronco.id).skinBones, [quadril.id]);
});
