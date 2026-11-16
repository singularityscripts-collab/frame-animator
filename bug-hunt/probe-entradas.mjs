// Sonda: entradas ruins nas funções puras. Cada caso imprime o resultado ou ERRO (exceção).
// Rodar: node bug-hunt/probe-entradas.mjs
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
globalThis.paper = require('../node_modules/paper/dist/paper-core.js');
const D = await import('../src/model/document.js');
const R = await import('../src/player/render.js');
const X = await import('../src/model/xfl.js');
const { analyzeLipSync } = await import('../src/model/lipsync.js');
const { traceImage } = await import('../src/model/trace.js');
const { toLottie } = await import('../src/export/lottie.js');
const { frameToSVG } = await import('../src/export/svg.js');
const { packRects } = await import('../src/export/spritesheet.js');
const { solveBones, solveIK } = await import('../src/player/bones.js');
const { mlsPoint } = await import('../src/player/mesh.js');

const FORMAT = JSON.parse(D.serialize(D.createDocument())).format;
const base = { format: FORMAT, version: 5, width: 100, height: 100, fps: 12, background: '#fff' };
const run = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`${name}: ${r === undefined ? 'OK' : typeof r === 'string' ? r : JSON.stringify(r)}`);
  } catch (e) {
    console.log(`${name}: ERRO ${e.constructor.name}: ${e.message.slice(0, 140)}`);
  }
};
const doc = (scenes, extra = {}) => JSON.stringify({ ...base, scenes, ...extra });
const shapeDoc = (el) => doc([{ layers: [{ frames: [{ duration: 1, elements: [el] }] }] }]);
const xfl = (body) => ({ 'DOMDocument.xml': { text: `<DOMDocument><timelines><DOMTimeline><layers><DOMLayer><frames>${body}</frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>` } });

await run('cena sem layers', () => D.parseDocument(doc([{}])) && 'abriu');
await run('layers = null', () => D.parseDocument(doc([{ layers: null }])) && 'abriu');
await run('scenes = [null]', () => D.parseDocument(doc([null])) && 'abriu');
await run('símbolo com camada null', () => D.parseDocument(doc([{ layers: [] }], { library: { items: [{ id: 'y', layers: [null] }] } })) && 'abriu');
await run('frame = null', () => D.parseDocument(doc([{ layers: [{ frames: [null] }] }])) && 'abriu');
await run('matriz com texto', () => {
  const d = D.parseDocument(shapeDoc({ type: 'shape', matrix: ['a', 0, 0, 1, 0, 0], path: { closed: true, pts: [[0, 0, 0, 0, 0, 0]] }, fill: '#f00' }));
  return 'matriz depois de abrir = ' + JSON.stringify(d.scenes[0].layers[0].frames[0].elements[0].matrix);
});
await run('pts com ponto não-array', () => {
  const d = D.parseDocument(shapeDoc({ type: 'shape', path: { closed: true, pts: [null, 5] }, fill: '#f00' }));
  const el = d.scenes[0].layers[0].frames[0].elements[0];
  R.buildPath2D ? 0 : 0;
  return 'abriu (pts: ' + JSON.stringify(el.path.pts) + ')';
});
await run('duration enorme', () => {
  const d = D.parseDocument(doc([{ layers: [{ frames: [{ duration: 1e12, elements: [] }] }] }]));
  return 'comprimento da cena = ' + R.sceneLength(d.scenes[0]);
});
await run('ossos com ciclo de pais', () => {
  const arm = { bones: [{ id: 'a', parentId: 'b', x: 0, y: 0, angle: 0, length: 10 }, { id: 'b', parentId: 'a', x: 0, y: 0, angle: 0, length: 10 }] };
  return 'ossos resolvidos = ' + solveBones(arm).size + ' de 2; IK = ' + JSON.stringify(solveIK(arm, {}, 'a', { x: 5, y: 5 }));
});
await run('pinos no mesmo ponto', () => JSON.stringify(mlsPoint([{ x: 5, y: 5, dx: 1, dy: 1 }, { x: 5, y: 5, dx: -1, dy: 0 }], 5, 5)));
await run('fundo com aspas no SVG', () => {
  const d = D.createDocument();
  d.background = '#fff"/><script>alert(1)</script><rect fill="#000';
  return /<script>/.test(frameToSVG(d, 0, 0, {})) ? 'SVG contém <script> injetado' : 'escapado';
});
await run('mime de imagem com aspas no SVG', () => {
  const d = D.createDocument();
  d.library.bitmaps.push({ id: 'b1', name: 'x', mime: 'image/png" onload="alert(1)', data: 'AA==', w: 1, h: 1 });
  d.scenes[0].layers[0].frames[0].elements.push({ id: 'e', type: 'bitmap', assetId: 'b1', w: 1, h: 1, matrix: [1, 0, 0, 1, 0, 0] });
  return /onload=/.test(frameToSVG(d, 0, 0, {})) ? 'SVG contém atributo onload injetado' : 'escapado';
});
await run('Lottie de doc vazio', () => 'camadas = ' + toLottie(D.createDocument(), {}).layers.length);
await run('lip-sync sem amostras', () => JSON.stringify(analyzeLipSync(new Float32Array(0), 44100, 24)));
await run('lip-sync fps 0', () => 'trechos = ' + analyzeLipSync(new Float32Array(1000), 44100, 0).length);
await run('lip-sync com NaN', () => JSON.stringify(analyzeLipSync(new Float32Array(4410).fill(NaN), 44100, 10)));
await run('vetorizar 0×0', () => JSON.stringify(traceImage({ width: 0, height: 0, data: new Uint8ClampedArray(0) })));
await run('vetorizar transparente', () => JSON.stringify(traceImage({ width: 4, height: 4, data: new Uint8ClampedArray(64) })));
await run('packRects vazio', () => JSON.stringify(packRects([])));
await run('packRects com tamanho 0', () => JSON.stringify(packRects([{ w: 0, h: 0 }, { w: 10, h: 10 }])));
await run('XFL sem DOMDocument', () => X.importXFL({}, {}).then(() => 'abriu'));
await run('XFL DOMDocument vazio', () => X.importXFL({ 'DOMDocument.xml': { text: '' } }, {}).then((r) => 'abriu, cenas = ' + r.doc.scenes.length + ', ' + r.doc.width + '×' + r.doc.height));
await run('XFL XML truncado', () => X.importXFL({ 'DOMDocument.xml': { text: '<DOMDocument width="100"><timelines><DOMTimeline name="a"><layers><DOMLayer' } }, {}).then((r) => 'abriu, cenas = ' + r.doc.scenes.length));
await run('XFL quadros fora de ordem', () => X.importXFL(xfl('<DOMFrame index="5" duration="2"/><DOMFrame index="0" duration="3"/>'), {}).then((r) => 'quadros [início, duração] = ' + JSON.stringify(r.doc.scenes[0].layers[0].frames.map((f) => [f.start, f.duration]))));
await run('XFL texto tamanho 0', () =>
  X.importXFL(xfl('<DOMFrame index="0"><elements><DOMStaticText><textRuns><DOMTextRun><characters>a</characters><textAttrs><DOMTextAttrs size="0"/></textAttrs></DOMTextRun></textRuns></DOMStaticText></elements></DOMFrame>'), {}).then((r) => {
    const el = r.doc.scenes[0].layers[0].frames[0].elements[0];
    return `size = ${el.size}, lineHeight = ${el.lineHeight}`;
  }),
);
await run('XFL símbolo que contém ele mesmo', () =>
  X.importXFL(
    {
      'DOMDocument.xml': { text: '<DOMDocument><symbols><Include href="A.xml"/></symbols><timelines><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements><DOMSymbolInstance libraryItemName="A"/></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>' },
      'LIBRARY/A.xml': { text: '<DOMSymbolItem name="A"><timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#ff0000"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 0|200 0|200 200|0 0"/></edges></DOMShape><DOMSymbolInstance libraryItemName="A"><matrix><Matrix a="0.9" d="0.9"/></matrix></DOMSymbolInstance></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>' },
    },
    {},
  ).then((r) => {
    const t0 = Date.now();
    const L = toLottie(r.doc, {});
    return `abriu; Lottie em ${Date.now() - t0} ms com ${JSON.stringify(L).length} bytes`;
  }),
);
await run('XFL arestas com lixo', () => JSON.stringify(X.decodeEdges('!abc def|1 2[3')));
await run('XFL .dat truncado', () => X.decodeBitmapDat(new Uint8Array([3, 5, 0, 0, 100, 0, 100, 0]), (b) => zlib.inflateSync(b)).then((r) => 'w=' + r.w + ' h=' + r.h + ' rgba=' + r.rgba.length));
