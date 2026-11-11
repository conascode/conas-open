// Camera: maps world coordinates to screen (canvas) coordinates.
// screen = world * zoom + offset. Objects are never stored in screen space.
import { clamp } from '../utils/geometry.js';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

export class Camera {
  constructor() {
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.viewWidth = 1;
    this.viewHeight = 1;
    this.version = 0; // bumps on every change so the renderer can detect it
  }

  setViewSize(w, h) {
    this.viewWidth = w;
    this.viewHeight = h;
    this.version++;
  }

  worldToScreen(p) {
    return { x: p.x * this.zoom + this.offsetX, y: p.y * this.zoom + this.offsetY };
  }

  screenToWorld(p) {
    return { x: (p.x - this.offsetX) / this.zoom, y: (p.y - this.offsetY) / this.zoom };
  }

  panBy(dxScreen, dyScreen) {
    this.offsetX += dxScreen;
    this.offsetY += dyScreen;
    this.version++;
  }

  // Zoom keeping the world point under `screenPt` fixed.
  zoomAt(screenPt, factor) {
    const before = this.screenToWorld(screenPt);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.offsetX = screenPt.x - before.x * this.zoom;
    this.offsetY = screenPt.y - before.y * this.zoom;
    this.version++;
  }

  setZoom(zoom, screenPt = { x: this.viewWidth / 2, y: this.viewHeight / 2 }) {
    this.zoomAt(screenPt, zoom / this.zoom);
  }

  centerOn(worldPt) {
    this.offsetX = this.viewWidth / 2 - worldPt.x * this.zoom;
    this.offsetY = this.viewHeight / 2 - worldPt.y * this.zoom;
    this.version++;
  }

  // Fit a world rectangle into the view with padding (screen px).
  fitBounds(b, padding = 60) {
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);
    this.zoom = clamp(Math.min((this.viewWidth - padding * 2) / w, (this.viewHeight - padding * 2) / h), MIN_ZOOM, MAX_ZOOM);
    this.centerOn({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
  }

  // Visible world rectangle.
  viewBounds(margin = 0) {
    const a = this.screenToWorld({ x: -margin, y: -margin });
    const b = this.screenToWorld({ x: this.viewWidth + margin, y: this.viewHeight + margin });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  toJSON() {
    return { zoom: this.zoom, offsetX: this.offsetX, offsetY: this.offsetY };
  }
}
