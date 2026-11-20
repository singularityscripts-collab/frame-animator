// Etapa V6 (Parte 2 do REFINO): camada de troca, fonemas do lip sync, clipes de animação e personagens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
if (!paper.project) paper.setup(new paper.Size(1, 1));
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const SW = await import('../src/editor/editor-switch.js');
const R = await import('../src/player/render.js');
const { rectPath, makeShape } = await import('../src/model/geometry.js');

const box = (x, fill = '#f00') => makeShape({ path: rectPath(20, 20), cx: x, cy: 0, fill, stroke: null, strokeWidth: 0 });

/** Editor com uma troca de 3 desenhos (vermelho, verde, azul) e a timeline com 20 quadros. */
function troca() {
  const ed = new Editor();
  ed.toast = () => {};
  ed.addElements([box(0, '#f00'), box(40, '#0f0'), box(80, '#00f')]);
  ed.setFrame(19);
  ed.timelineOp('insertFrame');
  ed.setFrame(0);
  ed.selectAll();
  const r = ed.createSwitchLayer('Boca');
  return { ed, ...r };
}
const shownFill = (ed, layer, frame) => {
  const it = R.layerFrame(layer, frame).items[0];
  const sym = ed.symbol(it.el.symbolId);
  const lf = R.layerFrame(sym.layers[0], it.el.firstFrame || 0);
  return lf.items[0].el.fill;
};

test('troca: cada objeto selecionado vira um desenho, numa camada nova acima', () => {
  const { ed, symbol, layer } = troca();
  assert.ok(symbol.switch);
  assert.deepEqual(SW.switchDrawings(symbol).map((d) => d.name), ['Desenho 1', 'Desenho 2', 'Desenho 3']);
  assert.equal(ed.layers.length, 2);
  assert.equal(ed.layers[0].id, layer.id, 'a camada de troca fica em cima');
  assert.equal(ed.layers[1].frames[0].elements.length, 0, 'os objetos saíram da camada de origem');
  assert.equal(R.layerLength(layer), 20, 'a troca vale a cena inteira');
  assert.equal(shownFill(ed, layer, 0), '#f00');
  ed.undo();
  assert.equal(ed.layers.length, 1);
  assert.equal(ed.layers[0].frames[0].elements.length, 3, 'desfazer devolve os objetos');
});

test('troca: trocar cria a chave no quadro; próximo/anterior dão a volta', () => {
  const { ed, layer } = troca();
  ed.setFrame(5);
  ed.switchTo(2);
  const L = ed.layer(layer.id);
  assert.deepEqual(L.frames.map((s) => s.start), [0, 5]);
  assert.equal(shownFill(ed, L, 4), '#f00');
  assert.equal(shownFill(ed, L, 5), '#00f');
  ed.switchStep(1);
  assert.equal(shownFill(ed, ed.layer(layer.id), 5), '#f00', 'depois do último volta ao primeiro');
  ed.switchStep(-1);
  assert.equal(shownFill(ed, ed.layer(layer.id), 5), '#00f');
  ed.undo();
  ed.undo();
  ed.undo();
  assert.deepEqual(ed.layer(layer.id).frames.map((s) => s.start), [0], 'cada troca é um passo de desfazer');
});

test('troca: novo desenho, renomear e apagar (as instâncias são reapontadas)', () => {
  const { ed, symbol, layer } = troca();
  ed.setFrame(3);
  ed.switchTo(2); // azul no quadro 3
  ed.setFrame(8);
  const i = ed.addSwitchDrawing({ copy: true });
  assert.equal(i, 3);
  const sym = ed.symbol(symbol.id);
  assert.equal(SW.switchDrawings(sym).length, 4);
  assert.equal(SW.switchDrawings(sym)[3].name, 'Desenho 3 (cópia)');
  assert.equal(shownFill(ed, ed.layer(layer.id), 8), '#00f', 'a cópia do azul aparece no quadro 8');
  ed.renameSwitchDrawing(sym.id, 0, 'A');
  assert.equal(SW.switchDrawings(ed.symbol(sym.id))[0].name, 'A');
  // apagar o verde (índice 1): o azul (quadro 2) sobe para o quadro 1 do símbolo
  ed.deleteSwitchDrawing(sym.id, 1);
  assert.deepEqual(SW.switchDrawings(ed.symbol(sym.id)).map((d) => d.name), ['A', 'Desenho 3', 'Desenho 3 (cópia)']);
  assert.equal(shownFill(ed, ed.layer(layer.id), 3), '#00f', 'a chave que mostrava o azul continua azul');
  assert.equal(shownFill(ed, ed.layer(layer.id), 0), '#f00');
  ed.undo();
  assert.equal(SW.switchDrawings(ed.symbol(sym.id)).length, 4);
});

test('fonemas: pelo nome do desenho e ajuste fino por chave', () => {
  assert.equal(SW.visemeForName('A'), 'A');
  assert.equal(SW.visemeForName('Boca O'), 'O');
  assert.equal(SW.visemeForName('repouso'), 'rest');
  assert.equal(SW.visemeForName('M B P'), 'MBP');
  assert.equal(SW.visemeForName('f/v'), 'FV');
  assert.equal(SW.visemeForName('Mão aberta'), null);
  const { ed, symbol, layer } = troca();
  ed.renameSwitchDrawing(symbol.id, 0, 'repouso');
  ed.renameSwitchDrawing(symbol.id, 1, 'A');
  ed.renameSwitchDrawing(symbol.id, 2, 'O');
  assert.deepEqual(SW.visemeMapFor(ed.symbol(symbol.id)), { rest: 0, A: 1, O: 2 });
  // lip sync com fonemas: cada chave guarda o dela
  const it = ed.switchItem();
  ed.applyLipSync(it, [
    { at: 0, length: 3, frame: 0, viseme: 'rest' },
    { at: 3, length: 4, frame: 1, viseme: 'A' },
    { at: 7, length: 3, frame: 0, viseme: 'rest' },
  ]);
  const L = ed.layer(layer.id);
  assert.deepEqual(L.frames.filter((s) => s.viseme).map((s) => [s.start, s.viseme]), [[0, 'rest'], [3, 'A'], [7, 'rest']]);
  assert.equal(ed.switchLabelOf(L.frames.find((s) => s.start === 3)), 'A');
  // ajuste fino: a chave do quadro 4 vira O e mostra o desenho O
  ed.setSpanViseme(layer.id, 3, 'O');
  assert.equal(shownFill(ed, ed.layer(layer.id), 4), '#00f');
  assert.equal(ed.layer(layer.id).frames.find((s) => s.start === 3).viseme, 'O');
});

// ---------- clipes ----------
const arm = (pose) => ({ bones: [{ id: 'b1', parentId: null, x: 0, y: 0, angle: 0, length: 50 }, { id: 'b2', parentId: 'b1', angle: 0, length: 40 }], pose });

test('clipes: substituir e repetir', () => {
  const base = [{ start: 0, duration: 20, elements: [] }];
  const clip = [
    { start: 0, duration: 3, elements: [], label: 'a' },
    { start: 3, duration: 2, elements: [] },
  ];
  const fr = SW.applyClipFrames(base, clip, 4, { repeat: 2 });
  assert.deepEqual(fr.map((s) => [s.start, s.duration]), [[0, 4], [4, 3], [7, 2], [9, 3], [12, 2], [14, 6]]);
  assert.equal(R.layerLength({ frames: fr }), 20, 'substituir não empurra o resto');
});

test('clipes: misturar troca só os ossos que o clipe mexe e mantém as chaves da camada', () => {
  // camada: b1 vai de 0 a 1 entre os quadros 0 e 10 (tween); b2 parado em 0.2
  const layer = [
    { start: 0, duration: 10, elements: [], armature: arm({ b1: 0, b2: 0.2 }), tween: { type: 'classic', ease: 0 } },
    { start: 10, duration: 5, elements: [], armature: arm({ b1: 1, b2: 0.2 }) },
  ];
  // clipe: aceno, só o b2 mexe (b1 parado no que estava quando o clipe foi gravado)
  const clip = [
    { start: 0, duration: 4, elements: [], armature: arm({ b1: 5, b2: 0 }), tween: { type: 'classic', ease: 0 } },
    { start: 4, duration: 4, elements: [], armature: arm({ b1: 5, b2: 1 }) },
  ];
  assert.deepEqual([...SW.clipMovedBones(clip)], ['b2']);
  const fr = SW.applyClipFrames(layer, clip, 2, { mode: 'blend' });
  const at = (f) => SW.poseAtFrame(fr, f);
  assert.ok(Math.abs(at(2).b1 - 0.2) < 1e-9, 'b1 segue a animação da camada');
  assert.equal(at(2).b2, 0, 'b2 vem do clipe');
  assert.equal(at(6).b2, 1);
  assert.ok(Math.abs(at(6).b1 - 0.6) < 1e-9);
  assert.ok(fr.some((s) => s.start === 10), 'a chave do quadro 10 da camada continua');
  // peso 50%: o b2 fica no meio do caminho
  const half = SW.applyClipFrames(layer, clip, 2, { mode: 'blend', weight: 0.5 });
  assert.ok(Math.abs(SW.poseAtFrame(half, 6).b2 - 0.6) < 1e-9);
});

test('clipes no editor: salvar a seleção, inserir em outro ponto, desfazer', () => {
  const ed = new Editor();
  ed.toast = () => {};
  ed.addElements([box(0)]);
  ed.setFrame(5);
  ed.timelineOp('insertKeyframe');
  ed.activeLayer.frames[1].elements[0].matrix = [1, 0, 0, 1, 100, 0];
  ed.setFrame(29);
  ed.timelineOp('insertFrame');
  ed.setFrameSelection({ from: 0, to: 9, layerIds: [ed.activeLayerId] });
  const c = ed.saveClip('Pulo');
  assert.equal(c.length, 10);
  assert.equal(ed.clips().length, 1);
  ed.setFrameSelection(null);
  ed.setFrame(20);
  assert.equal(ed.insertClip(c.id, { repeat: 1 }), 1);
  const starts = ed.activeLayer.frames.map((s) => s.start);
  assert.ok(starts.includes(20) && starts.includes(25), `o clipe entrou no quadro 21 (${starts})`);
  ed.undo();
  assert.ok(!ed.activeLayer.frames.some((s) => s.start === 25));
  ed.renameClip(c.id, 'Salto');
  assert.equal(ed.clips()[0].name, 'Salto');
  ed.deleteClip(c.id);
  assert.equal(ed.clips().length, 0);
  ed.undo();
  assert.equal(ed.clips().length, 1);
});

// ---------- personagens ----------
test('personagem: pacote com símbolos de dentro, imagens e clipes; volta com ids novos', () => {
  const { ed, symbol } = troca();
  ed.renameSwitchDrawing(symbol.id, 1, 'A');
  // personagem = símbolo com a troca dentro, uma imagem e um clipe
  const bmp = { id: 'bimg', name: 'Olho', folderId: null, mime: 'image/png', data: 'AAAA', w: 4, h: 4 };
  ed.doc.library.bitmaps.push(bmp);
  const it = ed.switchItem();
  ed.setSelection([it.el.id]);
  ed.convertToSymbol({ name: 'Herói' });
  const hero = ed.doc.library.items.find((s) => s.name === 'Herói');
  hero.layers[0].frames[0].elements.push({ id: 'eimg', type: 'bitmap', assetId: 'bimg', matrix: [1, 0, 0, 1, 0, 0], w: 4, h: 4 });
  hero.clips = [{ id: 'k1', name: 'Fala', length: 1, layers: [{ layerId: hero.layers[0].id, name: hero.layers[0].name, frames: [] }] }];
  const pkg = SW.characterPackage(ed.doc, hero.id);
  assert.equal(pkg.format, SW.CHARACTER_FORMAT);
  assert.deepEqual(pkg.items.map((s) => s.name).sort(), ['Boca', 'Herói']);
  assert.equal(pkg.bitmaps.length, 1);
  // outro arquivo
  const ed2 = new Editor();
  ed2.toast = () => {};
  const got = ed2.importCharacter(JSON.parse(JSON.stringify(pkg)));
  assert.equal(got.name, 'Herói');
  assert.notEqual(got.id, hero.id, 'id novo');
  const lib = ed2.doc.library;
  assert.equal(lib.items.length, 2);
  assert.equal(lib.bitmaps.length, 1);
  const inner = got.layers[0].frames[0].elements.find((e) => e.type === 'instance');
  const boca = lib.items.find((s) => s.id === inner.symbolId);
  assert.ok(boca?.switch, 'a instância aponta para a troca trazida');
  assert.equal(SW.switchDrawings(boca)[1].name, 'A');
  const img = got.layers[0].frames[0].elements.find((e) => e.type === 'bitmap');
  assert.equal(img.assetId, lib.bitmaps[0].id, 'a imagem aponta para a cópia');
  assert.equal(got.clips[0].layers[0].layerId, got.layers[0].id, 'o clipe aponta para a camada nova');
  assert.equal(ed2.layers[0].frames[0].elements.filter((e) => e.type === 'instance').length, 1, 'colocado no palco');
  // trazer de novo não repete nomes
  ed2.importCharacter(JSON.parse(JSON.stringify(pkg)), { place: false });
  assert.deepEqual(lib.items.map((s) => s.name).sort(), ['Boca', 'Boca 2', 'Herói', 'Herói 2']);
  ed2.undo();
  assert.equal(lib.items.length, 2, 'um passo de desfazer');
  assert.throws(() => SW.remapCharacter(ed2.doc, { format: 'outro' }));
});
