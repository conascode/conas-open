// OpenStreetMap import: parsing, coastline -> land, roads/junctions, buildings, terrain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOSM, convertOSM, summarizeOSM, joinChains } from '../src/data/osm-import.js';
import { parseProject, projectToJSONText } from '../src/data/serialize.js';
import { pointInPolygon, localToWorld } from '../src/utils/geometry.js';
import { buildRoadGraph, snapToNetwork, findRoute, routeSteps } from '../src/nav/road-graph.js';
import { cellAt } from '../src/objects/terrain.js';

const xml = readFileSync(new URL('./fixtures/coastal-town.osm', import.meta.url), 'utf8');
const model = parseOSM(xml);
const { data, stats, warnings } = convertOSM(model, { name: 'Coastal Town' });
// world px of a lat/lon in this import (same projection as the importer)
const B = { minlat: 37.5, minlon: 126.9, maxlat: 37.512 };
const kx = 111320 * Math.cos(((37.5 + 37.512) / 2) * (Math.PI / 180));
const px = (lat, lon) => ({ x: 300 + ((lon - B.minlon) * kx) / 0.5, y: 300 + ((B.maxlat - lat) * 110574) / 0.5 });

test('parses OSM XML (nodes, ways, relations, tags, bounds, entities)', () => {
  assert.equal(model.nodes.size, 113);
  assert.equal(model.ways.length, 21);
  assert.equal(model.relations.length, 1);
  assert.equal(model.bounds.maxlon, 126.915);
  const s = summarizeOSM(model);
  assert.equal(s.roads, 7);
  assert.equal(s.buildings, 5);
  const ent = parseOSM('<osm><node id="1" lat="1" lon="2"><tag k="name" v="A &amp; B &#39;C&#39;"/></node></osm>');
  assert.equal(ent.nodes.get('1').tags.name, "A & B 'C'");
  assert.throws(() => parseOSM('<html></html>'), /not OpenStreetMap/);
  assert.throws(() => parseOSM('{"foo":1}'), /Unsupported/);
});

test('converted project is a valid WORLD BUILDER project with OSM attribution', () => {
  const r = parseProject(projectToJSONText(data));
  assert.ok(r.ok, r.errors.join('\n'));
  assert.equal(data.metadata.source, 'OpenStreetMap');
  assert.match(data.metadata.attribution, /OpenStreetMap contributors/);
  assert.equal(data.metadata.metersPerPixel, 0.5);
  assert.deepEqual(warnings, []);
});

test('coastline: mainland on the land side, sea outside, closed ring becomes a named island', () => {
  assert.equal(data.islands.length, 2);
  const main = data.islands.find((i) => i.name === 'Mainland');
  const isl = data.islands.find((i) => i.name === 'Gulmaegi-do');
  assert.ok(main && isl);
  assert.ok(pointInPolygon(px(37.5100, 126.9050), main.polygon), 'north of the coast is land');
  assert.ok(!pointInPolygon(px(37.5010, 126.9020), main.polygon), 'south of the coast is sea');
  assert.ok(!pointInPolygon(px(37.5010, 126.9020), isl.polygon));
  assert.ok(pointInPolygon(px(37.5020, 126.9075), isl.polygon), 'island centre is on the island');
});

test('roads keep names, types, one-way and real junctions; the bridge links the island', () => {
  const byName = Object.fromEntries(data.roads.map((r) => [r.name, r]));
  assert.equal(byName['Haebyeon-ro'].roadType, 'Main Road');
  assert.equal(byName['Haebyeon-ro'].speedLimit, 50);
  assert.equal(byName['Haebyeon-ro'].lanes, 4);
  assert.equal(byName['Ilbang-gil'].direction, 'One-way');
  assert.equal(byName['Parking Road'].roadType, 'Parking Road');
  assert.equal(stats.junctions, 4);
  // Sandbox-gil crosses Haebyeon-ro at a shared OSM node -> connection to the same coordinates
  const c = byName['Sandbox-gil'].connections[0];
  const p = byName['Sandbox-gil'].points.find((q) => q.id === c.pointId);
  const t = data.roads.find((r) => r.id === c.roadId).points.find((q) => q.id === c.targetPointId);
  assert.deepEqual([p.x, p.y], [t.x, t.y]);
  // Navigator can drive from the mainland onto the island across Seom-daegyo
  const g = buildRoadGraph(data, { mode: 'car' });
  const route = findRoute(g, snapToNetwork(g, px(37.5081, 126.9000)), snapToNetwork(g, px(37.5021, 126.9084)), { mpp: 0.5 });
  assert.ok(route);
  assert.ok(routeSteps(g, route).some((s) => s.name === 'Seom-daegyo'));
});

test('buildings: type, asset, address name and footprint hitbox in local coordinates', () => {
  const byName = Object.fromEntries(data.buildings.map((b) => [b.name, b]));
  assert.equal(byName['Haebyeon Police Station'].buildingType, 'Police');
  assert.equal(byName['Haebyeon Police Station'].assetId, 'AST_POLICE');
  assert.equal(byName['Haebyeon Police Station'].investigatable, true);
  assert.equal(byName['Haebyeon Elementary School'].assetId, 'AST_SCHOOL');
  const house = byName['Sandbox-gil 3'];
  assert.ok(house, 'house named from its address');
  assert.equal(house.assetId, 'AST_HOUSE');
  assert.equal(house.address, 'Sandbox-gil 3');
  assert.ok(Math.abs(house.rotation) <= 45 && house.rotation !== 0, 'rotated footprint keeps its angle');
  // hitbox corners map back onto the OSM footprint
  const corner = localToWorld(house, house.hitbox.points[0]);
  const want = px(37.5070, 126.9060);
  assert.ok(Math.hypot(corner.x - want.x, corner.y - want.y) < 0.5);
  assert.equal(byName['Island Store'].islandId, data.islands.find((i) => i.name === 'Gulmaegi-do').id);
});

test('terrain: lake = water, multipolygon park = grass, beach = sand, commercial = concrete, stream painted', () => {
  const main = data.islands.find((i) => i.name === 'Mainland');
  const at = (lat, lon) => main.terrain.cells[cellAt(main.terrain, px(lat, lon))];
  assert.equal(at(37.5100, 126.9010), 6, 'lake');
  assert.equal(at(37.5104, 126.9100), 1, 'park (relation with two outer ways)');
  assert.equal(at(37.5052, 126.9040), 2, 'beach');
  assert.equal(at(37.5071, 126.9125), 4, 'commercial');
  assert.equal(at(37.51015, 126.9006), 6, 'stream');
  assert.equal(stats.trees, 3);
});

test('no coastline -> whole area is land; options switch parts off', () => {
  const inland = parseOSM('<osm><bounds minlat="10" minlon="20" maxlat="10.01" maxlon="20.01"/><node id="1" lat="10.002" lon="20.002"/><node id="2" lat="10.008" lon="20.008"/><way id="5"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way></osm>');
  const r = convertOSM(inland, { buildings: false });
  assert.equal(r.data.islands.length, 1);
  assert.equal(r.data.islands[0].name, 'Mainland');
  assert.equal(r.data.roads.length, 1);
  const none = convertOSM(model, { roads: false, buildings: false, trees: false, landuse: false });
  assert.equal(none.data.roads.length + none.data.buildings.length + none.data.objects.length, 0);
  assert.ok(none.data.islands.every((i) => !i.terrain));
  const noMinor = convertOSM(model, { minorRoads: false });
  assert.ok(noMinor.data.roads.every((x) => x.roadType !== 'Pedestrian Road' && x.roadType !== 'Alley'));
});

test('huge areas raise the scale to fit the world limit', () => {
  const big = parseOSM('<osm><bounds minlat="0" minlon="0" maxlat="1" maxlon="1"/><node id="1" lat="0.5" lon="0.5"/></osm>');
  const r = convertOSM(big, { metersPerPixel: 0.5 });
  assert.ok(r.metersPerPixel > 0.5);
  assert.ok(r.data.world.width <= 200000);
  assert.match(r.warnings[0], /scale changed/);
});

test('GeoJSON and Overpass JSON input; shared coordinates become junctions', () => {
  const gj = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { highway: 'primary', name: 'A' }, geometry: { type: 'LineString', coordinates: [[127.0, 37.0], [127.002, 37.0], [127.004, 37.0]] } },
      { type: 'Feature', properties: { highway: 'residential', name: 'B' }, geometry: { type: 'LineString', coordinates: [[127.002, 37.002], [127.002, 37.0]] } },
      { type: 'Feature', properties: { building: 'yes', name: 'Shop' }, geometry: { type: 'Polygon', coordinates: [[[127.001, 37.001], [127.0012, 37.001], [127.0012, 37.0012], [127.001, 37.0012], [127.001, 37.001]]] } },
    ],
  };
  const r = convertOSM(parseOSM(JSON.stringify(gj)));
  assert.equal(r.data.roads.length, 2);
  assert.equal(r.stats.junctions, 1);
  assert.equal(r.data.buildings[0].name, 'Shop');
  const op = { elements: [
    { type: 'node', id: 1, lat: 37, lon: 127 }, { type: 'node', id: 2, lat: 37, lon: 127.003 }, { type: 'node', id: 3, lat: 37.002, lon: 127.003 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'secondary', name: 'X' } },
    { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'secondary', name: 'Y', oneway: '-1' } },
  ] };
  const o = convertOSM(parseOSM(JSON.stringify(op)));
  assert.equal(o.data.roads.length, 2);
  assert.equal(o.stats.junctions, 1);
  const y = o.data.roads.find((x) => x.name === 'Y');
  assert.ok(y.points[0].y < y.points[1].y, 'oneway=-1 reversed (north end first)');
});

test('joinChains joins split ways in either direction', () => {
  const open = joinChains([['a', 'b'], ['b', 'c'], ['d', 'c']]);
  assert.equal(open.length, 1);
  assert.deepEqual([...open[0]].sort(), ['a', 'b', 'c', 'd']);
  const ring = joinChains([['a', 'b', 'c'], ['c', 'd', 'a']]);
  assert.equal(ring.length, 1);
  assert.equal(ring[0][0], ring[0][ring[0].length - 1]);
});
