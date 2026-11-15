// Lip-sync automático: analisa a voz quadro a quadro e escolhe a boca (visema).
// Medidas por quadro: volume (RMS), cruzamentos por zero e energia em faixas de frequência (FFT).
// É uma classificação acústica simples (sem reconhecer palavras), suficiente para animar a boca.

export const VISEMES = {
  rest: 'Repouso (boca fechada)',
  MBP: 'M, B, P (lábios juntos)',
  A: 'A (bem aberta)',
  E: 'E, I (aberta, larga)',
  O: 'O (redonda)',
  U: 'U, W (bico)',
  L: 'L, D, T, N (meio aberta)',
  FV: 'F, V (dente no lábio)',
  S: 'S, Z, CH (dentes juntos)',
};

/** FFT in-place (radix 2). re/im: Float64Array de tamanho potência de 2. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Medidas por quadro de vídeo. */
export function frameFeatures(samples, sampleRate, fps) {
  const hop = sampleRate / fps;
  const N = 1024;
  const frames = Math.ceil(samples.length / hop);
  const re = new Float64Array(N), im = new Float64Array(N);
  const bands = [
    [80, 400],
    [400, 900],
    [900, 1800],
    [1800, 3500],
    [3500, 8000],
  ];
  const out = [];
  for (let f = 0; f < frames; f++) {
    const c = Math.floor(f * hop + hop / 2);
    const s0 = Math.max(0, c - N / 2);
    let sum = 0, zc = 0, prev = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[s0 + i] || 0;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); // janela de Hann
      re[i] = v * w;
      im[i] = 0;
      sum += v * v;
      if (i && (v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    fft(re, im);
    const be = bands.map(() => 0);
    let total = 0, centroid = 0;
    for (let k = 1; k < N / 2; k++) {
      const hz = (k * sampleRate) / N;
      const p = re[k] * re[k] + im[k] * im[k];
      total += p;
      centroid += p * hz;
      bands.forEach(([lo, hi], b) => {
        if (hz >= lo && hz < hi) be[b] += p;
      });
    }
    const bsum = be.reduce((a, b) => a + b, 0) || 1;
    out.push({ rms: Math.sqrt(sum / N), zcr: zc / N, centroid: total ? centroid / total : 0, bands: be.map((b) => b / bsum) });
  }
  return out;
}

/** Visema de um quadro a partir das medidas (limiar de silêncio relativo ao volume da fala). */
export function classify(ft, silence) {
  if (ft.rms < silence) return 'rest';
  const [b0, b1, b2, b3, b4] = ft.bands;
  const noisy = ft.zcr > 0.18 || b4 > 0.35;
  if (noisy) return b4 > 0.5 || ft.centroid > 4000 ? 'S' : 'FV';
  if (b0 > 0.6 && b2 + b3 < 0.12) return ft.rms < silence * 4 ? 'U' : 'O';
  if (b3 + b4 > 0.3) return 'E';
  if (b1 + b2 > 0.5) return 'A';
  if (b0 > 0.45) return 'O';
  return 'L';
}

/**
 * Analisa o som e devolve trechos { at, length, viseme } (em quadros, a partir do 0).
 * opts.minLength: duração mínima de um trecho (quadros).
 */
export function analyzeLipSync(samples, sampleRate, fps, opts = {}) {
  const minLength = opts.minLength ?? 2;
  const fts = frameFeatures(samples, sampleRate, fps);
  if (!fts.length) return [];
  const sorted = fts.map((f) => f.rms).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const silence = Math.max(0.005, loud * (opts.silence ?? 0.12));
  let vis = fts.map((f) => classify(f, silence));
  // M/B/P: queda curta de volume no meio da fala
  for (let i = 1; i < fts.length - 1; i++) {
    if (vis[i] === 'rest' || vis[i - 1] === 'rest' || vis[i + 1] === 'rest') continue;
    if (fts[i].rms < 0.45 * Math.min(fts[i - 1].rms, fts[i + 1].rms)) vis[i] = 'MBP';
  }
  // mediana de 3 (tira tremidas), sem apagar MBP
  vis = vis.map((v, i) => {
    if (v === 'MBP' || i === 0 || i === vis.length - 1) return v;
    const a = vis[i - 1], b = vis[i + 1];
    return a === b && a !== v ? a : v;
  });
  // junta em trechos e absorve os curtos demais no anterior
  const segs = [];
  vis.forEach((v, i) => {
    const last = segs[segs.length - 1];
    if (last && last.viseme === v) last.length++;
    else segs.push({ at: i, length: 1, viseme: v });
  });
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.length < minLength && s.viseme !== 'MBP') last.length += s.length;
    else if (last && last.viseme === s.viseme) last.length += s.length;
    else merged.push({ ...s });
  }
  return merged;
}
