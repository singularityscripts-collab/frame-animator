// Histórico de desfazer/refazer baseado em comandos (padrão Command).
// Cada comando tem label, do(ctx) e undo(ctx). O ctx é o editor.

let nextToken = 1;

export class History {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.savedToken = 0;
  }

  get token() {
    const top = this.undoStack[this.undoStack.length - 1];
    return top ? top.__token : 0;
  }

  execute(cmd, ctx) {
    cmd.do(ctx);
    cmd.__token = nextToken++;
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
  }

  /** Registra um comando cujo efeito já foi aplicado (ex.: arraste ao vivo no palco). */
  push(cmd) {
    cmd.__token = nextToken++;
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
  }

  /** Junta os últimos n comandos (já aplicados) num passo só de desfazer. */
  squash(n, label) {
    if (n < 2 || this.undoStack.length < n) return;
    const cmds = this.undoStack.splice(this.undoStack.length - n, n);
    this.push({
      label,
      cmds,
      do(ctx) {
        for (const c of cmds) c.do(ctx);
      },
      undo(ctx) {
        for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(ctx);
      },
    });
  }

  undo(ctx) {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo(ctx);
    this.redoStack.push(cmd);
    return cmd;
  }

  redo(ctx) {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.do(ctx);
    this.undoStack.push(cmd);
    return cmd;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  markSaved() {
    this.savedToken = this.token;
  }
  get dirty() {
    return this.token !== this.savedToken;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.savedToken = 0;
  }
}
