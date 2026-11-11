// Navigator: road graph, route finding and drive simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProject } from '../src/data/serialize.js';
import { createProjectData, createRoad, createIsland, createBridge } from '../src/data/defaults.js';
import { buildRoadGraph, snapToNetwork, findRoute, routeSteps } from '../src/nav/road-graph.js';
import { buildTrack, stateAt, formatDistance, formatDuration, toCSV } from '../src/nav/simulation.js';

const P = (x, y) => ({ x, y });

function plusMap({ oneWay = false } = {}) {
  const d = createProjectData('T');
  d.roads.push(createRoad('RD_0001', [P(0, 500), P(1000, 500)], { roadType: 'Main Road', name: 'East-West' }));
  d.roads.push(createRoad('RD_0002', [P(500, 0), P(500, 1000)], { roadType: 'Local Road', name: 'North-South', direction: oneWay ? 'One-way' : 'Two-way' }));
  return d;
}

test('crossing roads become a junction (4-way)', () => {
  const g = buildRoadGraph(plusMap());
  assert.equal(g.crossingCount, 1);
  const center = g.nodes.findIndex((n) => n.x === 500 && n.y === 500);
  assert.ok(center >= 0);
  assert.equal(g.adj[center].length, 4);
  const r = findRoute(g, snapToNetwork(g, P(0, 500)), snapToNetwork(g, P(500, 0)));
  assert.ok(r);
  assert.ok(Math.abs(r.lengthPx - 1000) < 1e-6);
  const steps = routeSteps(g, r);
  assert.deepEqual(steps.map((s) => [s.turn, s.name]), [['start', 'East-West'], ['left', 'North-South']]);
});

test('crossings can be disabled', () => {
  const g = buildRoadGraph(plusMap(), { crossings: false });
  assert.equal(findRoute(g, snapToNetwork(g, P(0, 500)), snapToNetwork(g, P(500, 0))), null);
});

test('one-way roads are only driven forward (walking ignores direction)', () => {
  const d = plusMap({ oneWay: true });
  const car = buildRoadGraph(d, { mode: 'car' });
  const down = findRoute(car, snapToNetwork(car, P(500, 100)), snapToNetwork(car, P(500, 900)));
  const up = findRoute(car, snapToNetwork(car, P(500, 900)), snapToNetwork(car, P(500, 100)));
  assert.ok(down);
  assert.equal(up, null);
  const walk = buildRoadGraph(d, { mode: 'walk' });
  assert.ok(findRoute(walk, snapToNetwork(walk, P(500, 900)), snapToNetwork(walk, P(500, 100))));
});

test('start and end on the same road segment', () => {
  const g = buildRoadGraph(plusMap());
  const r = findRoute(g, snapToNetwork(g, P(100, 510)), snapToNetwork(g, P(300, 490)));
  assert.ok(Math.abs(r.lengthPx - 200) < 1e-6);
});

test('fastest vs shortest', () => {
  const d = createProjectData('T');
  // short slow alley vs long fast highway between (0,0) and (1000,0)
  d.roads.push(createRoad('RD_0001', [P(0, 0), P(1000, 0)], { roadType: 'Alley', name: 'Alley', speedLimit: 10 }));
  d.roads.push(createRoad('RD_0002', [P(0, 0), P(0, 300), P(1000, 300), P(1000, 0)], { roadType: 'Highway', name: 'Highway' }));
  const g = buildRoadGraph(d);
  const a = snapToNetwork(g, P(0, 0)); const b = snapToNetwork(g, P(1000, 0));
  assert.equal(Math.round(findRoute(g, a, b, { metric: 'distance' }).lengthPx), 1000);
  assert.equal(Math.round(findRoute(g, a, b, { metric: 'time' }).lengthPx), 1600);
});

test('pedestrian roads and bridges are walk-only; bridge ends join island roads', () => {
  const d = createProjectData('T');
  d.islands.push(createIsland('ISL_0001', [P(0, 0), P(400, 0), P(400, 400), P(0, 400)]));
  d.islands.push(createIsland('ISL_0002', [P(1000, 0), P(1400, 0), P(1400, 400), P(1000, 400)]));
  d.roads.push(createRoad('RD_0001', [P(50, 200), P(300, 200)], { name: 'West Rd' }));
  d.roads.push(createRoad('RD_0002', [P(1100, 200), P(1350, 200)], { name: 'East Rd' }));
  const bridge = (type) => createBridge('BR_0001', { bridgeType: type, startIslandId: 'ISL_0001', endIslandId: 'ISL_0002', startPosition: P(400, 200), endPosition: P(1000, 200) });
  d.bridges.push(bridge('Road Bridge'));
  let g = buildRoadGraph(d, { mode: 'car' });
  assert.equal(g.connectors.length, 2, 'both bridge ends connect to the nearby roads');
  const r = findRoute(g, snapToNetwork(g, P(60, 200)), snapToNetwork(g, P(1340, 200)));
  assert.ok(r);
  assert.ok(routeSteps(g, r).some((s) => s.kind === 'bridge'));
  d.bridges[0] = bridge('Pedestrian Bridge');
  g = buildRoadGraph(d, { mode: 'car' });
  assert.equal(findRoute(g, snapToNetwork(g, P(60, 200)), snapToNetwork(g, P(1340, 200))), null);
  g = buildRoadGraph(d, { mode: 'walk' });
  assert.ok(findRoute(g, snapToNetwork(g, P(60, 200)), snapToNetwork(g, P(1340, 200))));
});

test('snap respects a maximum distance', () => {
  const g = buildRoadGraph(plusMap());
  assert.equal(snapToNetwork(g, P(5000, 5000), 600), null);
  assert.equal(snapToNetwork(g, P(520, 300), 600).x, 500);
});

test('sample map: all three islands reachable by car, islet only on foot', () => {
  const d = parseProject(readFileSync(new URL('../samples/serim-city.world.json', import.meta.url), 'utf8')).data;
  const car = buildRoadGraph(d, { mode: 'car' });
  const from = snapToNetwork(car, P(3700, 5000));
  for (const to of [P(9200, 4400), P(6300, 8300)]) assert.ok(findRoute(car, from, snapToNetwork(car, to, 600)), JSON.stringify(to));
  assert.equal(snapToNetwork(car, P(2390, 2760), 600), null);
  const walk = buildRoadGraph(d, { mode: 'walk' });
  assert.ok(findRoute(walk, snapToNetwork(walk, P(5200, 5000)), snapToNetwork(walk, P(2390, 2760), 600)));
});

test('drive simulation timing, position and waypoints', () => {
  const g = buildRoadGraph(plusMap());
  const s = [P(0, 500), P(500, 500), P(500, 1000)].map((p) => snapToNetwork(g, p));
  const legs = [findRoute(g, s[0], s[1]), findRoute(g, s[1], s[2])];
  const tr = buildTrack(legs, 0.5);
  assert.equal(tr.totalPx, 1000);
  // Main Road 60 km/h for 250 m, Local Road 30 km/h for 250 m
  assert.ok(Math.abs(tr.totalSec - (250 / (60 / 3.6) + 250 / (30 / 3.6))) < 1e-6);
  const mid = stateAt(tr, 7.5); // halfway along the first leg
  assert.ok(Math.abs(mid.x - 250) < 1e-6 && mid.y === 500 && mid.speedKmh === 60 && mid.leg === 0);
  const later = stateAt(tr, 20);
  assert.equal(later.leg, 1);
  assert.equal(later.x, 500);
  assert.ok(Math.abs(later.heading - Math.PI / 2) < 1e-9, 'heading south (y down)');
  const end = stateAt(tr, 999);
  assert.ok(end.done && end.x === 500 && end.y === 1000 && end.speedKmh === 0);
});

test('formatting and CSV', () => {
  assert.equal(formatDistance(850), '850 m');
  assert.equal(formatDistance(2345), '2.35 km');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(3725), '1:02:05');
  const csv = toCSV([{ t_sec: 0, clock: '0:00', x: 1, y: 2, speed_kmh: 30, heading_deg: 0, road: 'A, "B"', event: 'start' }]);
  assert.equal(csv.split('\n')[1], '0,0:00,1,2,30,0,"A, ""B""",start');
});
