// Operações de timeline sobre a lista de trechos de uma camada.
// Invariante: os trechos são contíguos a partir do quadro 0, sem buracos.
// Todas as funções são puras: recebem frames e devolvem { frames, frame } novos
// (frame = quadro para onde a agulha deve ir), ou null se nada mudou.

import { clone, cloneElementsWithNewIds } from './document.js';

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

function splitAt(fr, frame, elementsFor) {
  const len = lengthOf(fr);
  if (frame >= len) {
    const last = fr[fr.length - 1];
    last.duration += frame - len;
    fr.push({ start: frame, duration: 1, elements: elementsFor(last) });
    return true;
  }
  const i = indexAt(fr, frame);
  const s = fr[i];
  if (s.start === frame) return false;
  const end = s.start + s.duration;
  s.duration = frame - s.start;
  fr.splice(i + 1, 0, { start: frame, duration: end - frame, elements: elementsFor(s) });
  return true;
}

/**
 * Insere keyframe no quadro. Se já houver keyframe ali, tenta o quadro seguinte
 * (como no Animate: apertar F6 repetidas vezes vai avançando).
 */
function insertKeyframeLike(frames, frame, elementsFor) {
  const fr = clone(frames);
  const i = indexAt(fr, frame);
  if (i >= 0 && fr[i].start === frame) {
    const next = frame + 1;
    const j = indexAt(fr, next);
    if (j >= 0 && fr[j].start === next) return null; // próximo já é keyframe
    const src = fr[i];
    const ok = splitAt(fr, next, () => elementsFor(src));
    return ok ? { frames: normalize(fr), frame: next } : null;
  }
  splitAt(fr, frame, elementsFor);
  return { frames: normalize(fr), frame };
}

/** F6: keyframe com cópia do conteúdo anterior. */
export function insertKeyframe(frames, frame) {
  return insertKeyframeLike(frames, frame, (src) => cloneElementsWithNewIds(src.elements));
}

/** F7: keyframe vazio. */
export function insertBlankKeyframe(frames, frame) {
  return insertKeyframeLike(frames, frame, () => []);
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
  splitAt(fr, frame, () => []);
  return { frames: normalize(fr), frame };
}
