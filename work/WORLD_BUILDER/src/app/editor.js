// Editor: central controller. Owns the document, history, selection, camera and renderer,
// and implements editing actions shared by tools, menus and panels.
import { Emitter } from '../utils/events.js';
import { WorldDocument } from '../core/document.js';
import { History } from '../core/history.js';
import { Selection } from '../core/selection.js';
import { Camera } from '../core/camera.js';
import { AddCommand, RemoveCommand, PatchCommand, BatchCommand } from '../core/commands.js';
import { getShapeBounds, transformPatch, isBoxType, outlineOf } from '../objects/shapes.js';
import { cloneTerrain } from '../objects/terrain.js';
import { sampleRoad } from '../objects/road.js';
import { translation, unionBounds, boundsCenter, pointInPolygon, polygonCentroid, snapValue } from '../utils/geometry.js';
import { pointId } from '../utils/id.js';
import { collectionForObject } from '../data/constants.js';
import { createBuilding, createProp } from '../data/defaults.js';

const SETTINGS_KEY = 'world-builder.settings';
export const DEFAULT_SETTINGS = {
  showGrid: true,
  snapToGrid: false,
  snapToObjects: true,
  showOutlines: false,
  showLabels: true,
  autosave: true,
  autosaveDelay: 2,
  undoLimit: 300,
};

export class Editor extends Emitter {
  constructor() {
    super();
    this.doc = new WorldDocument();
    this.camera = new Camera();
    this.selection = new Selection();
    this.settings = loadSettings();
    this.history = new History(this.settings.undoLimit);
    this.renderer = null; // set by main.js
    this.hitboxEditId = null;
    this.dirty = false;
    this.selection.on('change', () => {
      if (this.hitboxEditId && !this.selection.has(this.hitboxEditId)) this.setHitboxEdit(null);
      this.requestOverlay();
      this.emit('selection', this.selection.list);
    });
    this.doc.on('remove', ({ obj }) => { if (this.selection.has(obj.id)) this.selection.remove([obj.id]); });
    this.doc.on('change', () => { this.dirty = true; this.emit('dirty', true); });
    const syncWorldSize = () => { if (this.doc.data) this.camera.setWorldSize(this.doc.world.width, this.doc.world.height); };
    this.doc.on('reset', syncWorldSize);
    this.doc.on('section', ({ section }) => { if (section === 'world') syncWorldSize(); });
    this.history.on('change', () => this.emit('history'));
  }

  // ---------- settings ----------

  setSetting(key, value) {
    this.settings[key] = value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage unavailable */ }
    if (key === 'undoLimit') this.history.limit = value;
    if (this.renderer) {
      this.renderer.settings.showGrid = this.settings.showGrid;
      this.renderer.settings.showLabels = this.settings.showLabels;
      this.renderer.gridDirty = true;
      for (const isl of this.doc.data.islands) this.renderer.updateLabel(isl);
    }
    this.requestOverlay();
    this.emit('settings', { key, value });
  }

  // ---------- helpers ----------

  requestOverlay() { this.renderer?.requestOverlay(); }

  toast(message, kind = 'info') { this.emit('toast', { message, kind }); }

  execute(cmd) {
    if (cmd.empty) return cmd;
    this.history.execute(cmd);
    return cmd;
  }

  record(cmd) {
    if (cmd.empty) return cmd;
    this.history.record(cmd);
    return cmd;
  }

  undo() {
    const c = this.history.undo();
    if (c) this.toast(`Undo: ${c.label}`);
    this.requestOverlay();
  }

  redo() {
    const c = this.history.redo();
    if (c) this.toast(`Redo: ${c.label}`);
    this.requestOverlay();
  }

  // Grid snap (when enabled) for a world point.
  snap(p, force = false) {
    if (!this.settings.snapToGrid && !force) return { x: p.x, y: p.y };
    const s = this.doc.world.gridSize;
    return { x: snapValue(p.x, s), y: snapValue(p.y, s) };
  }

  // Screen-pixel tolerance converted to world units.
  tol(px = 6) { return px / this.camera.zoom; }

  layerEditable(layerId) {
    const l = this.doc.layer(layerId);
    return !!l && l.visible && !l.locked;
  }

  isEditable(obj) {
    return !!obj && !obj.locked && obj.visible && this.layerEditable(obj.layer);
  }

  pick(p, filter) {
    return this.renderer.pick(p, { tol: this.tol(4), filter: (o) => this.isEditable(o) && (!filter || filter(o)) });
  }

  islandAt(p) {
    const list = this.doc.data.islands;
    for (let i = list.length - 1; i >= 0; i--) {
      const isl = list[i];
      if (isl.visible && pointInPolygon(p, isl.polygon)) return isl;
    }
    return null;
  }

  // Which island an object sits on (used for the hierarchy and for islandId fields).
  islandIdFor(obj) {
    let p;
    if (isBoxType(obj)) p = { x: obj.x, y: obj.y };
    else if (obj.type === 'area') p = polygonCentroid(obj.polygon);
    else if (obj.type === 'road') { const s = sampleRoad(obj); p = s[Math.floor(s.length / 2)]; } else return undefined;
    return this.islandAt(p)?.id ?? null;
  }

  selectedObjects() {
    return this.selection.list.map((id) => this.doc.get(id)).filter(Boolean);
  }

  selectionBounds(objs = this.selectedObjects()) {
    let b = null;
    for (const o of objs) b = b ? unionBounds(b, getShapeBounds(o)) : getShapeBounds(o);
    return b;
  }

  // Expand ids to whole groups.
  expandGroups(ids) {
    const groups = new Set(ids.map((id) => this.doc.get(id)?.groupId).filter(Boolean));
    if (!groups.size) return ids;
    const out = new Set(ids);
    for (const o of this.doc.objects()) if (o.groupId && groups.has(o.groupId)) out.add(o.id);
    return [...out];
  }

  setHitboxEdit(id) {
    this.hitboxEditId = id;
    this.requestOverlay();
    this.emit('hitbox-edit', id);
  }

  // ---------- object creation ----------

  createObjects(objs, label = 'Create', select = true) {
    const entries = objs.map((obj) => ({ collection: collectionForObject(obj), obj }));
    const cmd = this.execute(new AddCommand(this.doc, entries, label));
    if (select) this.selection.set(objs.map((o) => o.id));
    return cmd;
  }

  // Patch one object, recording an undoable command. `mergeKey` merges rapid repeated edits.
  setProps(id, patch, label = 'Modify Property', mergeKey = null) {
    return this.execute(PatchCommand.from(this.doc, [[id, patch]], label, mergeKey));
  }

  // ---------- road links ----------

  // All (roadId, pointId) pairs linked to the given road point.
  roadLinks(roadId, pid) {
    const out = [];
    for (const r of this.doc.data.roads) {
      for (const c of r.connections) {
        if (r.id === roadId && c.pointId === pid) out.push([c.roadId, c.targetPointId]);
        else if (c.roadId === roadId && c.targetPointId === pid) out.push([r.id, c.pointId]);
      }
    }
    return out;
  }

  // Given patches (Map id -> patch) that move road points, move linked points on other roads too.
  propagateRoadLinks(patches) {
    for (const [id, patch] of [...patches]) {
      const road = this.doc.get(id);
      if (road?.type !== 'road' || !patch.points) continue;
      for (const p of patch.points) {
        const old = road.points.find((q) => q.id === p.id);
        if (old && old.x === p.x && old.y === p.y) continue;
        for (const [rid, pid] of this.roadLinks(id, p.id)) {
          const other = this.doc.get(rid);
          if (!other) continue;
          const existing = patches.get(rid);
          const pts = (existing?.points || other.points).map((q) => (q.id === pid ? { ...q, x: p.x, y: p.y } : q));
          patches.set(rid, { ...(existing || {}), points: pts });
        }
      }
    }
    return patches;
  }

  // ---------- actions ----------

  deleteSelection() {
    const ids = this.selection.list.filter((id) => this.isEditable(this.doc.get(id)) || this.doc.get(id)?.visible === false);
    const lockedCount = this.selection.size - ids.length;
    if (!ids.length) {
      if (lockedCount) this.toast('Selected objects are locked', 'warning');
      return;
    }
    this.deleteObjects(ids);
    if (lockedCount) this.toast(`${lockedCount} locked object(s) were not deleted`, 'warning');
  }

  // Delete with cascade: clear references held by other objects so no dangling IDs remain.
  deleteObjects(ids, label = 'Delete') {
    const del = new Set(ids);
    const patches = new Map();
    for (const r of this.doc.data.roads) {
      if (del.has(r.id)) continue;
      const kept = r.connections.filter((c) => !del.has(c.roadId));
      if (kept.length !== r.connections.length) patches.set(r.id, { connections: kept });
    }
    const delIslands = ids.filter((id) => this.doc.collectionOf(id) === 'islands');
    if (delIslands.length) {
      const di = new Set(delIslands);
      for (const b of this.doc.data.bridges) {
        if (del.has(b.id)) continue;
        const p = {};
        if (di.has(b.startIslandId)) p.startIslandId = null;
        if (di.has(b.endIslandId)) p.endIslandId = null;
        if (Object.keys(p).length) patches.set(b.id, p);
      }
      for (const key of ['buildings', 'facilities', 'objects', 'roads']) {
        for (const o of this.doc.data[key]) if (!del.has(o.id) && di.has(o.islandId)) patches.set(o.id, { ...(patches.get(o.id) || {}), islandId: null });
      }
    }
    const cmds = [];
    if (patches.size) cmds.push(PatchCommand.from(this.doc, patches, label));
    cmds.push(new RemoveCommand(this.doc, ids, label));
    this.execute(new BatchCommand(cmds, label));
    this.toast(`Deleted ${ids.length} object(s)`);
  }

  duplicateSelection(offset) {
    const objs = this.selectedObjects();
    if (!objs.length) return;
    const d = offset ?? this.doc.world.gridSize;
    const m = translation(d, d);
    const groupMap = new Map();
    const copies = objs.map((o) => {
      const c = structuredClone({ ...o, terrain: undefined });
      c.id = this.doc.newId(o.type);
      c.name = `${o.name} Copy`;
      if (o.terrain) c.terrain = cloneTerrain(o.terrain);
      if (o.groupId) {
        if (!groupMap.has(o.groupId)) groupMap.set(o.groupId, this.doc.newId('group') + `_${Date.now().toString(36)}`);
        c.groupId = groupMap.get(o.groupId);
      }
      if (c.type === 'road') {
        c.points = c.points.map((p) => ({ ...p, id: pointId() }));
        c.connections = [];
      }
      if (c.type === 'island' && !c.terrain) c.terrain = null;
      Object.assign(c, transformPatch(c, m));
      return c;
    });
    this.createObjects(copies, 'Duplicate');
    this.toast(`Duplicated ${copies.length} object(s)`);
  }

  selectAll() {
    const ids = [];
    for (const o of this.doc.objects()) if (this.isEditable(o)) ids.push(o.id);
    this.selection.set(ids);
  }

  // Move selected objects by (dx, dy) world units as one undoable step.
  nudge(dx, dy) {
    const objs = this.selectedObjects().filter((o) => this.isEditable(o));
    if (!objs.length) return;
    const m = translation(dx, dy);
    const patches = new Map(objs.map((o) => [o.id, transformPatch(o, m)]));
    this.finalizePatches(patches);
    this.execute(PatchCommand.from(this.doc, patches, 'Move', 'nudge'));
  }

  // Add derived fields (islandId, linked road points) to transform patches.
  finalizePatches(patches) {
    this.propagateRoadLinks(patches);
    for (const [id, patch] of patches) {
      const obj = this.doc.get(id);
      if (!obj || !('islandId' in obj)) continue;
      const next = this.islandIdFor({ ...obj, ...patch });
      if (next !== undefined && next !== obj.islandId) patch.islandId = next;
    }
    return patches;
  }

  groupSelection() {
    const objs = this.selectedObjects();
    if (objs.length < 2) { this.toast('Select at least two objects to group', 'warning'); return; }
    const gid = `GRP_${Date.now().toString(36).toUpperCase()}`;
    this.execute(PatchCommand.from(this.doc, objs.map((o) => [o.id, { groupId: gid }]), 'Group'));
    this.toast(`Grouped ${objs.length} objects`);
  }

  ungroupSelection() {
    const objs = this.selectedObjects().filter((o) => o.groupId);
    if (!objs.length) { this.toast('Selection has no groups', 'warning'); return; }
    this.execute(PatchCommand.from(this.doc, objs.map((o) => [o.id, { groupId: null }]), 'Ungroup'));
    this.toast(`Ungrouped ${objs.length} objects`);
  }

  align(mode) {
    const objs = this.selectedObjects().filter((o) => this.isEditable(o));
    if (objs.length < 2) { this.toast('Select at least two objects to align', 'warning'); return; }
    const all = this.selectionBounds(objs);
    const c = boundsCenter(all);
    const patches = new Map();
    for (const o of objs) {
      const b = getShapeBounds(o);
      let dx = 0; let dy = 0;
      if (mode === 'left') dx = all.minX - b.minX;
      if (mode === 'right') dx = all.maxX - b.maxX;
      if (mode === 'center') dx = c.x - (b.minX + b.maxX) / 2;
      if (mode === 'top') dy = all.minY - b.minY;
      if (mode === 'bottom') dy = all.maxY - b.maxY;
      if (mode === 'middle') dy = c.y - (b.minY + b.maxY) / 2;
      if (dx || dy) patches.set(o.id, transformPatch(o, translation(dx, dy)));
    }
    this.finalizePatches(patches);
    this.execute(PatchCommand.from(this.doc, patches, 'Align'));
  }

  moveSelectionToLayer(layerId) {
    const objs = this.selectedObjects();
    if (!objs.length) return;
    this.execute(PatchCommand.from(this.doc, objs.map((o) => [o.id, { layer: layerId }]), 'Change Layer'));
  }

  frameSelection() {
    const b = this.selectionBounds();
    if (b) this.camera.fitBounds(b, 120);
  }

  // Whole map: the world rectangle plus anything placed outside it.
  fitWorld() {
    const w = this.doc.world;
    let b = { minX: 0, minY: 0, maxX: w.width, maxY: w.height };
    for (const o of this.doc.objects()) b = unionBounds(b, getShapeBounds(o));
    this.camera.fitBounds(b, 40);
  }

  // Only the area that has objects (falls back to the whole map when empty).
  fitContent() {
    let b = null;
    for (const o of this.doc.objects()) b = b ? unionBounds(b, getShapeBounds(o)) : getShapeBounds(o);
    if (b) this.camera.fitBounds(b, 60); else this.fitWorld();
  }

  outlineOf(obj) { return outlineOf(obj); }

  // Create a building (Buildings category) or object/facility from an asset at world point p.
  placeAsset(asset, p, opts = {}) {
    if (!asset) return null;
    const pos = this.snap(p);
    const layerId = asset.category === 'Buildings' ? 'LYR_BUILDINGS' : null;
    const obj = asset.category === 'Buildings'
      ? createBuilding(this.doc.newId('building'), asset, pos.x, pos.y, opts)
      : createProp(this.doc.newId('prop'), asset, pos.x, pos.y, opts);
    if (!this.doc.layer(obj.layer)) obj.layer = layerId && this.doc.layer(layerId) ? layerId : this.doc.layers[this.doc.layers.length - 1].id;
    if (!this.layerEditable(obj.layer)) {
      this.toast(`Layer "${this.doc.layer(obj.layer)?.name}" is hidden or locked`, 'warning');
      return null;
    }
    obj.islandId = this.islandIdFor(obj) ?? null;
    this.createObjects([obj], 'Create');
    return obj;
  }
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
