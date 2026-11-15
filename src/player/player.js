// Reprodução: avança quadros no ritmo do FPS do documento.
// O mesmo Player toca a animação no palco do editor e na janela de teste.

import { renderScene, sceneLength } from './render.js';

export class Player {
  /**
   * @param {object} o
   * @param {() => number} o.getLength   total de quadros
   * @param {() => number} o.getFps
   * @param {() => boolean} o.getLoop
   * @param {(frame:number) => void} o.onFrame
   * @param {() => void} [o.onStop]
   */
  constructor(o) {
    this.o = o;
    this.playing = false;
    this._raf = 0;
  }

  play(fromFrame = 0) {
    if (this.playing) return;
    const len = this.o.getLength();
    this.startFrame = fromFrame >= len - 1 ? 0 : fromFrame;
    this.t0 = performance.now();
    this.lastFrame = -1;
    this.playing = true;
    this._tick();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this._raf);
    this.o.onStop?.();
  }

  _tick = () => {
    if (!this.playing) return;
    const len = this.o.getLength();
    const elapsed = Math.floor(((performance.now() - this.t0) * this.o.getFps()) / 1000);
    let frame = this.startFrame + elapsed;
    if (frame >= len) {
      if (this.o.getLoop()) {
        frame = frame % len;
      } else {
        this.o.onFrame(len - 1);
        this.stop();
        return;
      }
    }
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      this.o.onFrame(frame);
    }
    this._raf = requestAnimationFrame(this._tick);
  };
}

/**
 * Player autônomo: toca um documento num canvas, ajustando ao tamanho do canvas.
 * Base da janela de teste e do futuro export HTML5.
 */
export function mountPlayer(canvas, doc, { sceneIndex = 0, loop = true } = {}) {
  const ctx = canvas.getContext('2d');
  const scene = doc.scenes[sceneIndex];
  let current = 0;

  function draw(frame) {
    current = frame;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const scale = Math.min(w / doc.width, h / doc.height);
    const ox = (w - doc.width * scale) / 2, oy = (h - doc.height * scale) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
    renderScene(ctx, scene, frame);
    ctx.restore();
  }

  const player = new Player({
    getLength: () => sceneLength(scene),
    getFps: () => doc.fps,
    getLoop: () => loop,
    onFrame: draw,
  });
  window.addEventListener('resize', () => draw(current));
  draw(0);
  return player;
}
