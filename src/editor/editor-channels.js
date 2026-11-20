// Etapa V5: canais, interpolação por chave, modificadores (ruído e ciclo), retime e marcadores.

import { Editor, DEFAULT_TWEEN } from './editor.js';
import * as C from './commands.js';
import * as TL from '../model/timeline.js';
import { clone, uid } from '../model/document.js';
import { MOTION_LABELS } from '../player/tween.js';

const P = Editor.prototype;

// ---------- interpolação por chave ----------
/**
 * Tipos de interpolação (o que acontece do keyframe até o próximo), com o símbolo que aparece na
 * timeline. "Degrau" segura o desenho até a próxima chave (sem tween).
 */
export const INTERPOLATIONS = {
  smooth: { label: 'Suave (entrada e saída)', glyph: '●', easeType: 'sineInOut' },
  linear: { label: 'Linear', glyph: '◆', easeType: 'linear' },
  easeIn: { label: 'Acelerar (entrada lenta)', glyph: '◐', easeType: 'cubicIn' },
  easeOut: { label: 'Desacelerar (saída lenta)', glyph: '◑', easeType: 'cubicOut' },
  step: { label: 'Degrau (segura até a próxima chave)', glyph: '■', easeType: null },
  overshoot: { label: 'Passar do ponto e voltar', glyph: '▲', easeType: 'backOut' },
  elastic: { label: 'Elástico', glyph: '▲', easeType: 'elasticOut' },
  bounce: { label: 'Quicar', glyph: '▲', easeType: 'bounceOut' },
};

/** Tipo de interpolação de um keyframe (pelo tween dele). */
export function interpKind(span) {
  const tw = span?.tween;
  if (!tw) return 'step';
  if (tw.easeType === 'custom') return 'custom';
  const e = tw.easeType;
  if (!e || e === 'linear') {
    const k = tw.ease || 0;
    return k < 0 ? 'easeIn' : k > 0 ? 'easeOut' : 'linear';
  }
  if (/^back/.test(e)) return 'overshoot';
  if (/^elastic/.test(e)) return 'elastic';
  if (/^bounce/.test(e)) return 'bounce';
  if (/InOut$/.test(e)) return 'smooth';
  if (/In$/.test(e)) return 'easeIn';
  if (/Out$/.test(e)) return 'easeOut';
  return 'linear';
}

/** Tween novo do jeito certo para o trecho: shape tween entre formas do mesmo desenho, senão clássico. */
function autoTween(layer, span, next) {
  if (!next) return null;
  if (layer.type === 'camera') return { ...DEFAULT_TWEEN };
  if (!span.elements.length && !span.armature) return null;
  const shapes = span.elements.length && span.elements.every((e) => e.type === 'shape');
  // formas com os pontos mudando: shape tween (ponto a ponto); só posição/giro/escala: tween clássico
  const pointsChange = span.elements.some((e, i) => JSON.stringify(e.path ?? null) !== JSON.stringify(next.elements[i]?.path ?? null));
  if (shapes && !span.armature && pointsChange) return { type: 'shape', ease: 0, hints: [] };
  return { ...DEFAULT_TWEEN };
}

/**
 * Muda a interpolação dos keyframes do intervalo selecionado (ou do keyframe do quadro).
 * Cria o tween quando falta; "step" tira o tween.
 */
P.setInterpolation = function (kind) {
  const def = INTERPOLATIONS[kind];
  if (!def) return 0;
  const label = `Interpolação: ${def.label.split(' (')[0]}`;
  const cmds = [];
  for (const { layer, span, next } of this.rangeSpans()) {
    if (kind === 'step') {
      if (span.tween) cmds.push(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween: undefined }, label));
      continue;
    }
    const base = span.tween || autoTween(layer, span, next);
    if (!base) continue;
    const tween = { ...base, easeType: def.easeType, ease: 0 };
    delete tween.easeCurve;
    cmds.push(new C.SetSpanProps(layer.id, span.start, { tween: span.tween }, { tween }, label));
  }
  if (cmds.length) this.run(new C.Compound(label, cmds));
  else this.toast('Nenhum keyframe aqui pode mudar de interpolação: falta a chave seguinte ou conteúdo.');
  return cmds.length;
};

// ---------- canais (linhas por propriedade, abaixo da camada) ----------
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pick = (els, fn) => els.map(fn);

/**
 * Canais de uma camada: [{ id, label, color, keys: [{ frame, kind, motion? }], band? }].
 * Cada canal mostra só os keyframes em que aquela propriedade muda.
 */
export function layerChannels(layer, editor = null) {
  const fr = layer.frames || [];
  const out = [];
  const add = (id, label, color, keys, extra = {}) => {
    if (keys.length) out.push({ id, label, color, keys, ...extra });
  };
  const changed = (fn) => {
    const keys = [];
    for (let i = 0; i < fr.length; i++) {
      const s = fr[i];
      if (!s.elements.length) continue;
      const prev = fr[i - 1];
      if (!prev || !prev.elements.length || !same(fn(s), fn(prev))) keys.push({ frame: s.start, kind: interpKind(s) });
    }
    // só vale como canal se muda pelo menos uma vez
    return keys.length > 1 ? keys : [];
  };
  add('transform', 'Transformação', '#64d2ff', changed((s) => pick(s.elements, (e) => e.matrix)));
  add('points', 'Pontos', '#30d158', changed((s) => pick(s.elements, (e) => (e.type === 'shape' ? e.path : null))));
  add('color', 'Cor', '#ff9f0a', changed((s) => pick(s.elements, (e) => [e.fill, e.stroke, e.strokeWidth, e.color, e.alpha])));
  add('visible', 'Esconder', '#8e8e93', changed((s) => pick(s.elements, (e) => !!e.hidden)));
  add('drawing', 'Desenho (troca)', '#9be29b', changed((s) => pick(s.elements, (e) => (e.type === 'instance' ? e.firstFrame || 0 : null))));
  // ossos: um canal por osso (e a raiz), com as chaves em que o giro muda
  const bones = fr.find((s) => s.armature?.bones?.length)?.armature.bones || [];
  for (const b of [{ id: '__root', name: 'Raiz (posição)' }, ...bones]) {
    const keys = [];
    let prev;
    fr.forEach((s, i) => {
      if (!s.armature) return;
      const v = s.armature.pose?.[b.id] ?? (b.id === '__root' ? null : 0);
      if (i === 0 || !same(v, prev)) keys.push({ frame: s.start, kind: interpKind(s) });
      prev = v;
    });
    if (keys.length > 1) add(`bone:${b.id}`, b.id === '__root' ? b.name : `Osso: ${b.name || 'Osso'}`, '#ff9f0a', keys);
  }
  // motion tween: um canal por propriedade com keys
  const props = new Map();
  for (const s of fr) {
    if (s.tween?.type !== 'motion') continue;
    for (const [p, keys] of Object.entries(s.tween.props || {})) {
      if (!keys?.length) continue;
      if (!props.has(p)) props.set(p, []);
      for (const k of keys) props.get(p).push({ frame: s.start + k.t, kind: 'linear', motion: { start: s.start, prop: p, t: k.t } });
    }
  }
  for (const [p, keys] of props) add(`motion:${p}`, MOTION_LABELS[p] || p, '#ffd60a', keys);
  // modificadores: faixa onde valem
  const m = layer.modifiers;
  if (m?.noise) add('noise', 'Ruído', '#bf5af2', [{ frame: 0, kind: 'none' }], { band: { from: 0, to: Infinity } });
  if (m?.cycle) add('cycle', `Ciclo (${m.cycle.mode === 'pingpong' ? 'vai e volta' : 'repete'})`, '#5e5ce6', [{ frame: m.cycle.from, kind: 'none' }, { frame: m.cycle.to, kind: 'none' }], { band: { from: m.cycle.from, to: m.cycle.to } });
  void editor;
  return out;
}

/** Move uma key do motion tween (canal da propriedade) dentro do trecho dela. */
P.moveMotionKey = function (layerId, start, prop, fromT, toT) {
  const layer = this.layer(layerId);
  const span = layer?.frames.find((s) => s.start === start);
  const keys = span?.tween?.props?.[prop];
  if (!keys) return false;
  toT = Math.max(0, Math.min(span.duration - 1, Math.round(toT)));
  if (toT === fromT || keys.some((k) => k.t === toT)) return false;
  const tween = clone(span.tween);
  const k = tween.props[prop].find((x) => x.t === fromT);
  if (!k) return false;
  k.t = toT;
  tween.props[prop].sort((a, b) => a.t - b.t);
  this.run(new C.SetSpanProps(layerId, start, { tween: span.tween }, { tween }, 'Mover key'));
  return true;
};

// ---------- modificadores (ruído e ciclo, sem criar chaves) ----------
/**
 * layer.modifiers = {
 *   noise?: { position (px), rotation (graus), scale (%), speed (quadros por mudança), seed },
 *   cycle?: { from, to, mode: 'loop' | 'pingpong' }  — depois de `to`, repete o trecho
 * }
 */
P.setLayerModifiers = function (layerId, patch, label = 'Modificadores') {
  const layer = this.layer(layerId);
  if (!layer) return;
  const mods = { ...(layer.modifiers || {}), ...patch };
  for (const k of Object.keys(mods)) if (!mods[k]) delete mods[k];
  this.setLayerProps(layerId, { modifiers: Object.keys(mods).length ? mods : undefined }, label);
};

/** Ciclo a partir do intervalo selecionado na timeline (ou do começo da camada até o quadro). */
P.cycleFromSelection = function (mode = 'loop') {
  const r = this.hasFrameRange() ? this.frameRange() : { from: 0, to: this.frame };
  if (r.to <= r.from) return this.toast('Selecione na timeline os quadros que vão repetir (pelo menos 2).');
  const len = r.to - r.from + 1;
  // a camada precisa de quadros depois do trecho para o ciclo aparecer: estende até o fim da cena
  // (ou três voltas, se a cena acaba antes)
  const until = Math.max(this.length, r.to + 1 + len * 3);
  let extended = false;
  this.group(mode === 'pingpong' ? 'Ciclo vai e volta' : 'Ciclo', () => {
    for (const layer of this.hasFrameRange() ? this.rangeLayers(r) : [this.activeLayer]) {
      this.setLayerModifiers(layer.id, { cycle: { from: r.from, to: r.to, mode } }, mode === 'pingpong' ? 'Ciclo vai e volta' : 'Ciclo');
      const L = this.layer(layer.id);
      if (TL.lengthOf(L.frames) <= r.to + 1) {
        const fr = clone(L.frames);
        fr[fr.length - 1].duration += until - TL.lengthOf(fr);
        this.run(new C.SetLayerFrames(L.id, L.frames, fr, 'Ciclo'));
        extended = true;
      }
    }
  });
  this.toast(`Depois do quadro ${r.to + 1}, os quadros ${r.from + 1}–${r.to + 1} ${mode === 'pingpong' ? 'vão e voltam' : 'se repetem'}.${extended ? ` A camada foi até o quadro ${until} para o ciclo aparecer.` : ''}`);
};

// ---------- retime: esticar ou encolher um trecho ----------
/** Muda a duração do intervalo selecionado: factor 2 = o dobro de quadros, 0,5 = metade. */
P.retimeRange = function (factor) {
  if (!this.hasFrameRange()) return this.toast('Selecione na timeline os quadros que vão esticar ou encolher.');
  if (!(factor > 0) || factor === 1) return;
  const r = this.frameRange();
  const cmds = [];
  for (const layer of this.rangeLayers(r)) {
    const frames = TL.retimeFrames(layer.frames, r.from, r.to, factor);
    if (frames) cmds.push(new C.SetLayerFrames(layer.id, layer.frames, frames, 'Esticar quadros'));
  }
  if (!cmds.length) return;
  this.run(new C.Compound(factor > 1 ? 'Esticar quadros' : 'Encolher quadros', cmds));
  const len = Math.max(1, Math.round((r.to - r.from + 1) * factor));
  this.setFrameSelection({ from: r.from, to: r.from + len - 1, layerIds: r.layerIds });
};

// ---------- marcadores da timeline ----------
/** Muda propriedades da timeline aberta (cena ou símbolo), com desfazer. */
P.setTimelineProps = function (patch, label) {
  const tl = this.timeline;
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, tl[k]]));
  const inScene = this.doc.scenes.some((s) => s.id === tl.id);
  this.run(inScene ? new C.PatchScene(tl.id, before, patch, label) : new C.PatchLibraryEntry('items', tl.id, before, patch, label));
};

P.markers = function () {
  return this.timeline?.markers || [];
};

P.addMarker = function (frame, name) {
  const list = this.markers();
  const m = { id: uid('m'), frame: Math.max(0, Math.round(frame)), name: (name || '').trim().slice(0, 60) || `Marcador ${list.length + 1}` };
  this.setTimelineProps({ markers: [...list, m].sort((a, b) => a.frame - b.frame) }, 'Marcador');
  return m;
};
P.moveMarker = function (id, frame) {
  const list = this.markers();
  if (!list.some((m) => m.id === id)) return;
  this.setTimelineProps({ markers: list.map((m) => (m.id === id ? { ...m, frame: Math.max(0, Math.round(frame)) } : m)).sort((a, b) => a.frame - b.frame) }, 'Mover marcador');
};
P.renameMarker = function (id, name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return;
  this.setTimelineProps({ markers: this.markers().map((m) => (m.id === id ? { ...m, name } : m)) }, 'Renomear marcador');
};
P.deleteMarker = function (id) {
  const list = this.markers().filter((m) => m.id !== id);
  this.setTimelineProps({ markers: list.length ? list : undefined }, 'Apagar marcador');
};
/** Vai para o marcador seguinte (dir 1) ou anterior (dir -1). */
P.gotoMarker = function (dir = 1) {
  const list = this.markers();
  const m = dir > 0 ? list.find((x) => x.frame > this.frame) : [...list].reverse().find((x) => x.frame < this.frame);
  if (m) this.setFrame(m.frame);
  return m || null;
};
