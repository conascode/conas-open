// Road geometry: sampling of straight / smooth (Catmull-Rom) / bezier roads.
import { catmullRomHandles, sampleBezierChain, boundsOfPoints, closestPointOnPath } from '../utils/geometry.js';

export function roadHandles(road) {
  if (road.curve === 'Smooth') return catmullRomHandles(road.points);
  if (road.curve === 'Bezier') return road.points.map((p) => ({ x: p.hx || 0, y: p.hy || 0 }));
  return road.points.map(() => ({ x: 0, y: 0 }));
}

const cache = new WeakMap();
// Sampled centre line of a road. Cached per points-array identity + curve mode.
export function sampleRoad(road) {
  const c = cache.get(road.points);
  if (c && c.curve === road.curve) return c.path;
  const path = sampleBezierChain(road.points, roadHandles(road), 16);
  cache.set(road.points, { curve: road.curve, path });
  return path;
}

export function roadBounds(road) {
  return boundsOfPoints(sampleRoad(road), road.width / 2 + 4);
}

export function closestOnRoad(road, p) {
  return closestPointOnPath(p, sampleRoad(road), false);
}

// Index of the road segment (between anchor i and i+1) closest to p.
export function closestRoadSegment(road, p) {
  let best = null;
  const handles = roadHandles(road);
  for (let i = 0; i < road.points.length - 1; i++) {
    const seg = sampleBezierChain([road.points[i], road.points[i + 1]], [handles[i], handles[i + 1]], 12);
    const c = closestPointOnPath(p, seg, false);
    if (!best || c.d < best.d) best = { ...c, segment: i };
  }
  return best;
}

// Derived fields for path objects: x/y = bounds centre, height = centre-line length.
// (For roads and bridges `width` is the road/deck width, not the bounding-box width.)
export function pathMeta(path) {
  const b = boundsOfPoints(path);
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, height: Math.max(1, Math.round(len * 100) / 100) };
}

export function roadMeta(road) {
  return pathMeta(sampleRoad(road));
}
