export class History {
  constructor(limit = 25) {
    this.limit = limit;
    this.stack = [];
    this.redoStack = [];
  }

  push(imageData) {
    if (!imageData) return;
    this.stack.push(imageData);
    if (this.stack.length > this.limit) this.stack.shift();
    this.redoStack.length = 0;
  }

  canUndo() { return this.stack.length > 1; }
  canRedo() { return this.redoStack.length > 0; }

  undo(current) {
    if (!this.canUndo()) return current;
    const prev = this.stack.pop();
    this.redoStack.push(prev);
    return this.stack[this.stack.length - 1];
  }

  redo(current) {
    if (!this.canRedo()) return current;
    const next = this.redoStack.pop();
    this.stack.push(next);
    return next;
  }
}

