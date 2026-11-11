// Bridge tool: start on one island's coastline, optional control points over water, end on another island.
import { Tool } from './tool.js';
import { createBridge } from '../data/defaults.js';
import { BRIDGE_TYPES, BRIDGE_DEFAULTS, COLORS } from '../data/constants.js';
import { nearestCoastPoint } from '../objects/bridge.js';
import { sampleCurve, curveControls } from '../utils/geometry.js';
import { strokePts, drawHandle } from '../renderer/overlay.js';
import { h } from '../utils/dom.js';
import { selectControl, rangeControl } from '../panels/controls.js';

export class BridgeTool extends Tool {
  constructor(editor) {
    super(editor);
    this.bridgeType = 'Road Bridge';
    this.width = BRIDGE_DEFAULTS[this.bridgeType].width;
    this.lanes = BRIDGE_DEFAULTS[this.bridgeType].lanes;
    this.reset();
  }

  reset() {
    this.start = null; // { x, y, islandId }
    this.controls = [];
    this.hover = null;
  }

  get name() { return 'Bridge'; }
  get cursor() { return 'crosshair'; }
  get hint() {
    if (!this.start) return 'Step 1: click on an island coastline to start the bridge';
    return 'Step 2: click over water to add bends · click another island\'s coastline to finish · Esc cancels';
  }

  // Nearest coastline point of any island within tolerance.
  coastSnap(p) {
    const tol = this.editor.tol(30);
    let best = null;
    for (const isl of this.doc.data.islands) {
      if (!isl.visible) continue;
      const c = nearestCoastPoint(isl, p);
      if (c.d <= tol && (!best || c.d < best.d)) best = { x: c.x, y: c.y, d: c.d, islandId: isl.id };
    }
    return best;
  }

  onPointerDown(e) {
    if (e.button === 2) {
      if (this.controls.length) this.controls.pop(); else this.reset();
      this.requestOverlay(); this.editor.emit('hint');
      return;
    }
    if (e.button !== 0) return;
    const snap = this.coastSnap(e.world);
    if (!this.start) {
      if (!snap) { this.editor.toast('Start the bridge on an island coastline', 'warning'); return; }
      this.start = snap;
      this.editor.emit('hint');
      this.requestOverlay();
      return;
    }
    if (snap && snap.islandId !== this.start.islandId) {
      this.create(snap);
      return;
    }
    if (snap && snap.islandId === this.start.islandId && !this.controls.length) {
      this.editor.toast('The end must be on a different island', 'warning');
      return;
    }
    this.controls.push(this.editor.snap(e.world));
    this.requestOverlay();
  }

  create(end) {
    const id = this.doc.newId('bridge');
    const b = createBridge(id, {
      bridgeType: this.bridgeType,
      startIslandId: this.start.islandId,
      endIslandId: end.islandId,
      startPosition: { x: this.start.x, y: this.start.y },
      endPosition: { x: end.x, y: end.y },
      controlPoints: this.controls,
      width: this.width,
      lanes: this.lanes,
      name: `${this.bridgeType} ${id.split('_')[1]}`,
    });
    b.status = 'connected';
    this.editor.createObjects([b], 'Create Bridge');
    const sName = this.doc.get(b.startIslandId)?.name; const eName = this.doc.get(b.endIslandId)?.name;
    this.editor.toast(`Bridge connects ${sName} → ${eName}`, 'success');
    this.reset();
    this.editor.emit('hint');
  }

  onPointerMove(e) {
    this.hover = { p: e.world, snap: this.coastSnap(e.world) };
    this.requestOverlay();
  }

  cancel() {
    if (!this.start) return false;
    this.reset();
    this.requestOverlay();
    this.editor.emit('hint');
    return true;
  }

  deactivate() { this.reset(); }

  drawOverlay(g, zoom) {
    const snap = this.hover?.snap;
    if (snap) g.circle(snap.x, snap.y, 9 / zoom).stroke({ width: 2 / zoom, color: COLORS.success });
    if (!this.start) return;
    const endPt = snap && snap.islandId !== this.start.islandId ? snap : this.hover?.p;
    const pts = [this.start, ...this.controls, ...(endPt ? [endPt] : [])];
    if (pts.length >= 2) {
      const path = sampleCurve(pts, curveControls(pts, 'Smooth'), 12);
      strokePts(g, path, false, this.width, 0x5d646b, 0.7);
      const ok = snap && snap.islandId !== this.start.islandId;
      strokePts(g, path, false, 2 / zoom, ok ? COLORS.success : COLORS.warning, 1);
    }
    drawHandle(g, this.start, zoom, { size: 12, fill: COLORS.success, color: 0xffffff, shape: 'diamond' });
    for (const c of this.controls) drawHandle(g, c, zoom, { size: 8, fill: 0xffffff, color: 0x4b9de8, shape: 'circle' });
  }

  options() {
    return h('div', { class: 'opts' },
      selectControl('Type', this.bridgeType, BRIDGE_TYPES, (v) => {
        this.bridgeType = v;
        this.width = BRIDGE_DEFAULTS[v].width;
        this.lanes = BRIDGE_DEFAULTS[v].lanes;
        this.editor.emit('tool-options');
      }),
      rangeControl('Width', this.width, 8, 160, 1, (v) => { this.width = v; this.requestOverlay(); }, (v) => `${v}px`),
      rangeControl('Lanes', this.lanes, 0, 8, 1, (v) => { this.lanes = v; }));
  }
}
