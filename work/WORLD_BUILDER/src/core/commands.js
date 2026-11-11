// Command Pattern. Every edit is a command with do()/undo().
// Commands store only what changed: patches keep the changed keys, terrain keeps changed cells.

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

export class AddCommand {
  // entries: [{ collection, obj, index? }]
  constructor(doc, entries, label = 'Create') {
    this.doc = doc;
    this.entries = entries;
    this.label = label;
  }

  do() { for (const e of this.entries) this.doc.add(e.collection, e.obj, e.index); }
  undo() { for (const e of [...this.entries].reverse()) this.doc.remove(e.obj.id); }
  get ids() { return this.entries.map((e) => e.obj.id); }
}

export class RemoveCommand {
  constructor(doc, ids, label = 'Delete') {
    this.doc = doc;
    this.idList = ids;
    this.removed = [];
    this.label = label;
  }

  do() {
    this.removed = [];
    for (const id of this.idList) {
      const r = this.doc.remove(id);
      if (r) this.removed.push(r);
    }
  }

  undo() {
    for (const r of [...this.removed].reverse()) this.doc.add(r.collection, r.obj, r.index);
  }
}

export class PatchCommand {
  // changes: [{ id, before, after }]
  constructor(doc, changes, label = 'Modify Property', mergeKey = null) {
    this.doc = doc;
    this.changes = changes.filter((c) => Object.keys(c.after).length);
    this.label = label;
    this.mergeKey = mergeKey;
  }

  static from(doc, patches, label, mergeKey) {
    // patches: Map|array of [id, patch]
    const changes = [];
    for (const [id, patch] of patches) {
      const obj = doc.get(id);
      if (!obj || !patch) continue;
      changes.push({ id, before: pick(obj, Object.keys(patch)), after: patch });
    }
    return new PatchCommand(doc, changes, label, mergeKey);
  }

  get empty() { return this.changes.length === 0; }
  do() { for (const c of this.changes) this.doc.update(c.id, c.after); }
  undo() { for (const c of [...this.changes].reverse()) this.doc.update(c.id, c.before); }

  merge(other) {
    if (!(other instanceof PatchCommand)) return false;
    for (const oc of other.changes) {
      const mine = this.changes.find((c) => c.id === oc.id);
      if (mine) {
        for (const k of Object.keys(oc.after)) if (!(k in mine.before)) mine.before[k] = oc.before[k];
        Object.assign(mine.after, oc.after);
      } else this.changes.push(oc);
    }
    return true;
  }
}

export class MoveItemCommand {
  constructor(doc, id, toIndex, label = 'Reorder') {
    this.doc = doc; this.id = id; this.toIndex = toIndex; this.label = label; this.from = null;
  }

  do() { this.from = this.doc.move(this.id, this.toIndex); }
  undo() { this.doc.move(this.id, this.from); }
}

export class SectionCommand {
  constructor(doc, section, patch, label = 'Project Settings') {
    this.doc = doc; this.section = section; this.after = patch; this.label = label;
    this.before = pick(doc.data[section], Object.keys(patch));
  }

  do() { this.doc.updateSection(this.section, this.after); }
  undo() { this.doc.updateSection(this.section, this.before); }
}

// Terrain painting: diff is Map(cellIndex -> [old, new]). Cells were already painted live,
// so this command is pushed with history.record() rather than execute().
export class TerrainCommand {
  constructor(doc, islandId, diff, label = 'Terrain Paint') {
    this.doc = doc;
    this.islandId = islandId;
    // Compact typed arrays: memory-efficient for large strokes.
    const n = diff.size;
    this.idx = new Uint32Array(n);
    this.oldV = new Uint8Array(n);
    this.newV = new Uint8Array(n);
    let i = 0;
    for (const [k, [o, v]] of diff) { this.idx[i] = k; this.oldV[i] = o; this.newV[i] = v; i++; }
    this.label = label;
  }

  _apply(values) {
    const isl = this.doc.get(this.islandId);
    if (!isl?.terrain) return;
    const { cells } = isl.terrain;
    for (let i = 0; i < this.idx.length; i++) cells[this.idx[i]] = values[i];
    this.doc.terrainChanged(this.islandId, null);
  }

  do() { this._apply(this.newV); }
  undo() { this._apply(this.oldV); }
}

export class BatchCommand {
  constructor(commands, label) {
    this.commands = commands.filter(Boolean);
    this.label = label || this.commands[0]?.label || 'Edit';
  }

  do() { for (const c of this.commands) c.do(); }
  undo() { for (const c of [...this.commands].reverse()) c.undo(); }
}
