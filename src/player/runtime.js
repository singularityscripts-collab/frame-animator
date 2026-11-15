// Runtime interativo: toca o filme com scripts por quadro (JavaScript), botões, componentes,
// texto dinâmico/de entrada e som disparado pela agulha. Usado no "Testar filme" e no export HTML5.
//
// API dentro dos scripts (this = a timeline onde o script está):
//   this.stop() · this.play() · this.gotoAndPlay(quadro|'rótulo', 'Cena') · this.gotoAndStop(...)
//   this.nextFrame() · this.prevFrame() · this.currentFrame · this.totalFrames · this.currentLabel
//   this.getChild('nome') → objeto com x, y, rotation, scaleX, scaleY, alpha, visible, text,
//                            on('click', fn), stop(), play(), gotoAndPlay(...)
//   root (a timeline principal) · stage.on('keydown'|'keyup'|'mousemove'|'mousedown'|'mouseup', fn) · trace(...) · navigateToURL(url)
//   playSound('nome') · stopAllSounds()

import { renderTimeline, timelineLength, cameraAt, applyCameraTint, symbolById, invert, applyPoint } from './render.js';
import { matrixToProps, propsToMatrix } from './tween.js';
import { AudioEngine, soundById } from './audio.js';
import { preloadBitmaps, setAssetListener, lineHeight } from './assets.js';

export class Runtime {
  constructor(doc, canvas, { loop = true, onTrace = null, fit = 'fit' } = {}) {
    this.doc = doc;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.loop = loop;
    this.fit = fit;
    this.onTrace = onTrace || ((...a) => console.log('[trace]', ...a));
    this.sceneIndex = 0;
    this.frame = 0;
    this.playing = true;
    this.entered = null; // último quadro da raiz que rodou scripts
    this.mcs = new Map(); // caminho → { frame, playing, entered, sym }
    this.props = new Map(); // caminho → propriedades mudadas por script
    this.texts = new Map();
    this.handlers = new Map(); // caminho → { evento: [fn] }
    this.states = new Map(); // caminho → { over, down } (botões e componentes)
    this.comps = new Map(); // caminho → estado de componente
    this.lastEl = new Map();
    this.hits = [];
    this.seen = new Set();
    this.stageHandlers = {};
    this.inputs = new Map(); // caminho → <input>
    this.audio = new AudioEngine();
    this.compiled = new Map();
    this.running = false;
    this.bind();
    setAssetListener(() => this.render());
  }

  get scene() {
    return this.doc.scenes[this.sceneIndex];
  }

  async start() {
    await preloadBitmaps(this.doc);
    this.running = true;
    this.enterRoot(true);
    this.render();
    this.afterRender();
    let last = performance.now();
    let acc = 0;
    const loop = (t) => {
      if (!this.running) return;
      acc += t - last;
      last = t;
      const step = 1000 / this.doc.fps;
      let n = 0;
      while (acc >= step && n++ < 5) {
        acc -= step;
        this.step();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    for (const v of this.comps.values()) v.video?.pause();
    for (const i of this.inputs.values()) i.remove();
  }

  // ---------- tempo ----------
  step() {
    const len = timelineLength(this.scene);
    if (this.playing) {
      if (this.frame + 1 < len) this.frame++;
      else if (this.sceneIndex + 1 < this.doc.scenes.length) {
        this.sceneIndex++;
        this.frame = 0;
      } else if (this.loop) {
        this.sceneIndex = 0;
        this.frame = 0;
      } else this.playing = false;
    }
    for (const [path, st] of this.mcs) {
      if (!this.seen.has(path)) {
        this.mcs.delete(path); // saiu do palco: volta do começo quando aparecer de novo
        continue;
      }
      if (st.playing) st.frame = (st.frame + 1) % timelineLength(st.sym);
    }
    this.enterRoot();
    this.render();
    this.afterRender();
  }

  /** Ao entrar num quadro da raiz: scripts e sons daquele quadro. */
  enterRoot(force = false) {
    const key = `${this.sceneIndex}:${this.frame}`;
    if (!force && this.entered === key) return;
    this.entered = key;
    this.runScripts(this.scene, this.frame, this.api(''));
    this.triggerSounds(this.scene, this.frame);
  }

  afterRender() {
    for (const [path, st] of this.mcs) {
      if (st.entered === st.frame) continue;
      st.entered = st.frame;
      this.runScripts(st.sym, st.frame, this.api(path));
    }
  }

  // ---------- scripts ----------
  runScripts(tl, frame, self) {
    for (const layer of tl.layers) {
      const span = layer.frames.find((s) => s.start === frame);
      if (!span?.script?.trim()) continue;
      let fn = this.compiled.get(span.script);
      if (!fn) {
        try {
          fn = new Function('root', 'stage', 'trace', 'navigateToURL', 'playSound', 'stopAllSounds', span.script);
        } catch (err) {
          this.onTrace(`Erro no script (quadro ${frame + 1}, ${layer.name}): ${err.message}`);
          continue;
        }
        this.compiled.set(span.script, fn);
      }
      try {
        fn.call(
          self,
          this.api(''),
          this.stageApi(),
          (...a) => this.onTrace(...a),
          (url) => window.open(url, '_blank', 'noopener'),
          (name) => this.playSound(name),
          () => this.audio.stop(),
        );
      } catch (err) {
        this.onTrace(`Erro no script (quadro ${frame + 1}, ${layer.name}): ${err.message}`);
      }
    }
  }

  stageApi() {
    const rt = this;
    return {
      on(ev, fn) {
        (rt.stageHandlers[ev] ||= []).push(fn);
      },
      get width() {
        return rt.doc.width;
      },
      get height() {
        return rt.doc.height;
      },
    };
  }

  playSound(name) {
    const snd = this.doc.library.sounds?.find((s) => s.name === name || s.id === name);
    if (snd) this.audio.add(this.doc, [{ soundId: snd.id, at: 0, offset: 0, until: snd.duration, volume: 1, pan: 0, fadeIn: 0, fadeOut: 0 }]);
  }

  triggerSounds(scene, frame) {
    const fps = this.doc.fps;
    const entries = [];
    for (const layer of scene.layers) {
      if (layer.type === 'guide') continue;
      const span = layer.frames.find((s) => s.start === frame);
      const snd = span?.sound;
      if (!snd?.id) continue;
      const info = soundById(this.doc, snd.id);
      if (!info) continue;
      if (snd.sync === 'stop') continue;
      const loops = Math.max(1, snd.loops || 1);
      const until = snd.sync === 'stream' ? Math.min(span.duration / fps, info.duration * loops) : info.duration * loops;
      entries.push({ soundId: snd.id, at: 0, offset: 0, until, volume: (snd.volume ?? 100) / 100, pan: (snd.pan ?? 0) / 100, fadeIn: snd.fadeIn || 0, fadeOut: snd.fadeOut || 0, sync: snd.sync });
    }
    if (scene.layers.some((l) => l.frames.some((s) => s.start === frame && s.sound?.sync === 'stop'))) this.audio.stop();
    if (entries.length) this.audio.add(this.doc, entries);
  }

  // ---------- objetos da API ----------
  timelineOf(path) {
    if (!path) return { tl: this.scene, get: () => this.frame, set: (f) => (this.frame = f), playing: (v) => (this.playing = v) };
    const st = this.mcs.get(path);
    if (!st) return null;
    return { tl: st.sym, get: () => st.frame, set: (f) => (st.frame = f), playing: (v) => (st.playing = v) };
  }

  resolveFrame(tl, target) {
    if (typeof target === 'number') return Math.max(0, Math.min(timelineLength(tl) - 1, Math.round(target) - 1));
    for (const l of tl.layers) for (const s of l.frames) if (s.label === target) return s.start;
    this.onTrace(`Rótulo não encontrado: ${target}`);
    return null;
  }

  api(path) {
    const rt = this;
    const t = () => rt.timelineOf(path);
    const go = (target, scene, play) => {
      if (!path && scene != null) {
        const si = rt.doc.scenes.findIndex((s) => s.name === scene);
        if (si >= 0) rt.sceneIndex = si;
      }
      const tl = t();
      if (!tl) return;
      const f = rt.resolveFrame(tl.tl, target);
      if (f == null) return;
      tl.set(f);
      tl.playing(play);
      if (!path) rt.enterRoot();
    };
    const self = {
      stop: () => t()?.playing(false),
      play: () => t()?.playing(true),
      gotoAndPlay: (f, scene) => go(f, scene, true),
      gotoAndStop: (f, scene) => go(f, scene, false),
      nextFrame: () => {
        const tl = t();
        if (tl) {
          tl.set(Math.min(timelineLength(tl.tl) - 1, tl.get() + 1));
          tl.playing(false);
          if (!path) rt.enterRoot();
        }
      },
      prevFrame: () => {
        const tl = t();
        if (tl) {
          tl.set(Math.max(0, tl.get() - 1));
          tl.playing(false);
          if (!path) rt.enterRoot();
        }
      },
      get currentFrame() {
        return (t()?.get() ?? 0) + 1;
      },
      get totalFrames() {
        const tl = t();
        return tl ? timelineLength(tl.tl) : 0;
      },
      get currentLabel() {
        const tl = t();
        if (!tl) return null;
        let label = null;
        for (const l of tl.tl.layers) for (const s of l.frames) if (s.label && s.start <= tl.get()) label = s.label;
        return label;
      },
      getChild: (name) => rt.childApi(`${path}/${name}`),
      on: (ev, fn) => rt.on(path, ev, fn),
      addEventListener: (ev, fn) => rt.on(path, ev, fn),
    };
    return self;
  }

  on(path, ev, fn) {
    const h = this.handlers.get(path) || {};
    (h[ev] ||= []).push(fn);
    this.handlers.set(path, h);
  }

  childApi(path) {
    const rt = this;
    const base = this.api(path);
    const prop = (k) => {
      const o = rt.props.get(path) || {};
      if (k in o) return o[k];
      const el = rt.lastEl.get(path);
      if (!el) return undefined;
      const p = matrixToProps(el.matrix);
      if (k === 'alpha') return el.color?.mode === 'alpha' ? (el.color.alpha ?? 100) / 100 : 1;
      if (k === 'visible') return true;
      if (k === 'scaleX' || k === 'scaleY') return p[k] / 100;
      return p[k];
    };
    const setProp = (k, v) => {
      rt.props.set(path, { ...(rt.props.get(path) || {}), [k]: v });
    };
    const o = Object.create(base);
    for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'alpha', 'visible']) {
      Object.defineProperty(o, k, { get: () => prop(k), set: (v) => setProp(k, v), enumerable: true });
    }
    Object.defineProperty(o, 'text', {
      get: () => (rt.texts.has(path) ? rt.texts.get(path) : rt.lastEl.get(path)?.text ?? ''),
      set: (v) => rt.texts.set(path, String(v)),
    });
    Object.defineProperty(o, 'selectedIndex', { get: () => rt.comps.get(path)?.selected ?? -1 });
    Object.defineProperty(o, 'selectedItem', {
      get: () => {
        const el = rt.lastEl.get(path);
        const i = rt.comps.get(path)?.selected ?? -1;
        return el?.props?.items?.[i];
      },
    });
    o.name = path.split('/').pop();
    return o;
  }

  // ---------- ganchos chamados pelo renderer ----------
  adjust(path, el) {
    this.lastEl.set(path, el);
    const o = this.props.get(path);
    if (!o) return el;
    if (o.visible === false) return null;
    const p = matrixToProps(el.matrix);
    if ('x' in o) p.x = o.x;
    if ('y' in o) p.y = o.y;
    if ('rotation' in o) p.rotation = o.rotation;
    if ('scaleX' in o) p.scaleX = o.scaleX * 100;
    if ('scaleY' in o) p.scaleY = o.scaleY * 100;
    const out = { ...el, matrix: propsToMatrix(p) };
    if ('alpha' in o) out.color = { mode: 'alpha', alpha: Math.max(0, Math.min(1, o.alpha)) * 100 };
    return out;
  }

  frameOf(path, el, sym, def) {
    this.seen.add(path);
    const isButton = sym.type === 'button' || el.behavior === 'button';
    if (isButton) {
      const s = this.states.get(path) || {};
      const len = timelineLength(sym);
      return Math.min(len - 1, s.down && s.over ? 2 : s.over ? 1 : 0);
    }
    if (el.behavior !== 'movieclip') return def;
    let st = this.mcs.get(path);
    if (!st) {
      st = { frame: 0, playing: true, entered: -1, sym };
      this.mcs.set(path, st);
    }
    st.sym = sym;
    return st.frame;
  }

  textOf(path, el) {
    return this.texts.has(path) ? this.texts.get(path) : el.text;
  }

  componentState(path, el) {
    let st = this.comps.get(path);
    if (!st) {
      st = { selected: el.props?.selected ?? -1, scroll: 0 };
      if (el.kind === 'video' && el.props?.src && typeof document !== 'undefined') {
        const v = document.createElement('video');
        v.src = el.props.src;
        v.loop = el.props.loop !== false;
        v.muted = !!el.props.muted;
        v.playsInline = true;
        if (el.props.autoplay !== false) v.play().catch(() => {});
        v.addEventListener('timeupdate', () => this.render());
        st.video = v;
      }
      this.comps.set(path, st);
    }
    return { ...st, ...(this.states.get(path) || {}) };
  }

  register(path, el, m, box, kind, sym) {
    this.hits.push({ path, el, m, box, kind, sym });
  }

  // ---------- desenho ----------
  layout() {
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    const w = c.clientWidth || this.doc.width, h = c.clientHeight || this.doc.height;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    let sx = 1, sy = 1;
    if (this.fit === 'fit') sx = sy = Math.min(w / this.doc.width, h / this.doc.height);
    else if (this.fit === 'stretch') {
      sx = w / this.doc.width;
      sy = h / this.doc.height;
    }
    const ox = (w - this.doc.width * sx) / 2, oy = (h - this.doc.height * sy) / 2;
    return { dpr, w, h, base: [dpr * sx, 0, 0, dpr * sy, dpr * ox, dpr * oy] };
  }

  render() {
    if (!this.running) return;
    const { ctx, doc } = this;
    const { dpr, w, h, base } = this.layout();
    this.hits = [];
    this.seen = new Set();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(...base);
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
    renderTimeline(ctx, doc, this.scene, this.frame, { playMC: true, rt: this, path: '' });
    applyCameraTint(ctx, doc, cameraAt(doc, this.scene, this.frame));
    ctx.restore();
    this.syncInputs(dpr);
  }

  /** Campos de texto de entrada: um <input> de verdade por cima do canvas. */
  syncInputs(dpr) {
    const alive = new Set();
    for (const hit of this.hits) {
      if (hit.kind !== 'text' || hit.el.kind !== 'input') continue;
      alive.add(hit.path);
      let inp = this.inputs.get(hit.path);
      if (!inp) {
        inp = document.createElement('input');
        inp.type = 'text';
        inp.value = this.textOf(hit.path, hit.el) || '';
        Object.assign(inp.style, { position: 'absolute', border: '0', background: 'transparent', outline: 'none', padding: '0', margin: '0' });
        inp.addEventListener('input', () => {
          this.texts.set(hit.path, inp.value);
          this.dispatch(hit.path, 'change', { value: inp.value });
        });
        (this.canvas.parentElement || document.body).appendChild(inp);
        this.inputs.set(hit.path, inp);
      }
      const r = this.canvas.getBoundingClientRect();
      const pr = this.canvas.parentElement?.getBoundingClientRect() || { left: 0, top: 0 };
      const p = applyPoint(hit.m, hit.box.x, hit.box.y);
      const sc = Math.hypot(hit.m[0], hit.m[1]) / dpr;
      Object.assign(inp.style, {
        left: `${r.left - pr.left + p.x / dpr}px`,
        top: `${r.top - pr.top + p.y / dpr}px`,
        width: `${hit.box.w * sc}px`,
        height: `${lineHeight(hit.el) * sc}px`,
        font: `${hit.el.italic ? 'italic ' : ''}${hit.el.bold ? 'bold ' : ''}${(hit.el.size || 24) * sc}px "${hit.el.font || 'Arial'}"`,
        color: 'transparent',
        caretColor: hit.el.color || '#000',
      });
    }
    for (const [path, inp] of this.inputs) {
      if (!alive.has(path)) {
        inp.remove();
        this.inputs.delete(path);
      }
    }
  }

  // ---------- mouse e teclado ----------
  /** Ponto da tela → coordenadas do palco. */
  toStage(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) * this.canvas.width) / r.width, y = ((clientY - r.top) * this.canvas.height) / r.height;
    const inv = invert(this.layout().base);
    return inv ? applyPoint(inv, x, y) : { x, y };
  }

  fireStage(ev, e) {
    const list = this.stageHandlers[ev];
    if (!list?.length) return;
    const p = this.toStage(e.clientX, e.clientY);
    for (const fn of list) {
      try {
        fn({ type: ev, x: p.x, y: p.y });
      } catch (err) {
        this.onTrace(`Erro em ${ev}: ${err.message}`);
      }
    }
  }

  hitAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) * this.canvas.width) / r.width, y = ((clientY - r.top) * this.canvas.height) / r.height;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      const inv = invert(h.m);
      if (!inv) continue;
      const p = applyPoint(inv, x, y);
      if (p.x >= h.box.x && p.x <= h.box.x + h.box.w && p.y >= h.box.y && p.y <= h.box.y + h.box.h) {
        const interactive = h.kind === 'component' || h.sym?.type === 'button' || h.el.behavior === 'button' || this.hasHandlers(h.path);
        if (interactive) return { ...h, local: p };
      }
    }
    return null;
  }

  hasHandlers(path) {
    for (const [p, h] of this.handlers) if ((path === p || path.startsWith(p + '/')) && p && Object.keys(h).length) return true;
    return false;
  }

  dispatch(path, ev, data = {}) {
    // sobe do objeto até a raiz (como no editor clássico)
    const parts = path.split('/');
    for (let k = parts.length; k >= 1; k--) {
      const p = parts.slice(0, k).join('/');
      for (const fn of this.handlers.get(p)?.[ev] || []) {
        try {
          fn.call(this.childApi(path), { type: ev, target: this.childApi(path), ...data });
        } catch (err) {
          this.onTrace(`Erro em ${ev}: ${err.message}`);
        }
      }
    }
  }

  bind() {
    const c = this.canvas;
    let hover = null;
    const setState = (path, patch) => this.states.set(path, { ...(this.states.get(path) || {}), ...patch });
    c.addEventListener('pointermove', (e) => {
      this.fireStage('mousemove', e);
      const h = this.hitAt(e.clientX, e.clientY);
      const p = h?.path || null;
      if (p !== hover) {
        if (hover) {
          setState(hover, { over: false });
          this.dispatch(hover, 'mouseout');
        }
        if (p) {
          setState(p, { over: true });
          this.dispatch(p, 'mouseover');
        }
        hover = p;
        c.style.cursor = p ? 'pointer' : 'default';
        this.render();
      }
    });
    c.addEventListener('pointerdown', (e) => {
      this.fireStage('mousedown', e);
      const h = this.hitAt(e.clientX, e.clientY);
      if (!h) return;
      setState(h.path, { down: true, over: true });
      this.dispatch(h.path, 'mousedown');
      if (h.el.kind === 'list') {
        const rh = (h.el.props?.fontSize || 14) + 10;
        const st = this.comps.get(h.path) || {};
        const i = Math.floor((h.local.y + (st.scroll || 0)) / rh);
        if (i >= 0 && i < (h.el.props?.items || []).length) {
          st.selected = i;
          this.comps.set(h.path, st);
          this.dispatch(h.path, 'change', { selectedIndex: i, selectedItem: h.el.props.items[i] });
        }
      }
      if (h.el.kind === 'video') {
        const v = this.comps.get(h.path)?.video;
        if (v) v.paused ? v.play() : v.pause();
      }
      this.render();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.target === c) this.fireStage('mouseup', e);
      const h = this.hitAt(e.clientX, e.clientY);
      for (const [p, s] of this.states) {
        if (s.down) {
          setState(p, { down: false });
          this.dispatch(p, 'mouseup');
          if (h?.path === p) this.dispatch(p, 'click');
        }
      }
      this.render();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        const h = this.hitAt(e.clientX, e.clientY);
        if (h?.el.kind !== 'list') return;
        e.preventDefault();
        const st = this.comps.get(h.path) || {};
        const rh = (h.el.props?.fontSize || 14) + 10;
        const max = Math.max(0, (h.el.props?.items || []).length * rh - h.el.h);
        st.scroll = Math.max(0, Math.min(max, (st.scroll || 0) + e.deltaY));
        this.comps.set(h.path, st);
        this.render();
      },
      { passive: false },
    );
    for (const ev of ['keydown', 'keyup']) {
      window.addEventListener(ev, (e) => {
        if (e.target?.tagName === 'INPUT') return;
        for (const fn of this.stageHandlers[ev] || []) {
          try {
            fn({ type: ev, key: e.key, code: e.code });
          } catch (err) {
            this.onTrace(`Erro em ${ev}: ${err.message}`);
          }
        }
      });
    }
  }
}

export { symbolById };
