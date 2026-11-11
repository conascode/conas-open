// Enumerations and defaults shared by the data model, renderer and UI.

export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = '1.0.0';

export const ISLAND_TYPES = ['Urban', 'Residential', 'Industrial', 'Military', 'Rural', 'Uninhabited', 'Custom'];

export const COASTLINE_TYPES = ['Sand', 'Rock', 'Cliff', 'Concrete', 'Harbor', 'Seawall'];

export const TERRAIN_MATERIALS = ['Grass', 'Sand', 'Rock', 'Concrete', 'Soil', 'Water'];
// Terrain cell values: 0 = island base texture, 1..n = TERRAIN_MATERIALS[value - 1]
export const terrainValueOf = (material) => TERRAIN_MATERIALS.indexOf(material) + 1;
export const TERRAIN_CELL_SIZE = 16;

export const ROAD_TYPES = ['Highway', 'Main Road', 'Secondary Road', 'Local Road', 'Alley', 'Pedestrian Road', 'Parking Road'];
export const ROAD_DEFAULTS = {
  Highway: { width: 72, lanes: 4, speedLimit: 100, surface: 'Asphalt' },
  'Main Road': { width: 52, lanes: 4, speedLimit: 60, surface: 'Asphalt' },
  'Secondary Road': { width: 40, lanes: 2, speedLimit: 50, surface: 'Asphalt' },
  'Local Road': { width: 30, lanes: 2, speedLimit: 30, surface: 'Asphalt' },
  Alley: { width: 18, lanes: 1, speedLimit: 20, surface: 'Concrete' },
  'Pedestrian Road': { width: 14, lanes: 0, speedLimit: 0, surface: 'Cobblestone' },
  'Parking Road': { width: 36, lanes: 2, speedLimit: 10, surface: 'Asphalt' },
};
export const ROAD_SURFACES = ['Asphalt', 'Concrete', 'Cobblestone', 'Gravel', 'Dirt'];
export const ROAD_DIRECTIONS = ['Two-way', 'One-way'];
export const CURVE_MODES = ['Straight', 'Smooth', 'Bezier'];

export const BRIDGE_TYPES = ['Road Bridge', 'Highway Bridge', 'Pedestrian Bridge', 'Railway Bridge', 'Suspension Bridge', 'Drawbridge'];
export const BRIDGE_DEFAULTS = {
  'Road Bridge': { width: 44, lanes: 2 },
  'Highway Bridge': { width: 76, lanes: 4 },
  'Pedestrian Bridge': { width: 16, lanes: 0 },
  'Railway Bridge': { width: 28, lanes: 1 },
  'Suspension Bridge': { width: 56, lanes: 4 },
  Drawbridge: { width: 40, lanes: 2 },
};

export const BUILDING_TYPES = ['Office', 'Residential', 'Commercial', 'Industrial', 'Government', 'Police', 'Hospital', 'School', 'Hotel', 'Warehouse', 'Military', 'Infrastructure', 'Custom'];
export const HITBOX_TYPES = ['Rectangle', 'Polygon', 'Custom Shape'];

export const AREA_TYPES = ['Zone', 'Investigation', 'Restricted', 'Spawn', 'Custom'];

export const ASSET_CATEGORIES = ['Terrain', 'Islands', 'Buildings', 'Roads', 'Bridges', 'Vehicles', 'Trees', 'Facilities', 'Miscellaneous'];
export const ANCHOR_PRESETS = {
  Center: { x: 0.5, y: 0.5 },
  'Top Left': { x: 0, y: 0 },
  'Bottom Center': { x: 0.5, y: 1 },
};
export const ASSET_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

export const DEFAULT_LAYERS = [
  ['LYR_OCEAN', 'Ocean'],
  ['LYR_TERRAIN', 'Terrain'],
  ['LYR_INFRA', 'Infrastructure'],
  ['LYR_BUILDINGS', 'Buildings'],
  ['LYR_ENV', 'Environment'],
  ['LYR_FACILITIES', 'Facilities'],
  ['LYR_INVESTIGATION', 'Investigation'],
  ['LYR_CHARACTERS', 'Characters'],
  ['LYR_ROUTES', 'Routes'],
];

// Default layer for each kind of object.
export const DEFAULT_LAYER_FOR = {
  island: 'LYR_TERRAIN',
  road: 'LYR_INFRA',
  bridge: 'LYR_INFRA',
  building: 'LYR_BUILDINGS',
  area: 'LYR_INVESTIGATION',
};
export const CATEGORY_LAYER = {
  Terrain: 'LYR_TERRAIN',
  Islands: 'LYR_TERRAIN',
  Buildings: 'LYR_BUILDINGS',
  Roads: 'LYR_INFRA',
  Bridges: 'LYR_INFRA',
  Vehicles: 'LYR_ENV',
  Trees: 'LYR_ENV',
  Facilities: 'LYR_FACILITIES',
  Miscellaneous: 'LYR_ENV',
};

// Which top-level collection each object type lives in.
export const OBJECT_COLLECTIONS = ['islands', 'roads', 'bridges', 'buildings', 'facilities', 'objects'];
export function collectionForObject(obj) {
  switch (obj.type) {
    case 'island': return 'islands';
    case 'road': return 'roads';
    case 'bridge': return 'bridges';
    case 'building': return 'buildings';
    case 'prop': return obj.category === 'Facilities' ? 'facilities' : 'objects';
    case 'area': return 'objects';
    default: return 'objects';
  }
}

export const COLORS = {
  ocean: 0x173b50,
  accent: 0x4b9de8,
  warning: 0xe8a33d,
  error: 0xe0524d,
  success: 0x4cbf7a,
};
