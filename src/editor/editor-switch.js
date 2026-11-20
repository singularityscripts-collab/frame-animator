// Etapa V6 (Parte 2 do REFINO): troca de desenhos, fonemas do lip sync, clipes de animação
// (ações nomeadas, reaproveitáveis e misturáveis) e pacotes de personagem.
//
// Camada de troca: um símbolo gráfico com `switch: true`. Cada keyframe da primeira camada dele é
// um desenho (o nome fica no rótulo do keyframe). A instância mostra um desenho só (loop
// 'single', firstFrame = quadro do desenho), e cada keyframe da camada escolhe qual.
// Fonema: span.viseme guarda o fonema que o lip sync (ou o animador) deu para aquela chave;
// o símbolo guarda qual desenho é cada fonema em sym.visemeMap.
// Clipe: timeline.clips = [{ id, name, length, layers: [{ layerId, name, frames }] }].

import { Editor } from './editor.js';
import * as C from './commands.js';
import * as TL from '../model/timeline.js';
import { clone, uid, createSymbol, createInstance, createLayer, uniqueName, cloneElementsWithNewIds, allTimelines } from '../model/document.js';
import { multiply, translation, invert, IDENTITY } from '../player/render.js';
import { lerpPose } from '../player/bones.js';
import { lerpMatrix } from '../player/tween.js';
import { applyEase } from '../player/ease.js';
import { unionBounds } from '../model/geometry.js';
import { VISEMES } from '../model/lipsync.js';

const P = Editor.prototype;

// ---------- desenhos de um símbolo de troca ----------

export const isSwitch = (sym) => !!sym?.switch;

/** Desenhos do símbolo de troca: um por keyframe da primeira camada. */
export function switchDrawings(sym) {
  const layer = sym?.layers?.[0];
  if (!layer) return [];
  return layer.frames.map((s, i) => ({ index: i, frame: s.start, name: s.label || `Desenho ${i + 1}` }));
}

/** Índice do desenho que a instância mostra. */
export function drawingIndexOf(sym, firstFrame = 0) {
  const ds = switchDrawings(sym);
  let idx = 0;
  ds.forEach((d, i) => {
    if (d.frame <= firstFrame) idx = i;
  });
  return idx;
}

// nomes que valem para cada fonema (sem acento, minúsculas)
const VISEME_ALIASES = {
  rest: ['rest', 'repouso', 'fechada', 'fechado', 'neutra', 'neutro', 'boca fechada', 'x'],
  MBP: ['mbp', 'm', 'b', 'p', 'mb', 'm b p'],
  A: ['a', 'ai', 'aa', 'aberta'],
  E: ['e', 'i', 'ei', 'ee', 'e i'],
  O: ['o', 'oo', 'redonda'],
  U: ['u', 'w', 'uw', 'wq', 'u w', 'bico'],
  L: ['l', 'ldtn', 'l d t n', 'dtn', 'etc'],
  FV: ['fv', 'f', 'v', 'f v'],
  S: ['s', 'z', 'ch', 'sz', 's z', 'cdgknstxyz', 'dentes'],
};
const simplify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Fonema pelo nome do desenho ("A", "MBP", "Boca O", "repouso"…) ou null. */
export function visemeForName(name) {
  const n = simplify(name).replace(/^boca /, '');
  if (!n) return null;
  for (const [v, list] of Object.entries(VISEME_ALIASES)) if (list.includes(n)) return v;
  return null;
}

/** Qual quadro do símbolo é cada fonema: o mapa salvo no símbolo, completado pelos nomes. */
export function visemeMapFor(sym) {
  const map = { ...(sym?.visemeMap || {}) };
  for (const d of switchDrawings(sym)) {
    const v = visemeForName(d.name);
    if (v && map[v] == null) map[v] = d.frame;
  }
  return map;
}

// ---------- editor: troca ----------

/** Instância de troca com que trabalhar: a selecionada, senão a da camada ativa no quadro. */
P.switchItem = function () {
  const isSw = (it) => it.el.type === 'instance' && isSwitch(this.symbol(it.el.symbolId));
  const items = this.frameItems({ editableOnly: false, multi: false });
  return items.find((it) => this.selection.has(it.el.id) && isSw(it)) || items.find((it) => it.layer.id === this.activeLayerId && isSw(it)) || null;
};

/**
 * Cria uma camada de troca com os objetos selecionados: cada objeto vira um desenho.
 * A camada nova fica acima da camada dos objetos, com a instância no lugar deles.
 */
P.createSwitchLayer = function (name) {
  if (!this.selection.size) {
    this.toast('Selecione os desenhos (bocas, mãos, olhos…). Cada objeto selecionado vira um desenho da troca.');
    return null;
  }
  return this.group('Camada de troca', () => {
    this.materialize();
    const items = this.selectedItems();
    const b = unionBounds(items.map((it) => this.boundsOf(it)));
    const rx = b.x + b.w / 2, ry = b.y + b.h / 2;
    const sym = createSymbol(name || uniqueName(this.doc.library.items.map((s) => s.name), 'Troca'), 'graphic', []);
    sym.switch = true;
    sym.layers[0].name = 'Desenhos';
    sym.layers[0].frames = items.map((it, i) => ({
      start: i,
      duration: 1,
      elements: [{ ...clone(it.el), matrix: multiply(translation(-rx, -ry), it.wm || it.el.matrix) }],
      label: `Desenho ${i + 1}`,
      labelType: 'name',
    }));
    const target = items[items.length - 1];
    const inst = createInstance(sym, multiply(invert(target.lm || IDENTITY) || IDENTITY, translation(rx, ry)));
    Object.assign(inst, { loop: 'single', firstFrame: 0, behavior: 'graphic' });
    const cmds = [new C.InsertLibraryEntry('items', this.doc.library.items.length, sym, 'Novo símbolo')];
    for (const g of this.groupSelected(items)) cmds.push(new C.RemoveElements(g.layer.id, g.span.start, g.items.map((it) => ({ el: it.el, index: it.index }))));
    // camada nova acima, com a instância a partir do keyframe dos objetos
    const len = Math.max(this.length, target.span.start + 1);
    const layer = createLayer(uniqueName(this.layers.map((l) => l.name), `Troca: ${sym.name}`), this.layers.length, len);
    if (target.layer.folderId) layer.folderId = target.layer.folderId;
    layer.depth = target.layer.depth || 0;
    const at = target.span.start;
    layer.frames = at > 0 ? [{ start: 0, duration: at, elements: [] }, { start: at, duration: len - at, elements: [inst] }] : [{ start: 0, duration: len, elements: [inst] }];
    cmds.push(new C.AddLayer(this.timeline.id, Math.max(0, this.layerIndex(target.layer.id)), layer, 'Camada de troca'));
    this.run(new C.Compound('Camada de troca', cmds));
    this.activeLayerId = layer.id;
    this.setSelection([inst.id]);
    this.emit('library');
    this.emit('layers');
    return { symbol: this.symbol(sym.id), layer: this.layer(layer.id) };
  });
};

/** Muda o elemento index do keyframe no quadro (cria o keyframe se precisar). Um passo de desfazer. */
P.editInstanceKey = function (it, label, mutate, frame = this.frame) {
  const layer = it.layer;
  let fr = clone(layer.frames);
  if (!fr.some((s) => s.start === frame)) {
    const r = TL.insertKeyframe(fr, frame);
    if (!r) return false;
    fr = r.frames;
  }
  const span = fr.find((s) => s.start === frame);
  const el = span?.elements[it.index];
  if (!el) return false;
  mutate(el, span);
  // a chave nova tem ids novos: a instância continua selecionada (o painel da troca não some)
  const wasSelected = this.selection.has(it.el.id);
  this.run(new C.SetLayerFrames(layer.id, layer.frames, fr, label, this.frame, this.frame));
  const now = this.spanAt(this.layer(layer.id), frame)?.elements[it.index];
  if (now && wasSelected) this.setSelection([now.id]);
  return true;
};

/** Mostra o desenho `index` a partir do quadro atual. */
P.switchTo = function (index, it = this.switchItem()) {
  if (!it) return this.toast('Selecione uma camada de troca (ou a instância dela).');
  const sym = this.symbol(it.el.symbolId);
  const d = switchDrawings(sym)[index];
  if (!d) return false;
  return this.editInstanceKey(it, 'Trocar desenho', (el, span) => {
    Object.assign(el, { firstFrame: d.frame, loop: 'single', behavior: 'graphic' });
    const v = Object.entries(visemeMapFor(sym)).find(([, f]) => f === d.frame)?.[0];
    if (v) span.viseme = v;
    else delete span.viseme;
  });
};

/** Próximo (+1) ou anterior (-1) desenho. */
P.switchStep = function (delta) {
  const it = this.switchItem();
  if (!it) return this.toast('Selecione uma camada de troca (ou a instância dela).');
  const sym = this.symbol(it.el.symbolId);
  const n = switchDrawings(sym).length;
  const cur = drawingIndexOf(sym, it.el.firstFrame || 0);
  return this.switchTo((cur + delta + n) % n, it);
};

/** Novo desenho no fim da troca (cópia do atual ou vazio) e já mostra ele. Devolve o índice. */
P.addSwitchDrawing = function ({ copy = true, name } = {}, it = this.switchItem()) {
  if (!it) return this.toast('Selecione uma camada de troca (ou a instância dela).');
  const sym = this.symbol(it.el.symbolId);
  const layer = sym.layers[0];
  const ds = switchDrawings(sym);
  const cur = ds[drawingIndexOf(sym, it.el.firstFrame || 0)];
  const src = layer.frames.find((s) => s.start === cur?.frame);
  const start = TL.lengthOf(layer.frames);
  const span = {
    start,
    duration: 1,
    elements: copy && src ? cloneElementsWithNewIds(src.elements) : [],
    label: (name || '').trim().slice(0, 40) || uniqueName(ds.map((d) => d.name), copy && cur ? `${cur.name} (cópia)` : `Desenho ${ds.length + 1}`),
    labelType: 'name',
  };
  return this.group('Novo desenho', () => {
    this.run(new C.SetLayerFrames(layer.id, layer.frames, [...layer.frames, span], 'Novo desenho'));
    this.switchTo(ds.length, this.switchItem() || it);
    return ds.length;
  });
};

P.renameSwitchDrawing = function (symbolId, index, name) {
  const sym = this.symbol(symbolId);
  const layer = sym?.layers[0];
  const span = layer?.frames[index];
  name = String(name || '').trim().slice(0, 40);
  if (!span || !name) return false;
  const fr = clone(layer.frames);
  Object.assign(fr[index], { label: name, labelType: 'name' });
  this.run(new C.SetLayerFrames(layer.id, layer.frames, fr, 'Renomear desenho'));
  return true;
};

/**
 * Apaga um desenho. Os desenhos de depois sobem um quadro, então todas as instâncias
 * do símbolo (em qualquer timeline) são reapontadas.
 */
P.deleteSwitchDrawing = function (symbolId, index) {
  const sym = this.symbol(symbolId);
  const ds = switchDrawings(sym);
  if (ds.length <= 1) return this.toast('A troca precisa ter pelo menos um desenho.');
  const d = ds[index];
  if (!d) return false;
  const span = sym.layers[0].frames[index];
  const from = d.frame, n = span.duration;
  const cmds = [];
  for (const l of sym.layers) {
    const r = TL.removeRange(l.frames, from, from + n - 1);
    if (r) cmds.push(new C.SetLayerFrames(l.id, l.frames, r.frames, 'Apagar desenho'));
  }
  const remap = (f) => (f >= from + n ? f - n : f >= from ? Math.max(0, from - (index === 0 ? 0 : 1)) : f);
  for (const tl of allTimelines(this.doc)) {
    for (const l of tl.layers) {
      if (!l.frames.some((s) => s.elements.some((e) => e.type === 'instance' && e.symbolId === symbolId))) continue;
      const fr = clone(l.frames);
      for (const s of fr) for (const e of s.elements) if (e.type === 'instance' && e.symbolId === symbolId) e.firstFrame = remap(e.firstFrame || 0);
      cmds.push(new C.SetLayerFrames(l.id, l.frames, fr, 'Apagar desenho'));
    }
  }
  const vm = sym.visemeMap;
  if (vm) {
    const after = {};
    for (const [k, f] of Object.entries(vm)) if (f < from || f >= from + n) after[k] = f >= from + n ? f - n : f;
    cmds.push(new C.PatchLibraryEntry('items', sym.id, { visemeMap: vm }, { visemeMap: after }));
  }
  this.run(new C.Compound('Apagar desenho', cmds));
  return true;
};

/** Guarda no símbolo qual desenho é cada fonema. */
P.setVisemeMap = function (symbolId, map) {
  const sym = this.symbol(symbolId);
  if (!sym) return;
  this.run(new C.PatchLibraryEntry('items', sym.id, { visemeMap: sym.visemeMap }, { visemeMap: { ...map } }, 'Fonemas'));
};

/**
 * Ajuste fino do lip sync: dá o fonema `viseme` ao keyframe `start` da camada e mostra o desenho
 * daquele fonema. Sem desenho para o fonema, só marca o fonema.
 */
P.setSpanViseme = function (layerId, start, viseme) {
  const layer = this.layer(layerId);
  const span = layer?.frames.find((s) => s.start === start);
  if (!span) return false;
  const index = span.elements.findIndex((e) => e.type === 'instance' && isSwitch(this.symbol(e.symbolId)));
  const fr = clone(layer.frames);
  const s = fr.find((x) => x.start === start);
  if (viseme) s.viseme = viseme;
  else delete s.viseme;
  if (index >= 0) {
    const sym = this.symbol(s.elements[index].symbolId);
    const f = visemeMapFor(sym)[viseme];
    if (f != null) Object.assign(s.elements[index], { firstFrame: f, loop: 'single', behavior: 'graphic' });
  }
  this.run(new C.SetLayerFrames(layer.id, layer.frames, fr, 'Fonema'));
  return true;
};

/** Nome curto para mostrar na timeline: o fonema, senão o nome do desenho. */
P.switchLabelOf = function (span) {
  const el = span.elements.find((e) => e.type === 'instance');
  const sym = el && this.symbol(el.symbolId);
  if (!isSwitch(sym)) return span.viseme || null;
  if (span.viseme) return span.viseme === 'rest' ? '·' : span.viseme;
  return switchDrawings(sym)[drawingIndexOf(sym, el.firstFrame || 0)]?.name || null;
};

/** Põe a fala numa camada nova a partir do quadro (para ver a onda e ouvir ao arrastar a agulha). */
P.addSpeechLayer = function (soundId, at = this.frame, frames = 1) {
  const snd = this.doc.library.sounds.find((s) => s.id === soundId);
  if (!snd) return null;
  const len = Math.max(this.length, at + Math.max(1, frames));
  const layer = createLayer(uniqueName(this.layers.map((l) => l.name), `Fala: ${snd.name.replace(/\.[a-z0-9]+$/i, '')}`), this.layers.length, len);
  const sound = { id: soundId, sync: 'stream', loops: 1, volume: 100, pan: 0, fadeIn: 0, fadeOut: 0 };
  layer.frames = at > 0 ? [{ start: 0, duration: at, elements: [] }, { start: at, duration: len - at, elements: [], sound }] : [{ start: 0, duration: len, elements: [], sound }];
  this.run(new C.AddLayer(this.timeline.id, this.layers.length, layer, 'Camada da fala'));
  return this.layer(layer.id);
};

// ---------- clipes de animação (ações nomeadas) ----------

/** Pose (com keys, sem dinâmica) da camada no quadro f. */
export function poseAtFrame(frames, f) {
  const i = frames.findIndex((s) => f >= s.start && f < s.start + s.duration);
  if (i < 0) return null;
  const s = frames[i];
  if (!s.armature) return null;
  let pose = s.armature.pose || {};
  const next = s.tween ? frames[i + 1] : null;
  if (next?.armature && f > s.start) pose = lerpPose(pose, next.armature.pose || {}, applyEase((f - s.start) / s.duration, s.tween));
  return pose;
}

/** Ossos que o clipe mexe: os que mudam de giro dentro dele (com uma chave só, os que saem do descanso). */
export function clipMovedBones(frames) {
  const poses = frames.filter((s) => s.armature).map((s) => s.armature.pose || {});
  const ids = new Set(poses.flatMap((p) => Object.keys(p)));
  const val = (p, id) => JSON.stringify(p[id] ?? (id === '__root' ? null : 0));
  const out = new Set();
  for (const id of ids) {
    if (poses.length === 1) {
      if (id !== '__root' && Math.abs(poses[0][id] || 0) > 1e-6) out.add(id);
    } else if (poses.some((p) => val(p, id) !== val(poses[0], id))) out.add(id);
  }
  return out;
}

function mixValue(a, b, w) {
  if (a && typeof a === 'object' && b && typeof b === 'object') return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  if (typeof a === 'number' || typeof b === 'number') return (a || 0) + ((b || 0) - (a || 0)) * w;
  return w >= 0.5 ? b : a;
}

/**
 * Cola o clipe (trechos começando em 0) na camada a partir de `at`, `repeat` vezes.
 * mode 'replace': o clipe toma o lugar do que havia.
 * mode 'blend': só os ossos que o clipe mexe mudam (com o peso `weight` 0–1); o resto da
 * animação da camada continua (as chaves dela dentro do trecho são mantidas).
 */
export function applyClipFrames(frames, clipFrames, at, { repeat = 1, mode = 'replace', weight = 1 } = {}) {
  const one = TL.lengthOf(clipFrames);
  const n = one * Math.max(1, repeat);
  let slice = [];
  for (let r = 0; r < Math.max(1, repeat); r++) slice.push(...clone(clipFrames).map((s) => ({ ...s, start: s.start + r * one })));
  slice = TL.normalize(slice);
  // a última chave de cada repetição liga com o começo da próxima (o tween não quebra)
  const orig = clone(frames);
  let fr = TL.insertSpans(frames, at, slice, { overwrite: true }).frames;
  if (mode !== 'blend' && weight >= 1) return fr;
  // chaves da camada original dentro do trecho continuam existindo (misturar mantém a animação dela)
  if (mode === 'blend') {
    for (const s of orig) {
      if (s.start <= at || s.start >= at + n || fr.some((x) => x.start === s.start)) continue;
      const r = TL.insertKeyframe(fr, s.start);
      if (r) fr = r.frames;
    }
  }
  const moved = clipMovedBones(clipFrames);
  const w = Math.max(0, Math.min(1, weight));
  for (const s of fr) {
    if (s.start < at || s.start >= at + n) continue;
    const base = poseAtFrame(orig, s.start);
    if (s.armature && base) {
      const pose = mode === 'blend' ? { ...base } : { ...(s.armature.pose || {}) };
      const clipPose = s.armature.pose || {};
      const ids = mode === 'blend' ? moved : new Set([...Object.keys(base), ...Object.keys(clipPose)]);
      for (const id of ids) pose[id] = mixValue(base[id] ?? (id === '__root' ? undefined : 0), clipPose[id] ?? (id === '__root' ? undefined : 0), w);
      for (const id of Object.keys(pose)) if (pose[id] === undefined) delete pose[id];
      s.armature = { ...s.armature, pose };
    } else if (w < 1) {
      // camada sem ossos: o peso mistura a posição dos elementos quando os dois lados batem
      const oi = orig.findIndex((x) => s.start >= x.start && s.start < x.start + x.duration);
      const os = orig[oi];
      const els = os ? TL.poseAt(orig, oi, s.start - os.start) : [];
      if (els.length === s.elements.length) {
        s.elements = s.elements.map((e, k) => (els[k] && els[k].type === e.type && els[k].matrix && e.matrix ? { ...e, matrix: lerpMatrix(els[k].matrix, e.matrix, w) } : e));
      }
    }
  }
  return fr;
}

P.clips = function () {
  return this.timeline?.clips || [];
};

/** Salva o trecho selecionado (ou a timeline toda) como clipe com nome. */
P.saveClip = function (name, sel = this.frameSel) {
  const from = sel ? sel.from : 0;
  const to = sel ? sel.to : Math.max(0, this.length - 1);
  const ids = sel ? sel.layerIds : this.layers.map((l) => l.id);
  const layers = ids
    .map((id) => this.layer(id))
    .filter((l) => l && l.type !== 'folder' && l.type !== 'camera')
    .map((l) => ({ layerId: l.id, name: l.name, frames: TL.extractRange(l.frames, from, to) }));
  if (!layers.length) {
    this.toast('Selecione os quadros do clipe (arraste na timeline, por cima das camadas).');
    return null;
  }
  const list = this.clips();
  const clip = { id: uid('k'), name: uniqueName(list.map((c) => c.name), (name || '').trim().slice(0, 40) || 'Clipe'), length: to - from + 1, layers };
  this.setTimelineProps({ clips: [...list, clip] }, 'Salvar clipe');
  return clip;
};

P.renameClip = function (id, name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) return;
  this.setTimelineProps({ clips: this.clips().map((c) => (c.id === id ? { ...c, name } : c)) }, 'Renomear clipe');
};

P.deleteClip = function (id) {
  this.setTimelineProps({ clips: this.clips().filter((c) => c.id !== id) }, 'Apagar clipe');
};

/**
 * Insere o clipe no quadro atual. Cada camada do clipe vai para a camada de mesmo id
 * (ou de mesmo nome, se o clipe veio de outro lugar). Devolve quantas camadas mudaram.
 */
P.insertClip = function (id, { at = this.frame, repeat = 1, mode = 'replace', weight = 1 } = {}) {
  const clip = this.clips().find((c) => c.id === id);
  if (!clip) return 0;
  const cmds = [];
  const used = new Set();
  for (const cl of clip.layers) {
    const layer = this.layer(cl.layerId) || this.layers.find((l) => l.name === cl.name && !used.has(l.id));
    if (!layer || used.has(layer.id) || layer.type === 'folder' || layer.type === 'camera') continue;
    used.add(layer.id);
    const fr = applyClipFrames(layer.frames, cl.frames, at, { repeat, mode, weight });
    cmds.push(new C.SetLayerFrames(layer.id, layer.frames, fr, 'Inserir clipe', this.frame, at));
  }
  if (!cmds.length) {
    this.toast('Nenhuma camada desta timeline combina com as do clipe.');
    return 0;
  }
  this.run(new C.Compound(`Clipe: ${clip.name}`, cmds));
  const len = clip.length * Math.max(1, repeat);
  this.setFrameSelection?.({ from: at, to: at + len - 1, layerIds: [...used] });
  return cmds.length;
};

// ---------- personagens (pacote reaproveitável entre arquivos) ----------

export const CHARACTER_FORMAT = 'frame-animator-character';

/** O símbolo e tudo que ele usa (símbolos dentro, imagens, sons), num pacote JSON. */
export function characterPackage(doc, rootId) {
  const lib = doc.library;
  const root = lib.items.find((s) => s.id === rootId);
  if (!root) return null;
  const syms = new Map();
  const bmps = new Set(), snds = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (syms.has(id)) continue;
    const sym = lib.items.find((s) => s.id === id);
    if (!sym) continue;
    syms.set(id, sym);
    for (const l of sym.layers) {
      for (const s of l.frames) {
        if (s.sound?.id) snds.add(s.sound.id);
        for (const el of s.elements) {
          if (el.type === 'instance') stack.push(el.symbolId);
          if (el.type === 'bitmap' && el.assetId) bmps.add(el.assetId);
          if (el.fill?.type === 'bitmap' && el.fill.assetId) bmps.add(el.fill.assetId);
        }
      }
    }
  }
  return {
    format: CHARACTER_FORMAT,
    version: 1,
    name: root.name,
    root: rootId,
    fps: doc.fps,
    items: [...syms.values()].map(clone),
    bitmaps: lib.bitmaps.filter((b) => bmps.has(b.id)).map(clone),
    sounds: lib.sounds.filter((s) => snds.has(s.id)).map(clone),
  };
}

/**
 * Prepara o pacote para entrar num documento: ids novos (símbolos, camadas, elementos, imagens,
 * sons, clipes) e nomes que não batem com os que já existem. Não mexe no documento.
 */
export function remapCharacter(doc, pkg) {
  if (!pkg || pkg.format !== CHARACTER_FORMAT || !Array.isArray(pkg.items)) throw new Error('este arquivo não é um personagem do Frame Animator');
  const ids = new Map();
  const nid = (old, prefix) => {
    if (!ids.has(old)) ids.set(old, uid(prefix));
    return ids.get(old);
  };
  const names = doc.library.items.map((s) => s.name);
  const take = (list, base) => {
    const n = uniqueName(list, base);
    list.push(n);
    return n;
  };
  const bitmaps = (pkg.bitmaps || []).map((b) => ({ ...clone(b), id: nid(b.id, 'b'), folderId: null, name: take(doc.library.bitmaps.map((x) => x.name), b.name) }));
  const sounds = (pkg.sounds || []).map((s) => ({ ...clone(s), id: nid(s.id, 'a'), folderId: null, name: take(doc.library.sounds.map((x) => x.name), s.name) }));
  for (const s of pkg.items) nid(s.id, 'y');
  const items = pkg.items.map((s) => {
    const sym = clone(s);
    sym.id = ids.get(s.id);
    sym.name = take(names, s.name);
    sym.folderId = null;
    for (const l of sym.layers) {
      const old = l.id;
      l.id = nid(old, 'l');
      for (const sp of l.frames) {
        if (sp.sound?.id) sp.sound.id = ids.get(sp.sound.id) || sp.sound.id;
        sp.elements = sp.elements.map((el) => {
          const e = { ...el, id: uid('e') };
          if (el.type === 'shape') e.lineage = el.lineage || el.id;
          if (e.type === 'instance') e.symbolId = ids.get(e.symbolId) || e.symbolId;
          if (e.type === 'bitmap' && e.assetId) e.assetId = ids.get(e.assetId) || e.assetId;
          if (e.fill?.type === 'bitmap' && e.fill.assetId) e.fill = { ...e.fill, assetId: ids.get(e.fill.assetId) || e.fill.assetId };
          return e;
        });
      }
    }
    // camadas que apontam para outras (pai, máscara, guia, pasta)
    for (const l of sym.layers) for (const k of ['folderId', 'parentId', 'maskedBy', 'guidedBy', 'parentLayerId']) if (l[k] && ids.has(l[k])) l[k] = ids.get(l[k]);
    if (sym.clips) sym.clips = sym.clips.map((c) => ({ ...c, id: uid('k'), layers: c.layers.map((x) => ({ ...x, layerId: ids.get(x.layerId) || x.layerId })) }));
    return sym;
  });
  return { root: ids.get(pkg.root), name: pkg.name, items, bitmaps, sounds };
}

/** Traz o personagem para o documento (num passo de desfazer) e devolve o símbolo raiz. */
P.importCharacter = function (pkg, { place = true } = {}) {
  let r;
  try {
    r = remapCharacter(this.doc, pkg);
  } catch (err) {
    this.toast(`Não deu para trazer o personagem: ${err.message}.`);
    return null;
  }
  const lib = this.doc.library;
  const folder = { id: uid('f'), name: uniqueName(lib.folders.map((f) => f.name), r.name || 'Personagem'), parentId: null };
  const cmds = [new C.InsertLibraryEntry('folders', lib.folders.length, folder, 'Pasta')];
  r.items.forEach((s, i) => cmds.push(new C.InsertLibraryEntry('items', lib.items.length + i, { ...s, folderId: folder.id })));
  r.bitmaps.forEach((b, i) => cmds.push(new C.InsertLibraryEntry('bitmaps', lib.bitmaps.length + i, { ...b, folderId: folder.id })));
  r.sounds.forEach((s, i) => cmds.push(new C.InsertLibraryEntry('sounds', lib.sounds.length + i, { ...s, folderId: folder.id })));
  this.group('Trazer personagem', () => {
    this.run(new C.Compound('Trazer personagem', cmds));
    if (place) this.placeSymbol?.(r.root, this.doc.width / 2, this.doc.height / 2);
  });
  this.emit('library');
  return this.symbol(r.root);
};

export { VISEMES };
