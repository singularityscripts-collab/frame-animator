// Comandos de edição. Guardam cópias (clone) do antes/depois, então o histórico
// nunca compartilha objetos com o documento vivo.
// ctx precisa ter: scene, doc.

import { clone } from '../model/document.js';

function layer(ctx, id) {
  const l = ctx.scene.layers.find((x) => x.id === id);
  if (!l) throw new Error(`Camada ${id} não encontrada`);
  return l;
}

function span(ctx, layerId, start) {
  const s = layer(ctx, layerId).frames.find((f) => f.start === start);
  if (!s) throw new Error(`Keyframe ${start} não encontrado`);
  return s;
}

/** Vários comandos como um só passo de desfazer. */
export class Compound {
  constructor(label, cmds) {
    this.label = label;
    this.cmds = cmds.filter(Boolean);
  }
  do(ctx) {
    for (const c of this.cmds) c.do(ctx);
  }
  undo(ctx) {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo(ctx);
  }
}

export class AddElements {
  constructor(layerId, start, elements, label = 'Adicionar') {
    Object.assign(this, { layerId, start, label, elements: clone(elements) });
  }
  do(ctx) {
    span(ctx, this.layerId, this.start).elements.push(...clone(this.elements));
  }
  undo(ctx) {
    const s = span(ctx, this.layerId, this.start);
    const ids = new Set(this.elements.map((e) => e.id));
    s.elements = s.elements.filter((e) => !ids.has(e.id));
  }
}

export class RemoveElements {
  /** items: [{ el, index }] */
  constructor(layerId, start, items, label = 'Apagar') {
    Object.assign(this, { layerId, start, label });
    this.items = clone(items).sort((a, b) => a.index - b.index);
  }
  do(ctx) {
    const s = span(ctx, this.layerId, this.start);
    const ids = new Set(this.items.map((i) => i.el.id));
    s.elements = s.elements.filter((e) => !ids.has(e.id));
  }
  undo(ctx) {
    const s = span(ctx, this.layerId, this.start);
    for (const { el, index } of this.items) s.elements.splice(index, 0, clone(el));
  }
}

export class UpdateElements {
  constructor(layerId, start, before, after, label = 'Editar') {
    Object.assign(this, { layerId, start, label, before: clone(before), after: clone(after) });
  }
  apply(ctx, list) {
    const s = span(ctx, this.layerId, this.start);
    const map = new Map(list.map((e) => [e.id, e]));
    s.elements = s.elements.map((e) => (map.has(e.id) ? clone(map.get(e.id)) : e));
  }
  do(ctx) {
    this.apply(ctx, this.after);
  }
  undo(ctx) {
    this.apply(ctx, this.before);
  }
}

export class ReorderElements {
  constructor(layerId, start, beforeIds, afterIds, label = 'Organizar') {
    Object.assign(this, { layerId, start, beforeIds, afterIds, label });
  }
  apply(ctx, ids) {
    const s = span(ctx, this.layerId, this.start);
    const map = new Map(s.elements.map((e) => [e.id, e]));
    s.elements = ids.map((id) => map.get(id)).filter(Boolean);
  }
  do(ctx) {
    this.apply(ctx, this.afterIds);
  }
  undo(ctx) {
    this.apply(ctx, this.beforeIds);
  }
}

/** Troca a lista inteira de trechos de uma camada (operações de timeline). */
export class SetLayerFrames {
  constructor(layerId, before, after, label, frameBefore, frameAfter) {
    Object.assign(this, { layerId, label, frameBefore, frameAfter });
    this.before = clone(before);
    this.after = clone(after);
  }
  do(ctx) {
    layer(ctx, this.layerId).frames = clone(this.after);
    if (this.frameAfter != null) ctx.frame = this.frameAfter;
  }
  undo(ctx) {
    layer(ctx, this.layerId).frames = clone(this.before);
    if (this.frameBefore != null) ctx.frame = this.frameBefore;
  }
}

export class SetLayerProps {
  constructor(layerId, before, after, label = 'Camada') {
    Object.assign(this, { layerId, label, before: clone(before), after: clone(after) });
  }
  do(ctx) {
    Object.assign(layer(ctx, this.layerId), clone(this.after));
  }
  undo(ctx) {
    Object.assign(layer(ctx, this.layerId), clone(this.before));
  }
}

export class AddLayer {
  constructor(index, layerData, label = 'Nova camada') {
    Object.assign(this, { index, label, layer: clone(layerData) });
  }
  do(ctx) {
    ctx.scene.layers.splice(this.index, 0, clone(this.layer));
    ctx.activeLayerId = this.layer.id;
  }
  undo(ctx) {
    ctx.scene.layers.splice(this.index, 1);
  }
}

export class RemoveLayer {
  constructor(index, layerData, label = 'Apagar camada') {
    Object.assign(this, { index, label, layer: clone(layerData) });
  }
  do(ctx) {
    ctx.scene.layers.splice(this.index, 1);
  }
  undo(ctx) {
    ctx.scene.layers.splice(this.index, 0, clone(this.layer));
    ctx.activeLayerId = this.layer.id;
  }
}

export class MoveLayer {
  constructor(from, to, label = 'Mover camada') {
    Object.assign(this, { from, to, label });
  }
  move(ctx, a, b) {
    const [l] = ctx.scene.layers.splice(a, 1);
    ctx.scene.layers.splice(b, 0, l);
  }
  do(ctx) {
    this.move(ctx, this.from, this.to);
  }
  undo(ctx) {
    this.move(ctx, this.to, this.from);
  }
}

export class SetDocProps {
  constructor(before, after, label = 'Documento') {
    Object.assign(this, { label, before: clone(before), after: clone(after) });
  }
  do(ctx) {
    Object.assign(ctx.doc, clone(this.after));
  }
  undo(ctx) {
    Object.assign(ctx.doc, clone(this.before));
  }
}
