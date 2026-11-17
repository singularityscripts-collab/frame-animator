// Operações de timeline sobre a lista de trechos de uma camada.
// Invariante: os trechos são contíguos a partir do quadro 0, sem buracos.
// Todas as funções são puras: recebem frames e devolvem { frames, frame } novos
// (frame = quadro para onde a agulha deve ir), ou null se nada mudou.

import { clone, cloneElementsWithNewIds } from './document.js';
import { tweenElements, motionElement, motionPropsAt, MOTION_PROPS, applyEase, lerpHex } from '../player/tween.js';

export function normalize(frames) {
  let start = 0;
  for (const f of frames) {
    f.start = start;
    start += f.duration;
  }
  return frames;
}

export function lengthOf(frames) {
  const last = frames[frames.length - 1];
  return last ? last.start + last.duration : 0;
}

export function indexAt(frames, frame) {
  return frames.findIndex((s) => frame >= s.start && frame < s.start + s.duration);
}

// ---------- o que um trecho mostra num ponto ----------

/** Elementos que fr[i] mostra `offset` quadros depois do início (com tween calculado). */
export function poseAt(fr, i, offset) {
  const s = fr[i];
  if (s.tween?.type === 'motion' && s.elements.length) return [motionElement(s, offset), ...s.elements.slice(1)];
  const next = s.tween ? fr[i + 1] : null;
  if (next && offset > 0) return tweenElements(s, next, offset);
  return s.elements;
}

function cameraAtSpan(fr, i, offset) {
  const s = fr[i], next = fr[i + 1];
  if (!s.camera) return undefined;
  if (!s.tween || !next?.camera || offset <= 0) return clone(s.camera);
  const t = applyEase(offset / s.duration, s.tween);
  const a = s.camera, b = next.camera;
  const out = {};
  for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' && typeof b[k] === 'number' ? a[k] + (b[k] - a[k]) * t : a[k];
  if (a.tint && b.tint) out.tint = lerpHex(a.tint, b.tint, t);
  return out;
}

/** Divide as keys de um motion tween em o: a parte da esquerda acaba em o-1, a da direita começa em 0. */
function splitMotion(span, o) {
  const tw = span.tween;
  const left = { ...clone(tw), props: {} }, right = { ...clone(tw), props: {} };
  const atEnd = motionPropsAt(span, o - 1), atStart = motionPropsAt(span, o);
  for (const name of MOTION_PROPS) {
    const keys = tw.props?.[name];
    if (!keys?.length) continue;
    const l = keys.filter((k) => k.t <= o - 1).map((k) => ({ ...k }));
    if (!l.some((k) => k.t === o - 1)) l.push({ t: o - 1, v: atEnd[name] });
    const r = keys.filter((k) => k.t >= o).map((k) => ({ ...k, t: k.t - o }));
    if (!r.some((k) => k.t === 0)) r.unshift({ t: 0, v: atStart[name] });
    left.props[name] = l;
    right.props[name] = r;
  }
  return [left, right];
}

/**
 * Divide fr[i] no quadro `frame`. O trecho novo começa mostrando o mesmo que antes
 * (pose do tween, câmera); com blank = true ele começa vazio.
 */
function splitSpan(fr, i, frame, { blank = false, keepTween = true } = {}) {
  const s = fr[i];
  const o = frame - s.start;
  const end = s.start + s.duration;
  const span = { start: frame, duration: end - frame, elements: blank ? [] : cloneElementsWithNewIds(poseAt(fr, i, o)) };
  if (!blank) {
    if (s.camera) span.camera = cameraAtSpan(fr, i, o);
    if (s.tween && keepTween) {
      if (s.tween.type === 'motion') {
        const [l, r] = splitMotion(s, o);
        s.tween = l;
        span.tween = r;
        span.elements[0] = { ...span.elements[0] };
      } else {
        span.tween = clone(s.tween);
        delete span.tween.hints; // as dicas de forma valem para o par original
      }
    }
  } else if (s.camera) span.camera = cameraAtSpan(fr, i, o);
  s.duration = o;
  fr.splice(i + 1, 0, span);
  return span;
}

/** F5: insere quadro(s) no trecho do quadro, ou estende a camada até ele. */
export function insertFrames(frames, frame, count = 1) {
  const fr = clone(frames);
  const len = lengthOf(fr);
  if (frame >= len) {
    fr[fr.length - 1].duration += frame + 1 - len;
  } else {
    fr[indexAt(fr, frame)].duration += count;
  }
  return { frames: normalize(fr), frame };
}

/** Garante um keyframe em `frame` (dentro ou depois da ponta). Devolve true se criou. */
function splitAt(fr, frame, blank) {
  const len = lengthOf(fr);
  if (frame >= len) {
    const li = fr.length - 1;
    const last = fr[li];
    const pose = blank ? [] : cloneElementsWithNewIds(poseAt(fr, li, last.duration - 1));
    const cam = last.camera ? cameraAtSpan(fr, li, last.duration - 1) : undefined;
    last.duration += frame - len;
    const span = { start: frame, duration: 1, elements: pose };
    if (cam) span.camera = cam;
    fr.push(span);
    return true;
  }
  const i = indexAt(fr, frame);
  if (fr[i].start === frame) return false;
  splitSpan(fr, i, frame, { blank });
  return true;
}

/**
 * Insere keyframe no quadro. Se já houver keyframe ali, tenta o quadro seguinte
 * (como no editor clássico: apertar F6 repetidas vezes vai avançando).
 */
function insertKeyframeLike(frames, frame, blank) {
  const fr = clone(frames);
  const i = indexAt(fr, frame);
  if (i >= 0 && fr[i].start === frame) {
    const next = frame + 1;
    const j = indexAt(fr, next);
    if (j >= 0 && fr[j].start === next) return null; // próximo já é keyframe
    const ok = splitAt(fr, next, blank);
    return ok ? { frames: normalize(fr), frame: next } : null;
  }
  splitAt(fr, frame, blank);
  return { frames: normalize(fr), frame };
}

/**
 * F6: keyframe com cópia do conteúdo anterior. Dentro de um tween, copia a pose interpolada
 * naquele quadro e o tween continua dos dois lados.
 */
export function insertKeyframe(frames, frame) {
  return insertKeyframeLike(frames, frame, false);
}

/** F7: keyframe vazio. */
export function insertBlankKeyframe(frames, frame) {
  return insertKeyframeLike(frames, frame, true);
}

/** Shift+F5: remove um quadro. A camada sempre mantém pelo menos um quadro. */
export function removeFrames(frames, frame, count = 1) {
  const fr = clone(frames);
  const i = indexAt(fr, frame);
  if (i < 0) return null;
  fr[i].duration -= count;
  if (fr[i].duration <= 0) fr.splice(i, 1);
  if (!fr.length) fr.push({ start: 0, duration: 1, elements: [] });
  normalize(fr);
  return { frames: fr, frame: Math.min(frame, lengthOf(fr) - 1) };
}

/** Shift+F6: apaga o keyframe; os quadros passam a segurar o keyframe anterior. */
export function clearKeyframe(frames, frame) {
  const fr = clone(frames);
  const i = indexAt(fr, frame);
  if (i < 0 || fr[i].start !== frame) return null;
  if (i === 0) {
    if (!fr[0].elements.length) return null;
    fr[0].elements = [];
  } else {
    fr[i - 1].duration += fr[i].duration;
    fr.splice(i, 1);
  }
  return { frames: normalize(fr), frame };
}

/**
 * Garante que dá para desenhar no quadro: se ele está depois do fim da camada,
 * estende a camada e cria um keyframe vazio ali. Dentro da camada, desenhar edita
 * o keyframe que segura aquele quadro, então nada muda.
 */
export function ensureDrawable(frames, frame) {
  if (frame < lengthOf(frames)) return null;
  const fr = clone(frames);
  splitAt(fr, frame, true);
  return { frames: normalize(fr), frame };
}

// ---------- intervalos de quadros (copiar, colar, remover, inverter, converter) ----------
// from e to são inclusivos.

/** Cópia com keyframes garantidos em from e em to+1 (sem mudar o que aparece). */
export function splitRange(frames, from, to) {
  const fr = clone(frames);
  if (from < lengthOf(fr)) splitAt(fr, from, false);
  if (to + 1 < lengthOf(fr)) splitAt(fr, to + 1, false);
  return normalize(fr);
}

/** Trechos do intervalo, começando em 0 (para a área de transferência de quadros). */
export function extractRange(frames, from, to) {
  const len = lengthOf(frames);
  if (from >= len) return [{ start: 0, duration: to - from + 1, elements: [] }];
  const fr = splitRange(frames, from, Math.min(to, len - 1));
  const out = fr.filter((s) => s.start >= from && s.start <= to).map((s) => ({ ...s, start: s.start - from }));
  // um tween que aponta para fora do intervalo vira quebrado: tira para não enganar
  const last = out[out.length - 1];
  if (last?.tween && last.tween.type !== 'motion') delete last.tween;
  const got = lengthOf(out);
  if (got < to - from + 1) out.push({ start: got, duration: to - from + 1 - got, elements: [] });
  return normalize(out);
}

/** Remove o intervalo e puxa o resto para a esquerda. */
export function removeRange(frames, from, to) {
  const len = lengthOf(frames);
  if (from >= len) return null;
  const fr = splitRange(frames, from, Math.min(to, len - 1));
  const kept = fr.filter((s) => s.start < from || s.start > to);
  if (!kept.length) kept.push({ start: 0, duration: 1, elements: [] });
  normalize(kept);
  return { frames: kept, frame: Math.min(from, lengthOf(kept) - 1) };
}

/** Cola trechos (de extractRange) a partir de `at`, empurrando o resto para a direita. */
export function insertSpans(frames, at, slice, { overwrite = false } = {}) {
  let fr = clone(frames);
  const n = lengthOf(slice);
  if (overwrite) fr = removeRange(fr, at, at + n - 1)?.frames || fr;
  const len = lengthOf(fr);
  if (at > len) fr[fr.length - 1].duration += at - len;
  else if (at < len) splitAt(fr, at, false);
  normalize(fr);
  const i = at >= lengthOf(fr) ? fr.length : fr.findIndex((s) => s.start === at);
  const pasted = slice.map((s) => ({ ...clone(s), elements: cloneElementsWithNewIds(s.elements) }));
  fr.splice(i, 0, ...pasted);
  return { frames: normalize(fr), frame: at };
}

/** Inverte a ordem dos quadros do intervalo (quadros de tween viram keyframes com a pose). */
export function reverseRange(frames, from, to) {
  const len = lengthOf(frames);
  to = Math.min(to, len - 1);
  if (to <= from) return null;
  const perFrame = [];
  for (let f = from; f <= to; f++) {
    const i = indexAt(frames, f);
    const s = frames[i];
    const o = f - s.start;
    const animated = s.tween && (s.tween.type === 'motion' || frames[i + 1]) && (o > 0 || s.tween.type === 'motion');
    perFrame.push({ key: animated ? `${i}:${o}` : `${i}`, i, o });
  }
  perFrame.reverse();
  const built = [];
  for (const p of perFrame) {
    const last = built[built.length - 1];
    if (last && last.key === p.key) {
      last.duration++;
      continue;
    }
    const span = { start: 0, duration: 1, elements: cloneElementsWithNewIds(poseAt(frames, p.i, p.o)), key: p.key };
    const cam = cameraAtSpan(frames, p.i, p.o);
    if (cam) span.camera = cam;
    built.push(span);
  }
  for (const s of built) delete s.key;
  const fr = splitRange(frames, from, to);
  const before = fr.filter((s) => s.start < from), after = fr.filter((s) => s.start > to);
  return { frames: normalize([...before, ...built, ...after]), frame: from };
}

/** F6/F7 num intervalo: cada quadro vira keyframe (com a pose, ou vazio). */
export function convertRange(frames, from, to, blank = false) {
  const fr = clone(frames);
  for (let f = from; f <= to; f++) {
    const i = indexAt(fr, f);
    if (i >= 0 && fr[i].start === f) {
      if (blank) fr[i].elements = [];
      continue;
    }
    splitAt(fr, f, blank);
    normalize(fr);
  }
  return { frames: normalize(fr), frame: from };
}

// ---------- arrastar na timeline ----------

const isBlankSpan = (s) => !s.elements.length && !s.tween && !s.label && !s.script && !s.sound && !s.armature && !s.camera;

/**
 * Arrasta o keyframe que começa em `start` para `to`. Ele não passa por cima dos vizinhos:
 * o trecho anterior estica ou encolhe, e o fim do trecho fica onde está (se houver keyframe depois).
 * O primeiro keyframe arrastado para a direita deixa quadros vazios antes dele.
 */
export function moveKeyframe(frames, start, to) {
  const fr = clone(frames);
  const i = fr.findIndex((s) => s.start === start);
  if (i < 0) return null;
  const s = fr[i], prev = fr[i - 1], next = fr[i + 1];
  // um vazio que só existe por causa de um arraste anterior pode sumir
  const blankLead = i === 1 && prev && isBlankSpan(prev);
  const lo = prev ? (blankLead ? 0 : prev.start + 1) : 0;
  const hi = next ? next.start - 1 : Infinity;
  const ns = Math.max(lo, Math.min(hi, Math.round(to)));
  if (ns === start) return null;
  if (next) s.duration = next.start - ns;
  if (prev) {
    if (ns === 0) fr.splice(i - 1, 1);
    else prev.duration = ns - prev.start;
  } else if (ns > 0) fr.unshift({ start: 0, duration: ns, elements: [] });
  return { frames: normalize(fr), frame: ns };
}

/** Troca os quadros do intervalo por um trecho vazio (o resto não anda). */
export function blankRange(frames, from, to) {
  const len = lengthOf(frames);
  if (from >= len) return clone(frames);
  const t = Math.min(to, len - 1);
  const fr = splitRange(frames, from, t);
  const before = fr.filter((s) => s.start < from), after = fr.filter((s) => s.start > t);
  // o tween que apontava para dentro do intervalo perde o destino
  const last = before[before.length - 1];
  if (last?.tween && last.tween.type !== 'motion' && !after.length) delete last.tween;
  return normalize([...before, { start: from, duration: t - from + 1, elements: [] }, ...after]);
}

/**
 * Arrasta os quadros do intervalo `delta` quadros para o lado: eles substituem o que está no
 * destino e deixam quadros vazios onde estavam (copy: deixa os originais).
 */
export function moveRange(frames, from, to, delta, { copy = false } = {}) {
  const dest = Math.max(0, from + Math.round(delta));
  if (dest === from && !copy) return null;
  const slice = extractRange(frames, from, to);
  const base = copy ? clone(frames) : blankRange(frames, from, to);
  const r = insertSpans(base, dest, slice, { overwrite: true });
  return { frames: r.frames, frame: dest };
}
