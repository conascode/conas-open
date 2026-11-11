// Project file serialization, validation, migration and ZIP packaging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serializeProject, parseProject, projectToJSONText } from '../src/data/serialize.js';
import { createProjectData, createIsland, createBuilding, createRoad } from '../src/data/defaults.js';
import { createTerrainFor, paintDab } from '../src/objects/terrain.js';
import { migrate } from '../src/data/migrations.js';

// lib/jszip.min.js is the browser UMD build; loaded as a module it registers globalThis.JSZip.
await import('../lib/jszip.min.js');
const { buildProjectZip, readProjectZip } = await import('../src/storage/zip.js');

const sq = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];

function sample() {
  const d = createProjectData('SERIM_CITY');
  const isl = createIsland('ISL_0001', sq);
  isl.terrain = createTerrainFor(sq);
  paintDab(isl.terrain, sq, { x: 300, y: 200 }, 120, 2, 1, new Map());
  d.islands.push(isl);
  d.buildings.push(createBuilding('BLD_0001', d.assets.find((a) => a.id === 'AST_OFFICE'), 300, 200, { islandId: 'ISL_0001' }));
  d.roads.push(createRoad('RD_0001', [{ x: 10, y: 10 }, { x: 500, y: 10 }], { islandId: 'ISL_0001' }));
  return d;
}

test('save -> load keeps positions, properties and terrain', () => {
  const d = sample();
  const text = projectToJSONText(d);
  const res = parseProject(text);
  assert.ok(res.ok, res.errors.join('\n'));
  assert.equal(res.data.buildings[0].x, 300);
  assert.equal(res.data.buildings[0].islandId, 'ISL_0001');
  assert.deepEqual([...res.data.islands[0].terrain.cells], [...d.islands[0].terrain.cells]);
  assert.equal(typeof JSON.parse(text).islands[0].terrain.data, 'string', 'terrain stored as RLE');
  assert.deepEqual(serializeProject(res.data).buildings, serializeProject(d).buildings);
});

test('top-level structure matches the specification', () => {
  const json = JSON.parse(projectToJSONText(sample()));
  for (const k of ['project', 'world', 'layers', 'assets', 'islands', 'roads', 'bridges', 'buildings', 'facilities', 'objects', 'routes', 'metadata']) assert.ok(k in json, k);
  assert.deepEqual(json.world, { width: 12000, height: 12000, background: '#173B50', gridSize: 64 });
  assert.equal(json.project.version, '1.0.0');
  assert.ok(!JSON.stringify(json).includes('data:image'), 'no embedded image data');
});

test('invalid files produce errors', () => {
  assert.equal(parseProject('{ nope').ok, false);
  assert.match(parseProject('{"a":1}').errors[0], /not a WORLD BUILDER project/);
  const d = JSON.parse(projectToJSONText(sample()));
  d.buildings[0].width = -1;
  const r = parseProject(JSON.stringify(d));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('buildings.0.width')));
  const dup = JSON.parse(projectToJSONText(sample()));
  dup.roads[0].id = 'BLD_0001';
  assert.match(parseProject(JSON.stringify(dup)).errors[0], /Duplicate ID "BLD_0001"/);
  const bad = JSON.parse(projectToJSONText(sample()));
  bad.assets[0].path = '../../etc/passwd';
  assert.equal(parseProject(JSON.stringify(bad)).ok, false, 'asset path must stay inside assets/');
  const corrupt = JSON.parse(projectToJSONText(sample()));
  corrupt.islands[0].terrain.data = '5*1';
  assert.match(parseProject(JSON.stringify(corrupt)).errors.join(), /terrain data is corrupted/);
});

test('dangling references are reported and cleared', () => {
  const d = JSON.parse(projectToJSONText(sample()));
  d.buildings[0].islandId = 'ISL_9999';
  d.buildings[0].assetId = 'AST_MISSING';
  d.buildings[0].layer = 'LYR_GONE';
  const r = parseProject(JSON.stringify(d));
  assert.ok(r.ok);
  assert.equal(r.data.buildings[0].islandId, null);
  assert.equal(r.data.buildings[0].layer, 'LYR_BUILDINGS');
  assert.ok(r.warnings.some((w) => w.includes('missing asset "AST_MISSING"')));
});

test('migration from 0.9.0 and refusal of newer versions', () => {
  const old = JSON.parse(projectToJSONText(sample()));
  old.project.version = '0.9.0';
  delete old.facilities; delete old.routes; delete old.metadata;
  delete old.islands[0].coastline.edgeTypes;
  for (const b of old.buildings) delete b.groupId;
  const r = parseProject(JSON.stringify(old));
  assert.ok(r.ok, r.errors.join());
  assert.equal(r.data.project.version, '1.0.0');
  assert.equal(r.data.islands[0].coastline.edgeTypes.length, 4);
  assert.throws(() => migrate({ project: { version: '9.0.0' } }), /newer version/);
});

test('ZIP package structure and round trip with a custom asset', async () => {
  const d = sample();
  d.assets.push({ id: 'AST_0001', name: 'Marker', category: 'Miscellaneous', path: 'assets/objects/AST_0001.png', mime: 'image/png', width: 10, height: 10, anchor: { preset: 'Center', x: 0.5, y: 0.5 }, builtin: false });
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
  const svg = new Blob([readFileSync(new URL('../assets/buildings/office.svg', import.meta.url))], { type: 'image/svg+xml' });
  const getBlob = async (a) => (a.id === 'AST_0001' ? png : a.id === 'AST_OFFICE' ? svg : null);
  const { blob, missing, root } = await buildProjectZip(d, getBlob, null);
  assert.equal(root, 'SERIM_CITY');
  assert.ok(missing.length > 0, 'unresolvable builtin assets are listed as missing in this test');
  const zip = await globalThis.JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files);
  for (const n of ['SERIM_CITY/project.world.json', 'SERIM_CITY/metadata.json', 'SERIM_CITY/assets/objects/AST_0001.png', 'SERIM_CITY/assets/buildings/office.svg', 'SERIM_CITY/thumbnails/']) assert.ok(names.includes(n), n);
  const meta = JSON.parse(await zip.file('SERIM_CITY/metadata.json').async('string'));
  assert.equal(meta.counts.buildings, 1);
  const back = await readProjectZip(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(back.ok, back.errors?.join());
  assert.equal(back.data.buildings[0].x, 300);
  assert.equal(back.assetBlobs.get('AST_0001').size, 7);
  assert.equal((await readProjectZip(new Uint8Array([1, 2, 3]))).ok, false);
});

test('bundled sample project is valid', () => {
  const text = readFileSync(new URL('../samples/serim-city.world.json', import.meta.url), 'utf8');
  const r = parseProject(text);
  assert.ok(r.ok, r.errors.join('\n'));
  assert.equal(r.warnings.length, 0);
  assert.ok(JSON.parse(text).bridges.every((b) => b.status === 'connected'));
});
