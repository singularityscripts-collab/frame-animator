import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as TL from '../src/model/timeline.js';
import { createDocument, serialize, parseDocument } from '../src/model/document.js';
import { Editor } from '../src/editor/editor.js';
import { rectPath, makeShape } from '../src/model/geometry.js';

const spans = (fr) => fr.map((s) => `${s.start}+${s.duration}${s.elements.length ? '*' : ''}`).join(' ');
const el = (id) => ({ id, type: 'shape', matrix: [1, 0, 0, 1, 0, 0], path: { closed: true, pts: [] } });

test('F5 estende o trecho e depois da ponta estende a camada', () => {
  const fr = [{ start: 0, duration: 1, elements: [el('a')] }];
  assert.equal(spans(TL.insertFrames(fr, 0).frames), '0+2*');
  assert.equal(spans(TL.insertFrames(fr, 9).frames), '0+10*');
  assert.equal(spans(fr), '0+1*', 'não muta a entrada');
});

test('F6 divide o trecho copiando conteúdo com ids novos', () => {
  const fr = [{ start: 0, duration: 10, elements: [el('a')] }];
  const r = TL.insertKeyframe(fr, 4);
  assert.equal(spans(r.frames), '0+4* 4+6*');
  assert.notEqual(r.frames[1].elements[0].id, 'a');
  // F6 num keyframe existente avança para o quadro seguinte
  const r2 = TL.insertKeyframe(r.frames, 4);
  assert.equal(spans(r2.frames), '0+4* 4+1* 5+5*');
  assert.equal(r2.frame, 5);
  // F6 depois da ponta
  assert.equal(spans(TL.insertKeyframe(fr, 14).frames), '0+14* 14+1*');
});

test('F7 cria keyframe vazio e Shift+F6 junta de volta', () => {
  const fr = [{ start: 0, duration: 10, elements: [el('a')] }];
  const r = TL.insertBlankKeyframe(fr, 3);
  assert.equal(spans(r.frames), '0+3* 3+7');
  assert.equal(spans(TL.clearKeyframe(r.frames, 3).frames), '0+10*');
  assert.equal(TL.clearKeyframe(r.frames, 5), null, 'não é keyframe');
  assert.equal(spans(TL.clearKeyframe(fr, 0).frames), '0+10', 'primeiro keyframe só é esvaziado');
});

test('Shift+F5 remove quadros e nunca deixa a camada vazia', () => {
  const fr = [{ start: 0, duration: 2, elements: [] }, { start: 2, duration: 1, elements: [el('a')] }];
  const r = TL.removeFrames(fr, 2);
  assert.equal(spans(r.frames), '0+2');
  assert.equal(r.frame, 1);
  assert.equal(spans(TL.removeFrames([{ start: 0, duration: 1, elements: [el('a')] }], 0).frames), '0+1');
});

test('ensureDrawable cria keyframe vazio depois da ponta', () => {
  const fr = [{ start: 0, duration: 3, elements: [el('a')] }];
  assert.equal(TL.ensureDrawable(fr, 2), null);
  assert.equal(spans(TL.ensureDrawable(fr, 6).frames), '0+6* 6+1');
});

test('salvar e abrir preserva o documento', () => {
  const d = createDocument();
  d.scenes[0].layers[0].frames[0].elements.push(makeShape({ path: rectPath(10, 20), cx: 5, cy: 5, fill: '#f00', stroke: null, strokeWidth: 1 }));
  const back = parseDocument(serialize(d));
  assert.deepEqual(back, d);
  assert.throws(() => parseDocument('{"x":1}'), /não é um documento/);
  assert.throws(() => parseDocument('lixo'), /JSON/);
});

test('editor: desenhar, desfazer, refazer e estado sujo', () => {
  const ed = new Editor();
  const shape = () => makeShape({ path: rectPath(10, 10), cx: 0, cy: 0, fill: '#000', stroke: null, strokeWidth: 1 });
  assert.equal(ed.dirty, false);
  ed.addElements([shape()]);
  ed.setFrame(5);
  ed.addElements([shape()]); // cria keyframe no quadro 5
  const layer = ed.activeLayer;
  assert.equal(spans(layer.frames), '0+5* 5+1*');
  assert.equal(ed.dirty, true);
  ed.undo();
  assert.equal(spans(ed.activeLayer.frames), '0+1*');
  ed.undo();
  assert.equal(spans(ed.activeLayer.frames), '0+1');
  assert.equal(ed.dirty, false);
  ed.redo();
  ed.redo();
  assert.equal(spans(ed.activeLayer.frames), '0+5* 5+1*');
});

test('editor: camadas, seleção, mover e apagar com desfazer', () => {
  const ed = new Editor();
  const s = makeShape({ path: rectPath(10, 10), cx: 0, cy: 0, fill: '#000', stroke: null, strokeWidth: 1 });
  ed.addElements([s]);
  ed.selectAll();
  ed.nudge(5, 0);
  assert.equal(ed.activeLayer.frames[0].elements[0].matrix[4], 5);
  ed.addLayer();
  assert.equal(ed.layers.length, 2);
  assert.equal(ed.activeLayer.name, 'Camada 2');
  ed.setSelection([s.id]);
  ed.deleteSelection();
  assert.equal(ed.layers[1].frames[0].elements.length, 0);
  ed.undo();
  assert.equal(ed.layers[1].frames[0].elements[0].matrix[4], 5);
  ed.undo();
  assert.equal(ed.layers.length, 1);
  ed.undo();
  assert.equal(ed.activeLayer.frames[0].elements[0].matrix[4], 0);
});

test('editor: F6 pelo editor move a agulha', () => {
  const ed = new Editor();
  ed.addElements([makeShape({ path: rectPath(10, 10), cx: 0, cy: 0, fill: '#000', stroke: null, strokeWidth: 1 })]);
  ed.timelineOp('insertKeyframe');
  assert.equal(ed.frame, 1);
  ed.timelineOp('insertKeyframe');
  assert.equal(ed.frame, 2);
  assert.equal(spans(ed.activeLayer.frames), '0+1* 1+1* 2+1*');
  ed.undo();
  assert.equal(ed.frame, 1);
});
