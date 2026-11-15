// Peças de interface reutilizáveis: diálogo modal, menu de contexto e barra de progresso.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Diálogo com formulário. Resolve com os campos ({ nome: valor }) ou null se cancelado.
 * body: HTML dos campos (use name=""). onOpen(form) para ligar comportamentos extras.
 */
export function openDialog({ title, body, ok = 'OK', cancel = 'Cancelar', onOpen }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'fa-dialog';
  dlg.innerHTML = `
    <form>
      <h2>${esc(title)}</h2>
      <div class="dlg-body">${body}</div>
      <div class="dlg-actions">
        ${cancel ? `<button type="button" class="btn-flat" data-cancel>${esc(cancel)}</button>` : ''}
        <button type="submit" class="btn-primary">${esc(ok)}</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form');
  return new Promise((resolve) => {
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') data[el.name] = el.checked;
        else if (el.type === 'radio') {
          if (el.checked) data[el.name] = el.value;
        } else data[el.name] = el.value;
      }
      close(data);
    });
    dlg.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.showModal();
    onOpen?.(form);
    const first = form.querySelector('input:not([type=hidden]), select');
    first?.focus();
    if (first?.select) first.select();
  });
}

export async function confirmDialog(title, message, ok = 'Confirmar') {
  const r = await openDialog({ title, body: `<p class="dlg-text">${esc(message)}</p>`, ok });
  return !!r;
}

/** Janela de progresso com botão de cancelar. */
export function openProgress(title) {
  const dlg = document.createElement('dialog');
  dlg.className = 'fa-dialog';
  dlg.innerHTML = `
    <h2>${esc(title)}</h2>
    <div class="progress"><div class="progress-bar"></div></div>
    <p class="dlg-text progress-text">Preparando…</p>
    <div class="dlg-actions"><button type="button" class="btn-flat">Cancelar</button></div>`;
  document.body.appendChild(dlg);
  const state = { cancelled: false };
  dlg.querySelector('button').addEventListener('click', () => {
    state.cancelled = true;
    dlg.querySelector('.progress-text').textContent = 'Cancelando…';
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    state.cancelled = true;
  });
  dlg.showModal();
  return {
    get cancelled() {
      return state.cancelled;
    },
    update(frac, text) {
      dlg.querySelector('.progress-bar').style.width = `${Math.round(frac * 100)}%`;
      if (text && !state.cancelled) dlg.querySelector('.progress-text').textContent = text;
    },
    close() {
      dlg.close();
      dlg.remove();
    },
  };
}

// ---------- menu de contexto ----------
let openMenu = null;

/** items: [{ label, run, disabled, hint }] ou '-' para separador. */
export function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === '-') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' }));
      continue;
    }
    const b = document.createElement('button');
    b.className = 'ctx-item';
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    b.innerHTML = `<span>${esc(it.label)}</span>${it.hint ? `<span class="ctx-hint">${esc(it.hint)}</span>` : ''}`;
    b.addEventListener('click', () => {
      closeContextMenu();
      it.run();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  openMenu = menu;
  setTimeout(() => {
    window.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeContextMenu);
  });
}

function onOutside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeContextMenu();
}
function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeContextMenu();
  }
}

export function closeContextMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  window.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeContextMenu);
}
