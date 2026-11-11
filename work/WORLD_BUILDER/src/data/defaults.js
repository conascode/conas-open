// Factory functions for projects and world objects. All coordinates are world coordinates.
import {
  SCHEMA_VERSION, DEFAULT_LAYERS, DEFAULT_LAYER_FOR, CATEGORY_LAYER, ROAD_DEFAULTS, BRIDGE_DEFAULTS,
} from './constants.js';
import { BUILTIN_ASSETS } from './builtin-assets.js';
import { boundsOfPoints, boundsCenter } from '../utils/geometry.js';
import { pointId } from '../utils/id.js';
import { roadMeta } from '../objects/road.js';
import { bridgeMeta } from '../objects/bridge.js';

export function createLayers() {
  return DEFAULT_LAYERS.map(([id, name]) => ({ id, name, visible: true, locked: id === 'LYR_OCEAN', opacity: 1 }));
}

export function createProjectData(name = 'UNTITLED_WORLD') {
  const now = new Date().toISOString();
  return {
    project: { id: 'PROJECT_001', name, version: SCHEMA_VERSION, createdAt: now, updatedAt: now },
    world: { width: 12000, height: 12000, background: '#173B50', gridSize: 64 },
    layers: createLayers(),
    assets: BUILTIN_ASSETS.map((a) => structuredClone(a)),
    islands: [],
    roads: [],
    bridges: [],
    buildings: [],
    facilities: [],
    objects: [],
    routes: [],
    metadata: {},
  };
}

function base(id, type, name, layer) {
  return {
    id, type, name, layer, x: 0, y: 0, width: 1, height: 1, rotation: 0,
    visible: true, locked: false, groupId: null,
  };
}

// Keep x/y/width/height of polygon objects equal to their bounds.
export function syncPolygonBounds(obj) {
  const b = boundsOfPoints(obj.polygon);
  const c = boundsCenter(b);
  obj.x = c.x;
  obj.y = c.y;
  obj.width = Math.max(1, b.maxX - b.minX);
  obj.height = Math.max(1, b.maxY - b.minY);
  return obj;
}

export function createIsland(id, polygon, opts = {}) {
  const obj = {
    ...base(id, 'island', opts.name || `Island ${id.split('_')[1] || ''}`.trim(), DEFAULT_LAYER_FOR.island),
    islandType: opts.islandType || 'Urban',
    polygon: polygon.map((p) => ({ x: p.x, y: p.y })),
    texture: opts.texture || 'Grass',
    elevation: opts.elevation ?? 0,
    coastline: {
      type: opts.coastlineType || 'Sand',
      width: opts.coastlineWidth ?? 26,
      edgeTypes: polygon.map(() => null),
    },
    terrain: null,
  };
  return syncPolygonBounds(obj);
}

export function createArea(id, polygon, opts = {}) {
  const obj = {
    ...base(id, 'area', opts.name || `Area ${id.split('_')[1] || ''}`.trim(), DEFAULT_LAYER_FOR.area),
    areaType: opts.areaType || 'Zone',
    polygon: polygon.map((p) => ({ x: p.x, y: p.y })),
    color: opts.color || '#4B9DE8',
    islandId: opts.islandId ?? null,
    description: '',
  };
  return syncPolygonBounds(obj);
}

export function roadPoint(x, y, hx = 0, hy = 0) {
  return { id: pointId(), x, y, hx, hy };
}

export function createRoad(id, points, opts = {}) {
  const type = opts.roadType || 'Local Road';
  const d = ROAD_DEFAULTS[type];
  const road = {
    ...base(id, 'road', opts.name || `${type} ${id.split('_')[1] || ''}`.trim(), DEFAULT_LAYER_FOR.road),
    roadType: type,
    points: points.map((p) => (p.id ? { ...p } : roadPoint(p.x, p.y, p.hx || 0, p.hy || 0))),
    curve: opts.curve || 'Straight',
    width: opts.width ?? d.width,
    lanes: opts.lanes ?? d.lanes,
    direction: opts.direction || 'Two-way',
    surface: opts.surface || d.surface,
    speedLimit: opts.speedLimit ?? d.speedLimit,
    islandId: opts.islandId ?? null,
    connections: opts.connections || [],
  };
  return Object.assign(road, roadMeta(road));
}

export function createBridge(id, opts) {
  const type = opts.bridgeType || 'Road Bridge';
  const d = BRIDGE_DEFAULTS[type];
  const bridge = {
    ...base(id, 'bridge', opts.name || `Bridge ${id.split('_')[1] || ''}`.trim(), DEFAULT_LAYER_FOR.bridge),
    bridgeType: type,
    startIslandId: opts.startIslandId ?? null,
    endIslandId: opts.endIslandId ?? null,
    startPosition: { ...opts.startPosition },
    endPosition: { ...opts.endPosition },
    controlPoints: (opts.controlPoints || []).map((p) => ({ x: p.x, y: p.y })),
    width: opts.width ?? d.width,
    lanes: opts.lanes ?? d.lanes,
    status: 'warning',
  };
  return Object.assign(bridge, bridgeMeta(bridge));
}

export function rectHitbox(w, h, ax = 0.5, ay = 0.5) {
  const x0 = -ax * w; const y0 = -ay * h;
  return {
    type: 'Rectangle',
    points: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }],
  };
}

export function createBuilding(id, asset, x, y, opts = {}) {
  const w = opts.width ?? asset?.width ?? 100;
  const h = opts.height ?? asset?.height ?? 100;
  const ax = asset?.anchor?.x ?? 0.5;
  const ay = asset?.anchor?.y ?? 0.5;
  return {
    ...base(id, 'building', opts.name || asset?.name || 'Building', DEFAULT_LAYER_FOR.building),
    x, y, width: w, height: h, rotation: opts.rotation || 0,
    anchorX: ax, anchorY: ay,
    buildingType: opts.buildingType || guessBuildingType(asset),
    assetId: asset ? asset.id : null,
    islandId: opts.islandId ?? null,
    owner: '',
    address: '',
    description: '',
    investigatable: false,
    hitbox: rectHitbox(w, h, ax, ay),
  };
}

function guessBuildingType(asset) {
  const n = `${asset?.name || ''} ${asset?.id || ''}`.toLowerCase();
  const map = [
    ['police', 'Police'], ['hospital', 'Hospital'], ['school', 'School'], ['hotel', 'Hotel'], ['warehouse', 'Warehouse'],
    ['factory', 'Industrial'], ['industrial', 'Industrial'], ['city hall', 'Government'], ['government', 'Government'],
    ['mall', 'Commercial'], ['commercial', 'Commercial'], ['apartment', 'Residential'], ['house', 'Residential'],
    ['residential', 'Residential'], ['office', 'Office'], ['military', 'Military'],
  ];
  for (const [k, v] of map) if (n.includes(k)) return v;
  return 'Custom';
}

export function createProp(id, asset, x, y, opts = {}) {
  const w = opts.width ?? asset.width;
  const h = opts.height ?? asset.height;
  return {
    ...base(id, 'prop', opts.name || asset.name, CATEGORY_LAYER[asset.category] || 'LYR_ENV'),
    x, y, width: w, height: h, rotation: opts.rotation || 0,
    anchorX: asset.anchor?.x ?? 0.5,
    anchorY: asset.anchor?.y ?? 0.5,
    category: asset.category,
    assetId: asset.id,
    islandId: opts.islandId ?? null,
    description: '',
  };
}

export function createAsset(id, { name, category, path, mime, width, height, anchor }) {
  return { id, name, category, path, mime, width, height, anchor, builtin: false };
}
