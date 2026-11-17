// Etapa 3 do REFINO (timeline e animação): arrastar keyframes e quadros, colar substituindo,
// tween no intervalo inteiro e faixa de reprodução.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const TL = await import('../src/model/timeline.js');
const { Player } = await import('../src/player/player.js');
const { rectPath, makeShape } = await import('../src/model/geometry.js');

const el = (id) => ({ id, type: 'shape', matrix: [1, 0, 0, 1, 0, 0], path: { closed: true, pts: [] } });
const fr = () => [
  { start: 0, duration: 6, elements: [el('a')] },
  { start: 6, duration: 6, elements: [el('b')] },
  { start: 12, duration: 1, elements: [el('c')] },
];
const shape = (s) => s.frames.map((f) => `${f.start}:${f.duration}:${f.elements.length}`).join(' ');

test('arrastar keyframe: o vizinho de antes estica, o fim fica no lugar e não passa por cima de outro keyframe', () => {
  assert.equal(shape(TL.moveKeyframe(fr(), 6, 8)), '0:8:1 8:4:1 12:1:1');
  assert.equal(shape(TL.moveKeyframe(fr(), 6, 0)), '0:1:1 1:11:1 12:1:1', 'não pode engolir o keyframe de antes');
  assert.equal(shape(TL.moveKeyframe(fr(), 6, 50)), '0:11:1 11:1:1 12:1:1', 'não pode passar o keyframe de depois');
  assert.equal(shape(TL.moveKeyframe(fr(), 12, 20)), '0:6:1 6:14:1 20:1:1', 'o último keyframe anda e a camada cresce');
  const m = TL.moveKeyframe(fr(), 0, 3);
  assert.equal(shape(m), '0:3:0 3:3:1 6:6:1 12:1:1', 'o primeiro keyframe deixa quadros vazios antes');
  assert.equal(shape(TL.moveKeyframe(m.frames, 3, 0)), '0:6:1 6:6:1 12:1:1', 'e volta para o 0 sem sobrar vazio');
  assert.equal(TL.moveKeyframe(fr(), 6, 6), null);
});

test('arrastar intervalo: substitui o destino e deixa vazio na origem; com Alt copia', () => {
  assert.equal(shape(TL.moveRange(fr(), 6, 11, 2)), '0:6:1 6:2:0 8:6:1');
  assert.equal(shape(TL.moveRange(fr(), 0, 5, 13, { copy: true })), '0:6:1 6:6:1 12:1:1 13:6:1');
});

test('editor: mover keyframe e intervalo são um passo de desfazer cada', () => {
  const ed = new Editor();
  ed.activeLayer.frames = fr();
  ed.moveKeyframeTo(ed.activeLayerId, 6, 9);
  assert.equal(ed.activeLayer.frames[1].start, 9);
  assert.equal(ed.frame, 9, 'a agulha vai junto com o keyframe');
  ed.undo();
  assert.equal(ed.activeLayer.frames[1].start, 6);
  ed.setFrameSelection({ from: 0, to: 5, layerIds: [ed.activeLayerId] });
  ed.moveFrameRange(1);
  assert.deepEqual([ed.frameSel.from, ed.frameSel.to], [1, 6], 'a seleção acompanha os quadros');
  assert.equal(ed.history.undoStack.at(-1).label, 'Mover quadros');
});

test('colar quadros substitui (não empurra) e deixa selecionado o que foi colado; inserir continua disponível', () => {
  const ed = new Editor();
  ed.activeLayer.frames = fr();
  ed.setFrameSelection({ from: 0, to: 0, layerIds: [ed.activeLayerId] });
  ed.copyFrames();
  ed.setFrameSelection(null);
  ed.setFrame(12);
  ed.pasteFrames();
  assert.equal(shape(ed.activeLayer), '0:6:1 6:6:1 12:1:1', 'colar no último quadro não pode criar um quadro a mais');
  assert.deepEqual([ed.frameSel.from, ed.frameSel.to], [12, 12]);
  ed.setFrameSelection(null);
  ed.setFrame(6);
  ed.pasteFrames(true);
  assert.equal(shape(ed.activeLayer), '0:6:1 6:1:1 7:6:1 13:1:1', 'colar inserindo empurra o resto');
});

test('tween no intervalo: Ctrl+T cria em todos os trechos com destino e tira de novo', () => {
  const ed = new Editor();
  const rect = makeShape({ path: rectPath(10, 10), cx: 5, cy: 5, fill: '#000', stroke: null, strokeWidth: 0 });
  ed.addElements([rect]);
  ed.setFrame(6);
  ed.timelineOp('insertKeyframe');
  ed.setFrame(12);
  ed.timelineOp('insertKeyframe');
  ed.setFrameSelection({ from: 0, to: 12, layerIds: [ed.activeLayerId] });
  ed.toggleClassicTween();
  assert.deepEqual(ed.activeLayer.frames.map((f) => f.tween?.type || '-'), ['classic', 'classic', '-'], 'o último keyframe não tem destino');
  assert.equal(ed.history.undoStack.at(-1).label, 'Criar tween clássico');
  ed.toggleClassicTween();
  assert.ok(ed.activeLayer.frames.every((f) => !f.tween), 'Ctrl+T de novo devia tirar');
});

test('faixa de reprodução: o play começa e repete dentro dela', () => {
  const frames = [];
  let now = 0;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const realNow = performance.now.bind(performance);
  performance.now = () => now;
  try {
    const p = new Player({ getLength: () => 30, getFps: () => 10, getLoop: () => true, getRange: () => ({ from: 5, to: 9 }), onFrame: (f) => frames.push(f) });
    p.play(0);
    for (now = 0; now <= 1200; now += 100) p._tick();
    p.stop();
    assert.equal(frames[0], 5, 'fora da faixa: começa no início dela');
    assert.ok(frames.every((f) => f >= 5 && f <= 9), `saiu da faixa: ${frames}`);
    assert.ok(frames.includes(9) && frames.lastIndexOf(5) > 0, 'devia chegar ao fim e repetir');
  } finally {
    performance.now = realNow;
  }
  const ed = new Editor();
  ed.activeLayer.frames = fr(); // 13 quadros
  ed.setPlayRange({ from: 3, to: 99 });
  assert.deepEqual(ed.playBounds(), { from: 3, to: 12 }, 'a faixa é cortada no fim da cena');
  ed.setPlayRange(null);
  assert.deepEqual(ed.playBounds(), { from: 0, to: 12 });
});
