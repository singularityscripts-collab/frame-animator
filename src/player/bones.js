// Ossos (cinemática inversa): esqueleto guardado no keyframe, pose = giro de cada osso.
// armature = { bones: [{ id, parentId, x, y, angle, length, name?, min?, max?, pin? }],
//              pose: { [id]: giro extra em radianos, __root?: { x, y } } }
// x, y valem para ossos raiz e para galhos (offset: true, cabeça em qualquer ponto preso ao pai);
// nos outros filhos, a cabeça é a ponta do pai.
// min/max: limites do giro extra (radianos); pin: a ponta do osso fica parada quando outros ossos mexem.
// Elemento preso a um osso: el.bone = id; a matriz guardada é a de descanso.
// Forma com pele: el.skin = true e el.skinBones = [ids] (sem a lista, vale o esqueleto todo: arquivos antigos).

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
    // filho "galho" (offset): a cabeça fica em x, y (em descanso), em qualquer ponto preso ao pai
    const branch = p && b.offset && Number.isFinite(b.x) && Number.isFinite(b.y);
    const restHead = branch ? { x: b.x, y: b.y } : p ? p.restTail : { x: b.x, y: b.y };
    const restAngle = b.angle;
    const restTail = { x: restHead.x + Math.cos(restAngle) * b.length, y: restHead.y + Math.sin(restAngle) * b.length };
    // na pose, o filho herda o giro acumulado do pai
    const inherit = p ? p.angle - p.restAngle : 0;
    const angle = restAngle + inherit + (pose[b.id] || 0);
    const head = branch ? applyM(multiply(p.pose, invSafe(p.rest)), restHead.x, restHead.y) : p ? p.tail : { x: b.x + (pose.__root?.x || 0), y: b.y + (pose.__root?.y || 0) };
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
  const list = Array.isArray(el.skinBones) ? el.skinBones.map((id) => solved.get(id)).filter(Boolean) : [...solved.values()];
  if (!list.length) return el;
  // presa a um osso só: acompanha inteira (sem dobrar), como um símbolo
  if (list.length === 1) return { ...el, matrix: multiply(list[0].pose, multiply(invSafe(list[0].rest), el.matrix)) };
  const bones = list.map((s) => ({ restHead: s.restHead, restTail: s.restTail, soft: Math.max(4, Math.hypot(s.restTail.x - s.restHead.x, s.restTail.y - s.restHead.y) * 0.08), M: multiply(s.pose, invSafe(s.rest)) }));
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

/** Giro extra dentro dos limites do osso (min/max em radianos; sem limite, passa direto). */
export function clampBone(b, v) {
  if (Number.isFinite(b?.min) && v < b.min) v = b.min;
  if (Number.isFinite(b?.max) && v > b.max) v = b.max;
  return v;
}

/** Ponto preso ao osso: local.x ao longo do osso a partir da cabeça, local.y para o lado. */
export function bonePoint(s, local) {
  const c = Math.cos(s.angle), n = Math.sin(s.angle);
  return { x: s.head.x + c * local.x - n * local.y, y: s.head.y + n * local.x + c * local.y };
}

/** O osso e os pais dele, de baixo para cima (sem repetir: arquivo com pais em ciclo não trava). */
function chainUp(byId, id, solvable) {
  const out = [];
  const seen = new Set();
  for (let b = byId.get(id); b && solvable.has(b.id) && !seen.has(b.id); b = b.parentId ? byId.get(b.parentId) : null) {
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

// passo máximo de giro por iteração: a cadeia vai até o alvo sem dar chicotada nem tremer
const MAX_STEP = 0.5;

/** Para que lado a junta dobra quando está reta: o lado que o limite deixa, o da dobra atual ou o positivo. */
function bendSide(b, cur) {
  if (Number.isFinite(b.max) && b.max <= 0) return -1;
  if (Number.isFinite(b.min) && b.min >= 0) return 1;
  if (Math.abs(cur) > 1e-6) return Math.sign(cur);
  return 1;
}

/** CCD: gira os ossos da cadeia (do mais perto da ponta para o mais longe) até o ponto chegar no alvo. */
function ccd(arm, p, chain, endId, local, target, iterations) {
  if (!chain.length) return;
  for (let it = 0; it < iterations; it++) {
    for (const b of chain) {
      const s = solveBones(arm, p);
      const e = bonePoint(s.get(endId), local);
      const j = s.get(b.id).head;
      // alvo ou ponta em cima da junta: o ângulo não tem sentido (era daí que vinha a tremedeira)
      if (Math.hypot(e.x - j.x, e.y - j.y) < 1e-3 || Math.hypot(target.x - j.x, target.y - j.y) < 1e-3) continue;
      let d = Math.atan2(target.y - j.y, target.x - j.x) - Math.atan2(e.y - j.y, e.x - j.x);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // cadeia reta com o alvo na mesma linha, mais perto (perna esticada e quadril descendo):
      // girar não muda nada e o joelho nunca dobraria; dá um empurrão para o lado da dobra
      const de = Math.hypot(e.x - j.x, e.y - j.y), dt = Math.hypot(target.x - j.x, target.y - j.y);
      if (Math.abs(d) < 1e-4 && dt < de - 0.25) d = 0.15 * bendSide(b, p[b.id] || 0);
      d = Math.max(-MAX_STEP, Math.min(MAX_STEP, d));
      p[b.id] = clampBone(b, (p[b.id] || 0) + d);
    }
    const e = bonePoint(solveBones(arm, p).get(endId), local);
    if (Math.hypot(e.x - target.x, e.y - target.y) < 0.25) break;
  }
}

/**
 * Ossos fixados (pin) que saíram do lugar porque um pai girou ou o esqueleto andou:
 * gira a parte da cadeia entre o pino e o que mexeu para a ponta voltar ao lugar.
 */
function restorePins(arm, p, targets, moved, byId, iterations) {
  for (const [id, target] of targets) {
    const solvable = solveBones(arm, p);
    if (!solvable.has(id)) continue;
    const sub = [];
    for (const b of chainUp(byId, id, solvable)) {
      if (moved.has(b.id)) break;
      if (!b.parentId && b.id !== id) break; // o osso raiz não gira: giraria o corpo todo
      sub.push(b);
    }
    ccd(arm, p, sub, id, { x: byId.get(id).length, y: 0 }, target, iterations);
  }
}

const pinTargets = (arm, solved, except) =>
  new Map(arm.bones.filter((b) => b.pin && b.id !== except && solved.has(b.id)).map((b) => [b.id, solved.get(b.id).tail]));

/**
 * Cinemática inversa (CCD): gira os ossos da cadeia até o ponto do osso `endId`
 * chegar o mais perto possível do alvo. Devolve a pose nova.
 * opts.local: ponto agarrado no osso (padrão: a ponta). Respeita limites e ossos fixados:
 * um pai fixado (e os de cima) não gira; filhos fixados voltam para o lugar.
 */
export function solveIK(arm, pose, endId, target, iterations = 20, opts = {}) {
  const p = { ...pose };
  // só ossos que o esqueleto consegue resolver (um arquivo com pais em ciclo deixa alguns de fora)
  const solved = solveBones(arm, p);
  if (!solved.has(endId)) return p;
  const byId = new Map(arm.bones.map((b) => [b.id, b]));
  const end = byId.get(endId);
  const local = opts.local || { x: end.length, y: 0 };
  const pins = pinTargets(arm, solved, endId);
  // a cadeia sobe até a junção: puxar o pé mexe a perna, não o tronco. Para no osso fixado,
  // num galho (preso no meio do pai) e no pai que tem mais de um filho (quadril, ombro).
  const kids = new Map();
  for (const b of arm.bones) if (b.parentId) kids.set(b.parentId, (kids.get(b.parentId) || 0) + 1);
  const chain = [];
  for (const b of chainUp(byId, endId, solved)) {
    if (b.id !== endId && b.pin) break;
    chain.push(b);
    if (b.offset || (b.parentId && (kids.get(b.parentId) || 0) > 1)) break;
  }
  ccd(arm, p, chain, endId, local, target, iterations);
  restorePins(arm, p, pins, new Set(chain.map((b) => b.id)), byId, iterations);
  return p;
}

/** Cinemática direta: gira só este osso (os filhos acompanham), dentro dos limites. */
export function rotateBone(arm, pose, id, delta, iterations = 20) {
  const p = { ...pose };
  const solved = solveBones(arm, p);
  const b = arm.bones.find((x) => x.id === id);
  if (!b || !solved.has(id)) return p;
  const pins = pinTargets(arm, solved, id);
  p[id] = clampBone(b, (p[id] || 0) + delta);
  restorePins(arm, p, pins, new Set([id]), new Map(arm.bones.map((x) => [x.id, x])), iterations);
  return p;
}

/** Move o esqueleto inteiro (pela raiz); os ossos fixados ficam onde estavam. */
export function moveRoot(arm, pose, dx, dy, iterations = 20) {
  const solved = solveBones(arm, pose);
  const pins = pinTargets(arm, solved, null);
  const r = pose.__root || { x: 0, y: 0 };
  const p = { ...pose, __root: { x: r.x + dx, y: r.y + dy } };
  restorePins(arm, p, pins, new Set(), new Map(arm.bones.map((x) => [x.id, x])), iterations);
  return p;
}
