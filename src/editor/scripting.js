// Scripts que automatizam o próprio editor (o equivalente ao JSFL do Animate).
// O script recebe o objeto `fa` e roda como um passo só no histórico (Ctrl+Z desfaz tudo).
//
//   fa.doc                          documento (somente leitura: use as funções para mudar)
//   fa.selection()                  elementos selecionados [{ id, type, name, x, y, w, h }]
//   fa.select(ids) · fa.selectAll() · fa.deselect()
//   fa.rect(x, y, w, h, { fill, stroke, strokeWidth }) · fa.oval(...) · fa.line(x1, y1, x2, y2, opts)
//   fa.polygon(cx, cy, raio, lados, { star, inner, fill, stroke })
//   fa.text(x, y, "texto", { size, color, font, kind })
//   fa.move(dx, dy) · fa.rotate(graus) · fa.scale(sx, sy) · fa.setFill(cor) · fa.setStroke(cor, largura)
//   fa.align('left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'|'distH'|'distV', paraOPalco)
//   fa.frame · fa.gotoFrame(n) · fa.insertFrame() · fa.keyframe() · fa.blankKeyframe() · fa.tween('classic'|'motion'|'shape')
//   fa.layers() · fa.newLayer(nome) · fa.setLayer(nomeOuId)
//   fa.toSymbol(nome, 'graphic'|'movieclip'|'button') · fa.symbols()
//   fa.run('idDaAção') — qualquer ação do menu (ex.: 'breakApart', 'distributeToLayers')
//   fa.log(...) · fa.alert(msg)

import { makeShape, rectPath, ellipsePath, linePath } from '../model/geometry.js';
import { polystarPath } from './tools-final.js';
import { multiply, translation } from '../player/render.js';
import { clone } from '../model/document.js';

export function makeScriptAPI(editor, actions, log) {
  const ed = editor;
  const style = (o = {}) => ({
    fill: o.fill === undefined ? (ed.style.fillOn ? ed.style.fill : null) : o.fill,
    stroke: o.stroke === undefined ? (ed.style.strokeOn ? ed.style.stroke : null) : o.stroke,
    strokeWidth: o.strokeWidth ?? ed.style.strokeWidth,
  });
  const add = (el, label) => {
    ed.addElements([el], label);
    return el.id;
  };
  const fa = {
    get doc() {
      return clone(ed.doc);
    },
    get frame() {
      return ed.frame + 1;
    },
    get width() {
      return ed.doc.width;
    },
    get height() {
      return ed.doc.height;
    },
    selection() {
      return ed.selectedItems().map((it) => {
        const b = ed.boundsOf(it);
        return { id: it.el.id, type: it.el.type, name: it.el.name || null, x: b.x, y: b.y, w: b.w, h: b.h };
      });
    },
    select(ids) {
      ed.setSelection(Array.isArray(ids) ? ids : [ids]);
    },
    selectAll: () => ed.selectAll(),
    deselect: () => ed.deselect(),
    rect(x, y, w, h, o) {
      return add(makeShape({ path: rectPath(w, h), cx: x + w / 2, cy: y + h / 2, ...style(o) }), 'Retângulo');
    },
    oval(x, y, w, h, o) {
      return add(makeShape({ path: ellipsePath(w, h), cx: x + w / 2, cy: y + h / 2, ...style(o) }), 'Oval');
    },
    line(x1, y1, x2, y2, o = {}) {
      const { path, cx, cy } = linePath(x1, y1, x2, y2);
      return add(makeShape({ path, cx, cy, fill: null, stroke: o.stroke || ed.style.stroke, strokeWidth: o.strokeWidth ?? Math.max(1, ed.style.strokeWidth) }), 'Linha');
    },
    polygon(cx, cy, r, sides = 5, o = {}) {
      return add(makeShape({ path: polystarPath(r * 2, r * 2, sides, !!o.star, o.inner ?? 0.5), cx, cy, ...style(o) }), 'Polígono');
    },
    text(x, y, text, o = {}) {
      return ed.addText(x, y, String(text), o)?.id || null;
    },
    move(dx, dy) {
      ed.nudge(dx, dy);
    },
    rotate(deg) {
      ed.rotateSelection(deg);
    },
    scale(sx, sy = sx) {
      const b = ed.selectionBounds();
      if (!b) return;
      ed.setSelectionBounds({ w: b.w * sx, h: b.h * sy });
    },
    setFill(c) {
      ed.setStyle({ fill: c, fillOn: !!c });
    },
    setStroke(c, w) {
      ed.setStyle({ stroke: c, strokeOn: !!c, ...(w != null ? { strokeWidth: w } : {}) });
    },
    align(kind, toStage = false) {
      ed.alignSelection(kind, toStage);
    },
    gotoFrame(n) {
      ed.setFrame(Math.max(0, Math.round(n) - 1));
    },
    insertFrame: () => ed.timelineOp('insertFrame'),
    keyframe: () => ed.timelineOp('insertKeyframe'),
    blankKeyframe: () => ed.timelineOp('insertBlankKeyframe'),
    tween(kind = 'classic') {
      if (kind === 'motion') ed.createMotionTween();
      else if (kind === 'shape') ed.createShapeTween();
      else ed.createClassicTween();
    },
    layers() {
      return ed.layers.map((l) => ({ id: l.id, name: l.name, type: l.type }));
    },
    newLayer(name) {
      ed.addLayer();
      if (name) ed.setLayerProps(ed.activeLayerId, { name: String(name) }, 'Renomear camada');
      return ed.activeLayerId;
    },
    setLayer(key) {
      const l = ed.layers.find((x) => x.id === key || x.name === key);
      if (l) ed.setActiveLayer(l.id);
      return !!l;
    },
    toSymbol(name, type = 'graphic') {
      ed.convertToSymbol({ name: name || ed.nextSymbolName(), type, registration: 'center' });
    },
    symbols() {
      return ed.doc.library.items.map((s) => ({ id: s.id, name: s.name, type: s.type }));
    },
    place(symbolName, x, y) {
      const s = ed.doc.library.items.find((i) => i.name === symbolName || i.id === symbolName);
      if (s) ed.placeSymbol(s.id, x, y);
    },
    run(id) {
      actions.run(id);
    },
    log: (...a) => log(a.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ')),
    alert: (m) => ed.toast(String(m)),
    // utilidades
    matrix: { multiply, translation },
  };
  return fa;
}

/** Roda o código como um passo só no histórico. Devolve { ok, error }. */
export function runEditorScript(editor, actions, code, log) {
  const fa = makeScriptAPI(editor, actions, log);
  let fn;
  try {
    fn = new Function('fa', `"use strict";\n${code}`);
  } catch (err) {
    log(`Erro de sintaxe: ${err.message}`);
    return { ok: false, error: err };
  }
  let error = null;
  editor.group('Script do editor', () => {
    try {
      const r = fn(fa);
      if (r !== undefined) log(`→ ${typeof r === 'object' ? JSON.stringify(r) : String(r)}`);
    } catch (err) {
      error = err;
      log(`Erro: ${err.message}`);
    }
  });
  return { ok: !error, error };
}

export const SAMPLE_SCRIPTS = {
  'Grade de círculos': `// 5 × 3 círculos com cores variando
for (let y = 0; y < 3; y++)
  for (let x = 0; x < 5; x++)
    fa.oval(80 + x * 90, 80 + y * 90, 60, 60, { fill: \`hsl(\${x * 60 + y * 20}, 70%, 55%)\`, stroke: null });
fa.log('Pronto:', fa.selection().length, 'selecionado(s)');`,
  'Cada objeto numa camada': `fa.selectAll();
fa.run('distributeToLayers');`,
  'Centralizar no palco': `fa.align('hcenter', true);
fa.align('vcenter', true);`,
  'Renomear camadas em ordem': `fa.layers().forEach((l, i) => fa.log(i + 1, l.name));`,
};
