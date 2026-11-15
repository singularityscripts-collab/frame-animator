import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');

const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
const { rectPath, ellipsePath, linePath, makeShape, pathBounds } = await import('../src/model/geometry.js');
const { parseDocument, serialize, createInstance, createSymbol } = await import('../src/model/document.js');
const R = await import('../src/player/render.js');
const { EASES, curveY, applyEase } = await import('../src/player/ease.js');
const { sceneSchedule } = await import('../src/player/audio.js');
const { BUILTIN_PRESETS } = await import('../src/editor/presets.js');
const TL = await import('../src/model/timeline.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const rect = (cx, cy, w = 20, h = 20) => makeShape({ path: rectPath(w, h), cx, cy, fill: '#ff0000', stroke: null, strokeWidth: 1 });
const spans = (fr) => fr.map((s) => `${s.start}+${s.duration}${s.elements.length ? '*' : ''}`).join(' ');
const at = (ed, layer, f) => R.layerFrame(layer, f, ed.timeline);

test('easing: presets terminam no lugar certo e a curva personalizada funciona', () => {
  for (const [name, fn] of Object.entries(EASES)) {
    near(fn(0), 0, 1e-9);
    near(fn(1), 1, 1e-9);
    assert.ok(Number.isFinite(fn(0.37)), name);
  }
  const curve = [{ x: 0, y: 0, ox: 0.5, oy: 0 }, { x: 1, y: 1, ix: -0.5, iy: 0 }];
  assert.ok(curveY(curve, 0.25) < 0.25, 'começa devagar');
  near(curveY(curve, 0.5), 0.5, 1e-3);
  near(applyEase(0.5, { easeType: 'quadIn' }), 0.25);
});

test('motion tween: mover num quadro cria keys e o meio é interpolado', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0)]);
  ed.createMotionTween();
  const layer = ed.activeLayer;
  assert.equal(layer.frames[0].duration, ed.doc.fps);
  assert.equal(layer.frames[0].tween.type, 'motion');
  ed.setFrame(10);
  ed.selectAll();
  ed.nudge(100, 0);
  const tw = ed.activeLayer.frames[0].tween;
  assert.deepEqual(tw.props.x.map((k) => [k.t, Math.round(k.v)]), [[0, 0], [10, 100]]);
  near(at(ed, ed.activeLayer, 5).items[0].el.matrix[4], 50, 1e-6);
  near(at(ed, ed.activeLayer, 20).items[0].el.matrix[4], 100, 1e-6);
  // o elemento base não mudou: só as keys
  assert.equal(ed.activeLayer.frames[0].elements[0].matrix[4], 0);
  ed.undo();
  assert.equal(ed.activeLayer.frames[0].tween.props.x, undefined);
});

test('motion tween: curva com alças do editor de movimento', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0)]);
  ed.createMotionTween();
  ed.setMotionKeys('y', [{ t: 0, v: 0, ot: 5, ov: 0 }, { t: 10, v: 100, it: -5, iv: 0 }]);
  const y5 = at(ed, ed.activeLayer, 5).items[0].el.matrix[5];
  near(y5, 50, 1);
  assert.ok(at(ed, ed.activeLayer, 2).items[0].el.matrix[5] < 20, 'curva em S começa devagar');
});

test('F6 no meio de um motion tween divide sem mudar o que aparece', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0)]);
  ed.createMotionTween();
  ed.setFrame(20);
  ed.selectAll();
  ed.nudge(200, 0);
  const before = at(ed, ed.activeLayer, 15).items[0].el.matrix[4];
  ed.setFrame(8);
  ed.deselect();
  ed.timelineOp('insertKeyframe');
  const fr = ed.activeLayer.frames;
  assert.equal(fr.length, 2);
  assert.equal(fr[1].tween.type, 'motion');
  near(at(ed, ed.activeLayer, 15).items[0].el.matrix[4], before, 1e-6);
});

test('guia de movimento: tween clássico anda sobre o caminho', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0)]);
  ed.setFrame(10);
  ed.timelineOp('insertKeyframe');
  ed.selectAll();
  ed.nudge(100, 100);
  ed.setFrame(0);
  ed.createClassicTween();
  ed.addMotionGuide();
  // caminho em L: (0,0) → (100,0) → (100,100)
  const l1 = linePath(0, 0, 100, 0), l2 = linePath(100, 0, 100, 100);
  const path = { closed: false, pts: [[0, 0, 0, 0, 0, 0], [100, 0, 0, 0, 0, 0], [100, 100, 0, 0, 0, 0]] };
  ed.addElements([makeShape({ path, cx: 0, cy: 0, fill: null, stroke: '#000', strokeWidth: 1 })]);
  void l1;
  void l2;
  const guided = ed.layers.find((l) => l.guidedBy);
  assert.ok(guided);
  const m = at(ed, guided, 5).items[0].el.matrix;
  near(m[4], 100, 1e-6); // no meio do caminho em L: no canto
  near(m[5], 0, 1e-6);
});

test('shape tween: quadrado vira círculo e as dicas são aceitas', () => {
  const ed = new Editor();
  ed.addElements([makeShape({ path: rectPath(100, 100), cx: 0, cy: 0, fill: '#ff0000', stroke: null, strokeWidth: 1 })]);
  ed.setFrame(10);
  ed.timelineOp('insertBlankKeyframe');
  ed.addElements([makeShape({ path: ellipsePath(200, 200), cx: 0, cy: 0, fill: '#0000ff', stroke: null, strokeWidth: 1 })]);
  ed.setFrame(0);
  ed.createShapeTween();
  const mid = at(ed, ed.activeLayer, 5).items[0].el;
  const b = pathBounds(mid.path);
  assert.ok(b.w > 100 && b.w < 200, `largura no meio ${b.w}`);
  assert.ok(mid.fill !== '#ff0000' && mid.fill !== '#0000ff');
  ed.addShapeHint();
  assert.equal(ed.activeLayer.frames[0].tween.hints.length, 1);
  assert.ok(at(ed, ed.activeLayer, 5).items[0].el.path.pts.length > 10);
});

test('camadas: máscara pega a de baixo, guiada procura a guia de cima', () => {
  const ed = new Editor();
  ed.addLayer(); // Camada 2 em cima
  const [top, bottom] = ed.layers;
  ed.setLayerKind(top.id, 'mask');
  assert.equal(ed.layers[0].type, 'mask');
  assert.equal(ed.layers[1].maskedBy, ed.layers[0].id);
  assert.equal(ed.layerKind(ed.layers[1]), 'masked');
  ed.setLayerKind(ed.layers[0].id, 'normal');
  assert.equal(ed.layers[1].maskedBy, undefined, 'soltou');
  ed.undo();
  assert.equal(ed.layers[1].maskedBy, ed.layers[0].id);
  void bottom;
});

test('pastas: mover para dentro, travar a pasta trava as filhas, apagar leva o conteúdo', () => {
  const ed = new Editor();
  ed.addLayerFolder();
  const folder = ed.layers[0];
  assert.equal(folder.type, 'folder');
  const child = ed.layers[1];
  ed.moveLayerBlock(1, 1, folder.id);
  assert.equal(ed.layers[1].folderId, folder.id);
  ed.setLayerProps(folder.id, { locked: true });
  assert.equal(ed.isEditable(ed.layers[1]), false);
  ed.setLayerProps(folder.id, { locked: false });
  ed.addLayer();
  ed.deleteLayer(folder.id);
  assert.ok(!ed.layers.some((l) => l.id === folder.id || l.id === child.id));
  ed.undo();
  assert.ok(ed.layers.some((l) => l.id === child.id));
});

test('parentesco: a filha não pula ao ligar e depois segue a mãe', () => {
  const ed = new Editor();
  ed.addElements([rect(100, 100)]); // mãe na Camada 1
  ed.addLayer();
  ed.addElements([rect(300, 100)]); // filha na Camada 2
  const [childL, parentL] = ed.layers;
  ed.setLayerParent(childL.id, parentL.id);
  const wm = () => ed.frameItems().find((it) => it.layer.id === childL.id).wm;
  near(wm()[4], 300, 1e-6);
  // a mãe anda 50 no quadro 5: a filha vai junto
  ed.setFrame(5);
  ed.setActiveLayer(parentL.id);
  ed.timelineOp('insertKeyframe');
  ed.setActiveLayer(childL.id);
  ed.timelineOp('insertFrame');
  const pItem = ed.frameItems().find((it) => it.layer.id === parentL.id);
  ed.setSelection([pItem.el.id]);
  ed.nudge(50, 0);
  near(wm()[4], 350, 1e-6);
  assert.equal(ed.setLayerParent(parentL.id, childL.id), undefined); // ciclo recusado
  assert.equal(ed.layers.find((l) => l.id === parentL.id).parentLayerId, undefined);
});

test('câmera: zoom e profundidade (parallax)', () => {
  const ed = new Editor();
  ed.addCamera();
  ed.setCameraProps({ zoom: 200 });
  const cam = ed.cameraState();
  assert.equal(cam.zoom, 200);
  const M = R.cameraMatrix(ed.doc, cam, 0);
  const c = R.applyPoint(M, ed.doc.width / 2 + 10, ed.doc.height / 2);
  near(c.x, ed.doc.width / 2 + 20, 1e-6);
  const far = R.applyPoint(R.cameraMatrix(ed.doc, cam, 1000), ed.doc.width / 2 + 10, ed.doc.height / 2);
  near(far.x, ed.doc.width / 2 + 10, 1e-6, 'profundidade 1000 = metade do zoom');
  // desenhar com a câmera ligada: o elemento fica no lugar certo da cena
  ed.setActiveLayer(ed.layers[1].id);
  ed.addElements([rect(500, 300)]);
  assert.equal(ed.activeLayer.frames[0].elements[0].matrix[4], 500);
  ed.removeCamera();
  assert.equal(R.cameraLayer(ed.scene), null);
});

test('áudio: evento, stream, iniciar e parar na agenda', () => {
  const ed = new Editor();
  const snd = ed.importSound({ name: 'bip', mime: 'audio/wav', data: 'AAAA', duration: 2 });
  ed.setSpanSound({ id: snd.id, sync: 'event' });
  ed.setFrame(24);
  ed.timelineOp('insertKeyframe');
  ed.setSpanSound({ id: snd.id, sync: 'stop' });
  const s = sceneSchedule(ed.doc, ed.scene, 0, 47, 24);
  assert.equal(s.length, 1);
  near(s[0].until, 1, 1e-9, 'parou no quadro 24');
  // stream começando no meio: entra com deslocamento
  ed.setFrame(0);
  ed.setSpanSound({ id: snd.id, sync: 'stream' });
  const st = sceneSchedule(ed.doc, ed.scene, 12, 47, 24);
  near(st[0].offset, 0.5, 1e-9);
  near(st[0].until, 0.5, 1e-9, 'stream acaba no fim do trecho (quadro 24)');
  // evento não dispara se a agulha começa depois do keyframe
  ed.setSpanSound({ id: snd.id, sync: 'event' });
  assert.equal(sceneSchedule(ed.doc, ed.scene, 1, 47, 24).filter((e) => e.sync === 'event').length, 0);
});

test('quadros: copiar/colar, inverter, remover e converter intervalo', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0)]);
  ed.setFrame(1);
  ed.timelineOp('insertBlankKeyframe');
  ed.addElements([rect(50, 0)]);
  ed.setFrame(2);
  ed.timelineOp('insertBlankKeyframe');
  ed.addElements([rect(100, 0)]);
  const xs = () => ed.activeLayer.frames.map((s) => s.elements[0]?.matrix[4]);
  assert.deepEqual(xs(), [0, 50, 100]);
  ed.setFrameSelection({ from: 0, to: 2, layerIds: [ed.activeLayerId] });
  ed.reverseFrames();
  assert.deepEqual(xs(), [100, 50, 0]);
  ed.copyFrames();
  ed.setFrameSelection(null);
  ed.setFrame(3);
  ed.pasteFrames();
  assert.equal(spans(ed.activeLayer.frames), '0+1* 1+1* 2+1* 3+1* 4+1* 5+1*');
  ed.setFrameSelection({ from: 1, to: 4, layerIds: [ed.activeLayerId] });
  ed.removeFrameRange();
  assert.equal(TL.lengthOf(ed.activeLayer.frames), 2);
  // converter: um trecho de 4 quadros vira 4 keyframes
  const ed2 = new Editor();
  ed2.addElements([rect(0, 0)]);
  ed2.setFrame(3);
  ed2.timelineOp('insertFrame');
  ed2.setFrameSelection({ from: 0, to: 3, layerIds: [ed2.activeLayerId] });
  ed2.timelineOp('insertKeyframe');
  assert.equal(spans(ed2.activeLayer.frames), '0+1* 1+1* 2+1* 3+1*');
});

test('rótulos, cenas e o filme inteiro', () => {
  const ed = new Editor();
  ed.setSpanLabel('início');
  assert.equal(ed.activeLayer.frames[0].label, 'início');
  ed.setFrame(9);
  ed.timelineOp('insertFrame');
  ed.addScene();
  assert.equal(ed.doc.scenes.length, 2);
  assert.equal(ed.sceneIndex, 1);
  ed.renameScene(1, 'Final');
  ed.duplicateScene(0);
  assert.equal(ed.doc.scenes.length, 3);
  assert.equal(R.movieLength(ed.doc), 10 + 10 + 1);
  assert.deepEqual(R.movieLocate(ed.doc, 12), { sceneIndex: 1, frame: 2 });
  ed.deleteScene(2);
  ed.undo();
  assert.equal(ed.doc.scenes[2].name, 'Final');
});

test('distribuir para keyframes e para camadas', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0), rect(50, 0), rect(100, 0)]);
  ed.selectAll();
  ed.distributeToKeyframes();
  assert.equal(spans(ed.activeLayer.frames), '0+1* 1+1* 2+1*');
  ed.undo();
  ed.selectAll();
  ed.distributeToLayers();
  assert.equal(ed.layers.length, 4);
  assert.equal(ed.layers[0].frames[0].elements.length, 0, 'a camada de origem ficou vazia');
});

test('preset de movimento cria o motion tween', () => {
  const ed = new Editor();
  ed.addElements([rect(200, 100)]);
  ed.selectAll();
  ed.applyMotionPreset(BUILTIN_PRESETS.find((p) => p.id === 'in-left'));
  const span = ed.activeLayer.frames[0];
  assert.equal(span.tween.type, 'motion');
  assert.equal(span.duration, Math.round(0.75 * ed.doc.fps));
  near(at(ed, ed.activeLayer, 0).items[0].el.matrix[4], -200, 1e-6);
  near(at(ed, ed.activeLayer, span.duration - 1).items[0].el.matrix[4], 200, 1e-6);
});

test('arquivo v4 ida e volta com tudo junto', () => {
  const ed = new Editor();
  ed.addElements([rect(0, 0)]);
  ed.createMotionTween();
  ed.addLayer();
  ed.setLayerKind(ed.layers[0].id, 'mask');
  ed.addCamera();
  ed.addLayerFolder();
  ed.importSound({ name: 's', mime: 'audio/wav', data: 'AAAA', duration: 1 });
  ed.setSpanLabel('x', 'comment');
  ed.addScene();
  const back = parseDocument(serialize(ed.doc));
  assert.deepEqual(back, ed.doc);
  void createInstance;
  void createSymbol;
});
