// Uniform grid spatial hash for viewport culling and hit-test candidate lookup.

export class SpatialIndex {
  constructor(cellSize = 256) {
    this.cellSize = cellSize;
    this.cells = new Map(); // "cx,cy" -> Set(id)
    this.items = new Map(); // id -> { bounds, keys[] }
  }

  _keys(b) {
    const s = this.cellSize;
    const x0 = Math.floor(b.minX / s); const x1 = Math.floor(b.maxX / s);
    const y0 = Math.floor(b.minY / s); const y1 = Math.floor(b.maxY / s);
    const keys = [];
    // Very large objects (bigger than 64x64 cells) go to a shared "huge" bucket.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return ['huge'];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`);
    return keys;
  }

  insert(id, bounds) {
    if (this.items.has(id)) this.remove(id);
    const keys = this._keys(bounds);
    for (const k of keys) {
      let set = this.cells.get(k);
      if (!set) { set = new Set(); this.cells.set(k, set); }
      set.add(id);
    }
    this.items.set(id, { bounds, keys });
  }

  update(id, bounds) {
    this.insert(id, bounds);
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    for (const k of it.keys) {
      const set = this.cells.get(k);
      if (set) { set.delete(id); if (!set.size) this.cells.delete(k); }
    }
    this.items.delete(id);
  }

  clear() {
    this.cells.clear();
    this.items.clear();
  }

  boundsOf(id) {
    return this.items.get(id)?.bounds;
  }

  // Ids whose bounds intersect `b`.
  query(b) {
    const out = new Set();
    const s = this.cellSize;
    const x0 = Math.floor(b.minX / s); const x1 = Math.floor(b.maxX / s);
    const y0 = Math.floor(b.minY / s); const y1 = Math.floor(b.maxY / s);
    const test = (id) => {
      const ib = this.items.get(id).bounds;
      if (ib.minX <= b.maxX && ib.maxX >= b.minX && ib.minY <= b.maxY && ib.maxY >= b.minY) out.add(id);
    };
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (const set of this.cells.values()) for (const id of set) if (!out.has(id)) test(id);
    } else {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const set = this.cells.get(`${x},${y}`);
          if (set) for (const id of set) if (!out.has(id)) test(id);
        }
      }
      const huge = this.cells.get('huge');
      if (huge) for (const id of huge) if (!out.has(id)) test(id);
    }
    return out;
  }

  queryPoint(p, pad = 0) {
    return this.query({ minX: p.x - pad, minY: p.y - pad, maxX: p.x + pad, maxY: p.y + pad });
  }
}
