// Builds samples/serim-city.world.json with the same factories the editor uses.
// Run: node scripts/generate-sample.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectData, createIsland, createRoad, createBridge, createBuilding, createProp, createArea, roadPoint } from '../src/data/defaults.js';
import { BUILTIN_ASSETS } from '../src/data/builtin-assets.js';
import { createTerrainFor, paintDab, floodFill } from '../src/objects/terrain.js';
import { nearestCoastPoint } from '../src/objects/bridge.js';
import { projectToJSONText, parseProject } from '../src/data/serialize.js';
import { pointInPolygon } from '../src/utils/geometry.js';
import { terrainValueOf } from '../src/data/constants.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const asset = (id) => BUILTIN_ASSETS.find((a) => a.id === id);

function blob(cx, cy, rx, ry, n, wobble) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + Math.sin(a * 3 + cx) * wobble + Math.sin(a * 5 + cy) * wobble * 0.6 + (rand() - 0.5) * wobble * 0.5;
    pts.push({ x: Math.round(cx + Math.cos(a) * rx * k), y: Math.round(cy + Math.sin(a) * ry * k) });
  }
  return pts;
}

const data = createProjectData('SERIM_CITY');
data.project.createdAt = '2026-11-11T00:00:00.000Z';
data.metadata = { description: 'Sample archipelago for WORLD BUILDER 1.0', author: 'WORLD BUILDER sample generator' };

const main = createIsland('ISL_0001', blob(5200, 5000, 1750, 1350, 36, 0.12), { name: 'Serim Central', islandType: 'Urban', texture: 'Grass', coastlineType: 'Sand' });
const east = createIsland('ISL_0002', blob(8650, 4300, 1050, 900, 28, 0.14), { name: 'Haneul Residential', islandType: 'Residential', texture: 'Grass', coastlineType: 'Sand' });
const south = createIsland('ISL_0003', blob(5500, 8350, 1150, 750, 26, 0.1), { name: 'Port Industrial', islandType: 'Industrial', texture: 'Concrete', coastlineType: 'Concrete' });
const islet = createIsland('ISL_0004', blob(2500, 2900, 480, 400, 16, 0.18), { name: 'Gull Rock', islandType: 'Uninhabited', texture: 'Rock', coastlineType: 'Rock' });
south.coastline.edgeTypes = south.polygon.map((p, i) => (i >= 4 && i <= 9 ? 'Harbor' : null));
islet.coastline.edgeTypes = islet.polygon.map((p, i) => (i < 6 ? 'Cliff' : null));
main.coastline.edgeTypes = main.polygon.map((p, i) => (i >= 26 && i <= 31 ? 'Seawall' : null));
data.islands.push(main, east, south, islet);

// Terrain painting on the main island: concrete downtown, sand beach, a pond.
main.terrain = createTerrainFor(main.polygon);
const d = new Map();
const dab = (isl, x, y, r, mat, s = 1) => paintDab(isl.terrain, isl.polygon, { x, y }, r, terrainValueOf(mat), s, d, rand);
for (let x = 4600; x <= 5900; x += 60) for (let y = 4500; y <= 5400; y += 60) dab(main, x, y, 70, 'Concrete');
for (let a = 0; a < 40; a++) dab(main, 3700 + a * 18, 5900 + Math.sin(a / 4) * 80, 120, 'Sand', 0.9);
dab(main, 6400, 4100, 150, 'Water');
dab(main, 6400, 4100, 190, 'Sand', 0.5);
for (let a = 0; a < 25; a++) dab(main, 3900 + a * 30, 4100 - a * 10, 90, 'Soil', 0.6);
east.terrain = createTerrainFor(east.polygon);
for (let a = 0; a < 30; a++) dab(east, 8200 + a * 30, 4800 + Math.cos(a / 3) * 60, 100, 'Sand', 0.8);
islet.terrain = createTerrainFor(islet.polygon);
floodFill(islet.terrain, islet.polygon, { x: 2500, y: 2900 }, terrainValueOf('Rock'), d);
for (let a = 0; a < 10; a++) dab(islet, 2400 + a * 20, 2950, 80, 'Grass', 0.5);

// Roads on the main island.
const P = (x, y) => roadPoint(x, y);
const avenue = createRoad('RD_0001', [P(3700, 5000), P(4600, 4950), P(5200, 5000), P(5900, 5050), P(6750, 4900)], { roadType: 'Main Road', curve: 'Smooth', name: 'Serim Avenue', islandId: main.id });
const north = createRoad('RD_0002', [P(5200, 3900), P(5200, 4500), avenue.points[2]], { roadType: 'Secondary Road', name: 'Harbor Street', islandId: main.id });
north.points[2] = { ...avenue.points[2], id: north.points[2].id };
north.connections.push({ pointId: north.points[2].id, roadId: avenue.id, targetPointId: avenue.points[2].id });
const southSt = createRoad('RD_0003', [P(5200, 5000), P(5250, 5600), P(5400, 6150)], { roadType: 'Secondary Road', curve: 'Smooth', name: 'Market Road', islandId: main.id });
southSt.connections.push({ pointId: southSt.points[0].id, roadId: avenue.id, targetPointId: avenue.points[2].id });
const local1 = createRoad('RD_0004', [P(4600, 4950), P(4550, 5500), P(4300, 5800)], { roadType: 'Local Road', curve: 'Smooth', name: 'Elm Lane', islandId: main.id });
local1.connections.push({ pointId: local1.points[0].id, roadId: avenue.id, targetPointId: avenue.points[1].id });
const alley = createRoad('RD_0005', [P(5900, 5050), P(5950, 4600), P(6300, 4350)], { roadType: 'Alley', name: 'Night Alley', islandId: main.id });
alley.connections.push({ pointId: alley.points[0].id, roadId: avenue.id, targetPointId: avenue.points[3].id });
const eastRd = createRoad('RD_0006', [P(7800, 4250), P(8400, 4200), P(9200, 4400)], { roadType: 'Local Road', curve: 'Smooth', name: 'Haneul-ro', islandId: east.id });
const portRd = createRoad('RD_0007', [P(4700, 8250), P(5500, 8150), P(6300, 8300)], { roadType: 'Main Road', name: 'Port Road', islandId: south.id });
data.roads.push(avenue, north, southSt, local1, alley, eastRd, portRd);

// Bridges between islands.
const coast = (isl, x, y) => { const c = nearestCoastPoint(isl, { x, y }); return { x: Math.round(c.x), y: Math.round(c.y) }; };
data.bridges.push(createBridge('BR_0001', {
  name: 'Haneul Suspension Bridge', bridgeType: 'Suspension Bridge', startIslandId: main.id, endIslandId: east.id,
  startPosition: coast(main, 6900, 4800), endPosition: coast(east, 7600, 4300), controlPoints: [{ x: 7250, y: 4520 }],
}));
data.bridges.push(createBridge('BR_0002', {
  name: 'Port Bridge', bridgeType: 'Road Bridge', startIslandId: main.id, endIslandId: south.id,
  startPosition: coast(main, 5450, 6400), endPosition: coast(south, 5480, 7600),
}));
data.bridges.push(createBridge('BR_0003', {
  name: 'Gull Footbridge', bridgeType: 'Pedestrian Bridge', startIslandId: main.id, endIslandId: islet.id,
  startPosition: coast(main, 3700, 4000), endPosition: coast(islet, 2850, 3200),
}));

// Buildings and props.
let b = 0; let o = 0;
const bid = () => `BLD_${String(++b).padStart(4, '0')}`;
const oid = () => `OBJ_${String(++o).padStart(4, '0')}`;
const place = (assetId, x, y, opts = {}) => {
  const isl = data.islands.find((i) => pointInPolygon({ x, y }, i.polygon));
  const bld = createBuilding(bid(), asset(assetId), x, y, { islandId: isl?.id ?? null, ...opts });
  data.buildings.push(bld);
  return bld;
};
const cityHall = place('AST_GOVERNMENT', 5480, 4700, { name: 'Serim City Hall' });
cityHall.address = '1 Serim Avenue'; cityHall.owner = 'City of Serim'; cityHall.investigatable = true;
const police = place('AST_POLICE', 4900, 4700, { name: 'Central Police Station' });
police.address = '12 Serim Avenue'; police.owner = 'Serim Police'; police.investigatable = true;
place('AST_OFFICE', 4850, 5280, { name: 'Daewon Tower' });
place('AST_OFFICE', 5600, 5300, { name: 'Serim Finance Center', rotation: 8 });
place('AST_HOSPITAL', 5550, 4250, { name: 'Serim General Hospital' });
place('AST_COMMERCIAL', 6200, 5400, { name: 'Bayfront Mall' });
place('AST_HOTEL', 4250, 4650, { name: 'Harbor View Hotel' });
place('AST_SCHOOL', 4150, 5400, { name: 'Serim High School', rotation: -6 });
const bar = place('AST_HOUSE', 6150, 4520, { name: 'The Last Lantern (bar)', rotation: 20 });
bar.investigatable = true; bar.description = 'Small bar at the end of Night Alley.';
for (let i = 0; i < 6; i++) place('AST_RESIDENTIAL', 8150 + (i % 3) * 330, 3850 + Math.floor(i / 3) * 760, { name: `Haneul Apartments ${i + 1}` });
for (let i = 0; i < 8; i++) place('AST_HOUSE', 8100 + i * 140, 4650 + (i % 2) * 120, { rotation: (i % 3) * 5 });
place('AST_INDUSTRIAL', 5000, 8500, { name: 'Serim Shipworks' });
place('AST_WAREHOUSE', 5800, 8500, { name: 'Warehouse 7' }).investigatable = true;
place('AST_WAREHOUSE', 6150, 7950, { name: 'Warehouse 9', rotation: 90 });
const prop = (assetId, x, y, opts = {}) => {
  const a = asset(assetId);
  const isl = data.islands.find((i) => pointInPolygon({ x, y }, i.polygon));
  const p = createProp(oid(), a, x, y, { islandId: isl?.id ?? null, ...opts });
  (a.category === 'Facilities' ? data.facilities : data.objects).push(p);
};
for (let i = 0; i < 70; i++) {
  const x = 3700 + rand() * 3300; const y = 3800 + rand() * 2400;
  if (pointInPolygon({ x, y }, main.polygon) && !(x > 4500 && x < 6000 && y > 4400 && y < 5500)) prop(['AST_PINE', 'AST_OAK', 'AST_OAK'][i % 3], x, y);
}
for (let i = 0; i < 18; i++) prop('AST_PALM', 3750 + i * 45, 6000 + Math.sin(i) * 60);
for (let x = 3900; x <= 6600; x += 220) { prop('AST_STREETLIGHT', x, 4930); prop('AST_STREETLIGHT', x, 5085); }
prop('AST_FOUNTAIN', 5200, 4790);
prop('AST_HELIPAD', 5780, 4180);
prop('AST_LIGHTHOUSE', 2350, 2700);
prop('AST_PARKING', 6250, 5750);
prop('AST_CAR', 5000, 4985, { rotation: 90 });
prop('AST_CAR', 5600, 5020, { rotation: -90 });
prop('AST_BUS', 4400, 4960, { rotation: 90 });
prop('AST_BOAT', 4500, 7700, { rotation: 30 });
prop('AST_BOAT', 6600, 7900, { rotation: -60 });
for (let i = 0; i < 8; i++) prop('AST_CRATE', 5200 + (i % 4) * 40, 8050 + Math.floor(i / 4) * 80);

data.objects.push(createArea('AREA_0001', [{ x: 6020, y: 4380 }, { x: 6330, y: 4330 }, { x: 6380, y: 4650 }, { x: 6080, y: 4720 }], { name: 'Crime Scene — Night Alley', areaType: 'Investigation', color: '#E8A33D', islandId: main.id }));
data.objects.push(createArea('AREA_0002', [{ x: 2150, y: 2600 }, { x: 2800, y: 2550 }, { x: 2900, y: 3150 }, { x: 2250, y: 3250 }], { name: 'Restricted — Gull Rock', areaType: 'Restricted', color: '#E0524D', islandId: islet.id }));

const text = projectToJSONText(data);
const check = parseProject(text);
if (!check.ok) { console.error(check.errors); process.exit(1); }
writeFileSync(join(root, 'samples', 'serim-city.world.json'), text);
const n = (k) => data[k].length;
console.log(`sample written: ${n('islands')} islands, ${n('roads')} roads, ${n('bridges')} bridges, ${n('buildings')} buildings, ${n('facilities')} facilities, ${n('objects')} objects; warnings: ${check.warnings.length}`);
console.log('bridge status:', JSON.parse(text).bridges.map((x) => x.status).join(', '));
