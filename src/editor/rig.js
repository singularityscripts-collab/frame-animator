// Rig (ossos) no editor.
// - Um esqueleto só por camada: criar, apagar, mover junta, renomear e limitar vale para todos os
//   keyframes da camada (cada keyframe guarda só a própria pose). Assim mexer no rig depois de
//   animar não deixa keyframes com ossos diferentes.
// - Modos: "edit" (montar o rig) e "pose" (animar). Auto-key: posar cria o keyframe sozinho.
// - Vínculo da arte: forma → pele presa aos ossos da lista (el.skinBones); símbolo/imagem → el.bone.
// Tudo passa por comandos (desfazer/refazer) e o documento continua o mesmo JSON.

import { Editor } from './editor.js';
import * as C from './commands.js';
import * as TL from '../model/timeline.js';
import { clone, uid } from '../model/document.js';
import { elementLocalBounds } from '../model/geometry.js';
import { applyPoint, multiply, invert, IDENTITY, getSpanAt } from '../player/render.js';
import { solveBones, lerpPose, orderedBones } from '../player/bones.js';
import { distToSegment } from '../player/geom.js';
import { applyEase } from '../player/ease.js';

const P = Editor.prototype;

/** Cor de cada osso (pela ordem de criação): o osso e a arte presa a ele usam a mesma cor. */
export const BONE_COLORS = ['#ff9f0a', '#30d158', '#64d2ff', '#bf5af2', '#ff375f', '#ffd60a', '#5e5ce6', '#ac8e68', '#66d4cf', '#ff6482'];
export const boneColor = (bones, id) => BONE_COLORS[Math.max(0, bones.findIndex((b) => b.id === id)) % BONE_COLORS.length];

/** Ossos a que o elemento está preso: lista de ids ou 'all' (pele de arquivo antigo, sem lista). */
export function boundBones(el) {
  if (el.type === 'shape' && el.skin) return Array.isArray(el.skinBones) ? el.skinBones : 'all';
  return el.bone ? [el.bone] : [];
}

function unbindAll(el) {
  const c = { ...el };
  delete c.bone;
  delete c.skin;
  delete c.skinBones;
  return c;
}

/** Prende o elemento ao osso. Forma: soma o osso à pele (dois ou mais ossos = dobra); outros: troca de osso. */
function bindTo(el, boneId, allIds) {
  if (el.type === 'shape') {
    const cur = boundBones(el);
    const list = cur === 'all' ? [...allIds] : cur;
    if (list.includes(boneId)) return el;
    const c = unbindAll(el);
    return { ...c, skin: true, skinBones: [...list, boneId] };
  }
  return { ...el, bone: boneId };
}

/** Solta o elemento do osso (troca pelo osso `replaceWith`, se vier). */
function unbindFrom(el, boneId, allIds, replaceWith = null) {
  const cur = boundBones(el);
  if (cur === 'all' ? !allIds.includes(boneId) : !cur.includes(boneId)) return el;
  const list = (cur === 'all' ? [...allIds] : cur).filter((id) => id !== boneId);
  if (replaceWith && !list.includes(replaceWith)) list.push(replaceWith);
  const c = unbindAll(el);
  if (!list.length) return c;
  return el.type === 'shape' ? { ...c, skin: true, skinBones: list } : { ...c, bone: list[0] };
}

// keyframes "do mesmo personagem": mesma lista de tipos de elementos (o vínculo vai pelo índice)
const sig = (span) => span.elements.map((e) => e.type).join(',');

/** Pares esquerda/direita: pelo nome (esq/dir, e/d, l/r, left/right) ou, sem nomes, dois galhos iguais do mesmo pai. */
export function bonePairs(bones) {
  const L = new Set(['esq', 'esquerda', 'esquerdo', 'e', 'l', 'left']);
  const R = new Set(['dir', 'direita', 'direito', 'd', 'r', 'right']);
  const byBase = new Map();
  for (const b of bones) {
    const words = String(b.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
    const side = words.find((w) => L.has(w)) ? 'L' : words.find((w) => R.has(w)) ? 'R' : null;
    if (!side) continue;
    const base = words.filter((w) => !L.has(w) && !R.has(w)).join(' ');
    if (!byBase.has(base)) byBase.set(base, {});
    byBase.get(base)[side] = b.id;
  }
  const pairs = [...byBase.values()].filter((p) => p.L && p.R).map((p) => [p.L, p.R]);
  if (pairs.length) return pairs;
  // sem nomes: o primeiro pai com exatamente dois galhos de mesmo formato (duas pernas saindo do quadril)
  const kids = (id) => bones.filter((b) => (b.parentId || null) === id);
  const shape = (id) => `(${kids(id).map((k) => shape(k.id)).join(',')})`;
  const chain = (id, out = []) => {
    out.push(id);
    const k = kids(id);
    if (k.length === 1) chain(k[0].id, out);
    return out;
  };
  for (const parent of [null, ...orderedBones({ bones }).map((b) => b.id)]) {
    const k = kids(parent);
    if (k.length === 2 && shape(k[0].id) === shape(k[1].id)) {
      const a = chain(k[0].id), b = chain(k[1].id);
      if (a.length === b.length) return a.map((id, i) => [id, b[i]]);
    }
  }
  return [];
}

// ---------- estado da ferramenta ----------
P.rigState = function () {
  return (this._rig ||= { mode: null, selected: null, autoKey: true, show: true, clip: null });
};
/** Modo atual: o que o usuário escolheu ou, se ainda não escolheu, posar quando a camada já tem ossos. */
P.rigMode = function () {
  const st = this.rigState();
  return st.mode || (this.rigBones().length ? 'pose' : 'edit');
};
P.setRigState = function (patch) {
  Object.assign(this.rigState(), patch);
  this.emit('rig');
};
P.setRigMode = function (mode) {
  this.setRigState({ mode });
  this.toast(mode === 'edit' ? 'Editar rig: monte e ajuste os ossos.' : 'Posar: arraste os ossos para animar.');
};

// ---------- leitura ----------
/** Keyframe com o esqueleto no quadro (ou o último, se o quadro passou do fim da camada). */
P.rigSpan = function (layer = this.activeLayer) {
  if (!layer?.frames) return null;
  const s = getSpanAt(layer, this.frame) || (this.frame >= TL.lengthOf(layer.frames) ? layer.frames[layer.frames.length - 1] : null);
  return s?.armature?.bones?.length ? s : null;
};
P.rigBones = function (layer = this.activeLayer) {
  return this.rigSpan(layer)?.armature.bones || [];
};

/** Pose mostrada no quadro (com o tween e o easing de pose). { span, arm, pose, beyond } ou null. */
P.poseAt = function (layer = this.activeLayer, frame = this.frame) {
  if (!layer?.frames) return null;
  let span = getSpanAt(layer, frame);
  let beyond = false;
  if (!span && frame >= TL.lengthOf(layer.frames)) {
    span = layer.frames[layer.frames.length - 1];
    beyond = true;
  }
  if (!span?.armature?.bones?.length) return null;
  const i = layer.frames.indexOf(span);
  const next = layer.frames[i + 1];
  let pose = span.armature.pose || {};
  const at = beyond ? span.start + span.duration : frame;
  if (span.tween && next?.armature && at > span.start) pose = lerpPose(pose, next.armature.pose || {}, applyEase(Math.min(1, (at - span.start) / span.duration), span.tween));
  return { span, arm: span.armature, pose, beyond };
};

/** Ossos resolvidos na pose do quadro (espaço da camada). */
P.rigSolved = function () {
  const info = this.poseAt();
  return info ? solveBones(info.arm, info.pose) : new Map();
};

// ---------- edição do rig (vale para a camada toda) ----------
/**
 * Muda o esqueleto de todos os keyframes da camada num passo só de desfazer.
 * fnBones(bones) devolve a lista nova; fnEls(el, index, isCurrent) devolve o elemento novo (opcional).
 */
P.editRig = function (label, fnBones, fnEls, opts = {}) {
  const layer = this.activeLayer;
  if (!layer || layer.type === 'folder' || layer.type === 'camera') return null;
  const cur = getSpanAt(layer, this.frame) || this.rigSpan(layer);
  if (!cur) return null;
  const base = clone(cur.armature?.bones || []);
  const bones = fnBones ? fnBones(base) : base;
  const ids = new Set(bones.map((b) => b.id));
  const s0 = sig(cur);
  const frames = layer.frames.map((f) => {
    const isCur = f === cur;
    const sameArt = f.elements.length && sig(f) === s0;
    if (!isCur && !f.armature?.bones?.length && !sameArt) return f;
    const g = clone(f);
    if (!bones.length) delete g.armature;
    else {
      const pose = Object.fromEntries(Object.entries(g.armature?.pose || {}).filter(([k]) => k === '__root' || ids.has(k)));
      g.armature = { bones: clone(bones), pose };
    }
    if (fnEls && (isCur || sameArt)) g.elements = g.elements.map((el, i) => fnEls(el, i, isCur) ?? el);
    return g;
  });
  // ao vivo (arrastando uma junta): troca direto, sem histórico; quem arrasta grava um comando no fim
  if (opts.live) {
    layer.frames = frames;
    return bones;
  }
  this.run(new C.SetLayerFrames(layer.id, layer.frames, frames, label));
  this.emit('rig');
  return bones;
};

/** Ponto mostrado (na pose) → ponto de descanso preso ao osso `pid` (ou à raiz). */
P.rigToRest = function (pt, pid) {
  const info = this.poseAt();
  if (!info) return { ...pt };
  const s = pid && solveBones(info.arm, info.pose).get(pid);
  if (s) return applyPoint(multiply(s.rest, invert(s.pose) || IDENTITY), pt.x, pt.y);
  const r = info.pose.__root || { x: 0, y: 0 };
  return { x: pt.x - r.x, y: pt.y - r.y };
};

/**
 * Cria um osso de head até tail (pontos como aparecem no palco, espaço da camada).
 * parentId: osso pai (a cabeça fica na ponta dele). bindId: elemento que passa a seguir o osso.
 */
P.addBone = function (head, tail, parentId, bindId, opts = {}) {
  const layer = this.activeLayer;
  const cur = getSpanAt(layer, this.frame) || this.rigSpan(layer);
  if (!cur) return null;
  const bones0 = cur.armature?.bones || [];
  const rest = solveBones({ bones: bones0 }, {});
  const parent = parentId && rest.get(parentId) ? parentId : null;
  // galho: filho que começa em qualquer ponto do pai (o braço saindo do ombro do tronco)
  const branch = !!(parent && opts.branch);
  const h = branch ? this.rigToRest(head, parent) : parent ? rest.get(parent).restTail : this.rigToRest(head, null);
  const t = this.rigToRest(tail, parent);
  const used = new Set(bones0.map((b) => b.name));
  let n = bones0.length + 1;
  while (used.has(`Osso ${n}`)) n++;
  const bone = {
    id: uid('o'),
    parentId: parent,
    name: opts.name || `Osso ${n}`,
    x: h.x,
    y: h.y,
    angle: Math.atan2(t.y - h.y, t.x - h.x),
    length: Math.max(4, Math.hypot(t.x - h.x, t.y - h.y)),
  };
  if (branch) bone.offset = true;
  const bindIndex = bindId ? cur.elements.findIndex((e) => e.id === bindId) : -1;
  const allIds = [...bones0.map((b) => b.id), bone.id];
  this.editRig('Osso', (bones) => [...bones, bone], bindIndex >= 0 ? (el, i) => (i === bindIndex ? bindTo(el, bone.id, allIds) : el) : null);
  // quem está montando o rig continua em Editar rig (o modo nunca troca sozinho no meio do trabalho)
  const st = this.rigState();
  this.setRigState({ selected: bone.id, mode: st.mode || 'edit' });
  return bone;
};

/** Apaga um osso; os filhos passam para o pai dele como galhos, sem sair do lugar. */
P.deleteBone = function (id) {
  const bones = this.rigBones();
  const b = bones.find((x) => x.id === id);
  if (!b) return;
  const rest = solveBones({ bones }, {});
  const allIds = bones.map((x) => x.id);
  this.editRig(
    'Apagar osso',
    (list) =>
      list
        .filter((x) => x.id !== id)
        .map((c) => {
          if (c.parentId !== id) return c;
          const s = rest.get(c.id);
          const at = s ? { x: s.restHead.x, y: s.restHead.y } : { x: c.x, y: c.y };
          if (b.parentId) return { ...c, parentId: b.parentId, offset: true, ...at };
          const { offset: _o, ...root } = c;
          return { ...root, parentId: null, ...at };
        }),
    (el) => unbindFrom(el, id, allIds, b.parentId),
  );
  if (this.rigState().selected === id) this.setRigState({ selected: b.parentId || null });
};

/**
 * Move uma junta (ponto como aparece no palco). which: 'tail' (a ponta do osso; os filhos vão junto)
 * ou 'head' (osso raiz ou galho: a ponta fica onde está).
 */
P.moveJoint = function (id, which, pt, opts = {}) {
  const bones = this.rigBones();
  const b = bones.find((x) => x.id === id);
  const info = this.poseAt();
  if (!b || !info) return;
  const rest = solveBones({ bones }, {}).get(id);
  if (!rest) return;
  return this.editRig(
    'Mover junta',
    (list) =>
    list.map((c) => {
      if (c.id !== id) return c;
      if (which === 'head' && (!c.parentId || c.offset)) {
        const q = this.rigToRest(pt, c.offset ? c.parentId : null);
        return { ...c, x: q.x, y: q.y, angle: Math.atan2(rest.restTail.y - q.y, rest.restTail.x - q.x), length: Math.max(4, Math.hypot(rest.restTail.x - q.x, rest.restTail.y - q.y)) };
      }
      // ponta: no espaço do pai, descontando o giro da pose deste osso
      const q = this.rigToRest(pt, c.parentId);
      const delta = info.pose[c.id] || 0;
      return { ...c, angle: Math.atan2(q.y - rest.restHead.y, q.x - rest.restHead.x) - delta, length: Math.max(4, Math.hypot(q.x - rest.restHead.x, q.y - rest.restHead.y)) };
    }),
    null,
    opts,
  );
};

/** Nome, pino e limites do osso. patch: { name?, pin?, min?, max? } (null tira o limite). */
P.setBoneProps = function (id, patch, label = 'Osso') {
  if (!this.rigBones().some((b) => b.id === id)) return;
  this.editRig(label, (list) =>
    list.map((c) => {
      if (c.id !== id) return c;
      const n = { ...c, ...patch };
      for (const k of ['min', 'max']) if (n[k] == null || !Number.isFinite(n[k])) delete n[k];
      if (!n.pin) delete n.pin;
      if (Number.isFinite(n.min) && Number.isFinite(n.max) && n.min > n.max) [n.min, n.max] = [n.max, n.min];
      return n;
    }),
  );
};

/** Prende (ou solta, se já estiver) o elemento ao osso. */
P.toggleBind = function (elId, boneId) {
  const cur = getSpanAt(this.activeLayer, this.frame);
  const i = cur ? cur.elements.findIndex((e) => e.id === elId) : -1;
  if (i < 0) return;
  const allIds = this.rigBones().map((b) => b.id);
  const el = cur.elements[i];
  const cb = boundBones(el);
  const has = cb === 'all' ? allIds.includes(boneId) : cb.includes(boneId);
  this.editRig(has ? 'Soltar do osso' : 'Prender ao osso', null, (e, k) => (k === i ? (has ? unbindFrom(e, boneId, allIds) : bindTo(e, boneId, allIds)) : e));
  this.toast(has ? 'Parte solta do osso.' : 'Parte presa ao osso.');
};

/** Solta os elementos selecionados de todos os ossos. */
P.unbindSelection = function () {
  const cur = getSpanAt(this.activeLayer, this.frame);
  if (!cur) return;
  const idx = new Set(cur.elements.map((e, i) => (this.selection.has(e.id) ? i : -1)).filter((i) => i >= 0));
  if (!idx.size) return;
  this.editRig('Soltar do osso', null, (e, i) => (idx.has(i) ? unbindAll(e) : e));
};

/** Prende cada parte solta ao osso mais perto do centro dela. Devolve quantas prendeu. */
P.autoBind = function () {
  const cur = getSpanAt(this.activeLayer, this.frame);
  const bones = this.rigBones();
  if (!cur || !bones.length) return 0;
  const rest = [...solveBones({ bones }, {}).entries()];
  const allIds = bones.map((b) => b.id);
  const pick = new Map();
  cur.elements.forEach((el, i) => {
    if (boundBones(el) === 'all' || boundBones(el).length) return;
    const b = elementLocalBounds(el, this.doc);
    if (!b) return;
    const c = applyPoint(el.matrix, b.x + b.w / 2, b.y + b.h / 2);
    let best = null, bd = Infinity;
    for (const [id, s] of rest) {
      const d = distToSegment(c.x, c.y, s.restHead, s.restTail);
      if (d < bd) [bd, best] = [d, id];
    }
    if (best) pick.set(i, best);
  });
  if (pick.size) this.editRig('Prender arte aos ossos', null, (el, i) => (pick.has(i) ? bindTo(el, pick.get(i), allIds) : el));
  this.toast(pick.size ? `${pick.size} ${pick.size === 1 ? 'parte presa' : 'partes presas'} ao osso mais perto.` : 'Todas as partes já estão presas a algum osso.');
  return pick.size;
};

/** Tira todos os ossos da camada (a arte volta a ser solta). */
P.removeArmature = function () {
  if (!this.rigBones().length) return;
  this.editRig('Tirar ossos', () => [], (el) => unbindAll(el));
  this.setRigState({ selected: null, mode: 'edit' });
};

// ---------- pose ----------
/**
 * Garante keyframe de pose no quadro atual (a pose interpolada vira a pose do keyframe).
 * Depois do fim da camada, estende a camada até o quadro.
 */
P.poseKeyframeHere = function (layer = this.activeLayer) {
  const info = this.poseAt(layer);
  if (!info) return null;
  const span = this.spanAt(layer);
  if (span && span.start === this.frame) return span;
  const r = TL.insertKeyframe(layer.frames, this.frame);
  if (!r) return this.spanAt(layer);
  const ns = r.frames.find((s) => s.start === this.frame);
  if (ns) {
    // o keyframe novo guarda a pose do quadro (sem repetir a pose nas matrizes dos elementos)
    ns.armature = clone({ ...info.arm, pose: info.pose });
    if (!info.beyond) ns.elements = info.span.elements.map((e) => ({ ...clone(e), id: uid('e') }));
  }
  this.run(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Keyframe de pose', this.frame, this.frame));
  return this.spanAt(layer);
};

/** Keyframe que recebe a pose: com auto-key, o do quadro (criado se faltar); sem, o que segura o quadro. */
P.poseSpan = function () {
  const layer = this.activeLayer;
  if (this.rigState().autoKey) return this.poseKeyframeHere(layer);
  const span = this.spanAt(layer);
  if (!span?.armature) {
    this.toast('Auto-key desligado: este quadro não tem keyframe de pose. Ligue o auto-key ou crie um keyframe (F6).');
    return null;
  }
  if (span.start !== this.frame) this.toast(`Auto-key desligado: a pose vai para o keyframe do quadro ${span.start + 1}.`);
  return span;
};

/** Muda a pose do quadro num passo de desfazer: fn(pose, arm) devolve a pose nova. */
P.setPose = function (label, fn) {
  const layer = this.activeLayer;
  return this.group(label, () => {
    const span = this.poseSpan();
    if (!span?.armature) return false;
    const pose = fn(clone(span.armature.pose || {}), span.armature);
    this.run(new C.SetSpanProps(layer.id, span.start, { armature: span.armature }, { armature: { ...span.armature, pose } }, label));
    this.emit('rig');
    return true;
  });
};

P.copyPose = function () {
  const info = this.poseAt();
  if (!info) return;
  this.rigState().clip = clone(info.pose);
  this.emit('rig');
  this.toast('Pose copiada.');
};

P.pastePose = function () {
  const clip = this.rigState().clip;
  if (!clip) return this.toast('Copie uma pose antes de colar.');
  const ids = new Set(this.rigBones().map((b) => b.id));
  this.setPose('Colar pose', (pose) => {
    const out = { ...pose };
    for (const [k, v] of Object.entries(clip)) if (k === '__root' || ids.has(k)) out[k] = clone(v);
    return out;
  });
};

/** Troca a pose dos pares esquerda/direita (passo da caminhada: a perna da frente vira a de trás). */
P.mirrorPose = function () {
  const pairs = bonePairs(this.rigBones());
  if (!pairs.length) return this.toast('Nenhum par esquerda/direita: dê nomes como "Perna esq" e "Perna dir", ou faça os dois galhos saírem do mesmo osso.');
  this.setPose('Espelhar pose', (pose) => {
    const out = { ...pose };
    for (const [a, b] of pairs) [out[a], out[b]] = [pose[b] || 0, pose[a] || 0];
    return out;
  });
};

/** Zera a pose do osso selecionado e dos filhos (ou do esqueleto todo). */
P.resetPose = function () {
  const sel = this.rigState().selected;
  const bones = this.rigBones();
  const ids = new Set();
  if (sel && bones.some((b) => b.id === sel)) {
    const add = (id) => {
      if (ids.has(id)) return;
      ids.add(id);
      for (const b of bones) if (b.parentId === id) add(b.id);
    };
    add(sel);
  }
  this.setPose(sel ? 'Zerar pose do osso' : 'Zerar pose', (pose) => {
    if (!ids.size) return {};
    const out = { ...pose };
    for (const id of ids) delete out[id];
    return out;
  });
};
