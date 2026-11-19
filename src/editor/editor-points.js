// Animação ponto a ponto (Etapa V3): auto-key ao editar pontos fora do keyframe, esconder forma
// por quadro e operações nos pontos (curvatura, soldar e separar).

import { Editor } from './editor.js';
import * as C from './commands.js';
import * as TL from '../model/timeline.js';
import { clone } from '../model/document.js';
import { subpaths } from '../player/render.js';

const P = Editor.prototype;

const SHAPE_TWEEN = () => ({ type: 'shape', ease: 0, hints: [] });

/**
 * Keyframe de pontos no quadro atual (auto-key): cria o keyframe nas camadas dadas (cópia do que
 * aparece no quadro, com tween ou sem) e, se o keyframe de antes segura só formas e não tinha tween,
 * liga um shape tween nele — os pontos passam a andar entre as chaves, como no Moho.
 * Devolve quantas camadas ganharam keyframe.
 */
P.pointKeyframeHere = function (layers) {
  const cmds = [];
  for (const layer of layers) {
    if (layer.locked) continue;
    const span = this.spanAt(layer);
    if (!span || span.start === this.frame) continue;
    const r = TL.insertKeyframe(layer.frames, this.frame);
    if (!r) continue;
    const k = r.frames.findIndex((s) => s.start === this.frame);
    const prev = r.frames[k - 1];
    if (prev && !prev.tween && prev.elements.length && prev.elements.every((e) => e.type === 'shape')) prev.tween = SHAPE_TWEEN();
    cmds.push(new C.SetLayerFrames(layer.id, layer.frames, r.frames, 'Keyframe de pontos', this.frame, this.frame));
  }
  if (cmds.length) this.history.execute(new C.Compound('Keyframe de pontos', cmds), this);
  return cmds.length;
};

/**
 * Antes de editar pontos: com auto-key (o mesmo dos ossos), cria o keyframe no quadro se ele não é
 * keyframe; sem auto-key, só quando o quadro está no meio de um tween (como antes).
 * Troca a seleção para os elementos do keyframe novo. Devolve Map(id antigo → id novo).
 */
P.prepareShapeEdit = function (items = this.selectedItems()) {
  const auto = this.rigState().autoKey;
  // arte presa a ossos (it.src) edita o desenho guardado, não cria chave: quem anima ali é a pose
  const need = items.filter((it) => !it.motion && !it.src && (auto ? it.span.start !== this.frame : it.tweened));
  const map = new Map();
  if (!need.length) return map;
  const where = need.map((it) => ({ id: it.el.id, layer: it.layer, index: it.index }));
  const layers = [...new Set(need.map((it) => it.layer))];
  if (auto) this.pointKeyframeHere(layers);
  else this.keyframeHere(layers);
  for (const w of where) {
    const span = this.spanAt(w.layer);
    if (span?.start === this.frame && span.elements[w.index]) map.set(w.id, span.elements[w.index].id);
  }
  if (map.size) this.setSelection([...this.selection].map((id) => map.get(id) || id));
  return map;
};

/** Esconde (ou mostra de novo) as formas selecionadas neste quadro, sem apagar: os pontos continuam ligados no tween. */
P.toggleHideShapes = function () {
  const items = this.selectedItems().filter((it) => it.el.type === 'shape' && !it.motion);
  if (!items.length) return this.toast('Selecione uma forma para esconder ou mostrar neste quadro.');
  const hide = !items.every((it) => it.el.hidden);
  const label = hide ? 'Esconder forma' : 'Mostrar forma';
  this.group(label, () => {
    this.prepareShapeEdit(items);
    const now = this.selectedItems().filter((it) => it.el.type === 'shape' && !it.motion);
    this.updateItems(now, label, (el) => {
      if (hide) el.hidden = true;
      else delete el.hidden;
    });
  });
  this.toast(hide ? 'Forma escondida neste quadro (aparece tracejada na camada ativa). Repita para mostrar.' : 'Forma visível de novo neste quadro.');
};

// ---------- operações nos pontos (usadas pela Subseleção) ----------
/** Chaves "elId:sub:pt" → Map(elId → Map(sub → Set(pt))). */
function groupKeys(keys) {
  const out = new Map();
  for (const k of keys) {
    const [id, si, pi] = k.split(':');
    if (!out.has(id)) out.set(id, new Map());
    const m = out.get(id);
    if (!m.has(+si)) m.set(+si, new Set());
    m.get(+si).add(+pi);
  }
  return out;
}

const subsOf = (path) => subpaths(path).map((sp) => ({ closed: !!sp.closed, pts: sp.pts.map((q) => q.slice()) }));
const withSubs = (path, subs) => (subs.length === 1 ? { ...(path.fillRule ? { fillRule: path.fillRule } : {}), closed: subs[0].closed, pts: subs[0].pts } : { closed: subs.every((s) => s.closed), ...(path.fillRule ? { fillRule: path.fillRule } : {}), subs });

/**
 * Curvatura dos pontos (0 = canto pontudo, 100 = suave; até 200 = bem arredondado).
 * As alças seguem a direção dos vizinhos (Catmull-Rom), com o tamanho escalado pela curvatura.
 */
export function setCurvature(path, pts, value) {
  const subs = subsOf(path);
  const k = Math.max(0, value) / 100;
  for (const [si, set] of pts) {
    const sp = subs[si];
    if (!sp) continue;
    const n = sp.pts.length;
    for (const pi of set) {
      const q = sp.pts[pi];
      if (!q) continue;
      const prev = sp.closed ? sp.pts[(pi - 1 + n) % n] : sp.pts[Math.max(0, pi - 1)];
      const next = sp.closed ? sp.pts[(pi + 1) % n] : sp.pts[Math.min(n - 1, pi + 1)];
      const tx = ((next[0] - prev[0]) / 6) * k, ty = ((next[1] - prev[1]) / 6) * k;
      const first = !sp.closed && pi === 0, last = !sp.closed && pi === n - 1;
      // || 0 tira o -0 (JSON e comparações ficam limpos)
      q[2] = first ? 0 : -tx || 0;
      q[3] = first ? 0 : -ty || 0;
      q[4] = last ? 0 : tx || 0;
      q[5] = last ? 0 : ty || 0;
    }
  }
  return withSubs(path, subs);
}

/** Curvatura atual (0–200) de um ponto: tamanho das alças em relação ao que a curva suave teria. */
export function curvatureOf(path, si, pi) {
  const sp = subpaths(path)[si];
  const q = sp?.pts[pi];
  if (!q) return null;
  const n = sp.pts.length;
  const prev = sp.closed ? sp.pts[(pi - 1 + n) % n] : sp.pts[Math.max(0, pi - 1)];
  const next = sp.closed ? sp.pts[(pi + 1) % n] : sp.pts[Math.min(n - 1, pi + 1)];
  const ref = Math.hypot(next[0] - prev[0], next[1] - prev[1]) / 6;
  if (!ref) return 0;
  const h = Math.max(Math.hypot(q[2], q[3]), Math.hypot(q[4], q[5]));
  return Math.round((h / ref) * 100);
}

/**
 * Separa no ponto: num caminho aberto, vira dois pedaços (o ponto fica nos dois);
 * num fechado, abre ali. Só o primeiro ponto selecionado de cada subcaminho conta.
 */
export function splitAtPoints(path, pts) {
  let subs = subsOf(path);
  const out = [];
  subs.forEach((sp, si) => {
    const set = pts.get(si);
    const pi = set ? Math.min(...set) : -1;
    if (pi < 0 || !sp.pts[pi]) return out.push(sp);
    const q = sp.pts[pi];
    if (sp.closed) {
      // abre o laço no ponto: começa e termina nele
      const ring = [...sp.pts.slice(pi), ...sp.pts.slice(0, pi)].map((x) => x.slice());
      const end = q.slice();
      ring[0][2] = ring[0][3] = 0;
      end[4] = end[5] = 0;
      return out.push({ closed: false, pts: [...ring, end] });
    }
    if (pi === 0 || pi === sp.pts.length - 1) return out.push(sp); // ponta: nada a separar
    const a = sp.pts.slice(0, pi + 1).map((x) => x.slice());
    const b = sp.pts.slice(pi).map((x) => x.slice());
    a[a.length - 1][4] = a[a.length - 1][5] = 0;
    b[0][2] = b[0][3] = 0;
    out.push({ closed: false, pts: a }, { closed: false, pts: b });
  });
  subs = out;
  return withSubs(path, subs);
}

/**
 * Solda dois pontos de ponta (início/fim de caminhos abertos) na mesma forma: no mesmo
 * subcaminho, fecha o laço; em subcaminhos diferentes, junta os dois num só. O ponto soldado fica
 * no meio dos dois. Devolve o caminho novo ou null se não deu.
 */
export function weldPoints(path, keys) {
  if (keys.length !== 2) return null;
  const subs = subsOf(path);
  const [a, b] = keys;
  const sa = subs[a.si], sb = subs[b.si];
  if (!sa || !sb || sa.closed || sb.closed) return null;
  const isEnd = (sp, pi) => pi === 0 || pi === sp.pts.length - 1;
  if (!isEnd(sa, a.pi) || !isEnd(sb, b.pi)) return null;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (a.si === b.si) {
    if (a.pi === b.pi || sa.pts.length < 3) return null;
    const first = sa.pts[0], last = sa.pts[sa.pts.length - 1];
    const [x, y] = mid(first, last);
    first[0] = x;
    first[1] = y;
    first[2] = last[2];
    first[3] = last[3];
    sa.pts.pop();
    sa.closed = true;
    return withSubs(path, subs);
  }
  // deixa a ordem: fim de A encostando no começo de B
  let A = sa.pts, B = sb.pts;
  const rev = (pts) => pts.reverse().map((q) => [q[0], q[1], q[4], q[5], q[2], q[3]]);
  if (a.pi === 0) A = rev(A.map((q) => q.slice()));
  if (b.pi !== 0) B = rev(B.map((q) => q.slice()));
  const ea = A[A.length - 1], sbq = B[0];
  const [x, y] = mid(ea, sbq);
  const joint = [x, y, ea[2], ea[3], sbq[4], sbq[5]];
  const merged = { closed: false, pts: [...A.slice(0, -1), joint, ...B.slice(1)] };
  const rest = subs.filter((_, i) => i !== a.si && i !== b.si);
  return withSubs(path, [merged, ...rest]);
}

/**
 * Aplica uma operação de pontos às formas com pontos selecionados (com auto-key).
 * fn(path, pts, el) devolve o caminho novo (ou null = não mudou). Retorna { ok, map (ids trocados) }.
 */
P.editPoints = function (label, keys, fn) {
  const byEl = groupKeys(keys);
  const items = this.selectedItems().filter((it) => it.el.type === 'shape' && !it.motion && byEl.has(it.el.id));
  let map = new Map();
  if (!items.length) return { ok: false, map };
  let ok = false;
  this.group(label, () => {
    map = this.prepareShapeEdit(items);
    const now = this.selectedItems().filter((it) => it.el.type === 'shape' && !it.motion);
    const byNew = new Map();
    for (const [id, pts] of byEl) byNew.set(map.get(id) || id, pts);
    this.updateItems(
      now.filter((it) => byNew.has(it.el.id)),
      label,
      (el, it) => {
        const res = fn(clone(el.path), byNew.get(it?.el.id ?? el.id), el);
        if (res) {
          el.path = res;
          ok = true;
        }
      },
    );
  });
  return { ok, map };
};
