// Overlay drawing helpers. Everything is drawn in world space; sizes are divided by zoom
// so handles and lines keep a constant on-screen size.
import { COLORS } from '../data/constants.js';
import { outlineOf, getShapeBounds } from '../objects/shapes.js';
import { localToWorld, offsetPath } from '../utils/geometry.js';

export const ACCENT = COLORS.accent;

export function strokePts(g, pts, closed, width, color, alpha = 1) {
  if (pts.length < 2) return;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (closed) g.closePath();
  g.stroke({ width, color, alpha, join: 'round', cap: 'round' });
}

export function drawObjectOutline(g, obj, zoom, color = ACCENT, alpha = 1, w = 2) {
  const o = outlineOf(obj);
  if (o.width) {
    // path objects: draw both edges of the stroke
    strokePts(g, offsetPath(o.points, o.width / 2 + 3 / zoom), false, w / zoom, color, alpha);
    strokePts(g, offsetPath(o.points, -o.width / 2 - 3 / zoom), false, w / zoom, color, alpha);
  } else strokePts(g, o.points, o.closed, w / zoom, color, alpha);
}

export function drawHandle(g, p, zoom, { size = 8, color = 0xffffff, fill = ACCENT, shape = 'square' } = {}) {
  const s = size / zoom;
  if (shape === 'circle') g.circle(p.x, p.y, s / 2).fill(fill).stroke({ width: 1.5 / zoom, color });
  else if (shape === 'diamond') {
    g.poly([p.x, p.y - s / 1.6, p.x + s / 1.6, p.y, p.x, p.y + s / 1.6, p.x - s / 1.6, p.y], true).fill(fill).stroke({ width: 1.5 / zoom, color });
  } else g.rect(p.x - s / 2, p.y - s / 2, s, s).fill(fill).stroke({ width: 1.5 / zoom, color });
}

export function drawVertices(g, verts, zoom, activeKey, hoverKey) {
  for (const v of verts) {
    if (v.kind === 'handle' && v.anchor) strokePts(g, [v.anchor, v], false, 1 / zoom, 0xf2c94c, 0.8);
  }
  for (const v of verts) {
    const active = v.key === activeKey;
    const hover = v.key === hoverKey;
    const fill = active ? 0xf2c94c : v.kind === 'handle' ? 0xf2c94c : v.kind === 'endpoint' ? COLORS.success : v.kind === 'hitbox' ? 0xe0524d : 0xffffff;
    drawHandle(g, v, zoom, {
      size: active || hover ? 11 : v.kind === 'handle' ? 7 : 9,
      fill, color: v.kind === 'vertex' ? ACCENT : 0x111820,
      shape: v.kind === 'handle' || v.kind === 'control' ? 'circle' : v.kind === 'endpoint' ? 'diamond' : 'square',
    });
  }
}

export function drawHitbox(g, obj, zoom) {
  if (!obj.hitbox) return;
  const pts = obj.hitbox.points.map((p) => localToWorld(obj, p));
  g.poly(pts.flatMap((p) => [p.x, p.y]), true).fill({ color: 0xe0524d, alpha: 0.18 });
  strokePts(g, pts, true, 2 / zoom, 0xe0524d, 0.95);
}

export function drawBounds(g, b, zoom, color = ACCENT, alpha = 0.6) {
  g.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY).stroke({ width: 1 / zoom, color, alpha });
}

export function drawAllOutlines(g, editor, zoom) {
  const r = editor.renderer;
  for (const id of r.visibleIds) {
    const o = editor.doc.get(id);
    if (!o || !o.visible) continue;
    const l = editor.doc.layer(o.layer);
    if (l && !l.visible) continue;
    drawBounds(g, getShapeBounds(o), zoom, 0x9fb3c8, 0.35);
  }
}
