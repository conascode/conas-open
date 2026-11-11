// Island terrain grid. Runtime form: { cellSize, originX, originY, cols, rows, cells: Uint8Array }.
// Cell value 0 = island base texture, 1..6 = TERRAIN_MATERIALS[value - 1].
// The grid is world-aligned and covers the island bounds; painting is clipped by the island polygon.
import { boundsOfPoints, pointInPolygon, applyMatrix, invert, IDENTITY } from '../utils/geometry.js';
import { TERRAIN_CELL_SIZE } from '../data/constants.js';

export function createTerrainFor(polygon, cellSize = TERRAIN_CELL_SIZE) {
  const b = boundsOfPoints(polygon);
  const originX = Math.floor(b.minX / cellSize) * cellSize - cellSize;
  const originY = Math.floor(b.minY / cellSize) * cellSize - cellSize;
  const cols = Math.max(1, Math.ceil((b.maxX - originX) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((b.maxY - originY) / cellSize) + 1);
  return { cellSize, originX, originY, cols, rows, cells: new Uint8Array(cols * rows) };
}

export function cloneTerrain(t) {
  return t ? { ...t, cells: new Uint8Array(t.cells) } : null;
}

const maskCache = new WeakMap();
// 1 where the cell centre lies inside the polygon.
export function insideMask(terrain, polygon) {
  const c = maskCache.get(terrain);
  if (c && c.polygon === polygon && c.ox === terrain.originX && c.oy === terrain.originY) return c.mask;
  const { cols, rows, cellSize, originX, originY } = terrain;
  const mask = new Uint8Array(cols * rows);
  // Scanline fill: for each row find polygon crossings at the cell-centre y.
  const n = polygon.length;
  for (let r = 0; r < rows; r++) {
    const y = originY + (r + 0.5) * cellSize;
    const xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = polygon[i]; const b = polygon[j];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - originX) / cellSize - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - originX) / cellSize - 0.5));
      for (let col = c0; col <= c1; col++) mask[r * cols + col] = 1;
    }
  }
  maskCache.set(terrain, { polygon, ox: originX, oy: originY, mask });
  return mask;
}

export function cellAt(terrain, p) {
  const col = Math.floor((p.x - terrain.originX) / terrain.cellSize);
  const row = Math.floor((p.y - terrain.originY) / terrain.cellSize);
  if (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows) return -1;
  return row * terrain.cols + col;
}

// Build a new grid that covers `newPolygon`, sampling the old grid through `matrix`
// (old world -> new world). Used after polygon edits, scaling and rotation.
export function refitTerrain(oldTerrain, newPolygon, matrix = IDENTITY) {
  if (!oldTerrain) return null;
  const t = createTerrainFor(newPolygon, oldTerrain.cellSize);
  const inv = invert(matrix);
  const { cellSize, originX, originY, cols, rows } = t;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const src = applyMatrix(inv, { x: originX + (c + 0.5) * cellSize, y: originY + (r + 0.5) * cellSize });
      const i = cellAt(oldTerrain, src);
      if (i >= 0) t.cells[r * cols + c] = oldTerrain.cells[i];
    }
  }
  return t;
}

export function translateTerrain(t, dx, dy) {
  return t ? { ...t, originX: t.originX + dx, originY: t.originY + dy } : null;
}

// Paint a circular dab. `diff` is a Map(index -> [old, new]) that accumulates changes for undo.
// strength (0..1) is the probability that a cell at the brush centre is painted; it falls off to the edge.
export function paintDab(terrain, polygon, center, radius, value, strength, diff, rand = Math.random) {
  const mask = insideMask(terrain, polygon);
  const { cellSize, originX, originY, cols, rows, cells } = terrain;
  const c0 = Math.max(0, Math.floor((center.x - radius - originX) / cellSize));
  const c1 = Math.min(cols - 1, Math.floor((center.x + radius - originX) / cellSize));
  const r0 = Math.max(0, Math.floor((center.y - radius - originY) / cellSize));
  const r1 = Math.min(rows - 1, Math.floor((center.y + radius - originY) / cellSize));
  let changed = null;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      if (!mask[i] || cells[i] === value) continue;
      const dx = originX + (c + 0.5) * cellSize - center.x;
      const dy = originY + (r + 0.5) * cellSize - center.y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const falloff = 1 - (d / radius) * 0.5;
      if (strength < 1 && rand() > strength * falloff) continue;
      recordChange(diff, i, cells[i], value);
      cells[i] = value;
      changed = extend(changed, c, r);
    }
  }
  return changed; // {c0,r0,c1,r1} dirty cell rect or null
}

// 4-way flood fill of the connected region with the same value, clipped to the polygon.
export function floodFill(terrain, polygon, p, value, diff) {
  const mask = insideMask(terrain, polygon);
  const start = cellAt(terrain, p);
  if (start < 0 || !mask[start]) return null;
  const { cols, rows, cells } = terrain;
  const target = cells[start];
  if (target === value) return null;
  const stack = [start];
  let changed = null;
  const seen = new Uint8Array(cells.length);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    if (!mask[i] || cells[i] !== target) continue;
    recordChange(diff, i, cells[i], value);
    cells[i] = value;
    const c = i % cols; const r = (i - c) / cols;
    changed = extend(changed, c, r);
    if (c > 0) stack.push(i - 1);
    if (c < cols - 1) stack.push(i + 1);
    if (r > 0) stack.push(i - cols);
    if (r < rows - 1) stack.push(i + cols);
  }
  return changed;
}

function recordChange(diff, i, oldV, newV) {
  const e = diff.get(i);
  if (e) e[1] = newV;
  else diff.set(i, [oldV, newV]);
}

function extend(rect, c, r) {
  if (!rect) return { c0: c, r0: r, c1: c, r1: r };
  if (c < rect.c0) rect.c0 = c;
  if (c > rect.c1) rect.c1 = c;
  if (r < rect.r0) rect.r0 = r;
  if (r > rect.r1) rect.r1 = r;
  return rect;
}

export function terrainUsage(terrain) {
  const counts = new Map();
  if (!terrain) return counts;
  for (const v of terrain.cells) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return counts;
}

// Is a point inside an island polygon? (helper used by tools)
export function islandContains(island, p) {
  return pointInPolygon(p, island.polygon);
}
