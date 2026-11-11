// Unique ID generation. IDs look like ISL_0007 and never collide with IDs in `taken`.

const PREFIX = {
  island: 'ISL', road: 'RD', bridge: 'BR', building: 'BLD', prop: 'OBJ', area: 'AREA',
  layer: 'LYR', asset: 'AST', group: 'GRP', point: 'P', project: 'PROJECT',
};

export function prefixFor(kind) {
  return PREFIX[kind] || kind.toUpperCase().slice(0, 4);
}

export class IdGenerator {
  constructor() {
    this.counters = new Map();
  }

  // Make counters start past every numeric suffix already in use.
  seed(ids) {
    for (const id of ids) {
      const m = /^([A-Z]+)_(\d+)$/.exec(id);
      if (!m) continue;
      const n = Number(m[2]);
      if (n > (this.counters.get(m[1]) || 0)) this.counters.set(m[1], n);
    }
  }

  next(kind, taken) {
    const prefix = prefixFor(kind);
    let n = this.counters.get(prefix) || 0;
    let id;
    do {
      n += 1;
      id = `${prefix}_${String(n).padStart(4, '0')}`;
    } while (taken && taken(id));
    this.counters.set(prefix, n);
    return id;
  }
}

let pointCounter = 0;
// Short ids for road points; unique within the session and within a road.
export function pointId() {
  pointCounter += 1;
  return `p${Date.now().toString(36)}${pointCounter.toString(36)}`;
}
