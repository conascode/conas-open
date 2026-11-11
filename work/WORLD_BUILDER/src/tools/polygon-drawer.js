// Shared polygon / freehand drawing used by the Island and Area tools.
import { dist, simplifyClosed, isSelfIntersecting, polygonArea } from '../utils/geometry.js';
import { strokePts, drawHandle, ACCENT } from '../renderer/overlay.js';

export class PolygonDrawer {
  constructor(editor, { onComplete, color = ACCENT }) {
    this.editor = editor;
    this.onComplete = onComplete;
    this.color = color;
    this.mode = 'Polygon'; // or 'Freehand'
    this.tolerance = 6; // simplification tolerance in screen px
    this.reset();
  }

  reset() {
    this.points = [];
    this.cursor = null;
    this.drawing = false;
  }

  get active() { return this.points.length > 0; }

  down(e) {
    if (e.button === 2) { this.points.pop(); this.editor.requestOverlay(); return; }
    if (e.button !== 0) return;
    const p = this.editor.snap(e.world);
    if (this.mode === 'Freehand') {
      this.points = [p];
      this.drawing = true;
      return;
    }
    // Clicking the first vertex closes the polygon.
    if (this.points.length >= 3 && dist(this.editor.camera.worldToScreen(this.points[0]), e.screen) < 10) {
      this.finish();
      return;
    }
    const last = this.points[this.points.length - 1];
    if (!last || dist(last, p) > this.editor.tol(2)) this.points.push(p);
    this.editor.requestOverlay();
  }

  move(e) {
    this.cursor = this.editor.snap(e.world);
    if (this.drawing) {
      const last = this.points[this.points.length - 1];
      if (dist(last, e.world) > this.editor.tol(3)) this.points.push({ ...e.world });
    }
    this.editor.requestOverlay();
  }

  up() {
    if (this.drawing) {
      this.drawing = false;
      this.finish();
    }
  }

  dblclick() {
    if (this.mode !== 'Polygon') return;
    // The double click's second click added a duplicate point; drop near-duplicates.
    const pts = this.points.filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > this.editor.tol(4));
    this.points = pts;
    this.finish();
  }

  finish() {
    let pts = this.points;
    if (this.mode === 'Freehand') pts = simplifyClosed(pts, this.editor.tol(this.tolerance));
    if (pts.length < 3 || Math.abs(polygonArea(pts)) < this.editor.tol(4) ** 2 * 4) {
      if (this.points.length) this.editor.toast('A shape needs at least 3 points and some area', 'warning');
      this.reset();
      this.editor.requestOverlay();
      return;
    }
    if (isSelfIntersecting(pts)) this.editor.toast('The outline crosses itself — consider fixing it with the Coastline tool', 'warning');
    this.reset();
    this.onComplete(pts);
    this.editor.requestOverlay();
  }

  cancel() {
    if (!this.active) return false;
    this.reset();
    this.editor.requestOverlay();
    return true;
  }

  draw(g, zoom) {
    if (!this.points.length) {
      if (this.cursor) drawHandle(g, this.cursor, zoom, { size: 6, fill: this.color, color: 0xffffff, shape: 'circle' });
      return;
    }
    const pts = this.mode === 'Polygon' && this.cursor && !this.drawing ? [...this.points, this.cursor] : this.points;
    if (pts.length >= 3) g.poly(pts.flatMap((p) => [p.x, p.y]), true).fill({ color: this.color, alpha: 0.12 });
    strokePts(g, pts, false, 2 / zoom, this.color, 1);
    if (this.mode === 'Polygon') {
      for (const p of this.points) drawHandle(g, p, zoom, { size: 7, fill: 0xffffff, color: this.color });
      if (this.points.length >= 3) drawHandle(g, this.points[0], zoom, { size: 11, fill: this.color, color: 0xffffff, shape: 'circle' });
    }
  }
}
