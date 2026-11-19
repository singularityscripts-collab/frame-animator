// Etapa V4 (Parte 2 do REFINO): ossos no nível do Moho — força do osso na pele, pontos presos a um
// osso, Smart Bones (correções por ângulo), dinâmica e biblioteca de poses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
if (!paper.project) paper.setup(new paper.Size(1, 1));
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const R = await import('../src/player/render.js');
const B = await import('../src/player/bones.js');
const { rectPath, makeShape } = await import('../src/model/geometry.js');

const DEG = Math.PI / 180;
const near = (a, b, tol = 0.5) => Math.hypot(a.x - b.x, a.y - b.y) < tol;

/** Braço: retângulo deitado de 0 a 200 (y 90–110), ossos ombro (0→100) e antebraço (100→200), com pele. */
function braco() {
  const ed = new Editor();
  const arm = makeShape({ path: rectPath(200, 20), cx: 100, cy: 100, fill: '#4f9dff', stroke: null, strokeWidth: 0 });
  ed.addElements([arm]);
  const ombro = ed.addBone({ x: 0, y: 100 }, { x: 100, y: 100 }, null, arm.id, { name: 'Ombro' });
  const ante = ed.addBone({ x: 100, y: 100 }, { x: 200, y: 100 }, ombro.id, arm.id, { name: 'Antebraço' });
  return { ed, arm, ombro, ante };
}
const span0 = (ed) => ed.activeLayer.frames[0];
const shownEl = (ed) => R.layerFrame(ed.activeLayer, ed.frame, ed.timeline).items[0].el;

test('força do osso: mais força puxa mais a área perto da junta', () => {
  const { ed, ombro, ante } = braco();
  const solved = B.solveBones(span0(ed).armature, {});
  const ids = [ombro.id, ante.id];
  const w1 = B.skinWeightsAt(B.skinBonesOf(ids, solved), 95, 100)[1];
  ed.setBoneProps(ante.id, { strength: 3 });
  const solved2 = B.solveBones(span0(ed).armature, {});
  const w2 = B.skinWeightsAt(B.skinBonesOf(ids, solved2), 95, 100)[1];
  assert.ok(w2 > w1 + 0.1, `peso do antebraço perto da junta: ${w1.toFixed(2)} → ${w2.toFixed(2)}`);
  ed.setBoneProps(ante.id, { strength: 1 });
  assert.equal(span0(ed).armature.bones.find((b) => b.id === ante.id).strength, undefined, 'força 1 não fica gravada');
});

test('pontos presos: o canto preso ao antebraço segue só ele (gira inteiro com o osso)', () => {
  const { ed, arm, ante } = braco();
  // canto de cima, à direita, do retângulo (índice 1 em rectPath): (200, 90) no palco
  ed.bindPoints([`${arm.id}:0:1`, `${arm.id}:0:2`], ante.id);
  const el = span0(ed).elements[0];
  assert.equal(el.pointBones['0:1'], ante.id);
  span0(ed).armature.pose = { [ante.id]: Math.PI / 2 };
  const posed = shownEl(ed);
  // o antebraço girou 90° em volta de (100,100): o canto (200, 90) vai para (110, 200)
  const pts = posed.path.pts.map((q) => R.applyPoint(posed.matrix, q[0], q[1]));
  assert.ok(pts.some((p) => near(p, { x: 110, y: 200 }, 0.5)), 'o canto preso está exatamente onde o osso levou');
  // apagar o osso: os pontos passam para o pai
  ed.deleteBone(ante.id);
  assert.ok(!Object.values(span0(ed).elements[0].pointBones || {}).includes(ante.id));
});

test('Smart Bone: pesos das correções pelo giro do osso', () => {
  const arm = { bones: [{ id: 'a', parentId: null, x: 0, y: 0, angle: 0, length: 10 }], smart: [{ id: 'c45', bone: 'a', angle: 45 * DEG, shapes: {} }, { id: 'c90', bone: 'a', angle: 90 * DEG, shapes: {} }] };
  const w = (deg) => B.smartWeights(arm, { a: deg * DEG });
  assert.equal(w(0).size, 0);
  assert.ok(Math.abs(w(22.5).get('c45') - 0.5) < 1e-9);
  assert.ok(Math.abs(w(67.5).get('c45') - 0.5) < 1e-9 && Math.abs(w(67.5).get('c90') - 0.5) < 1e-9);
  assert.equal(w(120).get('c90'), 1, 'passou da última: segura a última');
  assert.equal(w(-60).size, 0, 'o outro lado não tem correção');
});

test('Smart Bone: a correção move os pontos da forma conforme o osso dobra', () => {
  const { ed, arm, ante } = braco();
  ed.setRigState({ selected: ante.id });
  span0(ed).armature.pose = { [ante.id]: 90 * DEG };
  assert.equal(ed.addSmartCorrection()?.bone, ante.id);
  const c = ed.smartCorrections()[0];
  assert.ok(Math.abs(c.angle - 90 * DEG) < 1e-9);
  ed.setSmartOffset(c.id, arm.id, '0:0', [0, -10]);
  const a90 = shownEl(ed).path;
  span0(ed).armature.pose = { [ante.id]: 45 * DEG };
  assert.ok(Math.abs(ed.smartWeightNow(c.id) - 0.5) < 1e-9);
  // sem pose: nada muda
  span0(ed).armature.pose = {};
  const rest = shownEl(ed).path;
  span0(ed).armature.pose = { [ante.id]: 90 * DEG };
  assert.notDeepEqual(a90, rest);
  // a correção sobrevive a outras edições do rig (osso novo)
  ed.addBone({ x: 0, y: 0 }, { x: 0, y: -40 }, null, null, { name: 'Cabeça' });
  assert.equal(ed.smartCorrections().length, 1);
  assert.deepEqual(ed.smartCorrections()[0].shapes[arm.id]['0:0'], [0, -10]);
  // girar pouco não cria correção
  span0(ed).armature.pose = { [ante.id]: 2 * DEG };
  ed.toast = () => {};
  ed.setRigState({ smartEdit: null });
  assert.equal(ed.addSmartCorrection(), null);
});

test('biblioteca de poses: guardar e aplicar em outro quadro (com auto-key)', () => {
  const { ed, ombro } = braco();
  ed.toast = () => {};
  span0(ed).armature.pose = { [ombro.id]: 0.7 };
  const p = ed.savePose('Aceno');
  assert.equal(p.name, 'Aceno');
  span0(ed).armature.pose = {};
  ed.setFrame(10);
  ed.applyPose(p.id);
  const k = ed.activeLayer.frames.find((s) => s.start === 10);
  assert.ok(k, 'auto-key criou o keyframe');
  assert.equal(k.armature.pose[ombro.id], 0.7);
  assert.equal(k.armature.poses.length, 1, 'a biblioteca vale em todos os keyframes');
  ed.deletePose(p.id);
  assert.ok(ed.activeLayer.frames.every((s) => !s.armature?.poses?.length));
});

test('dinâmica: o osso atrasa quando o esqueleto anda e volta para a pose; sempre igual', () => {
  const ed = new Editor();
  const tail = makeShape({ path: rectPath(10, 60), cx: 0, cy: 30, fill: '#000', stroke: null, strokeWidth: 0 });
  ed.addElements([tail]);
  const b = ed.addBone({ x: 0, y: 0 }, { x: 0, y: 60 }, null, tail.id, { name: 'Rabo' });
  ed.setBoneProps(b.id, { dynamics: { stiffness: 0.15, damping: 0.1, gravity: 0 } });
  // esqueleto parado até o quadro 5, pula 100 px para a direita no 6 e fica até o 60
  ed.setFrame(5);
  ed.timelineOp('insertKeyframe');
  ed.setFrame(6);
  ed.setPose('Pose', (p) => ({ ...p, __root: { x: 100, y: 0 } }));
  ed.setFrame(59);
  ed.timelineOp('insertFrame');
  const layer = ed.activeLayer;
  const at = (f) => B.dynamicPose(layer, f)[b.id] || 0;
  assert.equal(at(3), 0, 'parado: sem balanço');
  assert.ok(Math.abs(at(7)) > 0.05, `logo depois do pulo, atrasa (${at(7).toFixed(3)})`);
  assert.ok(Math.abs(at(58)) < Math.abs(at(7)) * 0.5, 'o balanço morre com o tempo');
  const again = at(7);
  layer.frames = [...layer.frames]; // força recalcular do zero
  assert.equal(B.dynamicPose(layer, 7)[b.id], again, 'mesmo resultado (determinístico)');
  // o render usa a pose com dinâmica
  const lf = R.layerFrame(layer, 7);
  assert.ok(lf.items[0].el.matrix[1] !== 0, 'a forma aparece girada pelo balanço');
});

test('F6 numa camada com ossos: a chave nova leva o esqueleto (no meio e depois do fim)', () => {
  const { ed, ombro } = braco();
  ed.setFrame(8);
  ed.timelineOp('insertKeyframe'); // depois do fim
  ed.setFrame(8);
  ed.setPose('Pose', (p) => ({ ...p, [ombro.id]: 1 }));
  ed.setFrame(4);
  ed.timelineOp('insertKeyframe'); // no meio
  for (const s of ed.activeLayer.frames) assert.equal(s.armature?.bones.length, 2, `keyframe ${s.start} sem esqueleto`);
  assert.equal(ed.activeLayer.frames.find((s) => s.start === 8).armature.pose[ombro.id], 1);
});
