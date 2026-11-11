// Bridge geometry and connection status.
import { curveControls, sampleCurve, boundsOfPoints, closestPointOnPath, pointInPolygon } from '../utils/geometry.js';

export function bridgeAnchors(bridge) {
  return [bridge.startPosition, ...bridge.controlPoints, bridge.endPosition];
}

export function bridgePath(bridge) {
  const pts = bridgeAnchors(bridge);
  if (pts.length === 2) return pts.map((p) => ({ x: p.x, y: p.y }));
  return sampleCurve(pts, curveControls(pts, 'Smooth'), 16);
}

export function bridgeBounds(bridge) {
  return boundsOfPoints(bridgePath(bridge), bridge.width / 2 + 12);
}

// Nearest point on an island's coastline.
export function nearestCoastPoint(island, p) {
  return closestPointOnPath(p, island.polygon, true);
}

export const CONNECT_TOLERANCE = 24;

// An end is connected when its island exists and the end lies on (or just inside) the coastline.
export function endConnected(island, p, width) {
  if (!island) return false;
  const c = nearestCoastPoint(island, p);
  const tol = Math.max(CONNECT_TOLERANCE, width / 2);
  return c.d <= tol || (pointInPolygon(p, island.polygon) && c.d <= tol * 3);
}

// Returns { status, problems[] } — problems explain warnings for the inspector.
export function bridgeStatus(bridge, getIsland) {
  const problems = [];
  const s = bridge.startIslandId ? getIsland(bridge.startIslandId) : null;
  const e = bridge.endIslandId ? getIsland(bridge.endIslandId) : null;
  if (!bridge.startIslandId) problems.push('Start island is not set');
  else if (!s) problems.push(`Start island ${bridge.startIslandId} does not exist`);
  else if (!endConnected(s, bridge.startPosition, bridge.width)) problems.push('Start point is not on the start island coastline');
  if (!bridge.endIslandId) problems.push('End island is not set');
  else if (!e) problems.push(`End island ${bridge.endIslandId} does not exist`);
  else if (!endConnected(e, bridge.endPosition, bridge.width)) problems.push('End point is not on the end island coastline');
  if (bridge.startIslandId && bridge.startIslandId === bridge.endIslandId) problems.push('Start and end island must be different');
  return { status: problems.length ? 'warning' : 'connected', problems };
}

export function bridgeMeta(bridge) {
  const path = bridgePath(bridge);
  const b = boundsOfPoints(path);
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, height: Math.max(1, Math.round(len * 100) / 100) };
}
