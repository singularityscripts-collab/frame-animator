// Painel "Esqueleto" nas propriedades (ferramenta Ossos): modo, auto-key, hierarquia dos ossos
// com seleção por nome, osso selecionado (nome, pino, limites) e ações de rig e de pose.

import { esc } from './ui-kit.js';
import { orderedBones } from '../player/bones.js';
import { getSpanAt } from '../player/render.js';
import { boneColor, boundBones } from './rig.js';

const DEG = 180 / Math.PI;
const fmt = (r) => String(Math.round(r * DEG));

/** Cria a seção (uma vez por reconstrução do painel). */
export function buildRig(ui) {
  const sec = ui.section('Esqueleto', '<div class="rig-panel"></div>');
  const body = sec.querySelector('.rig-panel');
  const ed = ui.editor;
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-bone],[data-pin],[data-ra],[data-mode],[data-pose-apply],[data-pose-del],[data-smart-edit],[data-smart-del]');
    if (!t) return;
    if (t.dataset.mode) return ed.setRigMode(t.dataset.mode);
    if (t.dataset.poseApply) return ed.applyPose(t.dataset.poseApply);
    if (t.dataset.poseDel) return ed.deletePose(t.dataset.poseDel);
    if (t.dataset.smartEdit) return ed.setRigState({ smartEdit: ed.rigState().smartEdit === t.dataset.smartEdit ? null : t.dataset.smartEdit });
    if (t.dataset.smartDel) return ed.deleteSmartCorrection(t.dataset.smartDel);
    if (t.dataset.pin) {
      const b = ed.rigBones().find((x) => x.id === t.dataset.pin);
      if (b) ed.setBoneProps(b.id, { pin: !b.pin }, b.pin ? 'Soltar junta' : 'Fixar junta');
      return;
    }
    if (t.dataset.bone) return ed.setRigState({ selected: t.dataset.bone });
    const sel = ed.rigState().selected;
    const a = t.dataset.ra;
    if (a === 'autoBind') ed.autoBind();
    if (a === 'remove') ed.removeArmature();
    if (a === 'delete' && sel) ed.deleteBone(sel);
    if (a === 'copy') ed.copyPose();
    if (a === 'paste') ed.pastePose();
    if (a === 'mirror') ed.mirrorPose();
    if (a === 'reset') ed.resetPose();
    if (a === 'poseSave') ed.savePose();
    if (a === 'smartNew') ed.addSmartCorrection();
    if (a === 'smartDone') ed.setRigState({ smartEdit: null });
    if (a === 'smartClearBones' && ed.rigState().smartEdit) ed.clearSmartBones(ed.rigState().smartEdit);
    if (a === 'paintPoints') ed.setRigState({ paintPoints: !ed.rigState().paintPoints });
  });
  body.addEventListener('change', (e) => {
    const t = e.target;
    const sel = ed.rigState().selected;
    // valor confirmado (Enter ou sair do campo): solta o foco para o painel se atualizar
    if (t.matches('input[type=text],input[type=number]')) t.blur();
    if (t.dataset.rk) return ed.setRigState({ [t.dataset.rk]: t.checked });
    if (!sel) return;
    const b = ed.rigBones().find((x) => x.id === sel);
    if (!b) return;
    if (t.dataset.bf === 'name') {
      const name = t.value.trim().slice(0, 40);
      if (name && name !== b.name) ed.setBoneProps(sel, { name }, 'Renomear osso');
    }
    if (t.dataset.bf === 'pin') ed.setBoneProps(sel, { pin: t.checked }, t.checked ? 'Fixar junta' : 'Soltar junta');
    if (t.dataset.bf === 'limit') ed.setBoneProps(sel, t.checked ? { min: -Math.PI / 2, max: Math.PI / 2 } : { min: null, max: null }, 'Limite do osso');
    if (t.dataset.bf === 'strength') ed.setBoneProps(sel, { strength: Math.max(0.1, Math.min(5, Number(t.value) || 1)) }, 'Força do osso');
    if (t.dataset.bf === 'dyn') ed.setBoneProps(sel, { dynamics: t.checked ? { stiffness: 0.2, damping: 0.15, gravity: 0 } : null }, t.checked ? 'Ligar dinâmica' : 'Desligar dinâmica');
    if (t.dataset.bf?.startsWith('dyn') && t.dataset.bf !== 'dyn' && b.dynamics) {
      const key = { dynStiff: 'stiffness', dynDamp: 'damping', dynGrav: 'gravity' }[t.dataset.bf];
      const v = Number(t.value) || 0;
      const val = key === 'gravity' ? Math.max(-5, Math.min(5, v)) : Math.max(0, Math.min(100, v)) / 100;
      ed.setBoneProps(sel, { dynamics: { ...b.dynamics, [key]: val } }, 'Dinâmica do osso');
    }
    if (t.dataset.bf === 'min' || t.dataset.bf === 'max') {
      const v = Math.max(-180, Math.min(180, Number(t.value) || 0)) / DEG;
      ed.setBoneProps(sel, { [t.dataset.bf]: v }, 'Limite do osso');
    }
  });
  // duplo clique no nome da hierarquia: vai direto para o campo de nome
  body.addEventListener('dblclick', (e) => {
    if (!e.target.closest('[data-bone]')) return;
    const inp = body.querySelector('[data-bf="name"]');
    inp?.focus();
    inp?.select();
  });
  ui.rigBody = body;
  refreshRig(ui);
}

/** Redesenha o conteúdo (sem atrapalhar quem está digitando num campo do painel). */
export function refreshRig(ui) {
  const body = ui.rigBody;
  if (!body?.isConnected) return;
  if (body.contains(document.activeElement) && document.activeElement.matches('input[type=text],input[type=number]')) return;
  const ed = ui.editor;
  const mode = ed.rigMode();
  const rs = ed.rigState();
  const bones = ed.rigBones();
  const byId = new Map(bones.map((b) => [b.id, b]));
  const depth = (b) => {
    let d = 0;
    for (let p = b.parentId && byId.get(b.parentId); p && d < 32; p = p.parentId && byId.get(p.parentId)) d++;
    return d;
  };
  const sel = byId.get(rs.selected);
  const span = getSpanAt(ed.activeLayer, ed.frame);
  const parts = sel && span ? span.elements.filter((el) => {
    const bb = boundBones(el);
    return bb === 'all' || bb.includes(sel.id);
  }).length : 0;

  const tree = bones.length
    ? `<ul class="bone-tree" role="listbox" aria-label="Ossos">${orderedBones({ bones })
        .map(
          (b) => `<li role="option" aria-selected="${b.id === rs.selected}" class="${b.id === rs.selected ? 'on' : ''}" data-bone="${b.id}" style="padding-left:${6 + depth(b) * 14}px">
            <span class="bone-dot" style="background:${boneColor(bones, b.id)}"></span>
            <span class="bone-name">${esc(b.name || 'Osso')}</span>
            ${Number.isFinite(b.min) || Number.isFinite(b.max) ? '<span class="bone-tag" title="Tem limite de ângulo">∢</span>' : ''}
            <button class="bone-pin ${b.pin ? 'on' : ''}" data-pin="${b.id}" title="${b.pin ? 'Soltar junta' : 'Fixar junta'} (P)">${b.pin ? 'fixa' : 'fixar'}</button>
          </li>`,
        )
        .join('')}</ul>`
    : `<p class="hint">${mode === 'edit' ? 'Nenhum osso nesta camada. Arraste no palco, de dentro da parte que o osso vai mover.' : 'Nenhum osso nesta camada. Passe para Editar rig para desenhar.'}</p>`;

  const selHtml = sel
    ? `<div class="rig-sel">
        <label class="field wide"><span style="flex:0 0 46px">Nome</span><input type="text" data-bf="name" value="${esc(sel.name || '')}" maxlength="40" style="flex:1"></label>
        <label class="field wide"><input type="checkbox" data-bf="pin" ${sel.pin ? 'checked' : ''}><span>Fixar junta (P) · fica parada quando outros ossos mexem</span></label>
        <label class="field wide"><input type="checkbox" data-bf="limit" ${Number.isFinite(sel.min) || Number.isFinite(sel.max) ? 'checked' : ''}><span>Limitar ângulo</span></label>
        ${
          Number.isFinite(sel.min) || Number.isFinite(sel.max)
            ? `<div class="prop-grid">
                <label class="field"><span>Mín °</span><input type="number" min="-180" max="0" step="5" data-bf="min" value="${fmt(sel.min ?? -Math.PI)}"></label>
                <label class="field"><span>Máx °</span><input type="number" min="0" max="180" step="5" data-bf="max" value="${fmt(sel.max ?? Math.PI)}"></label>
              </div>
              <p class="hint">${mode === 'edit' ? 'Ou arraste as bolinhas do arco no palco.' : 'Em Editar rig, dá para arrastar o arco no palco.'}</p>`
            : ''
        }
        ${mode === 'edit' ? `<label class="field wide"><span style="flex:1">Força (influência na pele)</span><input type="number" min="0.1" max="5" step="0.1" data-bf="strength" value="${sel.strength ?? 1}" style="flex:0 0 70px"></label>
        <p class="hint">As bolinhas na forma mostram o quanto cada ponto segue este osso. Mais força = puxa uma área maior.</p>` : ''}
        <label class="field wide"><input type="checkbox" data-bf="dyn" ${sel.dynamics ? 'checked' : ''}><span>Dinâmica: balança sozinho (cabelo, rabo, orelha)</span></label>
        ${
          sel.dynamics
            ? `<div class="prop-grid">
                <label class="field"><span>Rigidez</span><input type="number" min="0" max="100" step="5" data-bf="dynStiff" value="${Math.round((sel.dynamics.stiffness ?? 0.2) * 100)}"></label>
                <label class="field"><span>Amortecer</span><input type="number" min="0" max="100" step="5" data-bf="dynDamp" value="${Math.round((sel.dynamics.damping ?? 0.15) * 100)}"></label>
                <label class="field"><span>Gravidade</span><input type="number" min="-5" max="5" step="0.1" data-bf="dynGrav" value="${sel.dynamics.gravity ?? 0}"></label>
              </div>
              <p class="hint">O balanço aparece ao tocar e ao trocar de quadro (o esqueleto mostra a pose com keys).</p>`
            : ''
        }
        ${mode === 'pose' ? smartHtml(ed, sel) : ''}
        ${mode === 'edit' ? `<button class="btn-flat full ${rs.paintPoints ? 'on' : ''}" data-ra="paintPoints" title="Passe o pincel sobre os pontos da forma para prender ao osso; Alt solta">${rs.paintPoints ? 'Pincel de pontos: ligado' : 'Pincel de pontos'}</button>
        ${rs.paintPoints ? '<p class="hint">Arraste sobre os pontos da forma: eles passam a seguir só este osso (bolinha cheia). Alt+arraste solta. Shift: pincel maior.</p>' : ''}
        <p class="hint">${parts ? `${parts} ${parts === 1 ? 'parte presa' : 'partes presas'} a este osso (moldura na cor dele no palco).` : 'Nenhuma parte presa a este osso: Ctrl+clique numa parte no palco.'}</p>
        <button class="btn-flat full danger-hover" data-ra="delete" title="Delete">Apagar osso</button>` : ''}
      </div>`
    : bones.length
      ? '<p class="hint">Clique num osso (no palco ou na lista) para ver nome, pino e limites.</p>'
      : '';

  const actions =
    mode === 'edit'
      ? bones.length
        ? `<div class="prop-grid">
            <button class="btn-flat" data-ra="autoBind" title="Cada parte solta vai para o osso mais perto">Prender arte</button>
            <button class="btn-flat" data-ra="remove" title="Tira todos os ossos desta camada">Tirar ossos</button>
          </div>`
        : ''
      : bones.length
        ? `<div class="prop-grid">
            <button class="btn-flat" data-ra="copy">Copiar pose</button>
            <button class="btn-flat" data-ra="paste" ${rs.clip ? '' : 'disabled'}>Colar pose</button>
            <button class="btn-flat" data-ra="mirror" title="Troca esquerda e direita (pernas e braços)">Espelhar pose</button>
            <button class="btn-flat" data-ra="reset" title="${sel ? 'Zera o osso selecionado e os filhos' : 'Zera o esqueleto todo'}">${sel ? 'Zerar osso' : 'Zerar pose'}</button>
          </div>
          ${posesHtml(ed)}`
        : '';

  body.innerHTML = `
    <div class="rig-seg wide" role="group" aria-label="Modo dos ossos">
      <button data-mode="edit" class="${mode === 'edit' ? 'on' : ''}">Editar rig</button>
      <button data-mode="pose" class="${mode === 'pose' ? 'on' : ''}">Posar</button>
    </div>
    <p class="hint" style="margin-top:4px">M alterna entre os modos.</p>
    <label class="field wide"><input type="checkbox" data-rk="autoKey" ${rs.autoKey ? 'checked' : ''}><span>Auto-key: posar cria o keyframe sozinho</span></label>
    <label class="field wide"><input type="checkbox" data-rk="show" ${rs.show ? 'checked' : ''}><span>Mostrar as alças dos ossos</span></label>
    <h4 class="rig-h">Ossos</h4>
    ${tree}
    ${selHtml}
    ${actions}`;
}

/** Correções Smart Bone do osso selecionado (modo Posar). */
function smartHtml(ed, sel) {
  const list = ed.smartCorrections(sel.id);
  const editing = ed.rigState().smartEdit;
  const rows = list
    .map((c) => {
      const w = Math.round(ed.smartWeightNow(c.id) * 100);
      const n = Object.values(c.shapes || {}).reduce((a, x) => a + Object.keys(x).length, 0);
      const nb = Object.keys(c.bones || {}).length;
      return `<li class="${c.id === editing ? 'on' : ''}"><span class="bone-name">${fmt(c.angle)}° · ${n} ${n === 1 ? 'ponto' : 'pontos'}${nb ? ` · gira ${nb} ${nb === 1 ? 'osso' : 'ossos'}` : ''} · agora ${w}%</span>
        <button class="bone-pin ${c.id === editing ? 'on' : ''}" data-smart-edit="${c.id}">${c.id === editing ? 'editando' : 'editar'}</button>
        <button class="bone-pin" data-smart-del="${c.id}" title="Apagar correção">×</button></li>`;
    })
    .join('');
  const cur = list.find((c) => c.id === editing);
  return `<h4 class="rig-h">Smart Bone (correções)</h4>
    ${rows ? `<ul class="bone-tree">${rows}</ul>` : '<p class="hint">Dobre o osso (ex.: cotovelo a 90°) e crie uma correção: ao chegar nesse ângulo, a forma ajusta sozinha (o cotovelo não amassa).</p>'}
    ${cur ? `<p class="hint"><b>Editando:</b> arraste os pontos amarelos da forma no palco. Girar <b>outro</b> osso agora também entra na correção (ex.: o pé acompanha o joelho). O ajuste aparece aos poucos conforme o osso gira.</p>
      ${cur.bones ? '<button class="btn-flat full" data-ra="smartClearBones">Tirar os giros de outros ossos</button>' : ''}
      <button class="btn-flat full" data-ra="smartDone">Concluir correção</button>` : '<button class="btn-flat full" data-ra="smartNew">Nova correção neste ângulo</button>'}`;
}

/** Biblioteca de poses da camada (modo Posar). */
function posesHtml(ed) {
  const poses = ed.poseAt()?.arm.poses || [];
  const rows = poses
    .map((p) => `<li><span class="bone-name">${esc(p.name)}</span><button class="bone-pin" data-pose-apply="${p.id}">aplicar</button><button class="bone-pin" data-pose-del="${p.id}" title="Apagar pose">×</button></li>`)
    .join('');
  return `<h4 class="rig-h">Biblioteca de poses</h4>
    ${rows ? `<ul class="bone-tree">${rows}</ul>` : '<p class="hint">Guarde poses (mão aberta, boca, piscar…) para aplicar com um clique em qualquer quadro.</p>'}
    <button class="btn-flat full" data-ra="poseSave">Guardar pose atual</button>`;
}
