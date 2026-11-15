// Ossos (cinemática inversa): esqueleto guardado no keyframe, pose = giro de cada osso.
// armature = { bones: [{ id, parentId, x, y, angle, length }], pose: { [id]: giro extra em radianos } }
// x, y só valem para ossos raiz; a cabeça de um filho é a ponta do pai.
// Elemento preso a um osso: el.bone = id; a matriz guardada é a de descanso.

const T = (x, y) => [1, 0, 0, 1, x, y];
const R = (a) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const inv = (m) => {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};

/** Ossos em ordem (pais antes dos filhos). */
export function orderedBones(arm) {
  const byParent = new Map();
  for (const b of arm.bones) {
    const k = b.parentId || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(b);
  }
  const out = [];
  const walk = (pid, guard = 0) => {
    for (const b of byParent.get(pid) || []) {
      out.push(b);
      if (guard < 64) walk(b.id, guard + 1);
    }
  };
  walk(null);
  return out;
}

/**
 * Cabeça, ângulo e ponta de cada osso, em descanso e na pose.
 * Devolve Map(id → { head, angle, tail, restHead, restAngle, rest: matriz, pose: matriz })
 */
export function solveBones(arm, pose = arm.pose || {}) {
  const out = new Map();
  for (const b of orderedBones(arm)) {
    const p = b.parentId && out.get(b.parentId);
    const restHead = p ? p.restTail : { x: b.x, y: b.y };
    const restAngle = b.angle;
    const restTail = { x: restHead.x + Math.cos(restAngle) * b.length, y: restHead.y + Math.sin(restAngle) * b.length };
    // na pose, o filho herda o giro acumulado do pai
    const inherit = p ? p.angle - p.restAngle : 0;
    const angle = restAngle + inherit + (pose[b.id] || 0);
    const head = p ? p.tail : { x: b.x + (pose.__root?.x || 0), y: b.y + (pose.__root?.y || 0) };
    const tail = { x: head.x + Math.cos(angle) * b.length, y: head.y + Math.sin(angle) * b.length };
    out.set(b.id, {
      head,
      angle,
      tail,
      restHead,
      restAngle,
      restTail,
      rest: mul(T(restHead.x, restHead.y), R(restAngle)),
      pose: mul(T(head.x, head.y), R(angle)),
    });
  }
  return out;
}

/** Elementos na pose: cada um presos a um osso acompanha o osso. */
export function poseElements(elements, arm, pose) {
  const solved = solveBones(arm, pose);
  return elements.map((el) => {
    const s = el.bone && solved.get(el.bone);
    if (!s) return el;
    return { ...el, matrix: mul(s.pose, mul(inv(s.rest), el.matrix)) };
  });
}

export function lerpPose(a = {}, b = {}, t) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === '__root') {
      const ra = a.__root || { x: 0, y: 0 }, rb = b.__root || { x: 0, y: 0 };
      out.__root = { x: ra.x + (rb.x - ra.x) * t, y: ra.y + (rb.y - ra.y) * t };
    } else out[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
  }
  return out;
}

/**
 * Cinemática inversa (CCD): gira os ossos da cadeia até a ponta do osso `endId`
 * chegar o mais perto possível do alvo. Devolve a pose nova.
 */
export function solveIK(arm, pose, endId, target, iterations = 20) {
  const p = { ...pose };
  const chain = [];
  for (let b = arm.bones.find((x) => x.id === endId), g = 0; b && g < 64; g++) {
    chain.push(b);
    b = b.parentId ? arm.bones.find((x) => x.id === b.parentId) : null;
  }
  for (let it = 0; it < iterations; it++) {
    for (const b of chain) {
      const s = solveBones(arm, p);
      const end = s.get(endId).tail;
      const j = s.get(b.id).head;
      const a1 = Math.atan2(end.y - j.y, end.x - j.x);
      const a2 = Math.atan2(target.y - j.y, target.x - j.x);
      let d = a2 - a1;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p[b.id] = (p[b.id] || 0) + d;
    }
    const e = solveBones(arm, p).get(endId).tail;
    if (Math.hypot(e.x - target.x, e.y - target.y) < 0.5) break;
  }
  return p;
}
