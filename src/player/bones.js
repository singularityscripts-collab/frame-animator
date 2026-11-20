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
import { applyEase } from './ease.js';

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
      strength: b.strength,
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
 * - arm.smart: correções Smart Bone (o ângulo de um osso move pontos da forma) antes da pele.
 */
export function poseElements(elements, arm, pose) {
  const solved = solveBones(arm, smartPose(arm, pose));
  const smart = arm.smart?.length ? smartOffsets(arm, pose) : null;
  return elements.map((el0) => {
    const off = smart && el0.type === 'shape' ? smart.get(el0.lineage || el0.id) : null;
    const el = off ? offsetShape(el0, off) : el0;
    if ((el.skin || el.pointBones) && el.type === 'shape' && !el.bone) return skinShape(el, solved);
    const s = el.bone && solved.get(el.bone);
    if (!s) return el;
    return { ...el, matrix: multiply(s.pose, multiply(invSafe(s.rest), el.matrix)) };
  });
}

// ---------- Smart Bones: correções por ângulo ----------
// arm.smart = [{ id, bone, angle (giro do osso, rad), shapes: { [lineage]: { "sub:pt": [dx, dy] } } }]
// O giro do osso (pose[bone]) escolhe a correção: entre 0 e o ângulo da primeira correção do mesmo
// lado, cresce aos poucos; entre duas correções, mistura as duas; passando da última, segura a última.

/** Peso de cada correção para o giro atual do osso dela. Map(id da correção → peso 0–1). */
export function smartWeights(arm, pose) {
  const out = new Map();
  const byBone = new Map();
  for (const c of arm.smart || []) {
    if (!Number.isFinite(c.angle) || !c.angle) continue;
    if (!byBone.has(c.bone)) byBone.set(c.bone, []);
    byBone.get(c.bone).push(c);
  }
  for (const [bone, list] of byBone) {
    const d = pose[bone] || 0;
    if (!d) continue;
    const side = list.filter((c) => Math.sign(c.angle) === Math.sign(d)).sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle));
    if (!side.length) continue;
    const ad = Math.abs(d);
    let prevA = 0, prev = null, done = false;
    for (const c of side) {
      const ac = Math.abs(c.angle);
      if (ad <= ac) {
        const u = (ad - prevA) / (ac - prevA || 1);
        out.set(c.id, u);
        if (prev) out.set(prev.id, 1 - u);
        done = true;
        break;
      }
      prevA = ac;
      prev = c;
    }
    if (!done && prev) out.set(prev.id, 1); // passou da última: segura a última
  }
  return out;
}

/**
 * Pose com os giros que as correções dão a outros ossos (c.bones = { id: giro extra em rad }).
 * Ex.: dobrar o joelho gira o pé um pouco. Os pesos vêm da pose com keys (uma passada só).
 */
export function smartPose(arm, pose) {
  if (!arm?.smart?.some((c) => c.bones && Object.keys(c.bones).length)) return pose;
  const w = smartWeights(arm, pose);
  let out = null;
  for (const c of arm.smart) {
    const k = w.get(c.id);
    if (!k || !c.bones) continue;
    out ||= { ...pose };
    for (const [id, d] of Object.entries(c.bones)) out[id] = (out[id] || 0) + d * k;
  }
  return out || pose;
}

/** Deslocamentos somados das correções ativas: Map(lineage → Map("sub:pt" → [dx, dy])). */
export function smartOffsets(arm, pose) {
  const w = smartWeights(arm, pose);
  const out = new Map();
  for (const c of arm.smart || []) {
    const k = w.get(c.id);
    if (!k) continue;
    for (const [key, pts] of Object.entries(c.shapes || {})) {
      if (!out.has(key)) out.set(key, new Map());
      const m = out.get(key);
      for (const [pk, d] of Object.entries(pts)) {
        const cur = m.get(pk) || [0, 0];
        m.set(pk, [cur[0] + d[0] * k, cur[1] + d[1] * k]);
      }
    }
  }
  return out;
}

/** Forma com os pontos deslocados (no espaço local do caminho, antes da pele). */
function offsetShape(el, off) {
  const subs = (el.path.subs || [el.path]).map((sp, si) => ({
    ...sp,
    pts: sp.pts.map((q, pi) => {
      const d = off.get(`${si}:${pi}`);
      return d ? [q[0] + d[0], q[1] + d[1], q[2], q[3], q[4], q[5]] : q;
    }),
  }));
  return { ...el, path: el.path.subs ? { ...el.path, subs } : { ...el.path, ...subs[0] } };
}

/**
 * Matriz misturada dos ossos num ponto (em descanso), com peso força/(d + r)^4:
 * perto de um osso manda ele; na junta os dois se misturam e a curva fica suave.
 * A força do osso (bone.strength, 1 = normal) faz ele puxar uma área maior ou menor.
 */
function skinMatrix(bones, x, y) {
  const acc = [0, 0, 0, 0, 0, 0];
  let sw = 0;
  for (const b of bones) {
    const w = b.strength / (distToSegment(x, y, b.restHead, b.restTail) + b.soft) ** 4;
    for (let k = 0; k < 6; k++) acc[k] += w * b.M[k];
    sw += w;
  }
  return acc.map((v) => v / sw);
}

/** Peso (0–1) de cada osso num ponto de descanso: para mostrar a influência no editor. */
export function skinWeightsAt(bones, x, y) {
  const ws = bones.map((b) => b.strength / (distToSegment(x, y, b.restHead, b.restTail) + b.soft) ** 4);
  const sw = ws.reduce((a, b) => a + b, 0) || 1;
  return ws.map((w) => w / sw);
}

const applyM = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const lerpM = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Divide as curvas em pedaços curtos (uma reta precisa de pontos no meio para dobrar). Devolve { sp, k }. */
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
  if (k <= 1) return { sp, k: 1 };
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
  return { sp: subdivideSub({ closed: sp.closed, pts: even }, k), k };
}

/** Ossos (resolvidos) da pele: lista de { id, restHead, restTail, strength, soft, M }. */
export function skinBonesOf(ids, solved) {
  const out = [];
  for (const id of ids) {
    const s = solved.get(id);
    if (!s) continue;
    out.push({
      id,
      restHead: s.restHead,
      restTail: s.restTail,
      strength: Math.max(0.05, s.strength ?? 1),
      soft: Math.max(4, Math.hypot(s.restTail.x - s.restHead.x, s.restTail.y - s.restHead.y) * 0.08),
      M: multiply(s.pose, invSafe(s.rest)),
    });
  }
  return out;
}

/** Ids dos ossos da pele de uma forma (sem lista: o esqueleto todo, arquivos antigos). */
export const skinIds = (el, solved) => (Array.isArray(el.skinBones) ? el.skinBones.filter((id) => solved.has(id)) : el.skin ? [...solved.keys()] : []);

/**
 * Pele: cada ponto segue a mistura dos ossos; pontos presos (el.pointBones["sub:pt"] = osso)
 * seguem só aquele osso, e os pedaços entre um ponto preso e um solto passam de um para o outro.
 * Com `anchors`, devolve também onde cada ponto original foi parar e a matriz dele (para editar).
 */
export function skinShape(el, solved, { anchors = false } = {}) {
  const pb = el.pointBones && Object.keys(el.pointBones).length ? el.pointBones : null;
  const ids = skinIds(el, solved);
  if (!ids.length && !pb) return anchors ? { el, anchors: rigidAnchors(el, el) } : el;
  // presa a um osso só (e sem pontos presos): acompanha inteira (sem dobrar), como um símbolo
  if (ids.length === 1 && !pb) {
    const s = solved.get(ids[0]);
    const out = { ...el, matrix: multiply(s.pose, multiply(invSafe(s.rest), el.matrix)) };
    return anchors ? { el: out, anchors: rigidAnchors(el, out) } : out;
  }
  const bones = skinBonesOf(ids, solved);
  const m = el.matrix;
  const toLocal = invSafe(m);
  const pinned = new Map(); // "sub:pt" → matriz local→local do osso do ponto
  if (pb) {
    for (const [k, id] of Object.entries(pb)) {
      const s = solved.get(id);
      if (s) pinned.set(k, multiply(toLocal, multiply(multiply(s.pose, invSafe(s.rest)), m)));
    }
  }
  const outAnchors = anchors ? [] : null;
  const subs = (el.path.subs || [el.path]).map((sp, si) => {
    const { sp: d, k } = densify(sp, m);
    const n = sp.pts.length;
    return {
      closed: !!sp.closed,
      pts: d.pts.map((q, j) => {
        const p = applyM(m, q[0], q[1]);
        // local → local, com a pele (sem ossos de pele, só os pontos presos mexem)
        let M = bones.length ? multiply(toLocal, multiply(skinMatrix(bones, p.x, p.y), m)) : IDENTITY;
        if (pinned.size) {
          const a = Math.floor(j / k) % n, r = (j % k) / k, b = (a + 1) % n;
          const Ma = pinned.get(`${si}:${a}`), Mb = r > 0 ? pinned.get(`${si}:${b}`) : null;
          if (r === 0 && Ma) M = Ma;
          else if (r > 0 && (Ma || Mb)) M = lerpM(Ma || M, Mb || M, r);
        }
        const np = applyM(M, q[0], q[1]);
        if (outAnchors && j % k === 0) outAnchors.push({ si, pi: j / k, x: np.x, y: np.y, M });
        // alças: só a parte linear (giro/escala) da mistura no ponto
        const h = (dx, dy) => [M[0] * dx + M[2] * dy, M[1] * dx + M[3] * dy];
        return [np.x, np.y, ...h(q[2] || 0, q[3] || 0), ...h(q[4] || 0, q[5] || 0)];
      }),
    };
  });
  const out = { ...el, path: el.path.subs ? { ...el.path, subs } : { ...el.path, ...subs[0] } };
  return anchors ? { el: out, anchors: outAnchors } : out;
}

/** Pontos de uma forma que anda inteira: a matriz local→local é a mesma para todos. */
function rigidAnchors(el, out) {
  const M = multiply(invSafe(el.matrix), out.matrix);
  const res = [];
  (el.path.subs || [el.path]).forEach((sp, si) =>
    sp.pts.forEach((q, pi) => {
      const p = applyM(M, q[0], q[1]);
      res.push({ si, pi, x: p.x, y: p.y, M });
    }),
  );
  return res;
}

/**
 * Pontos de uma forma na pose (para editar correções e prender pontos no editor):
 * [{ si, pi, x, y (espaço local da forma posada), M (local → local) }] e a forma posada.
 */
export function posedAnchors(el, arm, pose) {
  const solved = solveBones(arm, smartPose(arm, pose));
  const smart = arm.smart?.length ? smartOffsets(arm, pose) : null;
  const off = smart && el.type === 'shape' ? smart.get(el.lineage || el.id) : null;
  const e = off ? offsetShape(el, off) : el;
  if (e.bone) {
    const s = solved.get(e.bone);
    const out = s ? { ...e, matrix: multiply(s.pose, multiply(invSafe(s.rest), e.matrix)) } : e;
    return { el: out, anchors: rigidAnchors(e, out), base: e };
  }
  const r = skinShape(e, solved, { anchors: true });
  return { ...r, base: e };
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

// ---------- dinâmica (balanço automático: cabelo, rabo, orelha) ----------
// bone.dynamics = { stiffness 0–1 (volta para a pose), damping 0–1 (perde o balanço), gravity (px/quadro²) }
// A simulação anda quadro a quadro desde o começo da camada, sempre igual (o player e o export
// mostram o mesmo que o editor). O osso com dinâmica atrasa e balança em volta da pose animada.

const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const hasDynamics = (arm) => !!arm?.bones?.some((b) => b.dynamics);

/** Pose com keys (sem dinâmica) da camada no quadro f, como o render calcula. */
function keyedPose(frames, f) {
  for (let i = 0; i < frames.length; i++) {
    const s = frames[i];
    if (f < s.start || f >= s.start + s.duration) continue;
    if (!s.armature) return null;
    let pose = s.armature.pose || {};
    const next = s.tween ? frames[i + 1] : null;
    if (next?.armature && f > s.start) pose = lerpPose(pose, next.armature.pose || {}, applyEase((f - s.start) / s.duration, s.tween));
    return { arm: s.armature, pose };
  }
  return null;
}

const dynCache = new WeakMap(); // layer → { refs, poses: [pose por quadro], state }

/** A camada mudou? (keyframes, durações, tweens ou esqueleto trocados) */
function sameRefs(a, frames) {
  if (!a || a.length !== frames.length * 4) return false;
  for (let i = 0; i < frames.length; i++) {
    const s = frames[i];
    if (a[i * 4] !== s.armature || a[i * 4 + 1] !== s.start || a[i * 4 + 2] !== s.duration || a[i * 4 + 3] !== s.tween) return false;
  }
  return true;
}

/**
 * Pose do quadro com a dinâmica aplicada. layer: a camada (os keyframes ficam em layer.frames).
 * Devolve a pose (giros por osso) já com o balanço.
 */
export function dynamicPose(layer, frame) {
  const frames = layer.frames;
  let c = dynCache.get(layer);
  if (!c || c.frames !== frames || !sameRefs(c.refs, frames)) {
    c = { frames, refs: frames.flatMap((s) => [s.armature, s.start, s.duration, s.tween]), poses: [], state: new Map(), last: -1 };
    dynCache.set(layer, c);
  }
  frame = Math.max(0, Math.floor(frame));
  while (c.last < frame) stepDynamics(c, frames, c.last + 1);
  return c.poses[frame] || keyedPose(frames, frame)?.pose || {};
}

function stepDynamics(c, frames, f) {
  c.last = f;
  const k = keyedPose(frames, f);
  if (!k) {
    c.poses[f] = null;
    c.state.clear();
    return;
  }
  const pose = { ...k.pose };
  for (const b of orderedBones(k.arm)) {
    const dyn = b.dynamics;
    if (!dyn) continue;
    const s = solveBones(k.arm, pose).get(b.id);
    if (!s) continue;
    const target = s.angle;
    let st = c.state.get(b.id);
    if (!st) {
      st = { phi: target, omega: 0, h1: s.head, h2: s.head };
      c.state.set(b.id, st);
    }
    const stiff = Math.max(0.005, Math.min(1, dyn.stiffness ?? 0.2));
    const damp = Math.max(0, Math.min(0.95, dyn.damping ?? 0.2));
    const grav = Number(dyn.gravity) || 0;
    const len = Math.max(4, b.length);
    // inércia: a cabeça acelera, a ponta fica para trás
    const ax = s.head.x - 2 * st.h1.x + st.h2.x, ay = s.head.y - 2 * st.h1.y + st.h2.y;
    const lag = (ax * Math.sin(st.phi) - ay * Math.cos(st.phi)) / len;
    const alpha = stiff * wrapA(target - st.phi) + lag + (grav * Math.cos(st.phi)) / len;
    st.omega = (st.omega + alpha) * (1 - damp);
    st.phi += st.omega;
    // nunca dá a volta: no máximo ~160° longe da pose
    const off = Math.max(-2.8, Math.min(2.8, wrapA(st.phi - target)));
    st.phi = target + off;
    st.h2 = st.h1;
    st.h1 = s.head;
    pose[b.id] = (pose[b.id] || 0) + off;
  }
  c.poses[f] = pose;
}
