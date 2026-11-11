// Type-dispatched geometry for every world object: bounds, hit testing, transforms and vertex editing.
// Box objects (building, prop) have x/y = anchor point, width/height and rotation.
// Path objects (island, area, road, bridge) store baked world-coordinate points;
// their x/y/width/height mirror the bounds and rotation is informational (cumulative).
import {
  boundsOfPoints, boxCorners, worldToLocal, pointInPolygon, distanceToPath, closestPointOnPath,
  applyMatrix, applyLinear, isTranslationOnly, DEG, boundsCenter, localToWorld,
} from '../utils/geometry.js';
import { sampleRoad, roadBounds, closestRoadSegment, roadMeta } from './road.js';
import { bridgePath, bridgeBounds, bridgeAnchors, bridgeMeta } from './bridge.js';
import { refitTerrain, translateTerrain } from './terrain.js';
import { syncPolygonBounds } from '../data/defaults.js';

export const isBoxType = (o) => o.type === 'building' || o.type === 'prop';
export const isPolygonType = (o) => o.type === 'island' || o.type === 'area';

export function getBounds(obj) {
  switch (obj.type) {
    case 'island': return boundsOfPoints(obj.polygon, (obj.coastline?.width || 0) / 2 + 30);
    case 'area': return boundsOfPoints(obj.polygon, 2);
    case 'road': return roadBounds(obj);
    case 'bridge': return bridgeBounds(obj);
    default: return boundsOfPoints(boxCorners(obj));
  }
}

// Tight bounds used for selection boxes (no coastline / glow padding).
export function getShapeBounds(obj) {
  switch (obj.type) {
    case 'island':
    case 'area': return boundsOfPoints(obj.polygon);
    case 'road': return boundsOfPoints(sampleRoad(obj), obj.width / 2);
    case 'bridge': return boundsOfPoints(bridgePath(obj), obj.width / 2);
    default: return boundsOfPoints(boxCorners(obj));
  }
}

export function hitTest(obj, p, tol = 0) {
  switch (obj.type) {
    case 'island':
    case 'area':
      return pointInPolygon(p, obj.polygon) || distanceToPath(p, obj.polygon, true) <= tol;
    case 'road':
      return distanceToPath(p, sampleRoad(obj), false) <= obj.width / 2 + tol;
    case 'bridge':
      return distanceToPath(p, bridgePath(obj), false) <= obj.width / 2 + tol;
    default: {
      const l = worldToLocal(obj, p);
      const x0 = -(obj.anchorX ?? 0.5) * obj.width;
      const y0 = -(obj.anchorY ?? 0.5) * obj.height;
      return l.x >= x0 - tol && l.x <= x0 + obj.width + tol && l.y >= y0 - tol && l.y <= y0 + obj.height + tol;
    }
  }
}

// Outline polygon (world coords) for selection highlight.
export function outlineOf(obj) {
  switch (obj.type) {
    case 'island':
    case 'area': return { points: obj.polygon, closed: true };
    case 'road': return { points: sampleRoad(obj), closed: false, width: obj.width };
    case 'bridge': return { points: bridgePath(obj), closed: false, width: obj.width };
    default: return { points: boxCorners(obj), closed: true };
  }
}

const mapPts = (m, pts) => pts.map((p) => ({ ...p, ...applyMatrix(m, p) }));

// Apply an affine transform (world -> world). Returns a patch (only changed keys).
// opts.live skips the (expensive) terrain resampling during interactive drags.
export function transformPatch(obj, m, opts = {}) {
  const angle = Math.atan2(m.b, m.a) / DEG;
  switch (obj.type) {
    case 'island': {
      const polygon = mapPts(m, obj.polygon);
      const tmp = syncPolygonBounds({ polygon });
      const patch = { polygon, x: tmp.x, y: tmp.y, width: tmp.width, height: tmp.height, rotation: normAngle(obj.rotation + angle) };
      if (obj.terrain) {
        if (isTranslationOnly(m)) patch.terrain = translateTerrain(obj.terrain, m.tx, m.ty);
        else if (!opts.live) patch.terrain = refitTerrain(obj.terrain, polygon, m);
      }
      return patch;
    }
    case 'area': {
      const polygon = mapPts(m, obj.polygon);
      const tmp = syncPolygonBounds({ polygon });
      return { polygon, x: tmp.x, y: tmp.y, width: tmp.width, height: tmp.height, rotation: normAngle(obj.rotation + angle) };
    }
    case 'road': {
      const points = obj.points.map((p) => {
        const q = applyMatrix(m, p);
        const h = applyLinear(m, { x: p.hx, y: p.hy });
        return { ...p, x: q.x, y: q.y, hx: h.x, hy: h.y };
      });
      return roadPatch(obj, { points, rotation: normAngle(obj.rotation + angle) });
    }
    case 'bridge': {
      const startPosition = applyMatrix(m, obj.startPosition);
      const endPosition = applyMatrix(m, obj.endPosition);
      const controlPoints = obj.controlPoints.map((p) => applyMatrix(m, p));
      return bridgePatch(obj, { startPosition, endPosition, controlPoints, rotation: normAngle(obj.rotation + angle) });
    }
    default: {
      // Box: move anchor; scale width/height by how the local axes stretch.
      const c = applyMatrix(m, { x: obj.x, y: obj.y });
      const r = obj.rotation * DEG;
      const ax = applyLinear(m, { x: Math.cos(r), y: Math.sin(r) });
      const ay = applyLinear(m, { x: -Math.sin(r), y: Math.cos(r) });
      const sx = Math.hypot(ax.x, ax.y);
      const sy = Math.hypot(ay.x, ay.y);
      const patch = { x: c.x, y: c.y };
      if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) {
        patch.width = Math.max(1, obj.width * sx);
        patch.height = Math.max(1, obj.height * sy);
        if (obj.hitbox) patch.hitbox = scaleHitbox(obj.hitbox, patch.width / obj.width, patch.height / obj.height);
      }
      const rot = normAngle(Math.atan2(ax.y, ax.x) / DEG);
      if (Math.abs(rot - obj.rotation) > 1e-6) patch.rotation = rot;
      return patch;
    }
  }
}

// Roads/bridges: add derived x/y (centre) and height (length) to a geometry patch.
export function roadPatch(obj, patch) {
  return { ...patch, ...roadMeta({ ...obj, ...patch }) };
}

export function bridgePatch(obj, patch) {
  return { ...patch, ...bridgeMeta({ ...obj, ...patch }) };
}

export function scaleHitbox(hitbox, sx, sy) {
  return { type: hitbox.type, points: hitbox.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) };
}

export function normAngle(a) {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.round(r * 1000) / 1000;
}

// ---------------- vertex editing ----------------
// Handles are { key, x, y, kind } where kind is 'vertex' | 'handle' | 'endpoint' | 'control' | 'hitbox'.

export function editableVertices(obj, mode = 'shape') {
  if (mode === 'hitbox' && obj.hitbox) {
    return obj.hitbox.points.map((p, i) => ({ key: `h${i}`, ...localToWorld(obj, p), kind: 'hitbox', index: i }));
  }
  switch (obj.type) {
    case 'island':
    case 'area':
      return obj.polygon.map((p, i) => ({ key: `v${i}`, x: p.x, y: p.y, kind: 'vertex', index: i }));
    case 'road': {
      const out = obj.points.map((p, i) => ({ key: `v${i}`, x: p.x, y: p.y, kind: 'vertex', index: i }));
      if (obj.curve === 'Bezier') {
        obj.points.forEach((p, i) => {
          out.push({ key: `hi${i}`, x: p.x - p.hx, y: p.y - p.hy, kind: 'handle', index: i, sign: -1, anchor: p });
          out.push({ key: `ho${i}`, x: p.x + p.hx, y: p.y + p.hy, kind: 'handle', index: i, sign: 1, anchor: p });
        });
      }
      return out;
    }
    case 'bridge': {
      const out = [{ key: 'start', ...obj.startPosition, kind: 'endpoint' }];
      obj.controlPoints.forEach((p, i) => out.push({ key: `c${i}`, x: p.x, y: p.y, kind: 'control', index: i }));
      out.push({ key: 'end', ...obj.endPosition, kind: 'endpoint' });
      return out;
    }
    default: return [];
  }
}

// Returns a patch moving vertex `key` to p.
export function moveVertexPatch(obj, key, p) {
  if (key.startsWith('h') && !key.startsWith('hi') && !key.startsWith('ho')) {
    const i = Number(key.slice(1));
    const l = worldToLocal(obj, p);
    const points = obj.hitbox.points.map((q, k) => (k === i ? { x: l.x, y: l.y } : q));
    return { hitbox: { type: obj.hitbox.type, points } };
  }
  switch (obj.type) {
    case 'island':
    case 'area': {
      const i = Number(key.slice(1));
      const polygon = obj.polygon.map((q, k) => (k === i ? { x: p.x, y: p.y } : q));
      const t = syncPolygonBounds({ polygon });
      return { polygon, x: t.x, y: t.y, width: t.width, height: t.height };
    }
    case 'road': {
      let points;
      if (key.startsWith('hi') || key.startsWith('ho')) {
        const i = Number(key.slice(2));
        const sign = key.startsWith('ho') ? 1 : -1;
        points = obj.points.map((q, k) => (k === i ? { ...q, hx: (p.x - q.x) * sign, hy: (p.y - q.y) * sign } : q));
      } else {
        const i = Number(key.slice(1));
        points = obj.points.map((q, k) => (k === i ? { ...q, x: p.x, y: p.y } : q));
      }
      return roadPatch(obj, { points });
    }
    case 'bridge': {
      const next = { startPosition: obj.startPosition, endPosition: obj.endPosition, controlPoints: obj.controlPoints };
      if (key === 'start') next.startPosition = { x: p.x, y: p.y };
      else if (key === 'end') next.endPosition = { x: p.x, y: p.y };
      else {
        const i = Number(key.slice(1));
        next.controlPoints = obj.controlPoints.map((q, k) => (k === i ? { x: p.x, y: p.y } : q));
      }
      return bridgePatch(obj, next);
    }
    default: return {};
  }
}

// Find where a new vertex would be inserted for a click at p. Returns {index, point, d} or null.
export function insertionPoint(obj, p, mode = 'shape') {
  if (mode === 'hitbox' && obj.hitbox) {
    const pts = obj.hitbox.points.map((q) => localToWorld(obj, q));
    const c = closestPointOnPath(p, pts, true);
    return c ? { index: c.index + 1, point: { x: c.x, y: c.y }, d: c.d } : null;
  }
  switch (obj.type) {
    case 'island':
    case 'area': {
      const c = closestPointOnPath(p, obj.polygon, true);
      return c ? { index: c.index + 1, point: { x: c.x, y: c.y }, d: c.d } : null;
    }
    case 'road': {
      const c = closestRoadSegment(obj, p);
      return c ? { index: c.segment + 1, point: { x: c.x, y: c.y }, d: c.d } : null;
    }
    case 'bridge': {
      const anchors = bridgeAnchors(obj);
      const c = closestPointOnPath(p, anchors, false);
      return c ? { index: c.index, point: { x: c.x, y: c.y }, d: c.d } : null; // index into controlPoints
    }
    default: return null;
  }
}

export function insertVertexPatch(obj, index, p, mode = 'shape', newPointFactory) {
  if (mode === 'hitbox' && obj.hitbox) {
    const l = worldToLocal(obj, p);
    const points = obj.hitbox.points.slice();
    points.splice(index, 0, { x: l.x, y: l.y });
    return { hitbox: { type: obj.hitbox.type === 'Rectangle' ? 'Polygon' : obj.hitbox.type, points } };
  }
  switch (obj.type) {
    case 'island': {
      const polygon = obj.polygon.slice();
      polygon.splice(index, 0, { x: p.x, y: p.y });
      const edgeTypes = obj.coastline.edgeTypes.slice();
      // new edge inherits the type of the edge it splits
      edgeTypes.splice(index, 0, edgeTypes[index - 1] ?? null);
      const t = syncPolygonBounds({ polygon });
      return { polygon, coastline: { ...obj.coastline, edgeTypes }, x: t.x, y: t.y, width: t.width, height: t.height };
    }
    case 'area': {
      const polygon = obj.polygon.slice();
      polygon.splice(index, 0, { x: p.x, y: p.y });
      const t = syncPolygonBounds({ polygon });
      return { polygon, x: t.x, y: t.y, width: t.width, height: t.height };
    }
    case 'road': {
      const points = obj.points.slice();
      points.splice(index, 0, newPointFactory(p.x, p.y));
      return roadPatch(obj, { points });
    }
    case 'bridge': {
      const controlPoints = obj.controlPoints.slice();
      controlPoints.splice(index, 0, { x: p.x, y: p.y });
      return bridgePatch(obj, { controlPoints });
    }
    default: return null;
  }
}

// Returns a patch removing a vertex, or a string explaining why it cannot be removed.
export function removeVertexPatch(obj, key, mode = 'shape') {
  if (mode === 'hitbox' && obj.hitbox) {
    if (obj.hitbox.points.length <= 3) return 'A hitbox needs at least 3 points';
    const i = Number(key.slice(1));
    return { hitbox: { type: obj.hitbox.type === 'Rectangle' ? 'Polygon' : obj.hitbox.type, points: obj.hitbox.points.filter((_, k) => k !== i) } };
  }
  switch (obj.type) {
    case 'island':
    case 'area': {
      if (obj.polygon.length <= 3) return 'A polygon needs at least 3 vertices';
      const i = Number(key.slice(1));
      const polygon = obj.polygon.filter((_, k) => k !== i);
      const t = syncPolygonBounds({ polygon });
      const patch = { polygon, x: t.x, y: t.y, width: t.width, height: t.height };
      if (obj.type === 'island') patch.coastline = { ...obj.coastline, edgeTypes: obj.coastline.edgeTypes.filter((_, k) => k !== i) };
      return patch;
    }
    case 'road': {
      if (key.startsWith('hi') || key.startsWith('ho')) {
        const i = Number(key.slice(2));
        return roadPatch(obj, { points: obj.points.map((q, k) => (k === i ? { ...q, hx: 0, hy: 0 } : q)) });
      }
      if (obj.points.length <= 2) return 'A road needs at least 2 points';
      const i = Number(key.slice(1));
      const points = obj.points.filter((_, k) => k !== i);
      return roadPatch(obj, { points });
    }
    case 'bridge': {
      if (!key.startsWith('c')) return 'Bridge endpoints cannot be removed';
      const i = Number(key.slice(1));
      return bridgePatch(obj, { controlPoints: obj.controlPoints.filter((_, k) => k !== i) });
    }
    default: return 'Not editable';
  }
}
