// Ferramenta Ossos (M), com dois modos bem separados:
// - Editar rig: arrastar desenha um osso; arrastar da ponta de um osso continua a cadeia
//   (as juntas atraem o cursor); Alt+arrastar uma junta move a junta; clique seleciona o osso;
//   Ctrl+clique numa parte prende/solta a parte do osso selecionado; Delete apaga o osso;
//   no osso selecionado, as alças do arco mudam os limites de ângulo.
// - Posar: arrastar um osso ou uma parte presa faz IK (o ponto agarrado segue o cursor);
//   Ctrl+arrastar gira só aquele osso (FK); arrastar a junta quadrada da raiz move o esqueleto;
//   duplo clique numa junta fixa/solta (pin). Com auto-key, cada pose vira keyframe.
// M (de novo) alterna o modo. As alças têm tamanho fixo na tela, qualquer que seja o zoom.

import { applyPoint, invert, IDENTITY } from '../player/render.js';
import { solveIK, rotateBone, moveRoot } from '../player/bones.js';
import { distToSegment } from '../player/geom.js';
import { clone } from '../model/document.js';
import * as C from './commands.js';
import { boneColor, boundBones } from './rig.js';

const JOINT_R = 5; // raio da junta na tela (px)
const HIT_JOINT = 10;
const HIT_SHAFT = 7;
const LIMIT_R = 34; // raio do arco de limites
const MODE_COLOR = { edit: '#ff9f0a', pose: '#0a84ff' };
const inv = (m) => invert(m) || IDENTITY;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Ossos na tela (pose do quadro): { info, lm, list: [{ id, b, s, head, tail, color }] } ou null. */
export function rigScreen(stage, editor) {
  const layer = editor.activeLayer;
  if (!layer || layer.type === 'folder' || layer.type === 'camera') return null;
  const info = editor.poseAt();
  if (!info) return null;
  const lm = editor.layerMatrixOf(layer);
  const solved = editor.rigSolved();
  const bones = info.arm.bones;
  const scr = (p) => {
    const w = applyPoint(lm, p.x, p.y);
    return stage.toScreen(w.x, w.y);
  };
  const list = [];
  for (const [id, s] of solved) {
    const b = bones.find((x) => x.id === id);
    list.push({ id, b, s, head: scr(s.head), tail: scr(s.tail), color: boneColor(bones, id) });
  }
  return { info, lm, list, scr };
}

/** O que está sob o ponteiro: junta (ponta ou cabeça da raiz), haste do osso ou nada. */
function hitRig(r, sx, sy) {
  let best = null;
  for (const it of r.list) {
    const dt = Math.hypot(it.tail.x - sx, it.tail.y - sy);
    if (dt <= HIT_JOINT && (!best || dt < best.d)) best = { kind: 'tail', it, d: dt };
    if (!it.b.parentId || it.b.offset) {
      const dh = Math.hypot(it.head.x - sx, it.head.y - sy);
      if (dh <= HIT_JOINT && (!best || dh < best.d)) best = { kind: 'head', it, d: dh };
    }
  }
  if (best) return best;
  for (const it of r.list) {
    const d = distToSegment(sx, sy, it.head, it.tail);
    if (d <= HIT_SHAFT && (!best || d < best.d)) best = { kind: 'shaft', it, d };
  }
  return best;
}

/** Ângulo-base do limite (direção de descanso já com o giro dos pais) e o giro atual do osso. */
function limitBase(r, it) {
  const pose = r.info.pose[it.id] || 0;
  return { base: it.s.angle - pose, pose };
}

/** Alças do arco de limites do osso selecionado (na tela). */
function limitHandles(r, it) {
  const { base } = limitBase(r, it);
  const c = r.scr(it.s.head);
  // direção da base na tela (a vista pode estar girada)
  const d = r.scr({ x: it.s.head.x + Math.cos(base) * 10, y: it.s.head.y + Math.sin(base) * 10 });
  const sa = Math.atan2(d.y - c.y, d.x - c.x);
  const has = Number.isFinite(it.b.min) || Number.isFinite(it.b.max);
  const min = Number.isFinite(it.b.min) ? it.b.min : -Math.PI / 2;
  const max = Number.isFinite(it.b.max) ? it.b.max : Math.PI / 2;
  const at = (v) => ({ x: c.x + Math.cos(sa + v) * LIMIT_R, y: c.y + Math.sin(sa + v) * LIMIT_R });
  return { c, sa, has, min, max, minP: at(min), maxP: at(max) };
}

/**
 * Desenha o esqueleto da camada ativa por cima do palco.
 * full: com juntas, cores, vínculos e limites (ferramenta Ossos); senão, só um contorno discreto.
 */
export function drawSkeleton(stage, editor, ctx, { full = false, hover = null, st = null } = {}) {
  const r = rigScreen(stage, editor);
  if (!r) return;
  const rs = editor.rigState();
  const mode = editor.rigMode();
  const sel = rs.selected;
  ctx.save();
  ctx.lineJoin = 'round';
  if (!full || !rs.show) {
    if (!rs.show && !full) return ctx.restore();
    // discreto: o rig continua visível com as outras ferramentas
    ctx.globalAlpha = full ? 0.85 : 0.7;
    ctx.lineCap = 'round';
    for (const it of r.list) {
      // contorno escuro por baixo: a linha aparece sobre qualquer cor de arte
      for (const [color, w] of [['rgba(0,0,0,0.55)', 4], [it.color, 2]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(it.head.x, it.head.y);
        ctx.lineTo(it.tail.x, it.tail.y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(it.tail.x, it.tail.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // vínculos: linha tracejada do centro de cada parte até o osso que ela segue (mesma cor)
  const items = editor.frameItems().filter((it) => it.layer.id === editor.activeLayerId);
  const byId = new Map(r.list.map((x) => [x.id, x]));
  for (const it of items) {
    const bb = boundBones(it.src || it.el);
    const ids = bb === 'all' ? [...byId.keys()] : bb;
    if (!ids.length) continue;
    const box = editor.boundsOf(it);
    const c = stage.toScreen(box.x + box.w / 2, box.y + box.h / 2);
    for (const id of ids) {
      const b = byId.get(id);
      if (!b) continue;
      const hot = id === sel || id === hover?.it?.id;
      ctx.globalAlpha = hot ? 0.95 : 0.55;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = hot ? 1.5 : 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo((b.head.x + b.tail.x) / 2, (b.head.y + b.tail.y) / 2);
      ctx.stroke();
      if (hot) {
        // a parte presa ao osso selecionado ganha uma moldura na cor dele
        const p1 = stage.toScreen(box.x, box.y), p2 = stage.toScreen(box.x + box.w, box.y + box.h);
        ctx.strokeRect(Math.min(p1.x, p2.x) - 3, Math.min(p1.y, p2.y) - 3, Math.abs(p2.x - p1.x) + 6, Math.abs(p2.y - p1.y) + 6);
      }
      ctx.setLineDash([]);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // ossos
  for (const it of r.list) {
    const dx = it.tail.x - it.head.x, dy = it.tail.y - it.head.y;
    const l = Math.hypot(dx, dy) || 1;
    const w = Math.min(8, Math.max(3, l * 0.18));
    const nx = (-dy / l) * w, ny = (dx / l) * w;
    const mx = it.head.x + dx * 0.18, my = it.head.y + dy * 0.18;
    const isSel = it.id === sel;
    const isHot = hover?.it?.id === it.id;
    ctx.beginPath();
    ctx.moveTo(it.head.x, it.head.y);
    ctx.lineTo(mx + nx, my + ny);
    ctx.lineTo(it.tail.x, it.tail.y);
    ctx.lineTo(mx - nx, my - ny);
    ctx.closePath();
    ctx.globalAlpha = mode === 'edit' ? (isHot || isSel ? 0.7 : 0.4) : isHot || isSel ? 0.95 : 0.75;
    ctx.fillStyle = it.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (mode === 'edit') ctx.setLineDash([3, 2]);
    ctx.strokeStyle = isSel ? '#ffffff' : 'rgba(0,0,0,0.75)';
    ctx.lineWidth = isSel ? 2.5 : 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // limites do osso selecionado (só ao montar o rig)
  const selIt = byId.get(sel);
  if (mode === 'edit' && selIt) {
    const lh = limitHandles(r, selIt);
    const min = st?.mode === 'limit' && st.id === sel && st.which === 'min' ? st.value : lh.min;
    const max = st?.mode === 'limit' && st.id === sel && st.which === 'max' ? st.value : lh.max;
    const has = lh.has || st?.mode === 'limit';
    ctx.globalAlpha = has ? 0.22 : 0.08;
    ctx.fillStyle = selIt.color;
    ctx.beginPath();
    ctx.moveTo(lh.c.x, lh.c.y);
    ctx.arc(lh.c.x, lh.c.y, LIMIT_R, lh.sa + min, lh.sa + max);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = has ? 0.9 : 0.45;
    ctx.strokeStyle = selIt.color;
    ctx.lineWidth = 1.5;
    if (!has) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(lh.c.x, lh.c.y, LIMIT_R, lh.sa + min, lh.sa + max);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const v of [min, max]) {
      const p = { x: lh.c.x + Math.cos(lh.sa + v) * LIMIT_R, y: lh.c.y + Math.sin(lh.sa + v) * LIMIT_R };
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = has ? selIt.color : '#2b2b31';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // juntas: tamanho fixo na tela; a raiz é quadrada (em Posar, arrastar move o esqueleto)
  const joint = (p, { root = false, pinned = false, hot = false } = {}) => {
    const rad = hot ? JOINT_R + 2 : JOINT_R;
    ctx.beginPath();
    if (root) ctx.rect(p.x - rad, p.y - rad, rad * 2, rad * 2);
    else ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = pinned ? '#ff453a' : hot ? '#ffd60a' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (pinned) {
      // alfinete: pontinho branco no meio da junta vermelha
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  };
  // galho: linha fina da cabeça até o ponto mais perto do pai (mostra de quem ele depende)
  for (const it of r.list) {
    const par = it.b.offset && byId.get(it.b.parentId);
    if (!par) continue;
    const dx = par.tail.x - par.head.x, dy = par.tail.y - par.head.y;
    const t = Math.max(0, Math.min(1, ((it.head.x - par.head.x) * dx + (it.head.y - par.head.y) * dy) / (dx * dx + dy * dy || 1)));
    ctx.strokeStyle = par.color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(it.head.x, it.head.y);
    ctx.lineTo(par.head.x + dx * t, par.head.y + dy * t);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  for (const it of r.list) {
    const hotHead = hover?.kind === 'head' && hover.it.id === it.id;
    if (!it.b.parentId) joint(it.head, { root: true, hot: hotHead });
    else if (it.b.offset) joint(it.head, { hot: hotHead });
    joint(it.tail, { pinned: !!it.b.pin, hot: hover?.kind === 'tail' && hover.it.id === it.id });
  }

  ctx.restore();
}

/** Osso sendo desenhado (vale também para o primeiro osso, quando ainda não há esqueleto). */
function drawDraft(ctx, st) {
  if (st?.mode !== 'create' || !st.tail) return;
  const a = st.scr(st.head), b = st.scr(st.tail);
  ctx.save();
  ctx.strokeStyle = MODE_COLOR.edit;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, JOINT_R, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/** Indicador de modo e de auto-key, por cima do palco, enquanto a ferramenta Ossos está ativa. */
function rigBadge(stage, editor) {
  let el = null;
  const render = () => {
    const show = editor.tool === 'bone';
    if (!show) {
      if (el) el.hidden = true;
      return;
    }
    if (!el) {
      const host = stage.canvas.parentElement;
      if (!host) return;
      el = document.createElement('div');
      el.className = 'rig-badge';
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-rig]');
        if (!b) return;
        const a = b.dataset.rig;
        if (a === 'edit' || a === 'pose') editor.setRigMode(a);
        if (a === 'autokey') editor.setRigState({ autoKey: !editor.rigState().autoKey });
        if (a === 'show') editor.setRigState({ show: !editor.rigState().show });
        stage.canvas.focus();
      });
      host.appendChild(el);
    }
    el.hidden = false;
    const mode = editor.rigMode();
    const rs = editor.rigState();
    const hasRig = editor.rigBones().length > 0;
    const hint =
      mode === 'edit'
        ? hasRig
          ? 'Arraste da ponta para continuar a cadeia · Alt+arrastar move a junta · Ctrl+clique numa parte prende/solta · Delete apaga'
          : 'Arraste no palco para desenhar o primeiro osso (dentro da parte que ele vai mover)'
        : hasRig
          ? 'Arraste um osso ou uma parte (IK) · Ctrl: gira só o osso (FK) · quadrado: move tudo · duplo clique na junta: fixar'
          : 'Ainda não há ossos nesta camada: passe para Editar rig (M) e desenhe os ossos';
    el.dataset.mode = mode;
    el.innerHTML = `
      <div class="rig-row">
        <div class="rig-seg" role="group" aria-label="Modo dos ossos">
          <button data-rig="edit" class="${mode === 'edit' ? 'on' : ''}" title="Montar e ajustar os ossos (M alterna)">Editar rig</button>
          <button data-rig="pose" class="${mode === 'pose' ? 'on' : ''}" title="Posar e animar (M alterna)">Posar</button>
        </div>
        <span class="rig-key">M</span>
        <button data-rig="autokey" class="rig-chip ${rs.autoKey ? 'rec' : ''}" title="Auto-key: posar cria o keyframe sozinho">
          <span class="dot"></span>Auto-key ${rs.autoKey ? 'ligado' : 'desligado'}</button>
        <button data-rig="show" class="rig-chip" title="Mostrar/ocultar as alças dos ossos">${rs.show ? 'Ocultar alças' : 'Mostrar alças'}</button>
      </div>
      <div class="rig-hint">${hint}</div>`;
  };
  for (const t of ['tool', 'rig', 'layers', 'doc', 'load', 'context']) editor.on(t, render);
  editor.on('frame', () => {
    if (editor.tool === 'bone' && !editor.player.playing) render();
  });
  return render;
}

export function boneTool(stage, editor) {
  let st = null;
  let hover = null;
  rigBadge(stage, editor);
  const toLayer = (r, e) => applyPoint(inv(r.lm), e.wx, e.wy);
  const activeArt = (e) => {
    const hit = stage.hitTest(e.wx, e.wy);
    return hit && hit.layer.id === editor.activeLayerId ? hit : null;
  };
  const select = (id) => {
    if (editor.rigState().selected !== id) editor.setRigState({ selected: id });
  };
  const snapAngle = (from, to, e) => {
    if (!e.shift) return to;
    const a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 12)) * (Math.PI / 12);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d };
  };

  /** Começa a posar (o keyframe só é criado quando o arraste começa de verdade). */
  function startPose(r, e, mode, boneId, local) {
    st = { mode, boneId, local, start: e, startLayer: toLayer(r, e), lmInv: inv(r.lm), moved: false };
    select(boneId);
  }

  function beginPoseDrag() {
    const n0 = editor.history.undoStack.length;
    const span = editor.poseSpan();
    if (!span?.armature) {
      st = null;
      return false;
    }
    st.span = span;
    st.before = clone(span.armature);
    st.created = editor.history.undoStack.length - n0;
    st.lastAngle = null;
    return true;
  }

  return {
    cursor: 'crosshair',
    down(e) {
      const r = rigScreen(stage, editor);
      const mode = editor.rigMode();
      const hit = r && hitRig(r, e.sx, e.sy);
      const rs = editor.rigState();

      if (mode === 'edit') {
        const layer = editor.activeLayer;
        if (!layer || layer.type === 'folder' || layer.type === 'camera') return editor.toast('Escolha uma camada de desenho para pôr ossos.');
        if (!editor.spanAt(layer) && !r) return editor.toast('Este quadro está vazio nesta camada: vá para um quadro com o desenho.');
        // alças do limite do osso selecionado
        const selIt = r?.list.find((x) => x.id === rs.selected);
        if (selIt) {
          const lh = limitHandles(r, selIt);
          for (const which of ['min', 'max']) {
            const p = which === 'min' ? lh.minP : lh.maxP;
            if (Math.hypot(p.x - e.sx, p.y - e.sy) <= 8) {
              st = { mode: 'limit', id: selIt.id, which, lh, value: lh[which], other: lh[which === 'min' ? 'max' : 'min'] };
              return;
            }
          }
        }
        // Ctrl+clique numa parte: prende/solta do osso selecionado
        if (e.ctrl) {
          const art = activeArt(e);
          if (!art) return;
          if (!rs.selected) return editor.toast('Selecione um osso (clique nele) e depois Ctrl+clique na parte.');
          return editor.toggleBind(art.el.id, rs.selected);
        }
        if (hit && e.alt && (hit.kind === 'tail' || hit.kind === 'head')) {
          select(hit.it.id);
          st = { mode: 'joint', id: hit.it.id, which: hit.kind, before: layer.frames, start: e, moved: false };
          return;
        }
        // novo osso. De onde ele sai decide o pai:
        // - ponta de um osso: continua a cadeia (filho);
        // - cabeça da raiz: galho da raiz ali (pernas saindo do quadril); cabeça de um galho: irmão dele;
        // - em cima de um osso ou dentro de uma parte presa: galho daquele osso (braço saindo do tronco);
        // - em qualquer outro lugar: osso raiz novo.
        const lm = r ? r.lm : editor.layerMatrixOf(layer);
        const here = applyPoint(inv(lm), e.wx, e.wy);
        let head = here, parentId = null, branch = false;
        if (hit?.kind === 'tail') [head, parentId] = [hit.it.s.tail, hit.it.id];
        else if (hit?.kind === 'head') [head, parentId, branch] = [hit.it.s.head, hit.it.b.parentId || hit.it.id, true];
        else if (hit?.kind === 'shaft') {
          select(hit.it.id);
          [parentId, branch] = [hit.it.id, true];
        } else if (r) {
          const art = activeArt(e);
          const bb = art ? boundBones(art.src || art.el) : [];
          const ids = bb === 'all' ? r.list.map((x) => x.id) : bb;
          let bd = Infinity;
          for (const x of r.list) {
            if (!ids.includes(x.id)) continue;
            const d = distToSegment(here.x, here.y, x.s.head, x.s.tail);
            if (d < bd) [bd, parentId, branch] = [d, x.id, true];
          }
        }
        st = {
          mode: 'create',
          parentId,
          branch,
          head,
          lm,
          pickOnly: hit?.kind === 'shaft',
          scr: (p) => {
            const w = applyPoint(lm, p.x, p.y);
            return stage.toScreen(w.x, w.y);
          },
        };
        return;
      }

      // ----- Posar -----
      if (!r) return editor.toast('Esta camada não tem ossos. Passe para Editar rig (M) e desenhe os ossos.');
      if (hit?.kind === 'head' && !hit.it.b.parentId) {
        st = { mode: 'root', start: e, startLayer: toLayer(r, e), lmInv: inv(r.lm), moved: false, boneId: hit.it.id };
        select(hit.it.id);
        return;
      }
      if (hit) {
        const it = hit.it;
        const p = hit.kind === 'shaft' ? toLayer(r, e) : null;
        const local = p ? localOn(it.s, p) : hit.kind === 'head' ? { x: 0, y: 0 } : { x: it.b.length, y: 0 };
        return startPose(r, e, e.ctrl ? 'fk' : 'ik', it.id, local);
      }
      const art = activeArt(e);
      if (art) {
        const bb = boundBones(art.src || art.el);
        const ids = bb === 'all' ? r.list.map((x) => x.id) : bb;
        const p = toLayer(r, e);
        let best = null, bd = Infinity;
        for (const x of r.list) {
          if (!ids.includes(x.id)) continue;
          const d = distToSegment(p.x, p.y, x.s.head, x.s.tail);
          if (d < bd) [bd, best] = [d, x];
        }
        if (best) return startPose(r, e, e.ctrl ? 'fk' : 'ik', best.id, localOn(best.s, p));
        return editor.toast('Esta parte não está presa a nenhum osso. Em Editar rig, selecione o osso e Ctrl+clique na parte.');
      }
      select(null);
    },

    move(e) {
      if (!st) return;
      const r = rigScreen(stage, editor);
      if (st.mode === 'create') {
        const t = applyPoint(inv(st.lm), e.wx, e.wy);
        st.tail = snapAngle(st.head, t, e);
        stage.invalidate();
        return;
      }
      if (st.mode === 'limit') {
        const a = Math.atan2(e.sy - st.lh.c.y, e.sx - st.lh.c.x) - st.lh.sa;
        let v = wrap(a);
        if (e.shift) v = Math.round(v / (Math.PI / 12)) * (Math.PI / 12);
        // o mínimo fica no lado negativo e o máximo no positivo
        st.value = st.which === 'min' ? Math.min(0, v) : Math.max(0, v);
        stage.invalidate();
        return;
      }
      if (st.mode === 'joint') {
        if (!st.moved && Math.hypot(e.sx - st.start.sx, e.sy - st.start.sy) < 2) return;
        st.moved = true;
        const layer = editor.activeLayer;
        layer.frames = st.before;
        const rr = rigScreen(stage, editor);
        if (!rr) return;
        editor.moveJoint(st.id, st.which, applyPoint(inv(rr.lm), e.wx, e.wy), { live: true });
        stage.invalidate();
        return;
      }
      if (st.mode === 'pick') return;
      // ----- posar -----
      if (!st.moved) {
        if (Math.hypot(e.sx - st.start.sx, e.sy - st.start.sy) < 3) return;
        if (!beginPoseDrag()) return;
        st.moved = true;
      }
      const target = applyPoint(st.lmInv, e.wx, e.wy);
      const arm = st.span.armature;
      let pose = arm.pose || {};
      if (st.mode === 'ik') pose = solveIK(arm, pose, st.boneId, target, 16, { local: st.local });
      else if (st.mode === 'root') pose = moveRoot(arm, st.before.pose || {}, target.x - st.startLayer.x, target.y - st.startLayer.y);
      else if (st.mode === 'fk') {
        const s = r?.list.find((x) => x.id === st.boneId)?.s;
        if (s) {
          const a = Math.atan2(target.y - s.head.y, target.x - s.head.x);
          if (st.lastAngle != null) pose = rotateBone(arm, pose, st.boneId, wrap(a - st.lastAngle));
          st.lastAngle = a;
        }
      }
      st.span.armature = { ...arm, pose };
      stage.invalidate();
    },

    up() {
      if (!st) return;
      const s = st;
      st = null;
      if (s.mode === 'create') {
        const tail = s.tail;
        const a = s.scr(s.head), b = tail && s.scr(tail);
        if (!tail || Math.hypot(b.x - a.x, b.y - a.y) < 8) {
          // clique simples: no osso, seleciona (já foi); fora, tira a seleção
          if (!s.pickOnly) select(null);
          return stage.invalidate();
        }
        // prende a parte que está embaixo do meio do osso (ou da ponta)
        const lm = s.lm;
        const mid = applyPoint(lm, (s.head.x + tail.x) / 2, (s.head.y + tail.y) / 2);
        const tip = applyPoint(lm, tail.x, tail.y);
        const pick = (p) => {
          const h = stage.hitTest(p.x, p.y);
          if (!h || h.layer.id !== editor.activeLayerId) return null;
          const bb = boundBones(h.src || h.el);
          if (bb !== 'all' && !bb.length) return h; // parte solta: passa a seguir o osso novo
          // parte já presa: só soma o osso quando a cadeia continua dentro dela (linha ou braço de um traço só);
          // um galho saindo de dentro do tronco não pode fazer o tronco dobrar junto
          return !s.branch && s.parentId && (bb === 'all' || bb.includes(s.parentId)) && (h.src || h.el).type === 'shape' ? h : null;
        };
        const target = pick(mid) || pick(tip);
        const bone = editor.addBone(s.head, tail, s.parentId, target?.el.id || null, { branch: s.branch });
        if (!bone) return;
        if (target) editor.toast(`${bone.name} criado e preso à parte embaixo dele.`);
        else editor.toast(`${bone.name} criado. Para prender uma parte: Ctrl+clique nela (ou "Prender arte" no painel).`);
        return;
      }
      if (s.mode === 'limit') {
        const v = s.value;
        const patch = s.which === 'min' ? { min: v, max: Number.isFinite(s.other) ? s.other : Math.PI / 2 } : { max: v, min: Number.isFinite(s.other) ? s.other : -Math.PI / 2 };
        editor.setBoneProps(s.id, patch, 'Limite do osso');
        return;
      }
      if (s.mode === 'joint') {
        const layer = editor.activeLayer;
        if (s.moved && layer.frames !== s.before) editor.commit(new C.SetLayerFrames(layer.id, s.before, layer.frames, 'Mover junta'));
        editor.emit('rig');
        return;
      }
      if (s.mode === 'pick' || !s.moved) return stage.invalidate();
      const label = s.mode === 'root' ? 'Mover esqueleto' : 'Pose';
      editor.commit(new C.SetSpanProps(editor.activeLayerId, s.span.start, { armature: s.before }, { armature: s.span.armature }, label));
      if (s.created) editor.history.squash(s.created + 1, label);
      editor.emit('rig');
    },

    cancel() {
      if (st?.mode === 'joint' && st.moved) editor.activeLayer.frames = st.before;
      if (st?.span && st.before) st.span.armature = st.before;
      st = null;
    },

    dblclick(e) {
      const r = rigScreen(stage, editor);
      const hit = r && hitRig(r, e.sx, e.sy);
      if (!hit) return;
      const b = hit.it.b;
      editor.setBoneProps(b.id, { pin: !b.pin }, b.pin ? 'Soltar junta' : 'Fixar junta');
      editor.toast(b.pin ? `${b.name || 'Osso'}: junta solta.` : `${b.name || 'Osso'}: junta fixada (fica parada quando outros ossos mexem).`);
    },

    keydown(e) {
      if (e.altKey) return false;
      const k = e.key.toLowerCase();
      const rs = editor.rigState();
      if (k === 'm' && !e.shiftKey) {
        editor.setRigMode(editor.rigMode() === 'edit' ? 'pose' : 'edit');
        return true;
      }
      if (!rs.selected || !editor.rigBones().some((b) => b.id === rs.selected)) return false;
      const bone = editor.rigBones().find((b) => b.id === rs.selected);
      if ((k === 'delete' || k === 'backspace') && editor.rigMode() === 'edit') {
        editor.deleteBone(bone.id);
        editor.toast(`${bone.name || 'Osso'} apagado.`);
        return true;
      }
      if (k === 'p') {
        editor.setBoneProps(bone.id, { pin: !bone.pin }, bone.pin ? 'Soltar junta' : 'Fixar junta');
        return true;
      }
      if (k === 'escape') {
        select(null);
        return true;
      }
      return false;
    },

    hover(e) {
      const r = rigScreen(stage, editor);
      const mode = editor.rigMode();
      const hit = r && hitRig(r, e.sx, e.sy);
      const key = hit ? `${hit.kind}:${hit.it.id}` : '';
      if (key !== (hover ? `${hover.kind}:${hover.it.id}` : '')) {
        hover = hit;
        stage.invalidate();
      }
      if (mode === 'edit') {
        if (hit && (hit.kind === 'tail' || hit.kind === 'head')) return stage.setCursor(e.alt ? 'move' : 'crosshair');
        if (hit) return stage.setCursor('pointer');
        return stage.setCursor(e.ctrl && activeArt(e) ? 'copy' : 'crosshair');
      }
      if (hit?.kind === 'head' && !hit.it.b.parentId) return stage.setCursor('move');
      if (hit || (r && activeArt(e))) return stage.setCursor('grab');
      stage.setCursor('default');
    },

    drawScreen(ctx) {
      drawSkeleton(stage, editor, ctx, { full: true, hover, st });
      drawDraft(ctx, st);
      // posar com auto-key: moldura vermelha no palco, como "gravando"
      if (editor.rigMode() === 'pose' && editor.rigState().autoKey && editor.rigBones().length) {
        const c = stage.canvas;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 69, 58, 0.85)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, c.clientWidth - 3, c.clientHeight - 3);
        ctx.restore();
      }
    },
  };
}

/** Ponto p (espaço da camada) no sistema do osso: x ao longo do osso, y para o lado. */
function localOn(s, p) {
  const dx = p.x - s.head.x, dy = p.y - s.head.y;
  const c = Math.cos(s.angle), n = Math.sin(s.angle);
  return { x: dx * c + dy * n, y: -dx * n + dy * c };
}
