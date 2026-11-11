// WorldDocument: the single source of truth for project data.
// All mutations go through add/remove/update so that the renderer, panels and
// spatial index stay in sync. Commands (commands.js) call these methods.
import { Emitter } from '../utils/events.js';
import { IdGenerator } from '../utils/id.js';
import { OBJECT_COLLECTIONS } from '../data/constants.js';

export const ALL_COLLECTIONS = ['layers', 'assets', ...OBJECT_COLLECTIONS, 'routes'];

export class WorldDocument extends Emitter {
  constructor() {
    super();
    this.ids = new IdGenerator();
    this.byId = new Map();
    this.data = null;
  }

  // Replace everything with `data` (runtime form, already validated).
  load(data) {
    this.data = data;
    this.byId.clear();
    for (const c of ALL_COLLECTIONS) {
      data[c] ??= [];
      for (const o of data[c]) if (o && o.id) this.byId.set(o.id, { obj: o, collection: c });
    }
    this.ids = new IdGenerator();
    this.ids.seed(this.byId.keys());
    this.emit('reset', data);
  }

  get project() { return this.data.project; }
  get world() { return this.data.world; }
  get layers() { return this.data.layers; }
  get assets() { return this.data.assets; }

  get(id) { return this.byId.get(id)?.obj; }
  has(id) { return this.byId.has(id); }
  collectionOf(id) { return this.byId.get(id)?.collection; }

  newId(kind) {
    return this.ids.next(kind, (id) => this.byId.has(id));
  }

  *objects() {
    for (const c of OBJECT_COLLECTIONS) yield* this.data[c];
  }

  objectCount() {
    let n = 0;
    for (const c of OBJECT_COLLECTIONS) n += this.data[c].length;
    return n;
  }

  layer(id) { return this.byId.get(id)?.collection === 'layers' ? this.get(id) : undefined; }
  asset(id) { return this.byId.get(id)?.collection === 'assets' ? this.get(id) : undefined; }
  island(id) { return this.byId.get(id)?.collection === 'islands' ? this.get(id) : undefined; }

  add(collection, obj, index) {
    if (this.byId.has(obj.id)) throw new Error(`Duplicate ID ${obj.id}`);
    const list = this.data[collection];
    if (index === undefined || index < 0 || index > list.length) list.push(obj);
    else list.splice(index, 0, obj);
    this.byId.set(obj.id, { obj, collection });
    this.emit('add', { collection, obj });
    this.emit('change', { kind: 'add', collection, id: obj.id });
  }

  remove(id) {
    const entry = this.byId.get(id);
    if (!entry) return null;
    const list = this.data[entry.collection];
    const index = list.indexOf(entry.obj);
    if (index >= 0) list.splice(index, 1);
    this.byId.delete(id);
    this.emit('remove', { collection: entry.collection, obj: entry.obj });
    this.emit('change', { kind: 'remove', collection: entry.collection, id });
    return { collection: entry.collection, obj: entry.obj, index };
  }

  // Shallow-merge `patch` into the object. Values are replaced, never mutated in place.
  update(id, patch) {
    const entry = this.byId.get(id);
    if (!entry) return;
    Object.assign(entry.obj, patch);
    const keys = Object.keys(patch);
    this.emit('update', { collection: entry.collection, obj: entry.obj, keys });
    this.emit('change', { kind: 'update', collection: entry.collection, id, keys });
  }

  // Move an item within its collection (used for layer ordering).
  move(id, newIndex) {
    const entry = this.byId.get(id);
    if (!entry) return;
    const list = this.data[entry.collection];
    const from = list.indexOf(entry.obj);
    list.splice(from, 1);
    list.splice(newIndex, 0, entry.obj);
    this.emit('reorder', { collection: entry.collection });
    this.emit('change', { kind: 'reorder', collection: entry.collection, id });
    return from;
  }

  // project / world / metadata sections
  updateSection(section, patch) {
    Object.assign(this.data[section], patch);
    this.emit('section', { section, keys: Object.keys(patch) });
    this.emit('change', { kind: 'section', section });
  }

  // Terrain cells are edited in place for speed; announce the dirty region.
  terrainChanged(islandId, rect) {
    this.emit('terrain', { id: islandId, rect });
    this.emit('change', { kind: 'terrain', id: islandId });
  }
}
