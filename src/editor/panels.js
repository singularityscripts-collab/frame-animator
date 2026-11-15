// Painéis encaixáveis: cada painel fica numa doca (esquerda ou direita, em abas), flutuando
// numa janelinha que dá para arrastar e redimensionar, ou fechado. O arranjo é salvo
// (layout atual + layouts com nome) neste computador.

import { showContextMenu } from './ui-kit.js';

const KEY = 'fa-layout';
const NAMED = 'fa-layouts';
const DEFAULT = {
  panels: {
    props: { dock: 'right' },
    colors: { dock: 'right' },
    library: { dock: 'right' },
    history: { dock: 'right' },
    actions: { dock: 'closed', last: 'left' },
    align: { dock: 'closed', last: 'float' },
    scenes: { dock: 'closed', last: 'left' },
    components: { dock: 'closed', last: 'float' },
    scripts: { dock: 'closed', last: 'float' },
  },
  order: ['props', 'colors', 'library', 'history', 'actions', 'align', 'scenes', 'components', 'scripts'],
  active: { right: 'props', left: null },
  sizes: { left: 280, right: 264, timeline: 240 },
};

const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // sem armazenamento: o layout vale só nesta sessão
    }
  },
};

export class Panels {
  constructor() {
    this.defs = new Map();
    this.app = document.getElementById('app');
    const right = document.getElementById('props');
    right.classList.add('dock');
    right.querySelector('.tabs').innerHTML = '';
    const left = document.createElement('aside');
    left.id = 'dock-left';
    left.className = 'dock';
    left.setAttribute('aria-label', 'Painéis da esquerda');
    left.innerHTML = '<div class="tabs" role="tablist"></div>';
    this.app.insertBefore(left, document.getElementById('stage-area'));
    this.docks = { right, left };
    for (const [side, el] of Object.entries(this.docks)) this.splitter(side, el);
    this.floatZ = 50;
    const saved = store.get(KEY);
    this.state = this.normalize(saved);
  }

  normalize(s) {
    const d = structuredClone(DEFAULT);
    if (!s || typeof s !== 'object') return d;
    for (const id of Object.keys(d.panels)) if (s.panels?.[id]) d.panels[id] = { ...d.panels[id], ...s.panels[id] };
    if (Array.isArray(s.order)) d.order = [...new Set([...s.order.filter((x) => d.panels[x]), ...d.order])];
    d.active = { ...d.active, ...(s.active || {}) };
    d.sizes = { ...d.sizes, ...(s.sizes || {}) };
    return d;
  }

  /** Registra um painel: el é a página (conteúdo); onShow é chamado quando ele aparece. */
  register(id, title, el, onShow) {
    el.classList.add('tab-page');
    el.dataset.panel = id;
    this.defs.set(id, { id, title, el, onShow });
    if (!this.state.panels[id]) this.state.panels[id] = { dock: 'closed', last: 'float' };
    if (!this.state.order.includes(id)) this.state.order.push(id);
  }

  save() {
    store.set(KEY, this.state);
  }

  /** Recoloca tudo de acordo com o estado. */
  apply() {
    const st = this.state;
    document.documentElement.style.setProperty('--tl-h', `${Math.round(st.sizes.timeline || 240)}px`);
    for (const side of ['left', 'right']) {
      const dock = this.docks[side];
      const tabs = dock.querySelector('.tabs');
      tabs.innerHTML = '';
      const ids = st.order.filter((id) => this.defs.has(id) && st.panels[id].dock === side);
      if (!ids.includes(st.active[side])) st.active[side] = ids[0] || null;
      for (const id of ids) {
        const def = this.defs.get(id);
        const b = document.createElement('button');
        b.className = 'tab';
        b.setAttribute('role', 'tab');
        b.textContent = def.title;
        b.title = `${def.title} · clique direito: encaixar, flutuar ou fechar`;
        b.classList.toggle('active', st.active[side] === id);
        b.addEventListener('click', () => this.activate(id));
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.menu(id, e.clientX, e.clientY);
        });
        tabs.appendChild(b);
        if (def.el.parentElement !== dock) dock.appendChild(def.el);
        def.el.hidden = st.active[side] !== id;
      }
      const w = ids.length ? Math.max(180, Math.min(640, st.sizes[side] || 264)) : 0;
      document.documentElement.style.setProperty(`--${side}-w`, `${w}px`);
      dock.hidden = !ids.length;
    }
    // flutuantes
    for (const [id, def] of this.defs) {
      const p = st.panels[id];
      const win = document.querySelector(`.float-panel[data-panel="${id}"]`);
      if (p.dock === 'float') {
        const fw = win || this.makeFloat(id);
        const body = fw.querySelector('.float-body');
        if (def.el.parentElement !== body) body.appendChild(def.el);
        def.el.hidden = false;
      } else {
        win?.remove();
        if (p.dock === 'closed') {
          def.el.hidden = true;
          if (def.el.parentElement && !def.el.parentElement.classList.contains('dock')) def.el.remove();
        }
      }
    }
    for (const side of ['left', 'right']) {
      const id = st.active[side];
      if (id) this.defs.get(id)?.onShow?.();
    }
    window.dispatchEvent(new Event('resize'));
  }

  makeFloat(id) {
    const def = this.defs.get(id);
    const p = this.state.panels[id];
    p.rect ||= { x: Math.round(window.innerWidth / 2 - 160), y: 120, w: 320, h: 380 };
    const win = document.createElement('div');
    win.className = 'float-panel';
    win.dataset.panel = id;
    win.innerHTML = `<div class="float-head"><span class="float-title"></span>
      <button class="mini-btn" data-to="left" title="Encaixar à esquerda">⇤</button>
      <button class="mini-btn" data-to="right" title="Encaixar à direita">⇥</button>
      <button class="mini-btn" data-to="closed" title="Fechar">✕</button></div><div class="float-body"></div>`;
    win.querySelector('.float-title').textContent = def.title;
    const place = () => {
      const r = p.rect;
      r.x = Math.max(0, Math.min(window.innerWidth - 80, r.x));
      r.y = Math.max(0, Math.min(window.innerHeight - 40, r.y));
      Object.assign(win.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    };
    place();
    win.style.zIndex = String(++this.floatZ);
    win.addEventListener('pointerdown', () => (win.style.zIndex = String(++this.floatZ)));
    win.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => this.move(id, b.dataset.to)));
    const head = win.querySelector('.float-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      head.setPointerCapture(e.pointerId);
      const sx = e.clientX - p.rect.x, sy = e.clientY - p.rect.y;
      const mv = (ev) => {
        p.rect.x = ev.clientX - sx;
        p.rect.y = ev.clientY - sy;
        place();
      };
      const up = () => {
        head.removeEventListener('pointermove', mv);
        head.removeEventListener('pointerup', up);
        this.save();
      };
      head.addEventListener('pointermove', mv);
      head.addEventListener('pointerup', up);
    });
    new ResizeObserver(() => {
      if (!win.isConnected) return;
      p.rect.w = win.offsetWidth;
      p.rect.h = win.offsetHeight;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), 300);
    }).observe(win);
    document.body.appendChild(win);
    return win;
  }

  splitter(side, dock) {
    const h = document.createElement('div');
    h.className = `dock-splitter ${side}`;
    h.title = 'Arraste para mudar a largura';
    dock.appendChild(h);
    h.addEventListener('pointerdown', (e) => {
      h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = dock.getBoundingClientRect().width;
      const mv = (ev) => {
        const w = Math.max(180, Math.min(640, side === 'left' ? w0 + (ev.clientX - x0) : w0 - (ev.clientX - x0)));
        this.state.sizes[side] = Math.round(w);
        document.documentElement.style.setProperty(`--${side}-w`, `${Math.round(w)}px`);
        window.dispatchEvent(new Event('resize'));
      };
      const up = () => {
        h.removeEventListener('pointermove', mv);
        h.removeEventListener('pointerup', up);
        this.save();
      };
      h.addEventListener('pointermove', mv);
      h.addEventListener('pointerup', up);
    });
  }

  menu(id, x, y) {
    const p = this.state.panels[id];
    showContextMenu(x, y, [
      { label: 'Encaixar à esquerda', run: () => this.move(id, 'left'), disabled: p.dock === 'left' },
      { label: 'Encaixar à direita', run: () => this.move(id, 'right'), disabled: p.dock === 'right' },
      { label: 'Flutuar', run: () => this.move(id, 'float'), disabled: p.dock === 'float' },
      '-',
      { label: 'Fechar painel', run: () => this.move(id, 'closed') },
    ]);
  }

  activate(id) {
    const p = this.state.panels[id];
    if (!p || (p.dock !== 'left' && p.dock !== 'right')) return;
    this.state.active[p.dock] = id;
    this.save();
    this.apply();
  }

  move(id, where) {
    const p = this.state.panels[id];
    if (!p) return;
    if (p.dock !== 'closed') p.last = p.dock;
    p.dock = where;
    if (where === 'left' || where === 'right') this.state.active[where] = id;
    this.save();
    this.apply();
  }

  /** Mostra o painel (abre onde estava da última vez, se estiver fechado). */
  show(id) {
    const p = this.state.panels[id];
    if (!p) return;
    if (p.dock === 'closed') return this.move(id, p.last || 'right');
    if (p.dock === 'float') {
      const win = document.querySelector(`.float-panel[data-panel="${id}"]`);
      if (win) win.style.zIndex = String(++this.floatZ);
      this.defs.get(id)?.onShow?.();
      return;
    }
    this.activate(id);
  }

  isVisible(id) {
    const p = this.state.panels[id];
    if (!p || p.dock === 'closed') return false;
    return p.dock === 'float' || this.state.active[p.dock] === id;
  }

  setTimelineHeight(h) {
    this.state.sizes.timeline = h;
    this.save();
  }

  // ---------- layouts com nome ----------
  layouts() {
    return store.get(NAMED) || {};
  }
  saveLayout(name) {
    const all = this.layouts();
    const tl = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tl-h'));
    if (Number.isFinite(tl)) this.state.sizes.timeline = tl;
    all[name] = structuredClone(this.state);
    store.set(NAMED, all);
  }
  loadLayout(name) {
    const l = this.layouts()[name];
    if (!l) return false;
    document.querySelectorAll('.float-panel').forEach((w) => w.remove());
    this.state = this.normalize(l);
    this.save();
    this.apply();
    return true;
  }
  deleteLayout(name) {
    const all = this.layouts();
    delete all[name];
    store.set(NAMED, all);
  }
  resetLayout() {
    document.querySelectorAll('.float-panel').forEach((w) => w.remove());
    this.state = structuredClone(DEFAULT);
    this.save();
    this.apply();
  }
}
