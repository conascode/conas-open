// Coastline tool: edit island outline vertices and paint per-edge coastline types.
import { Tool } from './tool.js';
import { LiveEdit } from './live-edit.js';
import { PatchCommand } from '../core/commands.js';
import { editableVertices, moveVertexPatch, insertionPoint, insertVertexPatch, removeVertexPatch } from '../objects/shapes.js';
import { refitTerrain } from '../objects/terrain.js';
import { dist, closestPointOnPath } from '../utils/geometry.js';
import { COASTLINE_TYPES } from '../data/constants.js';
import { COASTLINE_STYLE } from '../renderer/textures.js';
import { drawVertices, strokePts, ACCENT } from '../renderer/overlay.js';
import { h } from '../utils/dom.js';
import { segmented, selectControl, rangeControl } from '../panels/controls.js';

export class CoastlineTool extends Tool {
  constructor(editor) {
    super(editor);
    this.mode = 'Vertices';
    this.paintType = 'Rock';
    this.state = null;
    this.activeKey = null;
    this.hoverKey = null;
    this.hoverEdge = -1;
  }

  get name() { return 'Coastline'; }
  get cursor() { return 'default'; }
  get hint() {
    if (!this.target()) return 'Click an island to edit its coastline';
    return this.mode === 'Vertices'
      ? 'Drag vertices · double-click an edge to add · Alt+click or Delete removes · click another island to switch'
      : 'Click or drag along edges to paint the coastline type';
  }

  target() {
    const ed = this.editor;
    if (ed.selection.size !== 1) return null;
    const o = this.doc.get(ed.selection.first);
    return o?.type === 'island' && ed.isEditable(o) ? o : null;
  }

  hitVertex(isl, p) {
    const tol = this.editor.tol(8);
    let best = null;
    for (const v of editableVertices(isl)) {
      const d = dist(v, p);
      if (d <= tol && (!best || d < best.d)) best = { ...v, d };
    }
    return best;
  }

  hitEdge(isl, p) {
    const c = closestPointOnPath(p, isl.polygon, true);
    const tol = this.editor.tol(10) + isl.coastline.width / 2;
    return c && c.d <= tol ? c.index : -1;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const ed = this.editor;
    const isl = this.target();
    if (isl) {
      if (this.mode === 'Vertices') {
        const v = this.hitVertex(isl, e.world);
        if (v) {
          if (e.alt) { this.removeVertex(isl, v.key); return; }
          this.activeKey = v.key;
          this.state = { kind: 'vertex', id: isl.id, key: v.key, live: new LiveEdit(ed), moved: false };
          this.requestOverlay();
          return;
        }
      } else {
        const edge = this.hitEdge(isl, e.world);
        if (edge >= 0) {
          this.state = { kind: 'paint', id: isl.id, live: new LiveEdit(ed), edges: new Set([edge]) };
          this.state.live.step(() => this.paintPatches(this.state));
          return;
        }
      }
    }
    const hit = ed.pick(e.world, (o) => o.type === 'island');
    if (hit) ed.selection.set([hit.id]);
    else ed.selection.clear();
    this.activeKey = null;
    this.editor.emit('hint');
  }

  onPointerMove(e) {
    const s = this.state;
    const isl = this.target();
    if (!s) {
      if (!isl) return;
      if (this.mode === 'Vertices') {
        const k = this.hitVertex(isl, e.world)?.key || null;
        if (k !== this.hoverKey) { this.hoverKey = k; this.requestOverlay(); }
      } else {
        const ed = this.hitEdge(isl, e.world);
        if (ed !== this.hoverEdge) { this.hoverEdge = ed; this.requestOverlay(); }
      }
      return;
    }
    if (s.kind === 'vertex') {
      s.moved = true;
      const p = this.editor.snap(e.world);
      s.live.step(() => new Map([[s.id, moveVertexPatch(s.live.original(s.id), s.key, p)]]), false);
      s.last = p;
    } else if (s.kind === 'paint') {
      const edge = this.hitEdge(this.doc.get(s.id), e.world);
      if (edge >= 0 && !s.edges.has(edge)) {
        s.edges.add(edge);
        s.live.step(() => this.paintPatches(s), false);
      }
    }
    this.requestOverlay();
  }

  onPointerUp() {
    const s = this.state;
    this.state = null;
    if (!s) return;
    if (s.kind === 'vertex') {
      if (!s.moved) { s.live.cancel(); return; }
      s.live.commit(() => {
        const orig = s.live.original(s.id);
        const patch = moveVertexPatch(orig, s.key, s.last);
        if (orig.terrain) patch.terrain = refitTerrain(orig.terrain, patch.polygon);
        return new Map([[s.id, patch]]);
      }, 'Modify Polygon');
    } else if (s.kind === 'paint') {
      s.live.commit(() => this.paintPatches(s), 'Paint Coastline');
    }
    this.requestOverlay();
  }

  paintPatches(s) {
    const orig = s.live.original(s.id);
    const value = this.paintType === 'Default' ? null : this.paintType;
    const edgeTypes = orig.coastline.edgeTypes.map((t, i) => (s.edges.has(i) ? value : t));
    return new Map([[s.id, { coastline: { ...orig.coastline, edgeTypes } }]]);
  }

  onDoubleClick(e) {
    const isl = this.target();
    if (!isl || this.mode !== 'Vertices') return;
    const ins = insertionPoint(isl, e.world);
    if (!ins || ins.d > this.editor.tol(12) + isl.coastline.width / 2) return;
    const patch = insertVertexPatch(isl, ins.index, ins.point);
    if (isl.terrain) patch.terrain = refitTerrain(isl.terrain, patch.polygon);
    this.editor.execute(PatchCommand.from(this.doc, [[isl.id, patch]], 'Add Point'));
    this.activeKey = `v${ins.index}`;
  }

  removeVertex(isl, key) {
    const patch = removeVertexPatch(isl, key);
    if (typeof patch === 'string') { this.editor.toast(patch, 'warning'); return; }
    if (isl.terrain) patch.terrain = refitTerrain(isl.terrain, patch.polygon);
    this.editor.execute(PatchCommand.from(this.doc, [[isl.id, patch]], 'Remove Point'));
    this.activeKey = null;
  }

  onKeyDown(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.activeKey) {
      const isl = this.target();
      if (isl) { this.removeVertex(isl, this.activeKey); return true; }
    }
    return false;
  }

  cancel() {
    if (this.state) { this.state.live.cancel(); this.state = null; return true; }
    if (this.activeKey) { this.activeKey = null; this.requestOverlay(); return true; }
    return false;
  }

  drawOverlay(g, zoom) {
    const isl = this.target();
    if (!isl) return;
    strokePts(g, isl.polygon, true, 1.5 / zoom, ACCENT, 0.9);
    if (this.mode === 'Vertices') drawVertices(g, editableVertices(isl), zoom, this.activeKey, this.hoverKey);
    else if (this.hoverEdge >= 0 && this.hoverEdge < isl.polygon.length) {
      const a = isl.polygon[this.hoverEdge];
      const b = isl.polygon[(this.hoverEdge + 1) % isl.polygon.length];
      const color = this.paintType === 'Default' ? ACCENT : COASTLINE_STYLE[this.paintType].color;
      strokePts(g, [a, b], false, Math.max(isl.coastline.width, 8 / zoom), color, 0.7);
      strokePts(g, [a, b], false, 2 / zoom, 0xffffff, 1);
    }
  }

  options() {
    const isl = this.target();
    return h('div', { class: 'opts' },
      segmented([['Vertices', 'Edit Vertices'], ['Paint', 'Paint Edges']], this.mode, (v) => { this.mode = v; this.editor.emit('hint'); this.requestOverlay(); }),
      selectControl('Paint type', this.paintType, ['Default', ...COASTLINE_TYPES], (v) => { this.paintType = v; }),
      isl ? rangeControl('Coast width', isl.coastline.width, 0, 120, 1,
        (v) => this.editor.setProps(isl.id, { coastline: { ...this.doc.get(isl.id).coastline, width: v } }, 'Modify Property', `coastw:${isl.id}`),
        (v) => `${v}px`) : null);
  }
}
