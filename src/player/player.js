// Reprodução: avança quadros no ritmo do FPS do documento (relógio do palco do editor).
// A janela de teste e o HTML5 usam o runtime interativo (runtime.js).

export class Player {
  /**
   * @param {object} o
   * @param {() => number} o.getLength   total de quadros
   * @param {() => number} o.getFps
   * @param {() => boolean} o.getLoop
   * @param {(frame:number) => void} o.onFrame
   * @param {() => void} [o.onStop]
   * @param {() => void} [o.onLoop]  quando volta para o quadro 0
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
    this.cycle = 0;
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
        const cycle = Math.floor(frame / len);
        frame = frame % len;
        if (cycle !== this.cycle) {
          this.cycle = cycle;
          this.o.onLoop?.();
        }
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

