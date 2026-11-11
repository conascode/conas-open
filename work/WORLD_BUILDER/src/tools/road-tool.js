// Road tool: click to place road points, double-click / Enter to finish.
// Points snap to existing road points (creating a junction) or road segments (inserting a junction point).
import { Tool } from './tool.js';
import { AddCommand, PatchCommand, BatchCommand } from '../core/commands.js';
import { createRoad, roadPoint } from '../data/defaults.js';
import { ROAD_TYPES, ROAD_DEFAULTS, CURVE_MODES, ROAD_DIRECTIONS } from '../data/constants.js';
import { closestRoadSegment, sampleRoad } from '../objects/road.js';
import { dist, sampleCurve, curveControls, smoothHandles } from '../utils/geometry.js';
import { strokePts, drawHandle } from '../renderer/overlay.js';
import { h } from '../utils/dom.js';
import { selectControl, rangeControl, segmented } from '../panels/controls.js';

export class RoadTool extends Tool {
  constructor(editor) {
    super(editor);
    this.roadType = 'Local Road';
    this.curve = 'Straight';
    this.width = ROAD_DEFAULTS[this.roadType].width;
    this.lanes = ROAD_DEFAULTS[this.roadType].lanes;
    this.direction = 'Two-way';
    this.points = []; // { x, y, snap? }
    this.cursor = null;
  }

  get name() { return 'Road'; }
  get cursor() { return 'crosshair'; }
  set cursor(v) { this._cursor = v; }
  get cursorPt() { return this._cursor; }
  get hint() {
    return this.points.length
      ? 'Click to add points · double-click or Enter to finish · right-click removes last · Esc cancels'
      : 'Click to start a road · points snap to existing roads to form junctions (edit points with the Select tool)';
  }

  // Snap priority: existing road point > road segment > grid.
  snapPoint(p) {
    const ed = this.editor;
    if (ed.settings.snapToObjects) {
      const tol = ed.tol(12);
      let best = null;
      for (const id of ed.renderer.spatial.queryPoint(p, tol + 100)) {
        const r = this.doc.get(id);
        if (!r || r.type !== 'road' || !ed.isEditable(r)) continue;
        for (const q of r.points) {
          const d = dist(q, p);
          if (d <= tol && (!best || d < best.d)) best = { x: q.x, y: q.y, d, kind: 'point', roadId: r.id, pointId: q.id };
        }
      }
      if (best) return best;
      for (const id of ed.renderer.spatial.queryPoint(p, tol)) {
        const r = this.doc.get(id);
        if (!r || r.type !== 'road' || !ed.isEditable(r)) continue;
        const c = closestRoadSegment(r, p);
        if (c && c.d <= Math.max(tol, r.width / 2) && (!best || c.d < best.d)) best = { x: c.x, y: c.y, d: c.d, kind: 'segment', roadId: r.id, segment: c.segment };
      }
      if (best) return best;
    }
    return ed.snap(p);
  }

  onPointerDown(e) {
    if (e.button === 2) { this.points.pop(); this.requestOverlay(); this.editor.emit('hint'); return; }
    if (e.button !== 0) return;
    const p = this.snapPoint(e.world);
    const last = this.points[this.points.length - 1];
    if (last && dist(last, p) < this.editor.tol(3)) return;
    this.points.push(p);
    this.requestOverlay();
    this.editor.emit('hint');
  }

  onPointerMove(e) {
    this._cursor = this.snapPoint(e.world);
    this.requestOverlay();
  }

  onDoubleClick() { this.finish(); }

  onKeyDown(e) {
    if (e.key === 'Enter' && this.points.length) { this.finish(); return true; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.points.length) { this.points.pop(); this.requestOverlay(); return true; }
    return false;
  }

  cancel() {
    if (!this.points.length) return false;
    this.points = [];
    this.requestOverlay();
    this.editor.emit('hint');
    return true;
  }

  deactivate() { this.points = []; this._cursor = null; }

  finish() {
    const pts = this.points.filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > this.editor.tol(4));
    this.points = [];
    this.editor.emit('hint');
    if (pts.length < 2) { this.editor.toast('A road needs at least 2 points', 'warning'); this.requestOverlay(); return; }
    const id = this.doc.newId('road');
    const roadPts = pts.map((p) => roadPoint(p.x, p.y));
    if (this.curve === 'Bezier') {
      const hs = smoothHandles(roadPts);
      roadPts.forEach((p, i) => { p.hx = hs[i].x; p.hy = hs[i].y; });
    }
    const connections = [];
    const otherPatches = new Map();
    pts.forEach((p, i) => {
      if (p.kind === 'point') connections.push({ pointId: roadPts[i].id, roadId: p.roadId, targetPointId: p.pointId });
      else if (p.kind === 'segment') {
        // Insert a junction point into the other road.
        const other = this.doc.get(p.roadId);
        const current = otherPatches.get(other.id)?.points || other.points;
        const seg = closestRoadSegment({ ...other, points: current }, p);
        const np = roadPoint(p.x, p.y);
        const nextPts = current.slice();
        nextPts.splice(seg.segment + 1, 0, np);
        otherPatches.set(other.id, { points: nextPts });
        connections.push({ pointId: roadPts[i].id, roadId: other.id, targetPointId: np.id });
      }
    });
    const road = createRoad(id, roadPts, {
      roadType: this.roadType, curve: this.curve, width: this.width, lanes: this.lanes, direction: this.direction, connections,
    });
    road.islandId = this.editor.islandIdFor(road);
    const cmds = [new AddCommand(this.doc, [{ collection: 'roads', obj: road }], 'Create Road')];
    if (otherPatches.size) cmds.push(PatchCommand.from(this.doc, otherPatches, 'Create Road'));
    this.editor.execute(new BatchCommand(cmds, 'Create Road'));
    this.editor.selection.set([road.id]);
    this.editor.toast(`Created ${road.name}${connections.length ? ` with ${connections.length} junction(s)` : ''}`, 'success');
    this.requestOverlay();
  }

  drawOverlay(g, zoom) {
    const pts = this.cursorPt && this.points.length ? [...this.points, this.cursorPt] : this.points;
    if (pts.length >= 2) {
      const path = sampleCurve(pts, curveControls(pts, this.curve === 'Straight' ? 'Straight' : 'Smooth'), 12);
      strokePts(g, path, false, this.width, 0x3b4046, 0.75);
      strokePts(g, path, false, 2 / zoom, 0xf2c94c, 1);
    }
    for (const p of this.points) drawHandle(g, p, zoom, { size: 8, fill: 0xffffff, color: 0x4b9de8 });
    const c = this.cursorPt;
    if (c) {
      const snapped = c.kind === 'point' || c.kind === 'segment';
      drawHandle(g, c, zoom, { size: snapped ? 12 : 7, fill: snapped ? 0x4cbf7a : 0x4b9de8, color: 0xffffff, shape: 'circle' });
    }
  }

  options() {
    const widthCtl = rangeControl('Width', this.width, 6, 160, 1, (v) => { this.width = v; this.requestOverlay(); }, (v) => `${v}px`);
    const lanesCtl = rangeControl('Lanes', this.lanes, 0, 8, 1, (v) => { this.lanes = v; });
    return h('div', { class: 'opts' },
      selectControl('Type', this.roadType, ROAD_TYPES, (v) => {
        this.roadType = v;
        this.width = ROAD_DEFAULTS[v].width;
        this.lanes = ROAD_DEFAULTS[v].lanes;
        this.editor.emit('tool-options');
      }),
      segmented(CURVE_MODES, this.curve, (v) => { this.curve = v; this.requestOverlay(); }),
      widthCtl, lanesCtl,
      selectControl('Direction', this.direction, ROAD_DIRECTIONS, (v) => { this.direction = v; }));
  }
}

export { sampleRoad };
