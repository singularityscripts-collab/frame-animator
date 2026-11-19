// Etapa V2 (Parte 2 do REFINO): traço vetorial de verdade — linha central editável com largura
// por trecho (pressão da caneta e pontas afinadas), fechar ao voltar ao começo e borracha que
// mantém a largura dos pedaços.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
if (!paper.project) paper.setup(new paper.Size(1, 1));
const S = await import('../src/model/stroke.js');
const G = await import('../src/player/geom.js');
const V = await import('../src/model/vector-ops.js');
const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const { makeShape } = await import('../src/model/geometry.js');

const line = (n, w = () => 1) => Array.from({ length: n + 1 }, (_, i) => ({ x: i * 4, y: 0, w: w(i / n) }));

test('curva de pressão: leve engrossa antes, firme pede mais força; sempre entre o mínimo e 1', () => {
  for (const c of ['soft', 'normal', 'firm']) {
    assert.ok(Math.abs(S.pressureFactor(0, c) - S.MIN_PRESSURE_WIDTH) < 1e-9);
    assert.ok(Math.abs(S.pressureFactor(1, c) - 1) < 1e-9);
  }
  assert.ok(S.pressureFactor(0.3, 'soft') > S.pressureFactor(0.3, 'normal'));
  assert.ok(S.pressureFactor(0.3, 'normal') > S.pressureFactor(0.3, 'firm'));
  assert.match(S.pressureCurveSvgPath('normal'), /^M0\.0,/);
});

test('traço: pressão constante não grava perfil; pressão variando grava largura por trecho', () => {
  const flat = S.strokeFromSamples(line(50), { tolerance: 0.5 });
  assert.equal(flat.profile, null, 'largura constante não precisa de perfil');
  assert.equal(flat.closed, false);

  const ramp = S.strokeFromSamples(line(50, (t) => 0.2 + 0.8 * t), { tolerance: 0.5 });
  assert.ok(ramp.profile?.length >= 2, 'pressão subindo vira perfil');
  const w0 = G.profileAt(ramp.profile, 0.05), w1 = G.profileAt(ramp.profile, 0.95);
  assert.ok(w0 < 0.4 && w1 > 0.85, `começo fino e fim grosso (${w0}, ${w1})`);
  assert.ok(ramp.profile.length < 20, `perfil enxuto (${ramp.profile.length} pontos)`);
});

test('traço: o toque inicial sem pressão (null) usa a primeira pressão conhecida', () => {
  const s = line(40, (t) => (t < 0.1 ? null : 0.5));
  const r = S.strokeFromSamples(s, { tolerance: 0.5 });
  const w = G.profileAt(r.profile || [], 0.02);
  assert.ok(Math.abs(w - 0.5) < 0.05 || r.profile === null, `começo sem bolinha (${w})`);
});

test('traço: afinar as pontas deixa as duas pontas finas e o meio cheio', () => {
  const r = S.strokeFromSamples(line(100), { tolerance: 0.5, taperStart: 60, taperEnd: 60 });
  assert.ok(r.profile, 'afinar cria perfil mesmo sem pressão');
  assert.ok(G.profileAt(r.profile, 0) < 0.1 && G.profileAt(r.profile, 1) < 0.1);
  assert.ok(G.profileAt(r.profile, 0.5) > 0.95);
  // traço curto: o afinar não passa de 45% do comprimento de cada lado
  const short = S.strokeFromSamples(line(10), { tolerance: 0.5, taperStart: 500 });
  assert.ok(G.profileAt(short.profile, 0.9) > 0.95);
});

test('traço: terminar perto do começo fecha a forma (só se a opção estiver ligada)', () => {
  const circle = Array.from({ length: 81 }, (_, i) => {
    const a = (i / 80) * Math.PI * 2;
    return { x: 100 * Math.cos(a), y: 100 * Math.sin(a) + (i === 80 ? 3 : 0), w: 1 };
  });
  const closed = S.strokeFromSamples(circle, { tolerance: 0.8, closeDist: 8 });
  assert.equal(closed.closed, true);
  assert.equal(closed.path.closed, true);
  assert.ok(closed.path.pts.length >= 6);
  assert.equal(S.strokeFromSamples(circle, { tolerance: 0.8 }).closed, false);
  // um rabisco curto que volta ao começo não fecha
  const tiny = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 1, y: 1 }].map((p) => ({ ...p, w: 1 }));
  assert.equal(S.strokeFromSamples(tiny, { tolerance: 0.2, closeDist: 8 }).closed, false);
});

test('largura variável: pontas redondas passam da ponta do caminho', () => {
  const path = { closed: false, pts: [[0, 0, 0, 0, 0, 0], [100, 0, 0, 0, 0, 0]] };
  const [poly] = G.variableStrokePolys(path, 20, [{ t: 0, w: 1 }, { t: 1, w: 1 }]);
  const xs = poly.map((p) => p.x);
  assert.ok(Math.min(...xs) < -9 && Math.max(...xs) > 109, `ponta redonda (${Math.min(...xs)}, ${Math.max(...xs)})`);
});

test('reduceProfile tira pontos que a reta entre vizinhos já reproduz', () => {
  const pts = Array.from({ length: 51 }, (_, i) => ({ t: i / 50, w: 0.5 + 0.5 * (i / 50) }));
  assert.equal(G.reduceProfile(pts).length, 2);
  const bump = Array.from({ length: 51 }, (_, i) => ({ t: i / 50, w: i === 25 ? 2 : 1 }));
  assert.ok(G.reduceProfile(bump).some((p) => p.w === 2));
});

test('borracha: cada pedaço de uma linha de largura variável mantém a largura que tinha ali', () => {
  // linha de 0 a 200 ficando mais grossa; apaga o meio (x de 90 a 110)
  const path = { closed: false, pts: [[-100, 0, 0, 0, 0, 0], [100, 0, 0, 0, 0, 0]] };
  const el = { id: 'a', type: 'shape', matrix: [1, 0, 0, 1, 100, 0], path, fill: null, stroke: '#000000', strokeWidth: 10, widthProfile: [{ t: 0, w: 0.2 }, { t: 1, w: 1 }] };
  const eraser = new paper.Path.Rectangle({ point: [90, -50], size: [20, 100], insert: false });
  const out = V.eraseShape(el, eraser, 'normal');
  assert.equal(out.length, 1);
  const piece = out[0];
  assert.ok(piece.widthProfile?.length >= 2, 'o perfil foi recalculado');
  // pedaço da esquerda (0 a 90) e da direita (110 a 200), lidos no perfil novo
  const subs = R_subpathsTotal(piece.path);
  assert.ok(subs === 2, `dois pedaços (${subs})`);
  assert.ok(G.profileAt(piece.widthProfile, 0.01) < 0.3, 'começo continua fino');
  assert.ok(G.profileAt(piece.widthProfile, 0.99) > 0.9, 'fim continua grosso');
  const nearCut = G.profileAt(piece.widthProfile, 0.47);
  assert.ok(nearCut > 0.5 && nearCut < 0.7, `perto do corte, a largura de lá (${nearCut})`);
});

function R_subpathsTotal(path) {
  return path.subs ? path.subs.length : 1;
}

test('selecionar mesma cor pega as formas do quadro com o mesmo preenchimento', () => {
  const ed = new Editor();
  const sq = (x, fill) => makeShape({ path: { closed: true, pts: [[0, 0, 0, 0, 0, 0], [10, 0, 0, 0, 0, 0], [10, 10, 0, 0, 0, 0]] }, cx: x, cy: 0, fill, stroke: null, strokeWidth: 0 });
  ed.addElements([sq(0, '#FF0000'), sq(50, '#ff0000'), sq(100, '#00ff00')]);
  const items = ed.frameItems();
  ed.setSelection([items[0].el.id]);
  ed.toast = () => {};
  ed.selectSameColor();
  assert.equal(ed.selection.length ?? ed.selection.size, 2);
});
