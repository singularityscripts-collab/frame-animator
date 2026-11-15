// Malhas: desenhar uma imagem deformada (triângulo a triângulo), deformação por pinos (MLS rígido)
// e subdivisão de curvas. Base da malha de pinos, do 3D, do pincel de arte e do envelope.

/** Desenha o triângulo s0-s1-s2 da imagem no triângulo d0-d1-d2 (no espaço atual do ctx). */
export function drawTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
  const den = s0.x * (s2.y - s1.y) - s1.x * s2.y + s2.x * s1.y + (s1.x - s2.x) * s0.y;
  if (!den) return;
  const a = -(s0.y * (d2.x - d1.x) - s1.y * d2.x + s2.y * d1.x + (s1.y - s2.y) * d0.x) / den;
  const b = -(s0.y * (d2.y - d1.y) - s1.y * d2.y + s2.y * d1.y + (s1.y - s2.y) * d0.y) / den;
  const c = (s0.x * (d2.x - d1.x) - s1.x * d2.x + s2.x * d1.x + (s1.x - s2.x) * d0.x) / den;
  const d = (s0.x * (d2.y - d1.y) - s1.x * d2.y + s2.x * d1.y + (s1.x - s2.x) * d0.y) / den;
  const e = (s0.x * (s2.y * d1.x - s1.y * d2.x) + s0.y * (s1.x * d2.x - s2.x * d1.x) + (s2.x * s1.y - s1.x * s2.y) * d0.x) / den;
  const f = (s0.x * (s2.y * d1.y - s1.y * d2.y) + s0.y * (s1.x * d2.y - s2.x * d1.y) + (s2.x * s1.y - s1.x * s2.y) * d0.y) / den;
  // aumenta um pouco o triângulo de destino para não aparecer fresta entre os vizinhos
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p) => {
    const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1;
    const k = 0.6 / l;
    return { x: p.x + dx * k, y: p.y + dy * k };
  };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y);
  ctx.lineTo(g1.x, g1.y);
  ctx.lineTo(g2.x, g2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Desenha a imagem (região src: x, y, w, h em pixels da imagem) numa grade deformada.
 * map(u, v) → ponto de destino, com u e v de 0 a 1.
 */
export function drawMesh(ctx, img, src, map, cols = 10, rows = 10) {
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, v = j / rows;
      pts.push({ s: { x: src.x + u * src.w, y: src.y + v * src.h }, d: map(u, v) });
    }
  }
  const at = (i, j) => pts[j * (cols + 1) + i];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p00 = at(i, j), p10 = at(i + 1, j), p01 = at(i, j + 1), p11 = at(i + 1, j + 1);
      drawTriangle(ctx, img, p00.s, p10.s, p11.s, p00.d, p10.d, p11.d);
      drawTriangle(ctx, img, p00.s, p11.s, p01.s, p00.d, p11.d, p01.d);
    }
  }
}

// ---------- malha de pinos: Moving Least Squares rígido ----------
/**
 * pins: [{ x, y, dx, dy }] (posição de descanso e deslocamento).
 * Devolve onde o ponto (x, y) vai parar.
 */
export function mlsPoint(pins, x, y) {
  const n = pins.length;
  if (!n) return { x, y };
  if (n === 1) return { x: x + pins[0].dx, y: y + pins[0].dy };
  let sw = 0, px = 0, py = 0, qx = 0, qy = 0;
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pins[i];
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < 1e-9) return { x: p.x + p.dx, y: p.y + p.dy };
    w[i] = 1 / d2;
    sw += w[i];
    px += w[i] * p.x;
    py += w[i] * p.y;
    qx += w[i] * (p.x + p.dx);
    qy += w[i] * (p.y + p.dy);
  }
  px /= sw;
  py /= sw;
  qx /= sw;
  qy /= sw;
  const vx = x - px, vy = y - py;
  let fx = 0, fy = 0;
  for (let i = 0; i < n; i++) {
    const p = pins[i];
    const phx = p.x - px, phy = p.y - py;
    const qhx = p.x + p.dx - qx, qhy = p.y + p.dy - qy;
    // [ph; -ph⊥] · [v; -v⊥]^T   (⊥ gira 90°)
    const m00 = phx * vx + phy * vy;
    const m01 = phx * vy - phy * vx;
    const m10 = -m01;
    const m11 = m00;
    fx += w[i] * (qhx * m00 + qhy * m10);
    fy += w[i] * (qhx * m01 + qhy * m11);
  }
  const len = Math.hypot(fx, fy);
  const vl = Math.hypot(vx, vy);
  if (len < 1e-9) return { x: qx + vx, y: qy + vy };
  return { x: qx + (fx / len) * vl, y: qy + (fy / len) * vl };
}

/** Divide cada curva em `k` pedaços (para deformar com mais fidelidade). */
export function subdivideSub(sp, k = 3) {
  const pts = sp.pts;
  const n = pts.length;
  if (n < 2) return sp;
  const out = [];
  const segs = sp.closed ? n : n - 1;
  let first = [...pts[0]];
  out.push(first);
  for (let i = 0; i < segs; i++) {
    const a = out[out.length - 1];
    const bSrc = pts[(i + 1) % n];
    const P0 = [a[0], a[1]], P1 = [a[0] + a[4], a[1] + a[5]], P2 = [bSrc[0] + bSrc[2], bSrc[1] + bSrc[3]], P3 = [bSrc[0], bSrc[1]];
    let c = [P0, P1, P2, P3];
    let prev = a;
    for (let m = k; m >= 1; m--) {
      const t = 1 / m;
      const L = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const q0 = L(c[0], c[1]), q1 = L(c[1], c[2]), q2 = L(c[2], c[3]);
      const r0 = L(q0, q1), r1 = L(q1, q2);
      const s = L(r0, r1);
      if (m === 1) {
        prev[4] = c[1][0] - c[0][0];
        prev[5] = c[1][1] - c[0][1];
        if (sp.closed && i === segs - 1) {
          first[2] = c[2][0] - c[3][0];
          first[3] = c[2][1] - c[3][1];
        } else {
          out.push([c[3][0], c[3][1], c[2][0] - c[3][0], c[2][1] - c[3][1], bSrc[4], bSrc[5]]);
        }
      } else {
        prev[4] = q0[0] - c[0][0];
        prev[5] = q0[1] - c[0][1];
        const np = [s[0], s[1], r0[0] - s[0], r0[1] - s[1], 0, 0];
        out.push(np);
        prev = np;
        c = [s, r1, q2, c[3]];
      }
    }
  }
  return { closed: sp.closed, pts: out };
}

/** Caminho deformado pela malha de pinos (âncoras e alças passam pelo MLS). */
export function warpPathPts(sp, pins) {
  return {
    closed: sp.closed,
    pts: sp.pts.map((q) => {
      const p = mlsPoint(pins, q[0], q[1]);
      const hi = mlsPoint(pins, q[0] + q[2], q[1] + q[3]);
      const ho = mlsPoint(pins, q[0] + q[4], q[1] + q[5]);
      return [p.x, p.y, q[2] || q[3] ? hi.x - p.x : 0, q[2] || q[3] ? hi.y - p.y : 0, q[4] || q[5] ? ho.x - p.x : 0, q[4] || q[5] ? ho.y - p.y : 0];
    }),
  };
}
