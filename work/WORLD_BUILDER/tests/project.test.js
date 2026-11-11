// Document model, commands and undo/redo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldDocument } from '../src/core/document.js';
import { History } from '../src/core/history.js';
import { AddCommand, RemoveCommand, PatchCommand, BatchCommand, TerrainCommand, MoveItemCommand } from '../src/core/commands.js';
import { createProjectData, createIsland, createBuilding } from '../src/data/defaults.js';
import { createTerrainFor, paintDab } from '../src/objects/terrain.js';
import { IdGenerator } from '../src/utils/id.js';

globalThis.performance ??= { now: () => Date.now() };

function setup() {
  const doc = new WorldDocument();
  doc.load(createProjectData('TEST'));
  return { doc, history: new History(50) };
}

const sq = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }];

test('IDs are unique and continue after loaded IDs', () => {
  const g = new IdGenerator();
  g.seed(['ISL_0007', 'BLD_0012', 'weird']);
  assert.equal(g.next('island'), 'ISL_0008');
  assert.equal(g.next('building'), 'BLD_0013');
  const taken = new Set(['RD_0001', 'RD_0002']);
  assert.equal(g.next('road', (id) => taken.has(id)), 'RD_0003');
});

test('document rejects duplicate IDs', () => {
  const { doc } = setup();
  doc.add('islands', createIsland('ISL_0001', sq));
  assert.throws(() => doc.add('islands', createIsland('ISL_0001', sq)), /Duplicate/);
});

test('create / delete / undo / redo', () => {
  const { doc, history } = setup();
  const isl = createIsland(doc.newId('island'), sq);
  history.execute(new AddCommand(doc, [{ collection: 'islands', obj: isl }]));
  assert.equal(doc.data.islands.length, 1);
  history.execute(new RemoveCommand(doc, [isl.id]));
  assert.equal(doc.has(isl.id), false);
  history.undo();
  assert.equal(doc.get(isl.id), isl);
  history.undo();
  assert.equal(doc.data.islands.length, 0);
  history.redo();
  history.redo();
  assert.equal(doc.data.islands.length, 0);
});

test('patch command stores only changed keys and merges', () => {
  const { doc, history } = setup();
  const b = createBuilding('BLD_0001', null, 10, 10);
  doc.add('buildings', b);
  const c1 = PatchCommand.from(doc, [[b.id, { x: 20 }]], 'Move', 'k');
  history.execute(c1);
  history.execute(PatchCommand.from(doc, [[b.id, { x: 30, y: 40 }]], 'Move', 'k'));
  assert.equal(history.undoStack.length, 1, 'merged');
  assert.deepEqual(Object.keys(c1.changes[0].before).sort(), ['x', 'y']);
  history.undo();
  assert.equal(b.x, 10);
  assert.equal(b.y, 10);
  history.redo();
  assert.equal(b.x, 30);
});

test('batch, reorder and history limit', () => {
  const { doc, history } = setup();
  const before = doc.layers.map((l) => l.id);
  history.execute(new MoveItemCommand(doc, 'LYR_BUILDINGS', 0));
  assert.equal(doc.layers[0].id, 'LYR_BUILDINGS');
  history.undo();
  assert.deepEqual(doc.layers.map((l) => l.id), before);
  const b = createBuilding('BLD_0001', null, 0, 0);
  history.execute(new BatchCommand([new AddCommand(doc, [{ collection: 'buildings', obj: b }]), PatchCommand.from(doc, [], 'x')]));
  history.undo();
  assert.equal(doc.has('BLD_0001'), false);
  for (let i = 0; i < 80; i++) history.execute(PatchCommand.from(doc, [['LYR_ENV', { opacity: (i % 10) / 10 }]], 'op'));
  assert.equal(history.undoStack.length, 50);
});

test('terrain command undo/redo is diff based', () => {
  const { doc, history } = setup();
  const isl = createIsland('ISL_0001', sq);
  isl.terrain = createTerrainFor(sq);
  doc.add('islands', isl);
  const diff = new Map();
  paintDab(isl.terrain, isl.polygon, { x: 250, y: 250 }, 100, 4, 1, diff);
  const painted = isl.terrain.cells.filter((v) => v === 4).length;
  const cmd = new TerrainCommand(doc, isl.id, diff);
  history.record(cmd);
  assert.equal(cmd.idx.length, painted);
  history.undo();
  assert.equal(isl.terrain.cells.filter((v) => v === 4).length, 0);
  history.redo();
  assert.equal(isl.terrain.cells.filter((v) => v === 4).length, painted);
});

test('events keep listeners in sync', () => {
  const { doc } = setup();
  const seen = [];
  doc.on('change', (c) => seen.push(c.kind));
  const isl = createIsland('ISL_0001', sq);
  doc.add('islands', isl);
  doc.update(isl.id, { name: 'X' });
  doc.remove(isl.id);
  assert.deepEqual(seen, ['add', 'update', 'remove']);
});
