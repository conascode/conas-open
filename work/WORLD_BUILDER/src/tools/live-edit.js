// Live (interactive) edits: objects are updated every pointer move for visual feedback,
// then restored and committed as a single undoable PatchCommand on pointer up.
import { PatchCommand } from '../core/commands.js';

export class LiveEdit {
  constructor(editor) {
    this.editor = editor;
    this.doc = editor.doc;
    this.originals = new Map(); // id -> shallow copy at start
    this.touched = new Map(); // id -> Set(keys)
  }

  snapshot(id) {
    if (!this.originals.has(id)) {
      const o = this.doc.get(id);
      if (o) this.originals.set(id, { ...o });
    }
    return this.originals.get(id);
  }

  original(id) { return this.snapshot(id); }

  restore() {
    for (const [id, keys] of this.touched) {
      const orig = this.originals.get(id);
      if (!orig) continue;
      const patch = {};
      for (const k of keys) patch[k] = orig[k];
      this.doc.update(id, patch);
    }
    this.touched.clear();
  }

  // computeFn() must build patches from original() values, not from the live document.
  step(computeFn, propagate = true) {
    this.restore();
    const patches = computeFn();
    if (propagate) this.editor.propagateRoadLinks(patches);
    for (const [id, patch] of patches) {
      this.snapshot(id);
      const set = this.touched.get(id) || new Set();
      for (const k of Object.keys(patch)) set.add(k);
      this.touched.set(id, set);
      this.doc.update(id, patch);
    }
  }

  commit(computeFn, label, extra) {
    this.restore();
    const patches = computeFn();
    this.editor.finalizePatches(patches);
    if (extra) extra(patches);
    const cmd = PatchCommand.from(this.doc, patches, label);
    this.editor.execute(cmd);
    this.originals.clear();
    return cmd;
  }

  cancel() {
    this.restore();
    this.originals.clear();
  }
}
