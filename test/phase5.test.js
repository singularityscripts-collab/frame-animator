import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');

const { Editor } = await import('../src/editor/editor.js');
await import('../src/editor/editor-pro.js');
await import('../src/editor/editor-final.js');
const { rectPath, ellipsePath, makeShape, pathBounds } = await import('../src/model/geometry.js');
const { parseDocument, serialize, createDocument, createLayer } = await import('../src/model/document.js');
const R = await import('../src/player/render.js');
const { mlsPoint } = await import('../src/player/mesh.js');
const { solveBones, solveIK, poseElements } = await import('../src/player/bones.js');
const { polystarPath } = await import('../src/editor/tools-final.js');
const { pencilPath } = await import('../src/editor/tools.js');
const X = await import('../src/model/xfl.js');
const { parseXML, child } = await import('../src/model/xml.js');
const { analyzeLipSync } = await import('../src/model/lipsync.js');
const { traceImage } = await import('../src/model/trace.js');
const { toLottie } = await import('../src/export/lottie.js');
const { frameToSVG } = await import('../src/export/svg.js');
const { flattenFrame, combineCT, applyCT } = await import('../src/export/flatten.js');
const { packRects, atlasJSON } = await import('../src/export/spritesheet.js');
const { bundlePlayer, html5Files } = require('../bundler.cjs');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const rect = (cx, cy, w = 20, h = 20, fill = '#ff0000') => makeShape({ path: rectPath(w, h), cx, cy, fill, stroke: null, strokeWidth: 1 });

test('malha de pinos (MLS): sem deslocamento fica parado; um pino só arrasta tudo junto', () => {
  const still = [
    { x: 0, y: 0, dx: 0, dy: 0 },
    { x: 100, y: 0, dx: 0, dy: 0 },
    { x: 0, y: 100, dx: 0, dy: 0 },
  ];
  const p = mlsPoint(still, 37, 52);
  near(p.x, 37, 1e-6);
  near(p.y, 52, 1e-6);
  const one = mlsPoint([{ x: 50, y: 50, dx: 10, dy: -5 }], 0, 0);
  near(one.x, 10, 1e-6);
  near(one.y, -5, 1e-6);
  // três pinos com a mesma translação: tudo translada (deformação rígida)
  const moved = still.map((q) => ({ ...q, dx: 7, dy: 3 }));
  const m = mlsPoint(moved, 40, 40);
  near(m.x, 47, 1e-6);
  near(m.y, 43, 1e-6);
});

test('ossos: cadeia, pose e cinemática inversa alcançam o alvo', () => {
  const arm = {
    bones: [
      { id: 'a', parentId: null, x: 0, y: 0, angle: 0, length: 100 },
      { id: 'b', parentId: 'a', x: 100, y: 0, angle: 0, length: 100 },
    ],
    pose: {},
  };
  const rest = solveBones(arm, {});
  near(rest.get('b').tail.x, 200, 1e-6);
  // girar o primeiro osso 90° leva a ponta para baixo
  const bent = solveBones(arm, { a: Math.PI / 2 });
  near(bent.get('b').tail.x, 0, 1e-6);
  near(bent.get('b').tail.y, 200, 1e-6);
  const pose = solveIK(arm, {}, 'b', { x: 100, y: 100 }, 40);
  const tip = solveBones(arm, pose).get('b').tail;
  assert.ok(Math.hypot(tip.x - 100, tip.y - 100) < 2, `IK chegou em ${tip.x},${tip.y}`);
  // elemento preso ao osso acompanha a pose
  const el = { ...rect(150, 0), bone: 'b' };
  const [posed] = poseElements([el], arm, { a: Math.PI / 2 });
  near(posed.matrix[4], 0, 1e-6);
  near(posed.matrix[5], 150, 1e-6);
});

test('polígono, estrela e lápis endireitar (linha, retângulo, elipse)', () => {
  assert.equal(polystarPath(100, 100, 6, false).pts.length, 6);
  const star = polystarPath(100, 100, 5, true, 0.5);
  assert.equal(star.pts.length, 10);
  near(Math.hypot(star.pts[1][0], star.pts[1][1]), 25, 1e-6);
  const box = [];
  for (let i = 0; i <= 10; i++) box.push({ x: i * 10, y: 0 });
  for (let i = 0; i <= 10; i++) box.push({ x: 100, y: i * 6 });
  for (let i = 10; i >= 0; i--) box.push({ x: i * 10, y: 60 });
  for (let i = 10; i >= 0; i--) box.push({ x: 0, y: i * 6 + 0.5 });
  const r = pencilPath(box, 'straighten');
  assert.equal(r.path.closed, true);
  assert.equal(r.path.pts.length, 4);
  const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 0.4 * Math.sin(i) }));
  const l = pencilPath(line, 'straighten');
  assert.equal(l.path.pts.length, 2);
  near(l.path.pts[0][1], l.path.pts[1][1], 1e-6); // encaixou na horizontal
  const ink = pencilPath(line, 'ink');
  assert.ok(ink.path.pts.length >= 2 && ink.path.pts.every((q) => !q[4] && !q[5]));
});

test('XFL: números das arestas, laços de preenchimento e conversão de ActionScript', () => {
  near(X.edgeNumber('20'), 1, 1e-9);
  near(X.edgeNumber('#14'), 1, 1e-9);
  near(X.edgeNumber('#A.8'), 0.525, 1e-9);
  near(X.edgeNumber('#FFFFFFEC'), -1, 1e-9);
  const segs = X.decodeEdges('!0 0|200 0|200 200|0 200|0 0');
  assert.equal(segs.length, 4);
  const loops = X.chainLoops(segs);
  assert.equal(loops.length, 1);
  assert.equal(X.segsToSub(loops[0], true).pts.length, 4);
  const quad = X.decodeEdges('!0 0[100 0 100 100');
  assert.ok(quad[0].c);
  const js = X.as3ToJS('import flash.events.*;\nstop();\nvar n:int = 1;\nbtn.addEventListener(MouseEvent.CLICK, function(e:MouseEvent):void { gotoAndStop("fim"); });');
  assert.match(js, /this\.stop\(\)/);
  assert.match(js, /var n = 1/);
  assert.match(js, /this\.getChild\('btn'\)\.on\('click', \(e\) => \{ this\.gotoAndStop\("fim"\); \}\)/);
  assert.doesNotThrow(() => new Function('root', 'stage', 'trace', js));
  const x = parseXML('<a x="1 &amp; 2"><b>texto<![CDATA[<cru>]]></b><c/></a>');
  assert.equal(x.attrs.x, '1 & 2');
  assert.equal(child(x, 'b').text, 'texto<cru>');
});

test('XFL: documento com símbolo, máscara, tween, script, texto e gradiente', async () => {
  const docXml = `<DOMDocument width="400" height="300" frameRate="30" backgroundColor="#336699">
    <media><DOMBitmapItem name="img.png" href="img.png"/><DOMSoundItem name="voz.wav" href="voz.wav"/></media>
    <symbols><Include href="Bola.xml"/></symbols>
    <timelines><DOMTimeline name="Principal"><layers>
      <DOMLayer name="M" layerType="mask"><frames><DOMFrame index="0" duration="10"><elements>
        <DOMShape><fills><FillStyle index="1"><SolidColor color="#000000"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 0|4000 0|4000 4000|0 4000|0 0"/></edges></DOMShape>
      </elements></DOMFrame></frames></DOMLayer>
      <DOMLayer name="Conteúdo" parentLayerIndex="0"><frames>
        <DOMFrame index="0" duration="5" tweenType="motion" acceleration="50" name="inicio" soundName="voz.wav" soundSync="stream">
          <Actionscript><script><![CDATA[stop();]]></script></Actionscript>
          <elements><DOMSymbolInstance libraryItemName="Pasta/Bola" name="bola" blendMode="screen"><matrix><Matrix tx="10" ty="20"/></matrix><color><Color tintMultiplier="0.5" tintColor="#FF0000"/></color><filters><BlurFilter blurX="4" blurY="8"/></filters></DOMSymbolInstance>
            <DOMBitmapInstance libraryItemName="img.png"><matrix><Matrix tx="50" ty="60"/></matrix></DOMBitmapInstance></elements>
        </DOMFrame>
        <DOMFrame index="7" duration="3"><elements><DOMDynamicText name="placar" width="120"><matrix><Matrix tx="5" ty="6"/></matrix><textRuns><DOMTextRun><characters>Oi&#xD;você</characters><textAttrs><DOMTextAttrs face="Georgia-Bold" size="20" fillColor="#00FF00"/></textAttrs></DOMTextRun></textRuns></DOMDynamicText></elements></DOMFrame>
      </frames></DOMLayer>
    </layers></DOMTimeline></timelines></DOMDocument>`;
  const symXml = `<DOMSymbolItem name="Pasta/Bola" symbolType="graphic"><timeline><DOMTimeline name="Bola"><layers><DOMLayer name="L"><frames><DOMFrame index="0"><elements>
    <DOMShape><fills><FillStyle index="1"><LinearGradient><matrix><Matrix a="0.05" d="0.05"/></matrix><GradientEntry color="#FFFFFF" ratio="0"/><GradientEntry color="#0000FF" ratio="1" alpha="0.5"/></LinearGradient></FillStyle></fills>
    <strokes><StrokeStyle index="1"><SolidStroke weight="3"><fill><SolidColor color="#222222"/></fill></SolidStroke></StrokeStyle></strokes>
    <edges><Edge fillStyle0="1" strokeStyle="1" edges="!400 0[400 400 0 400[-400 400 -400 0[-400 -400 0 -400[400 -400 400 0"/></edges></DOMShape>
  </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
  // PNG 1×1 e WAV mínimo
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const wav = X.pcmToWav(new Uint8Array(400), '22kHz 16bit Mono');
  const files = {
    'DOMDocument.xml': { text: docXml },
    'LIBRARY/Bola.xml': { text: symXml },
    'LIBRARY/img.png': { base64: png.toString('base64') },
    'LIBRARY/voz.wav': { base64: Buffer.from(wav.bytes).toString('base64') },
  };
  const { doc, warnings } = await X.importXFL(files, { inflate: (b) => zlib.inflateSync(b) });
  assert.deepEqual(warnings, []);
  assert.equal(doc.width, 400);
  assert.equal(doc.fps, 30);
  assert.equal(doc.library.folders[0].name, 'Pasta');
  const [mask, content] = doc.scenes[0].layers;
  assert.equal(mask.type, 'mask');
  assert.equal(content.maskedBy, mask.id);
  const f0 = content.frames[0];
  assert.equal(f0.tween.type, 'classic');
  assert.equal(f0.tween.ease, 50);
  assert.equal(f0.label, 'inicio');
  assert.equal(f0.sound.sync, 'stream');
  assert.match(f0.script, /this\.stop\(\)/);
  const inst = f0.elements[0];
  assert.equal(inst.behavior, 'graphic');
  assert.equal(inst.name, 'bola');
  assert.equal(inst.blend, 'screen');
  assert.equal(inst.color.mode, 'tint');
  assert.equal(inst.filters[0].blur, 6);
  assert.equal(f0.elements[1].type, 'bitmap');
  // buraco entre o quadro 5 e o 7 vira quadros vazios
  assert.deepEqual(content.frames.map((s) => [s.start, s.duration]), [[0, 5], [5, 2], [7, 3]]);
  const txt = content.frames[2].elements[0];
  assert.equal(txt.kind, 'dynamic');
  assert.equal(txt.text, 'Oi\nvocê');
  assert.equal(txt.font, 'Georgia');
  assert.equal(txt.bold, true);
  const sym = doc.library.items[0];
  const [fillEl, strokeEl] = sym.layers[0].frames[0].elements;
  assert.equal(fillEl.fill.type, 'linear');
  near(fillEl.fill.matrix[0], 0.05 * 819.2, 1e-6);
  assert.equal(strokeEl.stroke, '#222222');
  const b = pathBounds(fillEl.path);
  near(b.w, 40, 1e-6); // círculo de 800 twips = 40 px
  // o documento importado desenha e serializa
  assert.doesNotThrow(() => parseDocument(serialize(doc)));
});

test('XFL: bitmap sem perdas do .fla (bin/*.dat) é decodificado', async () => {
  // 2×1: vermelho opaco e azul meio transparente (ARGB pré-multiplicado, zlib em blocos)
  const argb = Uint8Array.from([255, 255, 0, 0, 128, 0, 0, 128]);
  const z = zlib.deflateSync(argb);
  const head = new Uint8Array(26);
  const dv = new DataView(head.buffer);
  head[0] = 3;
  head[1] = 5;
  dv.setUint16(2, 8, true);
  dv.setUint16(4, 2, true);
  dv.setUint16(6, 1, true);
  head[24] = 1;
  head[25] = 1;
  const chunk = new Uint8Array(2 + z.length + 2);
  new DataView(chunk.buffer).setUint16(0, z.length, true);
  chunk.set(z, 2);
  const dat = new Uint8Array([...head, ...chunk]);
  const r = await X.decodeBitmapDat(dat, (b) => zlib.inflateSync(b));
  assert.equal(r.w, 2);
  assert.equal(r.h, 1);
  assert.deepEqual([...r.rgba.slice(0, 4)], [255, 0, 0, 255]);
  assert.equal(r.rgba[7], 128);
  assert.ok(r.rgba[6] > 250); // azul "despré-multiplicado"
});

test('lip-sync: silêncio fecha a boca, vogal grave arredonda, chiado vira S/F', () => {
  const sr = 22050, fps = 24;
  const s = new Float32Array(sr * 2);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < sr * 0.6; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / sr);
  for (let i = Math.floor(sr * 1.2); i < sr * 1.8; i++) s[i] = 0.4 * rnd();
  const segs = analyzeLipSync(s, sr, fps);
  const at = (f) => segs.find((x) => f >= x.at && f < x.at + x.length)?.viseme;
  assert.ok(['O', 'U'].includes(at(6)), `vogal: ${at(6)}`);
  assert.equal(at(22), 'rest');
  assert.ok(['S', 'FV'].includes(at(36)), `chiado: ${at(36)}`);
  assert.equal(segs.reduce((n, x) => n + x.length, 0), Math.ceil((s.length / sr) * fps));
});

test('vetorizar bitmap: quadrado com furo vira forma com dois contornos', () => {
  const w = 40, h = 30;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const red = x >= 5 && x < 25 && y >= 5 && y < 25 && !(x >= 12 && x < 18 && y >= 12 && y < 18);
      data.set(red ? [220, 20, 20, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    }
  const out = traceImage({ width: w, height: h, data }, { colors: 2, minArea: 4 });
  assert.equal(out.length, 2);
  const red = out.find((o) => o.color === '#dc1414');
  assert.equal(red.subs.length, 2);
  near(red.area, 400 - 36, 1e-6);
});

test('alinhar, distribuir e mesma largura', () => {
  const ed = new Editor();
  const a = rect(100, 100, 20, 20), b = rect(300, 200, 40, 40), c = rect(500, 150, 20, 60);
  ed.addElements([a, b, c]);
  ed.selectAll();
  ed.alignSelection('left');
  for (const it of ed.selectedItems()) near(ed.boundsOf(it).x, 90, 1e-6);
  ed.alignSelection('distV');
  const ys = ed.selectedItems().map((it) => ed.boundsOf(it)).map((bb) => bb.y + bb.h / 2).sort((p, q) => p - q);
  near(ys[1] - ys[0], ys[2] - ys[1], 1e-6);
  ed.alignSelection('matchW');
  for (const it of ed.selectedItems()) near(ed.boundsOf(it).w, 40, 1e-6);
  ed.alignSelection('hcenter', true);
  for (const it of ed.selectedItems()) near(ed.boundsOf(it).x + ed.boundsOf(it).w / 2, ed.doc.width / 2, 1e-6);
});

test('script por quadro, seletor de quadro, lip-sync e localizar/substituir no editor', () => {
  const ed = new Editor();
  ed.addElements([rect(50, 50)]);
  ed.setFrame(9);
  ed.timelineOp('insertFrame');
  ed.setFrame(4);
  ed.setSpanScript('this.stop();');
  const L = ed.activeLayer;
  assert.equal(L.frames.find((s) => s.start === 4).script, 'this.stop();');
  // símbolo gráfico de 4 quadros (bocas)
  ed.setFrame(0);
  ed.selectAll();
  ed.convertToSymbol({ name: 'Boca', type: 'graphic' });
  const sym = ed.doc.library.items[0];
  sym.layers[0].frames[0].duration = 4;
  ed.setFrame(2);
  ed.selectAll();
  ed.setFirstFrame(3);
  const k = L.frames.find((s) => s.start === 2);
  assert.equal(k.elements[0].firstFrame, 3);
  assert.equal(k.elements[0].loop, 'single');
  ed.setFrame(0);
  ed.selectAll();
  ed.applyLipSync(ed.selectedItems()[0], [
    { at: 0, length: 3, frame: 1 },
    { at: 3, length: 2, frame: 2 },
  ]);
  assert.deepEqual(
    L.frames.filter((s) => s.start < 5).map((s) => [s.start, s.elements[0]?.firstFrame]),
    [[0, 1], [3, 2], [4, 2]],
  );
  ed.addText(10, 10, 'Olá mundo');
  const found = ed.findAll('mundo');
  assert.equal(found.length, 1);
  assert.equal(ed.replaceAll('mundo', 'pessoal'), 1);
  assert.ok(ed.frameItems().some((it) => it.el.text === 'Olá pessoal'));
});

test('desenho mesclado: formas da mesma cor se fundem; ossos e 9 fatias ficam no arquivo', () => {
  const ed = new Editor();
  ed.setObjectDrawing(false);
  ed.addElements([rect(50, 50, 40, 40, '#00ff00')]);
  ed.addElements([rect(70, 50, 40, 40, '#00ff00')]);
  const shapes = ed.frameItems().filter((it) => it.el.type === 'shape');
  assert.equal(shapes.length, 1);
  near(ed.boundsOf(shapes[0]).w, 60, 0.5);
  ed.setObjectDrawing(true);
  ed.addElements([rect(300, 50, 40, 40, '#0000ff')]);
  const target = ed.frameItems().at(-1);
  ed.addBone({ x: 50, y: 50 }, { x: 300, y: 50 }, null, target.el.id);
  assert.equal(ed.currentSpan().armature.bones.length, 1);
  ed.selectAll();
  ed.convertToSymbol({ name: 'Painel', type: 'movieclip' });
  ed.setScale9(ed.doc.library.items[0].id, { x: 10, y: 10, w: 20, h: 20 });
  const back = parseDocument(serialize(ed.doc));
  assert.deepEqual(back.library.items[0].scale9, { x: 10, y: 10, w: 20, h: 20 });
});

/** Documento de teste: retângulo vermelho atrás de uma máscara, texto e instância com cor. */
function sampleDoc() {
  const ed = new Editor();
  ed.load(createDocument({ width: 200, height: 100, fps: 10 }), null);
  ed.addElements([rect(100, 50, 200, 100)]);
  ed.addLayer();
  ed.addElements([rect(50, 50, 100, 100, '#000000')]);
  ed.setLayerKind(ed.layers[0].id, 'mask');
  ed.addLayer();
  const blue = rect(150, 20, 20, 20, '#0000ff');
  ed.addElements([blue]);
  ed.setSelection([blue.id]);
  ed.convertToSymbol({ name: 'Azul', type: 'graphic' });
  ed.setInstanceProps({ color: { mode: 'alpha', alpha: 50 } });
  for (const l of ed.layers) {
    ed.setActiveLayer(l.id);
    ed.setFrame(4);
    ed.timelineOp('insertFrame');
  }
  return ed;
}

test('achatar quadro, SVG e Lottie (máscara vira track matte, quadros iguais se juntam)', () => {
  const ed = sampleDoc();
  const items = flattenFrame(ed.doc, 0, 0);
  const mask = items.find((i) => i.kind === 'mask');
  assert.ok(mask && mask.items.length === 1 && mask.mask.length === 1);
  const blue = items.find((i) => i.kind === 'shape' && i.fill === '#0000ff');
  near(applyCT('#0000ff', 1, blue.ct).a, 0.5, 1e-6);
  near(combineCT({ rm: 1, gm: 1, bm: 1, am: 0.5, ro: 0, go: 0, bo: 0, ao: 0 }, { rm: 1, gm: 1, bm: 1, am: 0.5, ro: 0, go: 0, bo: 0, ao: 0 }).am, 0.25, 1e-9);
  const svg = frameToSVG(ed.doc, 0, 0);
  assert.match(svg, /<mask id=/);
  assert.match(svg, /fill="#0000ff" fill-opacity="0.5"/);
  const L = toLottie(ed.doc, {});
  assert.equal(L.op, 5);
  assert.equal(L.fr, 10);
  const matte = L.layers.findIndex((l) => l.td === 1);
  assert.ok(matte >= 0);
  assert.equal(L.layers[matte + 1].tt, 1, 'o conteúdo vem logo abaixo da matte');
  // 5 quadros iguais: cada camada cobre o intervalo inteiro
  assert.ok(L.layers.every((l) => l.ip === 0 && l.op === 5));
  const sh = L.layers.find((l) => l.ty === 4 && !l.td && l.nm !== 'Fundo').shapes[0];
  assert.equal(sh.ty, 'gr');
  assert.equal(sh.it[0].ty, 'sh');
  assert.equal(sh.it[0].ks.k.v.length, 4);
});

test('sprite sheet: empacotar sem sobrepor e JSON no formato hash', () => {
  const sizes = [
    { w: 50, h: 40 },
    { w: 30, h: 60 },
    { w: 80, h: 20 },
    { w: 10, h: 10 },
    { w: 45, h: 45 },
  ];
  for (const layout of ['pack', 'grid', 'row']) {
    const p = packRects(sizes, { padding: 2, layout });
    const boxes = sizes.map((s, i) => ({ ...p.rects[i], ...s }));
    for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= p.w && b.y + b.h <= p.h, layout);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        assert.ok(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y, `${layout}: ${i} e ${j} se sobrepõem`);
      }
  }
  const json = atlasJSON([{ name: 'a0000', x: 0, y: 0, w: 10, h: 10, ox: 2, oy: 3, sw: 20, sh: 20, trimmed: true }], { image: 'a.png', w: 10, h: 10, fps: 12, name: 'a' });
  assert.deepEqual(json.frames.a0000.spriteSourceSize, { x: 2, y: 3, w: 10, h: 10 });
  assert.deepEqual(json.animations.a, ['a0000']);
});

test('HTML5: o player vira um script só e o runtime roda os scripts dos quadros', () => {
  const playerDir = fileURLToPath(new URL('../src/player/', import.meta.url));
  const src = bundlePlayer(playerDir);
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
  // ambiente mínimo de navegador
  const noop = () => {};
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  const listeners = {};
  const canvas = { clientWidth: 200, clientHeight: 100, width: 0, height: 0, style: {}, getContext: () => ctx, addEventListener: (t, fn) => ((listeners[t] ||= []).push(fn)), getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }), parentElement: null };
  ctx.canvas = canvas;
  const traces = [];
  const sandbox = { console, Math, JSON, Map, Set, WeakMap, Promise, setTimeout, clearTimeout, Float32Array, Uint8Array, Uint8ClampedArray, ArrayBuffer, DataView, Object, Array, Number, String, Boolean, Error, Symbol, Function, Infinity, NaN, isFinite, parseFloat, parseInt };
  sandbox.Path2D = function Path2D() {
    return new Proxy({}, { get: () => noop });
  };
  sandbox.DOMMatrix = function DOMMatrix() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, multiply: () => new sandbox.DOMMatrix() };
  };
  sandbox.window = sandbox;
  sandbox.devicePixelRatio = 1;
  sandbox.addEventListener = noop;
  sandbox.requestAnimationFrame = noop;
  sandbox.document = { createElement: () => canvas };
  sandbox.performance = { now: () => 0 };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const ed = new Editor();
  ed.load(createDocument({ width: 200, height: 100, fps: 10 }), null);
  ed.addElements([rect(50, 50)]);
  ed.setFrame(9);
  ed.timelineOp('insertFrame');
  ed.setFrame(3);
  ed.setSpanScript("trace('parou', this.currentFrame); this.stop();");
  ed.setFrame(0);
  ed.setSpanScript("trace('começou');");
  const rt = new sandbox.FrameAnimator.Runtime(JSON.parse(serialize(ed.doc)), canvas, { onTrace: (...a) => traces.push(a.join(' ')) });
  rt.running = true;
  rt.enterRoot();
  for (let i = 0; i < 8; i++) rt.step();
  assert.deepEqual(traces, ['começou', 'parou 4']);
  assert.equal(rt.frame, 3);
  rt.api('').gotoAndStop(8);
  assert.equal(rt.frame, 7);
  // os arquivos do pacote
  const files = html5Files(playerDir, ed.doc, { title: 'Teste <1>' });
  assert.deepEqual(Object.keys(files).sort(), ['boot.js', 'index.html', 'movie.js', 'player.js']);
  assert.match(files['index.html'], /Teste &lt;1&gt;/);
  assert.match(files['movie.js'], /^window\.FA_MOVIE = \{/);
});

test('arquivo v5: texto, bitmap, componente, filtros, 3D, largura e pinos voltam iguais', () => {
  const ed = new Editor();
  const bmp = ed.importBitmap({ name: 'px', mime: 'image/png', data: 'AAAA', w: 4, h: 4 }, true);
  ed.addText(10, 10, 'Oi', { kind: 'input', name: 'campo' });
  ed.addComponent('list');
  const s = makeShape({ path: ellipsePath(40, 40), cx: 100, cy: 100, fill: '#ff0000', stroke: '#000000', strokeWidth: 4 });
  s.widthProfile = [{ t: 0.5, w: 3 }];
  s.warp = { pins: [{ x: 0, y: 0, dx: 5, dy: 0 }] };
  ed.addElements([s]);
  ed.addElements([rect(10, 10)]);
  ed.setSelection([ed.frameItems().at(-1).el.id]);
  ed.convertToSymbol({ name: 'Mc', type: 'movieclip' });
  ed.updateSelection('fx', (el) => {
    el.filters = [{ type: 'blur', blur: 4, enabled: true }];
    el.blend = 'screen';
    el.rx = 30;
  });
  const back = parseDocument(serialize(ed.doc));
  const els = back.scenes[0].layers[0].frames[0].elements;
  assert.deepEqual(els.map((e) => e.type), ['bitmap', 'text', 'component', 'shape', 'instance']);
  assert.equal(els[0].assetId, bmp.id);
  assert.equal(els[1].kind, 'input');
  assert.deepEqual(els[2].props.items, ['Item 1', 'Item 2', 'Item 3']);
  assert.deepEqual(els[3].widthProfile, [{ t: 0.5, w: 3 }]);
  assert.equal(els[4].filters[0].type, 'blur');
  assert.equal(els[4].blend, 'screen');
  assert.equal(els[4].rx, 30);
  // forma com pinos: o caminho mostrado é deformado
  const shown = R.shapePath(els[3]);
  assert.notDeepEqual(shown, els[3].path);
  void createLayer;
});
