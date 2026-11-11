// Zod schemas for the project file (the serialized, on-disk form).
import { z } from '../../lib/zod.js';
import {
  ISLAND_TYPES, COASTLINE_TYPES, TERRAIN_MATERIALS, ROAD_TYPES, ROAD_SURFACES, ROAD_DIRECTIONS, CURVE_MODES,
  BRIDGE_TYPES, BUILDING_TYPES, HITBOX_TYPES, AREA_TYPES, ASSET_CATEGORIES,
} from './constants.js';

const num = z.number().finite();
const pos = num.positive();
const Point = z.object({ x: num, y: num });
const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_\-]+$/, 'ID may only contain letters, digits, _ and -');
const RefId = Id.nullable();

const Base = {
  id: Id,
  name: z.string().max(200),
  layer: Id,
  x: num,
  y: num,
  width: pos,
  height: pos,
  rotation: num,
  visible: z.boolean(),
  locked: z.boolean(),
  groupId: RefId.optional().default(null),
};

export const TerrainSchema = z.object({
  cellSize: pos,
  originX: num,
  originY: num,
  cols: z.number().int().positive().max(4096),
  rows: z.number().int().positive().max(4096),
  data: z.string(),
});

export const IslandSchema = z.object({
  ...Base,
  type: z.literal('island'),
  islandType: z.enum(ISLAND_TYPES),
  polygon: z.array(Point).min(3),
  texture: z.enum(TERRAIN_MATERIALS),
  elevation: num,
  coastline: z.object({
    type: z.enum(COASTLINE_TYPES),
    width: num.min(0),
    edgeTypes: z.array(z.enum(COASTLINE_TYPES).nullable()),
  }),
  terrain: TerrainSchema.nullable(),
}).refine((o) => o.coastline.edgeTypes.length === o.polygon.length, { message: 'coastline.edgeTypes must have one entry per polygon edge' });

export const RoadSchema = z.object({
  ...Base,
  type: z.literal('road'),
  roadType: z.enum(ROAD_TYPES),
  points: z.array(z.object({ id: z.string().min(1), x: num, y: num, hx: num, hy: num })).min(2),
  curve: z.enum(CURVE_MODES),
  width: pos,
  lanes: z.number().int().min(0).max(16),
  direction: z.enum(ROAD_DIRECTIONS),
  surface: z.enum(ROAD_SURFACES),
  speedLimit: num.min(0),
  islandId: RefId,
  connections: z.array(z.object({ pointId: z.string(), roadId: Id, targetPointId: z.string() })),
});

export const BridgeSchema = z.object({
  ...Base,
  type: z.literal('bridge'),
  bridgeType: z.enum(BRIDGE_TYPES),
  startIslandId: RefId,
  endIslandId: RefId,
  startPosition: Point,
  endPosition: Point,
  controlPoints: z.array(Point),
  width: pos,
  lanes: z.number().int().min(0).max(16),
  status: z.enum(['connected', 'warning']),
});

export const BuildingSchema = z.object({
  ...Base,
  type: z.literal('building'),
  anchorX: num,
  anchorY: num,
  buildingType: z.enum(BUILDING_TYPES),
  assetId: RefId,
  islandId: RefId,
  owner: z.string(),
  address: z.string(),
  description: z.string(),
  investigatable: z.boolean(),
  hitbox: z.object({ type: z.enum(HITBOX_TYPES), points: z.array(Point).min(3) }),
});

export const PropSchema = z.object({
  ...Base,
  type: z.literal('prop'),
  anchorX: num,
  anchorY: num,
  category: z.enum(ASSET_CATEGORIES),
  assetId: Id,
  islandId: RefId,
  description: z.string(),
});

export const AreaSchema = z.object({
  ...Base,
  type: z.literal('area'),
  areaType: z.enum(AREA_TYPES),
  polygon: z.array(Point).min(3),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  islandId: RefId,
  description: z.string(),
});

export const LayerSchema = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: num.min(0).max(1),
});

export const AssetSchema = z.object({
  id: Id,
  name: z.string().min(1).max(120),
  category: z.enum(ASSET_CATEGORIES),
  path: z.string().min(1).regex(/^assets\/[A-Za-z0-9_\-./]+$/, 'Asset path must be a relative path inside assets/').refine((p) => !p.includes('..'), 'Asset path must not contain ..'),
  mime: z.string(),
  width: pos,
  height: pos,
  anchor: z.object({ preset: z.string(), x: num, y: num }),
  builtin: z.boolean().optional().default(false),
});

export const ProjectSchema = z.object({
  project: z.object({
    id: Id,
    name: z.string().min(1).max(120),
    version: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  world: z.object({
    width: pos.max(200000),
    height: pos.max(200000),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    gridSize: z.number().int().min(4).max(4096),
  }),
  layers: z.array(LayerSchema).min(1),
  assets: z.array(AssetSchema),
  islands: z.array(IslandSchema),
  roads: z.array(RoadSchema),
  bridges: z.array(BridgeSchema),
  buildings: z.array(BuildingSchema),
  facilities: z.array(PropSchema),
  objects: z.array(z.union([PropSchema, AreaSchema])),
  routes: z.array(z.any()),
  metadata: z.record(z.any()),
});

export function formatZodError(error, limit = 12) {
  return error.issues.slice(0, limit).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
