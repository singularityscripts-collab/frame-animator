// Etapa V5 (Parte 2 do REFINO): interpolação por chave, canais, modificadores (ciclo e ruído),
// esticar/encolher quadros e marcadores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
if (!paper.project) paper.setup(new paper.Size(1, 1));
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const CH = await import('../src/editor/editor-channels.js');
const TL = await import('../src/model/timeline.js');
const R = await import('../src/player/render.js');
const { rectPath, makeShape } = await import('../src/model/geometry.js');

const box = (x) => makeShape({ path: rectPath(20, 20), cx: x, cy: 0, fill: '#f00', stroke: null, strokeWidth: 0 });
/** Camada com a bola em x=0 no quadro 1 e x=100 no quadro 11 (keyframes em 0 e 10). */
function bola() {
  const ed = new Editor();
  ed.addElements([box(0)]);
  ed.setFrame(10);
  ed.timelineOp('insertKeyframe');
  const k = ed.activeLayer.frames[1];
  k.elements[0].matrix = [1, 0, 0, 1, 100, 0];
  ed.setFrame(0);
  return ed;
}
const shape = (fr) => fr.map((s) => `${s.start}:${s.duration}`).join(' ');

test('interpolação: o tipo de cada keyframe pelo tween', () => {
  assert.equal(CH.interpKind({}), 'step');
  assert.equal(CH.interpKind({ tween: { type: 'classic', ease: 0 } }), 'linear');
  assert.equal(CH.interpKind({ tween: { type: 'classic', ease: -60 } }), 'easeIn');
  assert.equal(CH.interpKind({ tween: { easeType: 'sineInOut' } }), 'smooth');
  assert.equal(CH.interpKind({ tween: { easeType: 'cubicOut' } }), 'easeOut');
  assert.equal(CH.interpKind({ tween: { easeType: 'backOut' } }), 'overshoot');
  assert.equal(CH.interpKind({ tween: { easeType: 'bounceOut' } }), 'bounce');
  assert.equal(CH.interpKind({ tween: { easeType: 'custom', easeCurve: [] } }), 'custom');
});

test('interpolação: escolher cria o tween que falta; degrau tira', () => {
  const ed = bola();
  ed.setInterpolation('smooth');
  const tw = ed.activeLayer.frames[0].tween;
  assert.equal(tw?.easeType, 'sineInOut', 'tween criado com a interpolação suave');
  // suave: no quadro 3 (de 10) ainda andou bem menos que 30%
  ed.setFrame(2);
  const x = ed.frameItems()[0].el.matrix[4];
  assert.ok(x > 0 && x < 20, `começa devagar (x=${x.toFixed(1)})`);
  ed.setFrame(0);
  ed.setInterpolation('linear');
  assert.equal(ed.activeLayer.frames[0].tween.easeType, 'linear');
  ed.setInterpolation('step');
  assert.equal(ed.activeLayer.frames[0].tween, undefined, 'degrau = segura até a próxima chave');
  ed.undo();
  assert.equal(ed.activeLayer.frames[0].tween.easeType, 'linear', 'desfazer volta');
});

test('esticar/encolher: chaves proporcionais e o resto anda junto', () => {
  const fr = [
    { start: 0, duration: 4, elements: [] },
    { start: 4, duration: 4, elements: [] },
    { start: 8, duration: 4, elements: [] },
  ];
  assert.equal(shape(TL.retimeFrames(fr, 0, 7, 2)), '0:8 8:8 16:4', 'o dobro: chaves a cada 8 e o último trecho empurrado');
  assert.equal(shape(TL.retimeFrames(fr, 0, 7, 0.5)), '0:2 2:2 4:4');
  // encolhendo demais: chaves que caem no mesmo quadro ficam só com a primeira
  assert.equal(shape(TL.retimeFrames(fr, 0, 7, 0.1)), '0:1 1:4');
  assert.equal(TL.retimeFrames(fr, 0, 7, 1), null);
  // motion tween: as keys acompanham a duração nova
  const mt = [{ start: 0, duration: 10, elements: [], tween: { type: 'motion', props: { x: [{ t: 0, v: 0 }, { t: 9, v: 100 }] } } }];
  const r = TL.retimeFrames(mt, 0, 9, 2);
  assert.equal(r[0].duration, 20);
  assert.deepEqual(r[0].tween.props.x.map((k) => k.t), [0, 18]);
});

test('editor: esticar o intervalo selecionado é um passo de desfazer e a seleção acompanha', () => {
  const ed = bola();
  ed.setFrameSelection({ from: 0, to: 10, layerIds: [ed.activeLayerId] });
  ed.retimeRange(2);
  assert.deepEqual(ed.activeLayer.frames.map((s) => s.start), [0, 20], 'a chave do quadro 11 vai para o 21');
  assert.deepEqual([ed.frameSel.from, ed.frameSel.to], [0, 21]);
  ed.undo();
  assert.deepEqual(ed.activeLayer.frames.map((s) => s.start), [0, 10]);
});

test('ciclo: depois do fim repete o trecho (ou vai e volta)', () => {
  const layer = { modifiers: { cycle: { from: 2, to: 5, mode: 'loop' } } };
  assert.deepEqual([4, 5, 6, 7, 9, 10].map((f) => R.cycleFrame(layer, f)), [4, 5, 2, 3, 5, 2]);
  layer.modifiers.cycle.mode = 'pingpong';
  assert.deepEqual([5, 6, 7, 8, 9, 10, 11].map((f) => R.cycleFrame(layer, f)), [5, 4, 3, 2, 3, 4, 5]);
  assert.equal(R.cycleFrame({}, 50), 50);
});

test('ruído: treme sem criar chaves, sempre igual, só no desenho (a edição não muda)', () => {
  const ed = bola();
  const layer = ed.activeLayer;
  ed.setLayerModifiers(layer.id, { noise: { position: 10, rotation: 0, scale: 0, speed: 2, seed: 3 } });
  const a = R.shownLayerFrame(layer, 4).items[0].el.matrix;
  const b = R.shownLayerFrame(layer, 4).items[0].el.matrix;
  assert.deepEqual(a, b, 'determinístico');
  const plain = R.layerFrame(layer, 4).items[0].el.matrix;
  assert.ok(Math.hypot(a[4] - plain[4], a[5] - plain[5]) > 0.01, 'o desenho treme');
  assert.ok(Math.abs(a[4] - plain[4]) <= 10 && Math.abs(a[5] - plain[5]) <= 10, 'dentro da amplitude');
  assert.equal(layer.frames.length, 2, 'nenhuma chave criada');
  ed.setLayerModifiers(layer.id, { noise: null });
  assert.equal(layer.modifiers, undefined);
  // ciclo pela seleção
  ed.toast = () => {};
  ed.setFrameSelection({ from: 0, to: 10, layerIds: [layer.id] });
  ed.cycleFromSelection('pingpong');
  assert.deepEqual(ed.activeLayer.modifiers.cycle, { from: 0, to: 10, mode: 'pingpong' });
});

test('canais: só as propriedades que mudam entre keyframes; ossos e motion tween ganham linha própria', () => {
  const ed = bola();
  const chans = CH.layerChannels(ed.activeLayer);
  assert.deepEqual(chans.map((c) => c.id), ['transform'], 'a bola só muda de posição');
  assert.deepEqual(chans[0].keys.map((k) => k.frame), [0, 10]);
  // motion tween com key de x no quadro 5
  const ed2 = new Editor();
  ed2.addElements([box(0)]);
  ed2.activeLayer.frames[0].duration = 12;
  ed2.activeLayer.frames[0].tween = { type: 'motion', props: { x: [{ t: 0, v: 0 }, { t: 5, v: 50 }] }, ease: 0 };
  const mc = CH.layerChannels(ed2.activeLayer).find((c) => c.id === 'motion:x');
  assert.deepEqual(mc.keys.map((k) => k.frame), [0, 5]);
  // arrastar a key do canal
  assert.ok(ed2.moveMotionKey(ed2.activeLayerId, 0, 'x', 5, 8));
  assert.deepEqual(ed2.activeLayer.frames[0].tween.props.x.map((k) => k.t), [0, 8]);
});

test('marcadores: criar, mover, renomear, ir e apagar, com desfazer', () => {
  const ed = new Editor();
  ed.addElements([box(0)]);
  const m = ed.addMarker(12, 'pulo');
  assert.equal(ed.markers().length, 1);
  ed.moveMarker(m.id, 20);
  ed.renameMarker(m.id, 'aterrissa');
  assert.deepEqual(ed.markers().map((x) => [x.frame, x.name]), [[20, 'aterrissa']]);
  ed.setFrame(0);
  assert.equal(ed.gotoMarker(1)?.id, m.id);
  assert.equal(ed.frame, 20);
  ed.deleteMarker(m.id);
  assert.equal(ed.markers().length, 0);
  ed.undo();
  assert.equal(ed.markers().length, 1, 'desfazer devolve o marcador');
});
