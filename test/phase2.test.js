import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor/editor.js';
import { rectPath, makeShape } from '../src/model/geometry.js';
import { parseDocument, serialize, createSymbol, createInstance } from '../src/model/document.js';
import { layerFrame, instanceFrame } from '../src/player/render.js';
import { easeT, lerpMatrix, decompose, lerpColorEffect, colorToCT } from '../src/player/tween.js';

const shape = (x = 0) => makeShape({ path: rectPath(10, 10), cx: x, cy: 0, fill: '#ff0000', stroke: null, strokeWidth: 1 });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/** Bola em x=0 no quadro 1 e x=100 no quadro 11, com tween clássico. */
function tweenDoc() {
  const ed = new Editor();
  ed.addElements([shape(0)]);
  ed.setFrame(10);
  ed.timelineOp('insertKeyframe');
  ed.selectAll();
  ed.nudge(100, 0);
  ed.setFrame(0);
  ed.createClassicTween();
  return ed;
}

test('easing: 0 é linear, +100 desacelera, -100 acelera', () => {
  near(easeT(0.5, 0), 0.5);
  near(easeT(0.5, 100), 0.75);
  near(easeT(0.5, -100), 0.25);
  near(easeT(1, 100), 1);
});

test('tween clássico interpola posição no meio do trecho', () => {
  const ed = tweenDoc();
  const layer = ed.activeLayer;
  const lf = layerFrame(layer, 5);
  assert.equal(lf.tweened, true);
  near(lf.items[0].el.matrix[4], 50);
  ed.setTweenProps({ ease: 100 });
  near(layerFrame(ed.activeLayer, 5).items[0].el.matrix[4], 75);
  // sem tween: segura a pose do keyframe
  ed.removeTween();
  near(layerFrame(ed.activeLayer, 5).items[0].el.matrix[4], 0);
});

test('rotação horária com voltas extras', () => {
  const m0 = [1, 0, 0, 1, 0, 0];
  const half = lerpMatrix(m0, m0, 0.5, { rotate: 'cw', rotations: 1 });
  near(decompose(half).ky, Math.PI); // meia volta no meio do caminho
  const auto = lerpMatrix(m0, m0, 0.5, { rotate: 'auto' });
  near(decompose(auto).ky, 0);
});

test('efeito de cor: alfa interpola e "nenhum" vira neutro', () => {
  const c = lerpColorEffect({ mode: 'none' }, { mode: 'alpha', alpha: 0 }, 0.5);
  assert.equal(c.mode, 'alpha');
  near(c.alpha, 50);
  const ct = colorToCT({ mode: 'tint', tint: '#ff0000', tintAmount: 50 });
  near(ct.rm, 0.5);
  near(ct.ro, 127.5);
});

test('F6 no meio do tween cria keyframe com a pose interpolada', () => {
  const ed = tweenDoc();
  ed.setFrame(5);
  ed.timelineOp('insertKeyframe');
  const fr = ed.activeLayer.frames;
  assert.deepEqual(fr.map((s) => [s.start, s.duration, !!s.tween]), [[0, 5, true], [5, 5, true], [10, 1, false]]);
  near(fr[1].elements[0].matrix[4], 50);
});

test('editar num quadro interpolado cria keyframe e é um passo só de desfazer', () => {
  const ed = tweenDoc();
  ed.setFrame(5);
  ed.selectAll();
  ed.nudge(0, 20);
  const fr = ed.activeLayer.frames;
  assert.equal(fr.length, 3);
  near(fr[1].elements[0].matrix[5], 20);
  ed.undo();
  assert.equal(ed.activeLayer.frames.length, 2);
});

test('converter em símbolo, editar dentro e desfazer', () => {
  const ed = new Editor();
  ed.addElements([shape(100), shape(120)]);
  ed.selectAll();
  ed.convertToSymbol({ name: 'Bola', type: 'graphic' });
  const els = ed.activeLayer.frames[0].elements;
  assert.equal(els.length, 1);
  assert.equal(els[0].type, 'instance');
  near(els[0].matrix[4], 110); // registro no centro da seleção
  const sym = ed.doc.library.items[0];
  assert.equal(sym.name, 'Bola');
  near(sym.layers[0].frames[0].elements[0].matrix[4], -10);
  assert.equal(ed.usage().get(sym.id), 1);

  // entrar no símbolo e desenhar dentro
  const item = ed.frameItems()[0];
  ed.enterSymbol(sym.id, item);
  assert.equal(ed.timeline, sym);
  ed.addElements([shape(0)]);
  assert.equal(sym.layers[0].frames[0].elements.length, 3);
  // símbolo não entra nele mesmo
  assert.equal(ed.addElements([createInstance(sym)]), false);
  ed.exitSymbol();
  assert.equal(ed.timeline, ed.scene);

  ed.undo(); // desenho dentro do símbolo
  ed.undo(); // conversão
  assert.equal(ed.doc.library.items.length, 0);
  assert.equal(ed.activeLayer.frames[0].elements.length, 2);
});

test('apagar símbolo remove as instâncias, desfazer devolve', () => {
  const ed = new Editor();
  ed.addElements([shape(0)]);
  ed.selectAll();
  ed.convertToSymbol({ name: 'A' });
  const id = ed.doc.library.items[0].id;
  ed.deleteLibraryEntry('items', id);
  assert.equal(ed.doc.library.items.length, 0);
  assert.equal(ed.activeLayer.frames[0].elements.length, 0);
  ed.undo();
  assert.equal(ed.doc.library.items.length, 1);
  assert.equal(ed.activeLayer.frames[0].elements[0].symbolId, id);
});

test('gráfico: loop, uma vez e quadro único', () => {
  const sym = createSymbol('S');
  sym.layers[0].frames = [{ start: 0, duration: 3, elements: [] }];
  const el = createInstance(sym);
  assert.equal(instanceFrame(sym, el, 4, 0, false), 1);
  assert.equal(instanceFrame(sym, { ...el, loop: 'once' }, 4, 0, false), 2);
  assert.equal(instanceFrame(sym, { ...el, loop: 'single', firstFrame: 1 }, 4, 0, false), 1);
  const mc = { ...el, behavior: 'movieclip' };
  assert.equal(instanceFrame(sym, mc, 4, 4, false), 0, 'no editor o movie clip fica parado');
  assert.equal(instanceFrame(sym, mc, 4, 4, true), 1, 'no teste/export toca');
});

test('arquivo da versão 1 abre com biblioteca vazia', () => {
  const v1 = {
    format: 'frame-animator',
    version: 1,
    width: 100,
    height: 100,
    fps: 12,
    background: '#fff',
    scenes: [{ id: 's1', name: 'Cena 1', layers: [{ id: 'l1', name: 'C', frames: [{ start: 0, duration: 2, elements: [] }] }] }],
  };
  const d = parseDocument(JSON.stringify(v1));
  assert.deepEqual(d.library, { folders: [], items: [] });
  assert.equal(d.version, 2);
  const ed = new Editor();
  ed.addElements([shape(0)]);
  ed.selectAll();
  ed.convertToSymbol({ name: 'X', type: 'movieclip' });
  const back = parseDocument(serialize(ed.doc));
  assert.equal(back.library.items[0].type, 'movieclip');
  assert.equal(back.scenes[0].layers[0].frames[0].elements[0].behavior, 'movieclip');
});

test('pastas: mover símbolo e apagar pasta devolve o conteúdo', () => {
  const ed = new Editor();
  ed.newSymbol({ name: 'S' });
  ed.exitSymbol();
  const f = ed.addFolder('Personagens');
  const sid = ed.doc.library.items[0].id;
  ed.moveToFolder('items', sid, f.id);
  assert.equal(ed.doc.library.items[0].folderId, f.id);
  ed.deleteLibraryEntry('folders', f.id);
  assert.equal(ed.doc.library.items[0].folderId, null);
  assert.equal(ed.doc.library.folders.length, 0);
});
