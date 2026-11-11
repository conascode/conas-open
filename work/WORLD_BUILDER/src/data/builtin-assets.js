// Sample assets shipped with the editor (files live in WORLD_BUILDER/assets/).
// Paths are relative to the project root, which is also how they appear inside an exported ZIP.

const A = (id, name, category, file, width, height, anchor = 'Center') => ({
  id, name, category, path: `assets/${file}`, mime: 'image/svg+xml', width, height,
  anchor: { preset: anchor, x: anchor === 'Bottom Center' ? 0.5 : anchor === 'Top Left' ? 0 : 0.5, y: anchor === 'Bottom Center' ? 1 : anchor === 'Top Left' ? 0 : 0.5 },
  builtin: true,
});

export const BUILTIN_ASSETS = [
  A('AST_OFFICE', 'Office Tower', 'Buildings', 'buildings/office.svg', 160, 160),
  A('AST_RESIDENTIAL', 'Apartment Block', 'Buildings', 'buildings/residential.svg', 140, 100),
  A('AST_HOUSE', 'House', 'Buildings', 'buildings/house.svg', 80, 70),
  A('AST_COMMERCIAL', 'Shopping Mall', 'Buildings', 'buildings/commercial.svg', 200, 140),
  A('AST_INDUSTRIAL', 'Factory', 'Buildings', 'buildings/industrial.svg', 220, 150),
  A('AST_GOVERNMENT', 'City Hall', 'Buildings', 'buildings/government.svg', 180, 140),
  A('AST_POLICE', 'Police Station', 'Buildings', 'buildings/police.svg', 140, 110),
  A('AST_HOSPITAL', 'Hospital', 'Buildings', 'buildings/hospital.svg', 180, 160),
  A('AST_SCHOOL', 'School', 'Buildings', 'buildings/school.svg', 200, 130),
  A('AST_HOTEL', 'Hotel', 'Buildings', 'buildings/hotel.svg', 150, 150),
  A('AST_WAREHOUSE', 'Warehouse', 'Buildings', 'buildings/warehouse.svg', 200, 120),
  A('AST_PINE', 'Pine Tree', 'Trees', 'objects/tree-pine.svg', 48, 48),
  A('AST_OAK', 'Oak Tree', 'Trees', 'objects/tree-oak.svg', 56, 56),
  A('AST_PALM', 'Palm Tree', 'Trees', 'objects/tree-palm.svg', 52, 52),
  A('AST_CAR', 'Car', 'Vehicles', 'objects/car.svg', 20, 40),
  A('AST_BUS', 'Bus', 'Vehicles', 'objects/bus.svg', 26, 72),
  A('AST_BOAT', 'Boat', 'Vehicles', 'objects/boat.svg', 36, 90),
  A('AST_STREETLIGHT', 'Street Light', 'Facilities', 'objects/streetlight.svg', 16, 16),
  A('AST_FOUNTAIN', 'Fountain', 'Facilities', 'objects/fountain.svg', 64, 64),
  A('AST_HELIPAD', 'Helipad', 'Facilities', 'objects/helipad.svg', 90, 90),
  A('AST_LIGHTHOUSE', 'Lighthouse', 'Facilities', 'objects/lighthouse.svg', 56, 56),
  A('AST_PARKING', 'Parking Lot', 'Roads', 'roads/parking.svg', 160, 110),
  A('AST_CROSSWALK', 'Crosswalk', 'Roads', 'roads/crosswalk.svg', 48, 24),
  A('AST_PIER', 'Wooden Pier', 'Bridges', 'bridges/pier.svg', 40, 160),
  A('AST_ROCKS', 'Rock Cluster', 'Terrain', 'terrain/rocks.svg', 96, 80),
  A('AST_POND', 'Pond', 'Terrain', 'terrain/pond.svg', 120, 90),
  A('AST_ISLET', 'Rocky Islet', 'Islands', 'terrain/islet.svg', 140, 110),
  A('AST_CRATE', 'Cargo Container', 'Miscellaneous', 'objects/container.svg', 30, 70),
  A('AST_TENT', 'Tent', 'Miscellaneous', 'objects/tent.svg', 44, 44),
];
