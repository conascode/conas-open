// Conversion between the runtime project data and the on-disk JSON.
// Runtime: island.terrain.cells is a Uint8Array. Disk: island.terrain.data is an RLE string.
import { ProjectSchema, formatZodError } from './schema.js';
import { migrate } from './migrations.js';
import { encodeRLE, decodeRLE } from '../utils/rle.js';
import { bridgeStatus } from '../objects/bridge.js';
import { OBJECT_COLLECTIONS, DEFAULT_LAYER_FOR } from './constants.js';

export function serializeProject(data) {
  const islandsById = new Map(data.islands.map((i) => [i.id, i]));
  const out = {
    ...data,
    project: { ...data.project, updatedAt: new Date().toISOString() },
    islands: data.islands.map((isl) => ({
      ...isl,
      terrain: isl.terrain ? {
        cellSize: isl.terrain.cellSize, originX: isl.terrain.originX, originY: isl.terrain.originY,
        cols: isl.terrain.cols, rows: isl.terrain.rows, data: encodeRLE(isl.terrain.cells),
      } : null,
    })),
    bridges: data.bridges.map((b) => ({ ...b, status: bridgeStatus(b, (id) => islandsById.get(id)).status })),
  };
  return out;
}

export function projectToJSONText(data) {
  return JSON.stringify(serializeProject(data), null, 2);
}

// Parse + migrate + validate + integrity-check a project file.
// Returns { ok, data, errors[], warnings[] }. `data` is in runtime form when ok.
export function parseProject(input) {
  const errors = [];
  const warnings = [];
  let raw;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`The file is not valid JSON: ${e.message}`], warnings };
    }
  } else raw = structuredClone(input);
  if (!raw || typeof raw !== 'object' || !raw.project || !raw.world) {
    return { ok: false, errors: ['The file is not a WORLD BUILDER project (missing "project" or "world").'], warnings };
  }
  try {
    const m = migrate(raw);
    raw = m.data;
    if (m.applied.length) warnings.push(`Project migrated to version ${m.applied[m.applied.length - 1]}.`);
  } catch (e) {
    return { ok: false, errors: [e.message], warnings };
  }
  const res = ProjectSchema.safeParse(raw);
  if (!res.success) return { ok: false, errors: ['Project data is invalid:', ...formatZodError(res.error)], warnings };
  const data = res.data;

  // Unique IDs across every collection.
  const seen = new Map();
  const collections = ['layers', 'assets', ...OBJECT_COLLECTIONS];
  for (const key of collections) {
    for (const o of data[key]) {
      if (seen.has(o.id)) errors.push(`Duplicate ID "${o.id}" in ${key} (also used in ${seen.get(o.id)}).`);
      else seen.set(o.id, key);
    }
  }
  if (errors.length) return { ok: false, errors, warnings };

  const layerIds = new Set(data.layers.map((l) => l.id));
  const assetIds = new Set(data.assets.map((a) => a.id));
  const islandIds = new Set(data.islands.map((i) => i.id));
  const roadIds = new Set(data.roads.map((r) => r.id));
  for (const key of OBJECT_COLLECTIONS) {
    for (const o of data[key]) {
      if (!layerIds.has(o.layer)) {
        const fallback = DEFAULT_LAYER_FOR[o.type] && layerIds.has(DEFAULT_LAYER_FOR[o.type]) ? DEFAULT_LAYER_FOR[o.type] : data.layers[data.layers.length - 1].id;
        warnings.push(`${o.id}: layer "${o.layer}" does not exist; moved to ${fallback}.`);
        o.layer = fallback;
      }
      if (o.assetId && !assetIds.has(o.assetId)) warnings.push(`${o.id}: references missing asset "${o.assetId}".`);
      if ('islandId' in o && o.islandId && !islandIds.has(o.islandId)) {
        warnings.push(`${o.id}: island "${o.islandId}" does not exist; reference cleared.`);
        o.islandId = null;
      }
    }
  }
  for (const b of data.bridges) {
    for (const k of ['startIslandId', 'endIslandId']) {
      if (b[k] && !islandIds.has(b[k])) {
        warnings.push(`${b.id}: ${k} "${b[k]}" does not exist; reference cleared.`);
        b[k] = null;
      }
    }
  }
  for (const r of data.roads) {
    const before = r.connections.length;
    r.connections = r.connections.filter((c) => roadIds.has(c.roadId));
    if (r.connections.length !== before) warnings.push(`${r.id}: removed ${before - r.connections.length} connection(s) to missing roads.`);
  }
  // Terrain decode.
  for (const isl of data.islands) {
    if (!isl.terrain) continue;
    try {
      const t = isl.terrain;
      isl.terrain = { cellSize: t.cellSize, originX: t.originX, originY: t.originY, cols: t.cols, rows: t.rows, cells: decodeRLE(t.data, t.cols * t.rows) };
    } catch (e) {
      errors.push(`${isl.id}: terrain data is corrupted (${e.message}).`);
    }
  }
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, data, errors, warnings };
}
