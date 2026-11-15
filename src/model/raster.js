// Balde de tinta: preenche a área fechada sob o clique numa máscara de pixels e devolve os contornos.
// Funções puras sobre arrays (testáveis no Node). Quem desenha a máscara é a ferramenta do balde.

/**
 * Engorda a máscara em `r` pixels. Por padrão alterna cruz e quadrado (fica arredondado);
 * com square = true usa sempre as 8 direções (alcança cantos).
 */
export function dilate(mask, w, h, r, square = false) {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const next = new Uint8Array(cur);
    const diag = square || k % 2 === 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) continue;
        if (
          (x > 0 && cur[i - 1]) ||
          (x < w - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - w]) ||
          (y < h - 1 && cur[i + w]) ||
          (diag &&
            ((x > 0 && y > 0 && cur[i - w - 1]) ||
              (x < w - 1 && y > 0 && cur[i - w + 1]) ||
              (x > 0 && y < h - 1 && cur[i + w - 1]) ||
              (x < w - 1 && y < h - 1 && cur[i + w + 1])))
        ) {
          next[i] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Preenche a partir de (sx, sy).
 * ink: 1 onde há traço/forma. gap: quantos pixels de lacuna fechar.
 * Devolve { status: 'ok', region } | { status: 'ink' } (clicou em cima de algo) | { status: 'open' } (área não fechada).
 */
export function floodFill(ink, w, h, sx, sy, gap = 0) {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { status: 'open' };
  const blocked = gap > 0 ? dilate(ink, w, h, gap) : ink;
  if (blocked[sy * w + sx]) return { status: 'ink' };

  const region = new Uint8Array(w * h);
  const stack = [sx, sy];
  let open = false;
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    let i = y * w + x;
    if (region[i] || blocked[i]) continue;
    while (x > 0 && !blocked[i - 1] && !region[i - 1]) {
      x--;
      i--;
    }
    let up = false, down = false;
    for (; x < w && !blocked[i] && !region[i]; x++, i++) {
      region[i] = 1;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) open = true;
      if (y > 0) {
        const u = !blocked[i - w] && !region[i - w];
        if (u && !up) stack.push(x, y - 1);
        up = u;
      }
      if (y < h - 1) {
        const d = !blocked[i + w] && !region[i + w];
        if (d && !down) stack.push(x, y + 1);
        down = d;
      }
    }
    if (open) return { status: 'open' };
  }

  // volta a ocupar a faixa que a lacuna "engordou" (sem atravessar o traço) e entra um pouco por baixo dele
  let grown = region;
  if (gap > 0) {
    const halo = new Uint8Array(w * h);
    for (let i = 0; i < halo.length; i++) halo[i] = blocked[i] && !ink[i] ? 1 : 0;
    for (let k = 0; k < gap; k++) {
      const d = dilate(grown, w, h, 1, true);
      for (let i = 0; i < d.length; i++) if (d[i] && !grown[i] && !halo[i]) d[i] = 0;
      grown = d;
    }
  }
  const under = dilate(grown, w, h, 2, true);
  for (let i = 0; i < under.length; i++) if (under[i] && !grown[i] && !ink[i]) under[i] = 0;
  return { status: 'ok', region: under };
}

/**
 * Contornos da região (bordas dos pixels), como polígonos em coordenadas de pixel.
 * Contornos externos saem num sentido e furos no outro, então "nonzero" preenche certo.
 */
export function traceContours(region, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && region[y * w + x] === 1;
  // arestas dirigidas: a região fica sempre à direita de quem anda (sentido horário na tela)
  const out = new Map(); // "x,y" → [[x2,y2], ...]
  const add = (x1, y1, x2, y2) => {
    const k = x1 + ',' + y1;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([x2, y2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const [startKey, list] of out) {
    while (list.length) {
      const [sx, sy] = startKey.split(',').map(Number);
      const loop = [{ x: sx, y: sy }];
      let px = sx, py = sy;
      let [nx, ny] = list.pop();
      let guard = 0;
      while (!(nx === sx && ny === sy) && guard++ < 4 * w * h) {
        loop.push({ x: nx, y: ny });
        const k = nx + ',' + ny;
        const cands = out.get(k);
        if (!cands || !cands.length) break;
        // em cantos que se tocam na diagonal, vira à direita (mantém as partes separadas)
        let pick = 0;
        if (cands.length > 1) {
          const dx = nx - px, dy = ny - py;
          const right = [-dy, dx];
          const j = cands.findIndex(([cx, cy]) => cx - nx === right[0] && cy - ny === right[1]);
          if (j >= 0) pick = j;
        }
        const [tx, ty] = cands.splice(pick, 1)[0];
        px = nx;
        py = ny;
        nx = tx;
        ny = ty;
      }
      if (loop.length >= 4) loops.push(collinear(loop));
    }
  }
  return loops;
}

/** Tira pontos no meio de trechos retos. */
function collinear(loop) {
  const n = loop.length;
  const res = [];
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) res.push(b);
  }
  return res;
}

/** Área com sinal de um polígono (para descartar contornos minúsculos). */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return a / 2;
}
