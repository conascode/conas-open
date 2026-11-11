// Terrain brush: paint materials into the island terrain grid (clipped by the island polygon).
import { Tool } from './tool.js';
import { TerrainCommand, PatchCommand, BatchCommand } from '../core/commands.js';
import { createTerrainFor, paintDab, floodFill } from '../objects/terrain.js';
import { TERRAIN_MATERIALS, terrainValueOf } from '../data/constants.js';
import { dist } from '../utils/geometry.js';
import { h } from '../utils/dom.js';
import { segmented, selectControl, rangeControl } from '../panels/controls.js';

export class TerrainTool extends Tool {
  constructor(editor) {
    super(editor);
    this.material = 'Sand';
    this.mode = 'Brush';
    this.size = 64; // brush radius in world px
    this.strength = 1;
    this.stroke = null;
    this.cursorPos = null;
  }

  get name() { return 'Terrain Brush'; }
  get cursor() { return 'none'; }
  get hint() { return `${this.mode}: ${this.mode === 'Fill' ? 'click inside an island to fill the connected region' : 'drag inside an island'} · [ / ] change size`; }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const isl = this.editor.islandAt(e.world);
    if (!isl) { this.editor.toast('Terrain can only be edited inside an island', 'warning'); return; }
    if (!this.editor.isEditable(isl)) { this.editor.toast('This island is locked', 'warning'); return; }
    // Lazily create the terrain grid as part of the same undo step.
    let createCmd = null;
    if (!isl.terrain) {
      createCmd = PatchCommand.from(this.doc, [[isl.id, { terrain: createTerrainFor(isl.polygon) }]], 'Create Terrain');
      createCmd.do();
    }
    const value = this.mode === 'Eraser' ? 0 : terrainValueOf(this.material);
    this.stroke = { island: isl, diff: new Map(), value, createCmd, last: null };
    if (this.mode === 'Fill') {
      const rect = floodFill(isl.terrain, isl.polygon, e.world, value, this.stroke.diff);
      if (rect) this.doc.terrainChanged(isl.id, rect);
      this.finishStroke('Terrain Fill');
      return;
    }
    this.dab(e.world);
  }

  dab(p) {
    const s = this.stroke;
    const isl = s.island;
    const step = Math.max(4, this.size * 0.35);
    const pts = [];
    if (s.last) {
      const d = dist(s.last, p);
      const n = Math.max(1, Math.ceil(d / step));
      for (let i = 1; i <= n; i++) pts.push({ x: s.last.x + ((p.x - s.last.x) * i) / n, y: s.last.y + ((p.y - s.last.y) * i) / n });
    } else pts.push(p);
    let rect = null;
    for (const q of pts) {
      const r = paintDab(isl.terrain, isl.polygon, q, this.size, s.value, this.strength, s.diff);
      if (r) rect = rect ? { c0: Math.min(rect.c0, r.c0), r0: Math.min(rect.r0, r.r0), c1: Math.max(rect.c1, r.c1), r1: Math.max(rect.r1, r.r1) } : r;
    }
    s.last = p;
    if (rect) this.doc.terrainChanged(isl.id, rect);
  }

  onPointerMove(e) {
    this.cursorPos = e.world;
    if (this.stroke && this.mode !== 'Fill') this.dab(e.world);
    this.requestOverlay();
  }

  onPointerUp() {
    if (this.stroke) this.finishStroke(this.mode === 'Eraser' ? 'Terrain Erase' : 'Terrain Paint');
  }

  finishStroke(label) {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    if (!s.diff.size) {
      if (s.createCmd) s.createCmd.undo();
      return;
    }
    const t = new TerrainCommand(this.doc, s.island.id, s.diff, label);
    this.editor.record(s.createCmd ? new BatchCommand([s.createCmd, t], label) : t);
  }

  onKeyDown(e) {
    if (e.key === '[') { this.size = Math.max(8, Math.round(this.size / 1.25)); this.editor.emit('tool-options'); this.requestOverlay(); return true; }
    if (e.key === ']') { this.size = Math.min(800, Math.round(this.size * 1.25)); this.editor.emit('tool-options'); this.requestOverlay(); return true; }
    return false;
  }

  deactivate() { if (this.stroke) this.finishStroke('Terrain Paint'); this.cursorPos = null; }

  drawOverlay(g, zoom) {
    if (!this.cursorPos) return;
    const p = this.cursorPos;
    const inside = !!this.editor.islandAt(p);
    const color = inside ? 0xffffff : 0xe0524d;
    if (this.mode === 'Fill') {
      g.circle(p.x, p.y, 6 / zoom).stroke({ width: 2 / zoom, color });
      g.moveTo(p.x - 12 / zoom, p.y).lineTo(p.x + 12 / zoom, p.y).moveTo(p.x, p.y - 12 / zoom).lineTo(p.x, p.y + 12 / zoom).stroke({ width: 1 / zoom, color });
      return;
    }
    g.circle(p.x, p.y, this.size).stroke({ width: 1.5 / zoom, color, alpha: 0.9 });
    g.circle(p.x, p.y, this.size * 0.5).stroke({ width: 1 / zoom, color, alpha: 0.35 * this.strength + 0.1 });
    g.circle(p.x, p.y, 2 / zoom).fill(color);
  }

  options() {
    return h('div', { class: 'opts' },
      segmented(['Brush', 'Eraser', 'Fill'], this.mode, (v) => { this.mode = v; this.editor.emit('hint'); }),
      selectControl('Material', this.material, TERRAIN_MATERIALS, (v) => { this.material = v; }),
      rangeControl('Size', this.size, 8, 800, 1, (v) => { this.size = v; this.requestOverlay(); }, (v) => `${v}px`),
      rangeControl('Strength', this.strength, 0.05, 1, 0.05, (v) => { this.strength = v; }, (v) => `${Math.round(v * 100)}%`));
  }
}
