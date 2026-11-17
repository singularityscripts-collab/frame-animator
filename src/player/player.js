// Reprodução: avança quadros no ritmo do FPS do documento (relógio do palco do editor).
// A janela de teste e o HTML5 usam o runtime interativo (runtime.js).

export class Player {
  /**
   * @param {object} o
   * @param {() => number} o.getLength   total de quadros
   * @param {() => number} o.getFps
   * @param {() => boolean} o.getLoop
   * @param {() => {from:number,to:number}} [o.getRange]  faixa de reprodução (padrão: tudo)
   * @param {(frame:number) => void} o.onFrame
   * @param {() => void} [o.onStop]
   * @param {() => void} [o.onLoop]  quando volta para o começo da faixa
   */
  constructor(o) {
    this.o = o;
    this.playing = false;
    this._raf = 0;
  }

  bounds() {
    const len = this.o.getLength();
    const r = this.o.getRange?.();
    if (!r) return { from: 0, to: len - 1 };
    return { from: Math.max(0, Math.min(r.from, len - 1)), to: Math.max(0, Math.min(r.to, len - 1)) };
  }

  play(fromFrame = 0) {
    if (this.playing) return;
    const { from, to } = this.bounds();
    // fora da faixa ou já no fim dela: começa do início da faixa
    this.startFrame = fromFrame < from || fromFrame >= to ? from : fromFrame;
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
    const { from, to } = this.bounds();
    const span = to - from + 1;
    const elapsed = Math.floor(((performance.now() - this.t0) * this.o.getFps()) / 1000);
    let frame = this.startFrame + elapsed;
    if (frame > to) {
      if (this.o.getLoop()) {
        const cycle = Math.floor((frame - from) / span);
        frame = from + ((frame - from) % span);
        if (cycle !== this.cycle) {
          this.cycle = cycle;
          this.o.onLoop?.();
        }
      } else {
        this.o.onFrame(to);
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
