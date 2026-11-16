// Áudio: agenda dos sons (evento, iniciar, parar, stream), reprodução, scrub e mixagem para o export.
// A agenda é uma função pura (testável); a reprodução usa Web Audio.
//
// som no keyframe: span.sound = { id, sync: 'event'|'start'|'stop'|'stream', loops, volume (0-100),
//                                 pan (-100 a 100), fadeIn (s), fadeOut (s) }
// biblioteca: doc.library.sounds = [{ id, name, folderId, mime, data (base64), duration (s) }]

export function soundById(doc, id) {
  return doc.library?.sounds?.find((s) => s.id === id) || null;
}

/** Keyframes com som numa cena (camadas guia não tocam). */
function soundSpans(scene) {
  const out = [];
  for (const layer of scene.layers) {
    if (layer.type === 'guide' || layer.type === 'folder') continue;
    for (const span of layer.frames) if (span.sound?.id) out.push({ layer, span });
  }
  return out.sort((a, b) => a.span.start - b.span.start);
}

/**
 * Agenda de uma cena entre os quadros from e to (inclusive), em segundos a partir de `from`.
 * Devolve [{ soundId, at, offset, until, volume, pan, fadeIn, fadeOut, sync }].
 */
export function sceneSchedule(doc, scene, from, to, fps) {
  const entries = [];
  const dur = (id) => soundById(doc, id)?.duration || 0;
  for (const { span } of soundSpans(scene)) {
    const snd = span.sound;
    const base = {
      soundId: snd.id,
      volume: (snd.volume ?? 100) / 100,
      pan: (snd.pan ?? 0) / 100,
      fadeIn: Math.max(0, snd.fadeIn || 0),
      fadeOut: Math.max(0, snd.fadeOut || 0),
      sync: snd.sync || 'event',
    };
    const start = span.start, end = span.start + span.duration;
    const at = (start - from) / fps;
    if (base.sync === 'stream') {
      // stream: preso à timeline; toca enquanto o trecho estiver na tela
      if (end <= from || start > to) continue;
      const offset = Math.max(0, from - start) / fps;
      if (offset >= dur(snd.id) * Math.max(1, snd.loops || 1)) continue;
      entries.push({ ...base, at: Math.max(0, at), offset, until: Math.min((end - from) / fps, Math.max(0, at) + dur(snd.id) * Math.max(1, snd.loops || 1) - offset) });
    } else if (base.sync === 'stop') {
      if (start < from || start > to) continue;
      for (const e of entries) if (e.soundId === snd.id && e.until > at && e.at <= at) e.until = at;
    } else {
      // evento / iniciar: dispara quando a agulha chega no keyframe e toca até o fim
      if (start < from || start > to) continue;
      const length = dur(snd.id) * Math.max(1, snd.loops || 1);
      if (base.sync === 'start' && entries.some((e) => e.soundId === snd.id && e.at <= at && e.until > at)) continue;
      entries.push({ ...base, at, offset: 0, until: at + length });
    }
  }
  return entries.sort((a, b) => a.at - b.at);
}

/** Agenda do filme a partir de um ponto: segments = [{ sceneIndex, from, to }] em sequência. */
export function movieSchedule(doc, segments) {
  const out = [];
  let t = 0;
  for (const seg of segments) {
    const scene = doc.scenes[seg.sceneIndex];
    for (const e of sceneSchedule(doc, scene, seg.from, seg.to, doc.fps)) out.push({ ...e, at: e.at + t, until: e.until + t });
    t += (seg.to - seg.from + 1) / doc.fps;
  }
  return out;
}

// ---------- decodificar ----------
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const decodeCache = new Map(); // id → Promise<AudioBuffer>

export function decodeSound(actx, snd) {
  const key = `${snd.id}:${snd.data.length}`;
  if (!decodeCache.has(key)) {
    decodeCache.set(
      key,
      actx.decodeAudioData(base64ToBytes(snd.data).buffer).catch((err) => {
        decodeCache.delete(key);
        throw err;
      }),
    );
  }
  return decodeCache.get(key);
}

/** Picos para desenhar a forma de onda: `rate` picos por segundo (0 a 1). */
export function computePeaks(buffer, rate = 200) {
  const n = Math.max(1, Math.ceil(buffer.duration * rate));
  const per = buffer.length / n;
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * per), b = Math.min(buffer.length, Math.floor((i + 1) * per));
    for (const ch of chans) for (let j = a; j < b; j += 4) m = Math.max(m, Math.abs(ch[j]));
    peaks[i] = m;
  }
  return { peaks, rate };
}

// ---------- tocar uma agenda num AudioContext (ao vivo ou offline) ----------
function scheduleInto(actx, dest, buffers, entries, t0) {
  const nodes = [];
  for (const e of entries) {
    const buf = buffers.get(e.soundId);
    if (!buf) continue;
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = e.until - e.at > buf.duration - e.offset + 1e-3;
    const gain = actx.createGain();
    const pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    src.connect(gain);
    if (pan) {
      pan.pan.value = Math.max(-1, Math.min(1, e.pan));
      gain.connect(pan).connect(dest);
    } else gain.connect(dest);
    const start = t0 + e.at, end = t0 + e.until;
    const v = e.volume;
    // fade in/out (o fade in conta do começo do som, não do ponto em que o stream entrou)
    const inLeft = Math.max(0, e.fadeIn - e.offset);
    gain.gain.setValueAtTime(inLeft > 0 ? (v * (e.fadeIn - inLeft)) / (e.fadeIn || 1) : v, start);
    if (inLeft > 0) gain.gain.linearRampToValueAtTime(v, start + inLeft);
    if (e.fadeOut > 0 && end - e.fadeOut > start) {
      gain.gain.setValueAtTime(v, Math.max(start + inLeft, end - e.fadeOut));
      gain.gain.linearRampToValueAtTime(0, end);
    }
    src.start(Math.max(start, actx.currentTime), e.offset % buf.duration);
    src.stop(end);
    nodes.push(src);
  }
  return nodes;
}

/** Reprodução ao vivo (editor e janela de teste). */
export class AudioEngine {
  constructor() {
    this.actx = null;
    this.nodes = [];
    this.token = 0;
  }
  ctx() {
    if (!this.actx) this.actx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (this.actx.state === 'suspended') this.actx.resume();
    return this.actx;
  }
  async buffersFor(doc, entries) {
    const actx = this.ctx();
    const map = new Map();
    for (const id of new Set(entries.map((e) => e.soundId))) {
      const snd = soundById(doc, id);
      if (snd) {
        try {
          map.set(id, await decodeSound(actx, snd));
        } catch (err) {
          console.warn('Som não decodificado', snd.name, err);
        }
      }
    }
    return map;
  }
  /** Toca a partir de agora. entries com `at` em segundos relativos a este momento. */
  async play(doc, entries) {
    this.stop();
    if (!entries.length) return;
    const token = ++this.token;
    const actx = this.ctx();
    const t0 = actx.currentTime;
    const buffers = await this.buffersFor(doc, entries);
    if (token !== this.token) return;
    // se a decodificação demorou, compensa o atraso
    const late = actx.currentTime - t0;
    const shifted = entries
      .map((e) => (e.at < late ? { ...e, offset: e.offset + (late - e.at), at: late } : e))
      .filter((e) => e.until > e.at);
    this.nodes = scheduleInto(actx, actx.destination, buffers, shifted, t0);
  }
  /** Toca mais sons sem parar os que já estão tocando (runtime interativo). */
  async add(doc, entries) {
    if (!entries.length) return;
    const actx = this.ctx();
    const t0 = actx.currentTime;
    const buffers = await this.buffersFor(doc, entries);
    this.nodes.push(...scheduleInto(actx, actx.destination, buffers, entries, t0));
  }
  stop() {
    this.token++;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        // já tinha parado
      }
    }
    this.nodes = [];
  }
  /** Scrub: um pedacinho dos sons stream no quadro (ao arrastar a agulha). */
  async scrub(doc, scene, frame) {
    const entries = sceneSchedule(doc, scene, frame, frame, doc.fps)
      .filter((e) => e.sync === 'stream')
      .map((e) => ({ ...e, until: e.at + Math.max(1 / doc.fps, 0.06), fadeOut: 0.02, fadeIn: 0 }));
    if (entries.length) await this.play(doc, entries);
  }
}

/** Mixa a agenda num arquivo WAV (para juntar ao vídeo no export). Devolve ArrayBuffer ou null. */
export async function mixdownWav(doc, entries, seconds, sampleRate = 48000) {
  if (!entries.length || seconds <= 0) return null;
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const actx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
  const buffers = new Map();
  for (const id of new Set(entries.map((e) => e.soundId))) {
    const snd = soundById(doc, id);
    if (snd) buffers.set(id, await decodeSound(actx, snd));
  }
  scheduleInto(actx, actx.destination, buffers, entries, 0);
  const out = await actx.startRendering();
  return encodeWav(out);
}

export function encodeWav(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const n = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return data.buffer;
}
