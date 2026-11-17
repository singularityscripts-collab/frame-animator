// Funções da fase final do editor: texto, bitmaps, separar/otimizar, alinhar, desenho mesclado,
// seletor de quadro, ossos, malha de pinos, lip-sync, scripts por quadro e componentes.

import { Editor } from './editor.js';
import * as C from './commands.js';
import * as TL from '../model/timeline.js';
import { clone, uid, uniqueName, cloneElementsWithNewIds } from '../model/document.js';
import { makeShape, rectPath, unionBounds, pathBounds, localBoxCorners, pointsBounds, elementLocalBounds } from '../model/geometry.js';
import * as V from '../model/vector-ops.js';
import { layerFrame, symbolById, instanceFrame, multiply, translation, invert, IDENTITY, applyPoint } from '../player/render.js';
import './rig.js';
import { measureText, textLines, lineHeight } from '../player/assets.js';
import { clearBitmapCache } from '../player/effects.js';

const P = Editor.prototype;

// O "cache como bitmap" guarda a imagem de cada símbolo; qualquer mudança no documento
// (editar o símbolo, desfazer, abrir outro arquivo) pode mudar o conteúdo, então o cache é zerado.
const baseEmit = P.emit;
P.emit = function (type, detail) {
  if (type === 'doc' || type === 'load') clearBitmapCache();
  return baseEmit.call(this, type, detail);
};

/** Atualiza propriedades dos elementos selecionados (texto, bitmap, componente, instância). */
P.setElementProps = function (patch, label = 'Propriedades', filter = () => true) {
  this.updateSelection(label, (el) => {
    if (filter(el)) Object.assign(el, clone(patch));
  });
};

// ---------- texto ----------
P.textDefaults = { font: 'Arial', size: 32, color: '#1d1d21', bold: false, italic: false, align: 'left', kind: 'static', letterSpacing: 0, lineHeight: 1.25 };

P.addText = function (x, y, text = '', opts = {}) {
  const el = { id: uid('e'), type: 'text', matrix: [1, 0, 0, 1, x, y], text, width: 0, ...this.textDefaults, ...opts };
  return this.addElements([el], 'Texto') ? el : null;
};

// ---------- componentes ----------
P.addComponent = function (kind) {
  const sizes = { button: [140, 44], list: [180, 140], video: [320, 180] };
  const props = {
    button: { label: 'Botão' },
    list: { items: ['Item 1', 'Item 2', 'Item 3'], selected: -1 },
    video: { src: '', name: 'Vídeo', autoplay: true, loop: true },
  }[kind];
  const [w, h] = sizes[kind];
  const names = new Set(this.frameItems({ editableOnly: false }).map((it) => it.el.name));
  const name = uniqueName([...names].filter(Boolean), kind === 'button' ? 'botao' : kind === 'list' ? 'lista' : 'video');
  const el = { id: uid('e'), type: 'component', kind, w, h, props, name, matrix: [1, 0, 0, 1, this.doc.width / 2 - w / 2, this.doc.height / 2 - h / 2] };
  if (this.addElements([el], 'Componente')) this.setSelection([el.id]);
};

// ---------- bitmaps ----------
P.importBitmap = function ({ name, mime, data, w, h }, place = true) {
  const bmp = { id: uid('b'), name: uniqueName(this.doc.library.bitmaps.map((b) => b.name), name || 'Imagem'), folderId: null, mime, data, w, h };
  this.group('Importar imagem', () => {
    this.run(new C.InsertLibraryEntry('bitmaps', this.doc.library.bitmaps.length, bmp, 'Importar imagem'));
    if (place) this.placeBitmap(bmp.id, this.doc.width / 2 - w / 2, this.doc.height / 2 - h / 2);
  });
  return bmp;
};

P.placeBitmap = function (id, x, y) {
  const b = this.doc.library.bitmaps.find((x) => x.id === id);
  if (!b) return;
  const el = { id: uid('e'), type: 'bitmap', assetId: id, w: b.w, h: b.h, matrix: [1, 0, 0, 1, x, y] };
  if (this.addElements([el], 'Colocar imagem')) this.setSelection([el.id]);
};

/** Troca um item do quadro por outros elementos (no mesmo lugar da pilha). */
P.replaceItem = function (it, elements, label) {
  const list = [...it.span.elements];
  const i = list.findIndex((e) => e.id === it.el.id);
  if (i < 0) return;
  list.splice(i, 1, ...elements);
  this.run(new C.SetSpanElements(it.layer.id, it.span.start, it.span.elements, list, label));
  this.setSelection(elements.map((e) => e.id));
};

// ---------- separar (Ctrl+B) e otimizar curvas ----------
/**
 * Instância → o conteúdo dela; texto com várias letras → uma letra por texto;
 * bitmap → retângulo com preenchimento de bitmap. Texto de uma letra vira forma pelo callback (vetorizar).
 */
P.breakApart = async function (textToShapes = null) {
  const items = this.selectedItems().filter((it) => !it.motion && !it.multi);
  if (!items.length) return this.toast('Selecione o que quer separar.');
  const results = [];
  for (const it of items) {
    const el = it.el;
    if (el.type === 'instance') {
      const sym = symbolById(this.doc, el.symbolId);
      if (!sym) continue;
      const f = instanceFrame(sym, el, it.offset, it.mcTime, false);
      const out = [];
      for (let li = sym.layers.length - 1; li >= 0; li--) {
        const L = sym.layers[li];
        if (!L.visible || L.type === 'guide' || L.type === 'folder') continue;
        const lf = layerFrame(L, f, sym);
        for (const x of lf?.items || []) out.push({ ...clone(x.el), id: uid('e'), matrix: multiply(el.matrix, x.el.matrix) });
      }
      results.push({ it, out });
    } else if (el.type === 'text') {
      const chars = [...String(el.text)].filter((c) => c.trim());
      if (chars.length > 1) {
        // uma letra por texto, nas mesmas posições
        const out = [];
        const lines = textLines(el);
        const lh = lineHeight(el);
        lines.forEach((line, li) => {
          let x = 0;
          for (const ch of line) {
            if (ch.trim()) out.push({ ...clone(el), id: uid('e'), text: ch, width: 0, matrix: multiply(el.matrix, translation(x, li * lh)) });
            x += measureText(el, ch);
          }
        });
        results.push({ it, out });
      } else if (textToShapes) {
        const shapes = await textToShapes(it);
        if (shapes?.length) results.push({ it, out: shapes });
      }
    } else if (el.type === 'bitmap') {
      const s = makeShape({ path: rectPath(el.w, el.h), cx: el.w / 2, cy: el.h / 2, fill: '#000000', stroke: null, strokeWidth: 0 });
      s.fill = { type: 'bitmap', assetId: el.assetId, matrix: [el.w / (this.doc.library.bitmaps.find((b) => b.id === el.assetId)?.w || el.w), 0, 0, el.h / (this.doc.library.bitmaps.find((b) => b.id === el.assetId)?.h || el.h), -el.w / 2, -el.h / 2] };
      s.matrix = multiply(el.matrix, translation(el.w / 2, el.h / 2));
      results.push({ it, out: [s] });
    }
  }
  if (!results.length) return this.toast('Nada para separar aqui.');
  this.group('Separar', () => {
    for (const { it, out } of results) {
      const now = this.frameItems().find((x) => x.el.id === it.el.id);
      if (now) this.replaceItem(now, out, 'Separar');
    }
    this.setSelection(results.flatMap((r) => r.out.map((e) => e.id)));
  });
};

P.optimizeCurves = function (amount = 50) {
  const tol = 0.2 + (amount / 100) * 6;
  this.updateSelection('Otimizar curvas', (el) => {
    if (el.type !== 'shape') return;
    const item = V.toPaper(el.path);
    const kids = item.className === 'CompoundPath' ? item.children : [item];
    for (const k of kids) if (k.segments.length > 3) k.simplify(tol);
    const res = V.fromPaper(item);
    if (!res) return;
    el.path = res.path;
    el.matrix = multiply(el.matrix, translation(res.cx, res.cy));
  });
};

// ---------- alinhar e distribuir ----------
/** kind: left|hcenter|right|top|vcenter|bottom|distH|distV|spaceH|spaceV|matchW|matchH|matchWH */
P.alignSelection = function (kind, toStage = false) {
  const items = this.selectedItems();
  if (!items.length || (!toStage && items.length < 2 && !kind.startsWith('match'))) return this.toast('Selecione dois ou mais objetos (ou marque "relativo ao palco").');
  const boxes = items.map((it) => this.boundsOf(it));
  const all = toStage ? { x: 0, y: 0, w: this.doc.width, h: this.doc.height } : unionBounds(boxes);
  const moves = items.map(() => ({ dx: 0, dy: 0, sx: 1, sy: 1 }));
  const order = (axis) => items.map((_, i) => i).sort((a, b) => (axis === 'x' ? boxes[a].x - boxes[b].x : boxes[a].y - boxes[b].y));
  items.forEach((_, i) => {
    const b = boxes[i];
    if (kind === 'left') moves[i].dx = all.x - b.x;
    if (kind === 'hcenter') moves[i].dx = all.x + all.w / 2 - (b.x + b.w / 2);
    if (kind === 'right') moves[i].dx = all.x + all.w - (b.x + b.w);
    if (kind === 'top') moves[i].dy = all.y - b.y;
    if (kind === 'vcenter') moves[i].dy = all.y + all.h / 2 - (b.y + b.h / 2);
    if (kind === 'bottom') moves[i].dy = all.y + all.h - (b.y + b.h);
  });
  if (kind === 'distH' || kind === 'distV') {
    const ax = kind === 'distH' ? 'x' : 'y', sz = kind === 'distH' ? 'w' : 'h';
    const ord = order(ax);
    const c0 = boxes[ord[0]][ax] + boxes[ord[0]][sz] / 2, c1 = boxes[ord[ord.length - 1]][ax] + boxes[ord[ord.length - 1]][sz] / 2;
    ord.forEach((i, k) => {
      const target = c0 + ((c1 - c0) * k) / Math.max(1, ord.length - 1);
      moves[i][ax === 'x' ? 'dx' : 'dy'] = target - (boxes[i][ax] + boxes[i][sz] / 2);
    });
  }
  if (kind === 'spaceH' || kind === 'spaceV') {
    const ax = kind === 'spaceH' ? 'x' : 'y', sz = kind === 'spaceH' ? 'w' : 'h';
    const ord = order(ax);
    const total = ord.reduce((n, i) => n + boxes[i][sz], 0);
    const gap = (all[sz] - total) / Math.max(1, ord.length - 1);
    let pos = all[ax];
    for (const i of ord) {
      moves[i][ax === 'x' ? 'dx' : 'dy'] = pos - boxes[i][ax];
      pos += boxes[i][sz] + gap;
    }
  }
  if (kind.startsWith('match')) {
    const W = toStage ? this.doc.width : Math.max(...boxes.map((b) => b.w));
    const H = toStage ? this.doc.height : Math.max(...boxes.map((b) => b.h));
    items.forEach((_, i) => {
      if (kind !== 'matchH') moves[i].sx = W / (boxes[i].w || 1);
      if (kind !== 'matchW') moves[i].sy = H / (boxes[i].h || 1);
    });
  }
  const byId = new Map(items.map((it, i) => [it.el.id, i]));
  this.updateSelection('Alinhar', (el, it) => {
    const i = byId.get(it?.el.id ?? el.id);
    if (i == null) return;
    const m = moves[i], b = boxes[i];
    const W = multiply(translation(b.x + m.dx, b.y + m.dy), multiply([m.sx, 0, 0, m.sy, 0, 0], translation(-b.x, -b.y)));
    this.applyWorld(it, el, W);
  });
};

// ---------- desenho mesclado ----------
P.objectDrawing = true;
P.setObjectDrawing = function (v) {
  this.objectDrawing = v;
  this.emit('toolOptions');
};

/**
 * No modo mesclado, uma forma nova se funde com as formas soltas do keyframe: mesma cor sem traço
 * junta numa só; cor diferente recorta a de baixo (como o desenho clássico).
 */
P.mergeShapes = function (elements) {
  const layer = this.activeLayer;
  const span = this.spanAt(layer);
  if (!span) return { elements, changes: null };
  const list = [...span.elements];
  let changed = false;
  const out = [];
  for (let s of elements) {
    if (s.type !== 'shape' || !s.path.closed || !s.fill) {
      out.push({ ...s, raw: true });
      continue;
    }
    s = { ...s, raw: true };
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.raw || e.type !== 'shape') continue;
      const sameFill = typeof e.fill === 'string' && e.fill === s.fill && !e.stroke && !s.stroke && e.path.closed;
      const region = V.toPaper(s.path, s.matrix);
      if (sameFill) {
        const u = V.combine('union', [e, s]);
        if (u.add) {
          s = { ...u.add, raw: true };
          list.splice(i, 1);
          changed = true;
        }
      } else {
        const res = V.eraseShape(e, region, 'normal');
        if (res) {
          list.splice(i, 1, ...res.map((x) => ({ ...x, raw: true })));
          changed = true;
        }
      }
    }
    out.push(s);
  }
  return { elements: out, changes: changed ? list : null };
};

const baseAdd = P.addElements;
P.addElements = function (elements, label, index = null, opts = {}) {
  const drawing = !this.objectDrawing && opts.space !== 'local' && elements.some((e) => e.type === 'shape') && !opts.noMerge;
  if (!drawing) return baseAdd.call(this, elements, label, index, opts);
  let ok = false;
  this.group(label, () => {
    const pre = this.prepareDrawing();
    if (pre === false) return;
    if (pre) this.run(pre);
    const lm = invert(this.layerMatrixOf(this.activeLayer)) || IDENTITY;
    const local = elements.map((el) => ({ ...el, matrix: multiply(lm, el.matrix) }));
    const { elements: els, changes } = this.mergeShapes(local);
    const span = this.spanAt(this.activeLayer);
    if (changes) this.run(new C.SetSpanElements(this.activeLayer.id, span.start, span.elements, changes, label));
    ok = baseAdd.call(this, els, label, index, { space: 'local' });
  });
  return ok;
};

// ---------- seletor de quadro (troca de boca, expressões) ----------
P.setFirstFrame = function (frame, makeKeyframe = true) {
  const it = this.selectedItems().find((x) => x.el.type === 'instance');
  if (!it) return this.toast('Selecione uma instância de símbolo gráfico.');
  this.group('Seletor de quadro', () => {
    if (makeKeyframe && it.span.start !== this.frame) {
      const r = TL.insertKeyframe(it.layer.frames, this.frame);
      if (r) this.run(new C.SetLayerFrames(it.layer.id, it.layer.frames, r.frames, 'Keyframe'));
      const span = this.spanAt(it.layer);
      const el = span.elements[it.index];
      if (el) this.setSelection([el.id]);
    }
    this.setInstanceProps({ firstFrame: frame, loop: 'single', behavior: 'graphic' }, 'Seletor de quadro');
  });
};

// ---------- lip-sync ----------
/**
 * Cria keyframes na camada da instância, a partir do quadro atual, trocando o quadro do símbolo
 * conforme os visemas (frames: lista de { frame do filme relativo, quadro do símbolo }).
 */
P.applyLipSync = function (it, segments) {
  const layer = it.layer;
  const start = this.frame;
  const base = clone(it.el);
  const total = segments.reduce((n, s) => Math.max(n, s.at + s.length), 0);
  let fr = clone(layer.frames);
  // garante quadros suficientes e corta o trecho em keyframes
  const need = start + total;
  if (TL.lengthOf(fr) < need) fr = TL.insertFrames(fr, need - 1).frames;
  // keyframes antigos dentro do trecho saem (menos os que têm script, rótulo ou som)
  const starts = new Set(segments.map((s) => start + s.at));
  for (const sp of [...fr]) {
    if (sp.start <= start || sp.start >= need || starts.has(sp.start)) continue;
    if (sp.script || sp.label || sp.sound) continue;
    const r = TL.clearKeyframe(fr, sp.start);
    if (r) fr = r.frames;
  }
  // (inserir keyframe onde já tem um cria no quadro seguinte, como o F6; por isso a checagem)
  const keyAt = (f) => {
    if (f >= TL.lengthOf(fr) || fr.some((x) => x.start === f)) return;
    const r = TL.insertKeyframe(fr, f);
    if (r) fr = r.frames;
  };
  for (const s of segments) {
    keyAt(start + s.at);
    keyAt(start + s.at + s.length);
  }
  // cada keyframe do trecho mostra a boca do visema que cobre aquele quadro
  for (const span of fr) {
    if (span.start < start || span.start >= need) continue;
    const s = segments.find((x) => span.start >= start + x.at && span.start < start + x.at + x.length);
    if (!s) continue;
    span.elements = span.elements.map((e, i) => (i === it.index ? { ...base, id: uid('e'), loop: 'single', behavior: 'graphic', firstFrame: s.frame } : e));
    delete span.tween;
  }
  this.run(new C.SetLayerFrames(layer.id, layer.frames, fr, 'Lip-sync', this.frame, this.frame));
};

// ---------- scripts por quadro ----------
P.setSpanScript = function (code) {
  const layer = this.activeLayer;
  let span = this.currentSpan();
  if (!span) return;
  const v = code && code.trim() ? code : undefined;
  if ((span.script || undefined) === v) return;
  this.group('Script do quadro', () => {
    if (span.start !== this.frame && v) {
      const r = TL.insertBlankKeyframe(layer.frames, this.frame);
      // ação num quadro sem keyframe: cria keyframe (com o mesmo conteúdo)
      const r2 = TL.insertKeyframe(layer.frames, this.frame);
      const use = r2 || r;
      if (use) this.run(new C.SetLayerFrames(layer.id, layer.frames, use.frames, 'Keyframe'));
      span = this.spanAt(layer);
    }
    this.run(new C.SetSpanProps(layer.id, span.start, { script: span.script }, { script: v }, 'Script do quadro'));
  });
};

// ---------- ossos: ver rig.js ----------

// ---------- 9 fatias ----------
P.setScale9 = function (symbolId, grid) {
  const sym = this.symbol(symbolId);
  if (!sym) return;
  this.patchLibrary('items', symbolId, { scale9: grid || undefined }, grid ? 'Escala de 9 fatias' : 'Tirar 9 fatias');
};

// ---------- localizar e substituir ----------
/** Procura texto em textos, nomes de camadas, rótulos, símbolos e instâncias. */
P.findAll = function (query, { caseSensitive = false, whole = false } = {}) {
  if (!query) return [];
  const flags = caseSensitive ? 'g' : 'gi';
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(whole ? `\\b${esc}\\b` : esc, flags);
  const out = [];
  const visit = (tl, where) => {
    tl.layers.forEach((layer) => {
      if (re.test(layer.name)) out.push({ kind: 'Camada', text: layer.name, where, tlId: tl.id, layerId: layer.id, frame: 0 });
      re.lastIndex = 0;
      for (const span of layer.frames) {
        if (span.label && re.test(span.label)) out.push({ kind: 'Rótulo', text: span.label, where, tlId: tl.id, layerId: layer.id, frame: span.start });
        re.lastIndex = 0;
        if (span.script && re.test(span.script)) out.push({ kind: 'Script', text: span.script.split('\n')[0], where, tlId: tl.id, layerId: layer.id, frame: span.start });
        re.lastIndex = 0;
        for (const el of span.elements) {
          if (el.type === 'text' && re.test(el.text)) out.push({ kind: 'Texto', text: el.text, where, tlId: tl.id, layerId: layer.id, frame: span.start, elId: el.id });
          re.lastIndex = 0;
          if (el.name && re.test(el.name)) out.push({ kind: 'Nome de instância', text: el.name, where, tlId: tl.id, layerId: layer.id, frame: span.start, elId: el.id });
          re.lastIndex = 0;
        }
      }
    });
  };
  this.doc.scenes.forEach((s) => visit(s, s.name));
  for (const s of this.doc.library.items) {
    if (re.test(s.name)) out.push({ kind: 'Símbolo', text: s.name, where: 'Biblioteca', tlId: s.id, frame: 0 });
    re.lastIndex = 0;
    visit(s, `Símbolo ${s.name}`);
  }
  return out;
};

/** Substitui em todo o documento (textos, nomes, rótulos, scripts). Devolve quantas trocas. */
P.replaceAll = function (query, replacement, opts = {}) {
  if (!query) return 0;
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(opts.whole ? `\\b${esc}\\b` : esc, opts.caseSensitive ? 'g' : 'gi');
  const before = clone({ scenes: this.doc.scenes, items: this.doc.library.items });
  let n = 0;
  const sub = (s) =>
    s.replace(re, () => {
      n++;
      return replacement;
    });
  const after = clone({ scenes: this.doc.scenes, items: this.doc.library.items });
  for (const tl of [...after.scenes, ...after.items]) {
    for (const layer of tl.layers) {
      layer.name = sub(layer.name);
      for (const span of layer.frames) {
        if (span.label) span.label = sub(span.label);
        if (span.script) span.script = sub(span.script);
        for (const el of span.elements) {
          if (el.type === 'text') el.text = sub(el.text);
          if (el.name) el.name = sub(el.name);
        }
      }
    }
  }
  for (const s of after.items) s.name = sub(s.name);
  if (!n) return 0;
  this.run({
    label: 'Substituir',
    do: (ctx) => {
      ctx.doc.scenes = clone(after.scenes);
      ctx.doc.library.items = clone(after.items);
    },
    undo: (ctx) => {
      ctx.doc.scenes = clone(before.scenes);
      ctx.doc.library.items = clone(before.items);
    },
  });
  return n;
};

/** Troca uma cor por outra em preenchimentos, traços e textos do documento todo. */
P.replaceColor = function (from, to) {
  const norm = (c) => String(c || '').toLowerCase().slice(0, 7);
  const f = norm(from);
  const before = clone({ scenes: this.doc.scenes, items: this.doc.library.items });
  const after = clone(before);
  let n = 0;
  for (const tl of [...after.scenes, ...after.items]) {
    for (const layer of tl.layers) {
      for (const span of layer.frames) {
        for (const el of span.elements) {
          for (const k of ['fill', 'stroke', 'color']) {
            if (typeof el[k] === 'string' && norm(el[k]) === f) {
              el[k] = to + el[k].slice(7);
              n++;
            }
          }
          if (el.fill?.stops) for (const s of el.fill.stops) if (norm(s.color) === f) (s.color = to), n++;
        }
      }
    }
  }
  if (!n) return 0;
  this.run({
    label: 'Substituir cor',
    do: (ctx) => {
      ctx.doc.scenes = clone(after.scenes);
      ctx.doc.library.items = clone(after.items);
    },
    undo: (ctx) => {
      ctx.doc.scenes = clone(before.scenes);
      ctx.doc.library.items = clone(before.items);
    },
  });
  return n;
};

/** Vai até um resultado (cena ou símbolo, camada, quadro) e seleciona o elemento. */
P.reveal = function (r) {
  const si = this.doc.scenes.findIndex((s) => s.id === r.tlId);
  if (si >= 0) {
    if (si !== this.sceneIndex) this.setScene(si);
    else if (this.editStack.length) this.exitSymbol(Infinity);
  } else if (this.symbol(r.tlId)) {
    if (this.timeline.id !== r.tlId) this.enterSymbol(r.tlId);
  }
  if (r.layerId && this.layer(r.layerId)) this.setActiveLayer(r.layerId);
  this.setFrame(r.frame || 0);
  if (r.elId) this.setSelection([r.elId]);
};

export { elementLocalBounds, localBoxCorners, pointsBounds, pathBounds, applyPoint, cloneElementsWithNewIds };
