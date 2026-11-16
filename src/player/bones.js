// Ossos (cinemática inversa): esqueleto guardado no keyframe, pose = giro de cada osso.
// armature = { bones: [{ id, parentId, x, y, angle, length }], pose: { [id]: giro extra em radianos } }
// x, y só valem para ossos raiz; a cabeça de um filho é a ponta do pai.
// Elemento preso a um osso: el.bone = id; a matriz guardada é a de descanso.

import { subdivideSub } from './mesh.js';
import { multiply, invert, translation, rotation, IDENTITY } from './render.js';
import { distToSegment } from './geom.js';

// matriz inversa que nunca falha (escala zero vira identidade)
const invSafe = (m) => invert(m) || IDENTITY;

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
      rest: multiply(translation(restHead.x, restHead.y), rotation(restAngle)),
      pose: multiply(translation(head.x, head.y), rotation(angle)),
    });
  }
  return out;
}

/**
 * Elementos na pose.
 * - el.bone = id: o elemento inteiro acompanha aquele osso (símbolos, imagens).
 * - el.skin: forma "com pele": cada ponto do caminho segue uma mistura dos ossos perto dele,
 *   então a forma dobra nas juntas (ossos dentro de uma forma, como uma linha ou um braço desenhado).
 */
export function poseElements(elements, arm, pose) {
  const solved = solveBones(arm, pose);
  return elements.map((el) => {
    if (el.skin && el.type === 'shape' && !el.bone) return skinShape(el, solved);
    const s = el.bone && solved.get(el.bone);
    if (!s) return el;
    return { ...el, matrix: multiply(s.pose, multiply(invSafe(s.rest), el.matrix)) };
  });
}

/**
 * Matriz misturada dos ossos num ponto (em descanso), com peso 1/(d + r)^4:
 * perto de um osso manda ele; na junta os dois se misturam e a curva fica suave.
 */
function skinMatrix(bones, x, y) {
  const acc = [0, 0, 0, 0, 0, 0];
  let sw = 0;
  for (const b of bones) {
    const w = 1 / (distToSegment(x, y, b.restHead, b.restTail) + b.soft) ** 4;
    for (let k = 0; k < 6; k++) acc[k] += w * b.M[k];
    sw += w;
  }
  return acc.map((v) => v / sw);
}

const applyM = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Divide as curvas em pedaços curtos (uma reta precisa de pontos no meio para dobrar). */
function densify(sp, matrix) {
  const pts = sp.pts;
  let longest = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (!sp.closed && i === pts.length - 1) break;
    const p = applyM(matrix, a[0], a[1]), q = applyM(matrix, b[0], b[1]);
    longest = Math.max(longest, Math.hypot(q.x - p.x, q.y - p.y));
  }
  const k = Math.max(1, Math.min(24, Math.ceil(longest / 16), Math.floor(1500 / Math.max(1, pts.length))));
  if (k <= 1) return sp;
  // trecho reto (sem alças): alças em 1/3 e 2/3 deixam a divisão com pedaços iguais
  const even = pts.map((q) => q.slice());
  const n = even.length;
  for (let i = 0; i < (sp.closed ? n : n - 1); i++) {
    const a = even[i], b = even[(i + 1) % n];
    if (a[4] || a[5] || b[2] || b[3]) continue;
    a[4] = (b[0] - a[0]) / 3;
    a[5] = (b[1] - a[1]) / 3;
    b[2] = (a[0] - b[0]) / 3;
    b[3] = (a[1] - b[1]) / 3;
  }
  return subdivideSub({ closed: sp.closed, pts: even }, k);
}

function skinShape(el, solved) {
  if (!solved.size) return el;
  const bones = [...solved.values()].map((s) => ({ restHead: s.restHead, restTail: s.restTail, soft: Math.max(4, Math.hypot(s.restTail.x - s.restHead.x, s.restTail.y - s.restHead.y) * 0.08), M: multiply(s.pose, invSafe(s.rest)) }));
  const m = el.matrix;
  const toLocal = invSafe(m);
  const subs = (el.path.subs || [el.path]).map((sp) => {
    const d = densify(sp, m);
    return {
      closed: !!sp.closed,
      pts: d.pts.map((q) => {
        const p = applyM(m, q[0], q[1]);
        const M = multiply(toLocal, multiply(skinMatrix(bones, p.x, p.y), m)); // local → local, com a pele
        const np = applyM(M, q[0], q[1]);
        // alças: só a parte linear (giro/escala) da mistura no ponto
        const h = (dx, dy) => [M[0] * dx + M[2] * dy, M[1] * dx + M[3] * dy];
        return [np.x, np.y, ...h(q[2] || 0, q[3] || 0), ...h(q[4] || 0, q[5] || 0)];
      }),
    };
  });
  return { ...el, path: el.path.subs ? { ...el.path, subs } : { ...el.path, ...subs[0] } };
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
  // só ossos que o esqueleto consegue resolver (um arquivo com pais em ciclo deixa alguns de fora)
  const solvable = solveBones(arm, p);
  if (!solvable.has(endId)) return p;
  const chain = [];
  const seen = new Set();
  for (let b = arm.bones.find((x) => x.id === endId); b && solvable.has(b.id) && !seen.has(b.id); ) {
    seen.add(b.id);
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
