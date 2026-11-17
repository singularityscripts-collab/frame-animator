// Atualização automática (interface): um cartão no canto do palco que avisa da versão nova,
// mostra as novidades, baixa com barra de progresso e reinicia o app já atualizado.
// Ajuda › Procurar atualizações faz a mesma coisa na hora; ao abrir o app, procura sozinho
// (no máximo a cada 6 horas, e dá para desligar no próprio cartão).

import { esc, openDialog } from './ui-kit.js';

const AUTO_KEY = 'fa-update-auto';
const LAST_KEY = 'fa-update-last';
const SKIP_KEY = 'fa-update-skip';
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  },
};
const mb = (n) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',')} MB`;

/** Novidades da release (markdown simples) → lista curta. */
function notesHtml(md) {
  const lines = String(md || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s*$/.test(l));
  const items = [];
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l)) items.push(`<li class="up-h">${esc(l.replace(/^#+\s*/, ''))}</li>`);
    else items.push(`<li>${esc(l.replace(/^[-*]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1'))}</li>`);
    if (items.length >= 8) break;
  }
  return items.length ? `<ul class="up-notes">${items.join('')}</ul>` : '';
}

export function installUpdates({ editor, actions, io }) {
  const api = window.api;
  let card = null;
  let info = null;
  let busy = false;

  const close = () => {
    if (!card || busy) return;
    const c = card;
    card = null;
    c.classList.add('leaving');
    setTimeout(() => c.remove(), 220);
  };
  const show = (html, { tone = '' } = {}) => {
    if (!card) {
      card = document.createElement('div');
      card.className = 'update-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Atualização do Frame Animator');
      document.getElementById('stage-wrap').appendChild(card);
    }
    card.dataset.tone = tone;
    card.innerHTML = `<button class="up-x" aria-label="Fechar" title="Fechar">×</button>${html}`;
    card.querySelector('.up-x').addEventListener('click', close);
    return card;
  };
  const on = (sel, fn) => card?.querySelector(sel)?.addEventListener('click', fn);

  function showAvailable(r) {
    const can = r.canInstall;
    show(
      `<div class="up-head"><div class="up-badge">Nova versão</div><h3>Frame Animator ${esc(r.latest)}</h3><p class="up-sub">Você está na ${esc(r.current)}${r.size ? ` · download de ${mb(r.size)}` : ''}</p></div>
       ${notesHtml(r.notes)}
       <div class="up-actions">
         <button class="up-primary" data-go>${can ? 'Atualizar agora' : 'Abrir a página da versão'}</button>
         <button class="up-ghost" data-later>Depois</button>
       </div>
       <div class="up-foot">
         <button class="up-link" data-skip>Pular esta versão</button>
         <label class="up-auto"><input type="checkbox" ${store.get(AUTO_KEY) === 'off' ? '' : 'checked'}> Procurar sozinho ao abrir</label>
       </div>
       ${can ? '' : '<p class="up-sub">Este app está rodando pelo código-fonte: a atualização automática só funciona no app instalado.</p>'}`,
      { tone: 'new' },
    );
    on('[data-go]', () => (can ? startDownload() : api.openUrl(r.url)));
    on('[data-later]', close);
    on('[data-skip]', () => {
      store.set(SKIP_KEY, r.latest);
      close();
    });
    card.querySelector('.up-auto input').addEventListener('change', (e) => store.set(AUTO_KEY, e.target.checked ? 'on' : 'off'));
  }

  async function startDownload() {
    busy = true;
    show(
      `<div class="up-head"><h3>Baixando a versão ${esc(info.latest)}…</h3><p class="up-sub" data-status>Conectando ao GitHub</p></div>
       <div class="up-bar"><div class="up-fill"></div></div>
       <div class="up-actions"><button class="up-ghost" data-cancel>Cancelar</button></div>`,
      { tone: 'busy' },
    );
    on('[data-cancel]', () => api.update.cancel());
    try {
      await api.update.download();
      busy = false;
      showReady();
    } catch (err) {
      busy = false;
      const msg = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (/abort/i.test(msg)) return close();
      showError(`Não deu para baixar: ${msg}.`);
    }
  }

  function showReady() {
    show(
      `<div class="up-head"><div class="up-badge ok">Pronto</div><h3>Versão ${esc(info.latest)} baixada</h3>
       <p class="up-sub">O Frame Animator fecha, instala a atualização e abre de novo sozinho. Leva poucos segundos.</p></div>
       <div class="up-actions"><button class="up-primary" data-install>Instalar e reiniciar</button><button class="up-ghost" data-later>Na próxima vez</button></div>`,
      { tone: 'ok' },
    );
    on('[data-install]', async () => {
      // alterações não salvas: pergunta antes, como ao fechar o app
      if (!(await io.confirmDiscard())) return;
      busy = true;
      card.querySelector('.up-actions').innerHTML = '<p class="up-sub">Abrindo o instalador…</p>';
      api.update.install();
    });
    on('[data-later]', close);
  }

  function showError(msg) {
    show(
      `<div class="up-head"><h3>Atualização</h3><p class="up-sub">${esc(msg)}</p></div>
       <div class="up-actions"><button class="up-primary" data-retry>Tentar de novo</button><button class="up-ghost" data-later>Fechar</button></div>`,
      { tone: 'err' },
    );
    on('[data-retry]', () => check(true));
    on('[data-later]', close);
  }

  async function check(manual) {
    if (!api?.update) {
      if (manual) editor.toast('A atualização automática só existe no app para Windows (não no navegador).');
      return;
    }
    if (manual)
      show('<div class="up-head"><h3>Procurando atualizações…</h3><p class="up-sub">Consultando as versões publicadas no GitHub</p></div><div class="up-bar indeterminate"><div class="up-fill"></div></div>', {
        tone: 'busy',
      });
    try {
      const r = await api.update.check();
      info = r;
      store.set(LAST_KEY, String(Date.now()));
      if (r.available) {
        if (!manual && store.get(SKIP_KEY) === r.latest) return;
        return showAvailable(r);
      }
      if (r.manualOnly) {
        show(
          `<div class="up-head"><div class="up-badge">Nova versão</div><h3>Frame Animator ${esc(r.latest)}</h3><p class="up-sub">Esta versão precisa ser baixada pelo site.</p></div>
           <div class="up-actions"><button class="up-primary" data-go>Abrir a página da versão</button><button class="up-ghost" data-later>Depois</button></div>`,
          { tone: 'new' },
        );
        on('[data-go]', () => api.openUrl(r.url));
        on('[data-later]', close);
        return;
      }
      if (manual) {
        show(`<div class="up-head"><div class="up-badge ok">Em dia</div><h3>Você está na versão mais nova</h3><p class="up-sub">Frame Animator ${esc(r.current)}</p></div>`, { tone: 'ok' });
        setTimeout(close, 4000);
      }
    } catch (err) {
      const msg = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (manual) showError(`Não deu para procurar: ${/fetch|net::|ENOTFOUND|network/i.test(msg) ? 'sem conexão com a internet' : msg}.`);
    }
  }

  api?.update?.onProgress(({ got, total }) => {
    if (!card) return;
    const pct = total ? Math.min(100, (got / total) * 100) : 0;
    const fill = card.querySelector('.up-fill');
    if (fill) fill.style.width = `${pct}%`;
    const st = card.querySelector('[data-status]');
    if (st) st.textContent = total ? `${mb(got)} de ${mb(total)} · ${Math.round(pct)}%` : mb(got);
  });

  // ações do menu Ajuda
  const add = (id, run) => (actions.defs[id] = { keys: [], run });
  add('checkUpdates', () => check(true));
  add('about', async () => {
    const v = (await api?.version?.()) || '';
    await openDialog({
      title: 'Sobre o Frame Animator',
      cancel: null,
      ok: 'Fechar',
      body: `<p class="dlg-text"><b>Frame Animator ${esc(v)}</b><br>Editor de animação 2D vetorial.</p>
        <p class="dlg-text">Atualizações e código: <a href="#" data-gh>github.com/singularityscripts-collab/frame-animator</a></p>`,
      onOpen: (dlg) => dlg.querySelector('[data-gh]').addEventListener('click', (e) => {
        e.preventDefault();
        api?.openUrl('https://github.com/singularityscripts-collab/frame-animator');
      }),
    });
  });

  // procura sozinho ao abrir (no máximo a cada 6 horas)
  const last = Number(store.get(LAST_KEY)) || 0;
  if (api?.update && store.get(AUTO_KEY) !== 'off' && Date.now() - last > 6 * 3600 * 1000) setTimeout(() => check(false), 6000);
  return { check };
}
