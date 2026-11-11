// Current selection (object ids).
import { Emitter } from '../utils/events.js';

export class Selection extends Emitter {
  constructor() {
    super();
    this.ids = new Set();
  }

  set(ids) {
    const next = new Set(ids);
    if (next.size === this.ids.size && [...next].every((id) => this.ids.has(id))) return;
    this.ids = next;
    this.emit('change', this.ids);
  }

  add(ids) { this.set([...this.ids, ...ids]); }
  toggle(ids) {
    const next = new Set(this.ids);
    const allIn = ids.every((id) => next.has(id));
    for (const id of ids) if (allIn) next.delete(id); else next.add(id);
    this.set(next);
  }

  remove(ids) {
    const next = new Set(this.ids);
    for (const id of ids) next.delete(id);
    this.set(next);
  }

  clear() { this.set([]); }
  has(id) { return this.ids.has(id); }
  get size() { return this.ids.size; }
  get list() { return [...this.ids]; }
  get first() { return this.ids.values().next().value; }
}
