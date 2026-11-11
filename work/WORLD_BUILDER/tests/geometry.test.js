// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointInPolygon, polygonArea, polygonCentroid, simplifyPath, simplifyClosed, closestPointOnPath, isSelfIntersecting,
  applyMatrix, invert, multiply, rotationAbout, scaleAbout, translation, boxCorners, worldToLocal, localToWorld,
  sampleBezierChain, catmullRomHandles, dashPath, pathLength, convexHull, offsetPath,
} from '../src/utils/geometry.js';
import { Camera } from '../src/core/camera.js';
import { SpatialIndex } from '../src/core/spatial-index.js';
import { createTerrainFor, paintDab, floodFill, insideMask, refitTerrain } from '../src/objects/terrain.js';
import { transformPatch, hitTest, getBounds, moveVertexPatch, insertVertexPatch, removeVertexPatch } from '../src/objects/shapes.js';
import { createIsland, createBuilding, createRoad, createBridge } from '../src/data/defaults.js';
import { bridgeStatus } from '../src/objects/bridge.js';
import { encodeRLE, decodeRLE } from '../src/utils/rle.js';

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('point in polygon', () => {
  assert.equal(pointInPolygon({ x: 50, y: 50 }, square), true);
  assert.equal(pointInPolygon({ x: 150, y: 50 }, square), false);
  assert.equal(pointInPolygon({ x: -1, y: -1 }, square), false);
});

test('area and centroid', () => {
  assert.equal(Math.abs(polygonArea(square)), 10000);
  const c = polygonCentroid(square);
  assert.ok(near(c.x, 50) && near(c.y, 50));
});

test('closest point on closed path', () => {
  const c = closestPointOnPath({ x: 50, y: -20 }, square, true);
  assert.ok(near(c.x, 50) && near(c.y, 0) && near(c.d, 20));
  assert.equal(c.index, 0);
});

test('self intersection', () => {
  assert.equal(isSelfIntersecting(square), false);
  assert.equal(isSelfIntersecting([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]), true);
});

test('RDP simplification removes collinear points', () => {
  const line = Array.from({ length: 101 }, (_, i) => ({ x: i, y: (i % 2) * 0.1 }));
  assert.equal(simplifyPath(line, 1).length, 2);
  const circle = Array.from({ length: 200 }, (_, i) => ({ x: Math.cos(i / 200 * Math.PI * 2) * 500, y: Math.sin(i / 200 * Math.PI * 2) * 500 }));
  const s = simplifyClosed(circle, 4);
  assert.ok(s.length >= 12 && s.length < 60, `got ${s.length}`);
});

test('affine matrices: rotate, scale, invert, multiply', () => {
  const r = rotationAbout(Math.PI / 2, { x: 10, y: 10 });
  const p = applyMatrix(r, { x: 20, y: 10 });
  assert.ok(near(p.x, 10) && near(p.y, 20));
  const s = scaleAbout(2, 3, { x: 1, y: 1 });
  const q = applyMatrix(s, { x: 2, y: 2 });
  assert.ok(near(q.x, 3) && near(q.y, 4));
  const m = multiply(translation(5, 7), r);
  const back = applyMatrix(invert(m), applyMatrix(m, { x: 3, y: 4 }));
  assert.ok(near(back.x, 3) && near(back.y, 4));
});

test('oriented boxes: local/world conversion and corners', () => {
  const box = { x: 100, y: 100, width: 40, height: 20, rotation: 90, anchorX: 0.5, anchorY: 0.5 };
  const c = boxCorners(box);
  assert.ok(near(c[0].x, 110) && near(c[0].y, 80));
  const l = worldToLocal(box, localToWorld(box, { x: 7, y: -3 }));
  assert.ok(near(l.x, 7) && near(l.y, -3));
});

test('bezier sampling and helpers', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }];
  const straight = sampleBezierChain(pts, pts.map(() => ({ x: 0, y: 0 })));
  assert.equal(straight.length, 3);
  const smooth = sampleBezierChain(pts, catmullRomHandles(pts), 8);
  assert.equal(smooth.length, 17);
  assert.ok(near(smooth.at(-1).x, 200));
  assert.ok(pathLength(smooth) >= pathLength(straight) - 1);
  const dashes = dashPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 10);
  assert.equal(dashes.length, 5);
  const off = offsetPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);
  assert.ok(near(off[0].y, 5));
  assert.equal(convexHull([...square, { x: 50, y: 50 }]).length, 4);
});

test('camera: world <-> screen and zoom anchoring', () => {
  const cam = new Camera();
  cam.setViewSize(800, 600);
  cam.zoomAt({ x: 200, y: 150 }, 2);
  cam.panBy(30, -10);
  const w = cam.screenToWorld({ x: 321, y: 123 });
  const s = cam.worldToScreen(w);
  assert.ok(near(s.x, 321) && near(s.y, 123));
  const before = cam.screenToWorld({ x: 400, y: 300 });
  cam.zoomAt({ x: 400, y: 300 }, 1.7);
  const after = cam.screenToWorld({ x: 400, y: 300 });
  assert.ok(near(before.x, after.x) && near(before.y, after.y));
});

test('spatial index query', () => {
  const idx = new SpatialIndex(100);
  for (let i = 0; i < 1000; i++) idx.insert(`o${i}`, { minX: i * 10, minY: 0, maxX: i * 10 + 5, maxY: 5 });
  const hits = idx.query({ minX: 95, minY: 0, maxX: 125, maxY: 10 });
  assert.deepEqual([...hits].sort(), ['o10', 'o11', 'o12', 'o9'].sort());
  idx.remove('o10');
  assert.equal(idx.query({ minX: 100, minY: 0, maxX: 101, maxY: 1 }).size, 0);
  idx.insert('huge', { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
  assert.ok(idx.queryPoint({ x: 5, y: 5 }).has('huge'));
});

test('terrain painting is clipped to the island polygon and undo diffs are exact', () => {
  const tri = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 400 }];
  const t = createTerrainFor(tri, 16);
  const diff = new Map();
  paintDab(t, tri, { x: 300, y: 300 }, 200, 3, 1, diff);
  const mask = insideMask(t, tri);
  t.cells.forEach((v, i) => { if (v) assert.equal(mask[i], 1); });
  assert.ok(diff.size > 0);
  for (const [i, [o]] of diff) t.cells[i] = o;
  assert.equal(t.cells.filter((v) => v).length, 0);
  const d2 = new Map();
  floodFill(t, tri, { x: 50, y: 50 }, 2, d2);
  assert.equal(t.cells.filter((v) => v === 2).length, mask.filter((v) => v).length);
});

test('terrain refit follows a rotation', () => {
  const sq = [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 160 }, { x: 0, y: 160 }];
  const t = createTerrainFor(sq, 16);
  paintDab(t, sq, { x: 40, y: 40 }, 30, 5, 1, new Map());
  const m = rotationAbout(Math.PI, { x: 160, y: 80 });
  const rotated = sq.map((p) => applyMatrix(m, p));
  const r = refitTerrain(t, rotated, m);
  const col = Math.floor((280 - r.originX) / 16); const row = Math.floor((120 - r.originY) / 16);
  assert.equal(r.cells[row * r.cols + col], 5, 'painted corner moved to the opposite corner');
});

test('RLE encode/decode', () => {
  const cells = new Uint8Array([0, 0, 0, 2, 2, 5, 0, 0]);
  const text = encodeRLE(cells);
  assert.equal(text, '3*0,2*2,1*5,2*0');
  assert.deepEqual([...decodeRLE(text, 8)], [...cells]);
  assert.throws(() => decodeRLE('3*0', 8));
});

test('object transforms, hit tests and vertex edits', () => {
  const isl = createIsland('ISL_0001', square);
  const moved = transformPatch(isl, translation(10, 20));
  assert.equal(moved.polygon[0].x, 10);
  assert.equal(moved.x, 60);
  const b = createBuilding('BLD_0001', { id: 'A', name: 'x', width: 40, height: 20, anchor: { x: 0.5, y: 0.5 } }, 0, 0);
  const rot = transformPatch(b, rotationAbout(Math.PI / 2, { x: 0, y: 0 }));
  assert.ok(near(rot.rotation, 90));
  const scaled = transformPatch(b, scaleAbout(2, 2, { x: 0, y: 0 }));
  assert.equal(scaled.width, 80);
  assert.equal(scaled.hitbox.points[2].x, 40);
  assert.equal(hitTest(b, { x: 19, y: 9 }), true);
  assert.equal(hitTest(b, { x: 21, y: 0 }), false);
  const mv = moveVertexPatch(isl, 'v0', { x: -50, y: -50 });
  assert.equal(mv.polygon[0].x, -50);
  const ins = insertVertexPatch(isl, 1, { x: 50, y: -10 });
  assert.equal(ins.polygon.length, 5);
  assert.equal(ins.coastline.edgeTypes.length, 5);
  const tri = createIsland('ISL_0002', square.slice(0, 3));
  assert.equal(typeof removeVertexPatch(tri, 'v0'), 'string');
  const road = createRoad('RD_0001', [{ x: 0, y: 0 }, { x: 100, y: 0 }], { width: 20 });
  assert.equal(hitTest(road, { x: 50, y: 9 }), true);
  assert.equal(hitTest(road, { x: 50, y: 12 }), false);
  assert.equal(road.width, 20);
  const rp = transformPatch(road, translation(5, 5));
  assert.equal(rp.width, undefined, 'road width is not overwritten by bounds');
  assert.ok(getBounds(road).maxX >= 100);
});

test('bridge connection status', () => {
  const a = createIsland('ISL_0001', square);
  const c = createIsland('ISL_0002', square.map((p) => ({ x: p.x + 300, y: p.y })));
  const get = (id) => ({ ISL_0001: a, ISL_0002: c })[id];
  const br = createBridge('BR_0001', { startIslandId: a.id, endIslandId: c.id, startPosition: { x: 100, y: 50 }, endPosition: { x: 300, y: 50 } });
  assert.equal(bridgeStatus(br, get).status, 'connected');
  const far = { ...br, endPosition: { x: 600, y: 50 } };
  assert.equal(bridgeStatus(far, get).status, 'warning');
  assert.equal(bridgeStatus({ ...br, endIslandId: a.id }, get).status, 'warning');
  assert.equal(bridgeStatus({ ...br, endIslandId: 'ISL_9999' }, get).problems[0], 'End island ISL_9999 does not exist');
});
