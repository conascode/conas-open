// Undo / redo stacks.
import { Emitter } from '../utils/events.js';

export class History extends Emitter {
  constructor(limit = 300) {
    super();
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  execute(cmd) {
    cmd.do();
    this.record(cmd);
    return cmd;
  }

  // Push a command whose effect is already applied (e.g. after a live drag).
  record(cmd) {
    const top = this.undoStack[this.undoStack.length - 1];
    const now = performance.now();
    if (top && cmd.mergeKey && top.mergeKey === cmd.mergeKey && now - top.time < 2500 && top.merge?.(cmd)) {
      top.time = now;
    } else {
      cmd.time = now;
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.redoStack.length = 0;
    this.emit('change');
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit('change');
    return cmd;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.do();
    cmd.time = 0; // never merge into a redone command
    this.undoStack.push(cmd);
    this.emit('change');
    return cmd;
  }

  // Stop the top command from absorbing later edits (e.g. when an input loses focus).
  seal() {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.time = 0;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit('change');
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label; }
}
