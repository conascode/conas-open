// Select tool: click / shift-click / marquee selection, move, resize, rotate,
// and vertex editing for roads, bridges, areas and building hitboxes.
import { Tool } from './tool.js';
import { LiveEdit } from './live-edit.js';
import {
  isBoxType, transformPatch, roadPatch, editableVertices, moveVertexPatch, insertionPoint, insertVertexPatch, removeVertexPatch, getShapeBounds,
} from '../objects/shapes.js';
import { nearestCoastPoint } from '../objects/bridge.js';
import { closestRoadSegment } from '../objects/road.js';
import {
  boxCorners, worldToLocal, localToWorld, translation, rotationAbout, scaleAbout, dist, DEG, boundsContainsBounds, snapValue,
} from '../utils/geometry.js';
import { PatchCommand } from '../core/commands.js';
import { roadPoint } from '../data/defaults.js';
import { h } from '../utils/dom.js';
import { drawHandle, drawVertices, strokePts, drawHitbox, ACCENT } from '../renderer/overlay.js';

const MIN_WIDTH = 2;
const MAX_WIDTH = 400;
const HANDLE_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];
const RESIZE_CURSORS = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'];

export class SelectTool extends Tool {
  constructor(editor) {
    super(editor);
    this.state = null;
    this.activeVertex = null; // { id, key }
    this.hoverVertex = null;
  }

  get name() { return 'Select'; }
  get hint() {
    if (this.editor.hitboxEditId) return 'Hitbox: drag points · double-click edge to add · Alt+click point to remove';
    return 'Click to select · Shift+click add · drag to move · Ctrl+drag box-select · handles resize/rotate (Shift snaps) · double-click island = coastline';
  }

  deactivate() {
    if (this.state?.live) this.state.live.cancel();
    this.state = null;
  }

  editableSelection() {
    return this.editor.selectedObjects().filter((o) => this.editor.isEditable(o));
  }

  // Transform frame of the current selection: oriented for a single box object, axis-aligned otherwise.
  frame() {
    const objs = this.editableSelection();
    if (!objs.length || this.editor.hitboxEditId) return null;
    // A single road/bridge/area shows its editable points instead of a resize frame.
    if (objs.length === 1 && ['road', 'bridge', 'area'].includes(objs[0].type)) return null;
    let corners;
    let rotation = 0;
    let single = null;
    if (objs.length === 1 && isBoxType(objs[0])) {
      single = objs[0];
      corners = boxCorners(single);
      rotation = single.rotation;
    } else {
      const b = this.editor.selectionBounds(objs);
      corners = [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
    }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const handles = [corners[0], corners[1], corners[2], corners[3], mid(corners[0], corners[1]), mid(corners[1], corners[2]), mid(corners[2], corners[3]), mid(corners[3], corners[0])];
    const z = this.editor.camera.zoom;
    const up = { x: corners[0].x - corners[3].x, y: corners[0].y - corners[3].y };
    const ul = Math.hypot(up.x, up.y) || 1;
    const rot = { x: handles[4].x + (up.x / ul) * (28 / z), y: handles[4].y + (up.y / ul) * (28 / z) };
    const center = mid(corners[0], corners[2]);
    return { objs, corners, handles, rot, rotation, single, center };
  }

  vertexTarget() {
    const ed = this.editor;
    if (ed.hitboxEditId) {
      const o = this.doc.get(ed.hitboxEditId);
      return o && ed.isEditable(o) ? { obj: o, mode: 'hitbox' } : null;
    }
    if (ed.selection.size !== 1) return null;
    const o = this.doc.get(ed.selection.first);
    if (!o || !ed.isEditable(o) || !['road', 'bridge', 'area'].includes(o.type)) return null;
    return { obj: o, mode: 'shape' };
  }

  hitVertex(p) {
    const t = this.vertexTarget();
    if (!t) return null;
    const tol = this.editor.tol(8);
    let best = null;
    for (const v of editableVertices(t.obj, t.mode)) {
      const d = dist(v, p);
      if (d <= tol && (!best || d < best.d)) best = { ...v, d, id: t.obj.id, mode: t.mode };
    }
    return best;
  }

  hitHandle(screenPt) {
    const f = this.frame();
    if (!f) return null;
    const cam = this.editor.camera;
    const near = (p) => dist(cam.worldToScreen(p), screenPt) <= 8;
    if (near(f.rot)) return { kind: 'rotate', frame: f };
    for (let i = 0; i < 8; i++) if (near(f.handles[i])) return { kind: 'resize', index: i, frame: f };
    return null;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const ed = this.editor;
    const v = this.hitVertex(e.world);
    if (v) {
      if (e.alt) { this.removeVertex(v); return; }
      this.activeVertex = { id: v.id, key: v.key, mode: v.mode };
      this.state = { kind: 'vertex', v, start: e.world, live: new LiveEdit(ed), moved: false };
      this.requestOverlay();
      return;
    }
    this.activeVertex = null;
    const handle = this.hitHandle(e.screen);
    if (handle) {
      const live = new LiveEdit(ed);
      for (const o of handle.frame.objs) live.snapshot(o.id);
      this.state = { ...handle, start: e.world, live, startScreen: e.screen, moved: false };
      return;
    }
    // Ctrl+drag always draws a selection box, even on top of islands.
    const hit = e.ctrl ? null : ed.pick(e.world);
    if (hit) {
      const ids = ed.expandGroups([hit.id]);
      if (e.shift) ed.selection.toggle(ids);
      else if (!ed.selection.has(hit.id)) ed.selection.set(ids);
      if (!ed.selection.has(hit.id)) return;
      const objs = this.editableSelection();
      const live = new LiveEdit(ed);
      for (const o of objs) live.snapshot(o.id);
      this.state = { kind: 'move', start: e.world, startScreen: e.screen, objs, ref: hit, live, moved: false };
      return;
    }
    if (!e.shift && !e.ctrl) ed.selection.clear();
    this.state = { kind: 'marquee', start: e.world, current: e.world, additive: e.shift };
  }

  onPointerMove(e) {
    const s = this.state;
    if (!s) {
      const v = this.hitVertex(e.world);
      const hk = v?.key || null;
      if (hk !== this.hoverVertex) { this.hoverVertex = hk; this.requestOverlay(); }
      const h = v ? null : this.hitHandle(e.screen);
      this.editor.tools.canvas.style.cursor = v ? 'pointer' : h ? (h.kind === 'rotate' ? 'alias' : RESIZE_CURSORS[handleCursorIndex(h)]) : 'default';
      return;
    }
    if (s.kind === 'marquee') {
      s.current = e.world;
      this.requestOverlay();
      return;
    }
    if (!s.moved && s.startScreen && dist(s.startScreen, e.screen) < 3) return;
    s.moved = true;
    if (s.kind === 'move') s.live.step(() => this.movePatches(s, e));
    else if (s.kind === 'resize') s.live.step(() => this.resizePatches(s, e, true));
    else if (s.kind === 'rotate') s.live.step(() => this.rotatePatches(s, e, true));
    else if (s.kind === 'vertex') s.live.step(() => this.vertexPatches(s, e).patches);
    this.requestOverlay();
  }

  onPointerUp(e) {
    const s = this.state;
    this.state = null;
    if (!s) return;
    const ed = this.editor;
    if (s.kind === 'marquee') {
      const b = { minX: Math.min(s.start.x, s.current.x), minY: Math.min(s.start.y, s.current.y), maxX: Math.max(s.start.x, s.current.x), maxY: Math.max(s.start.y, s.current.y) };
      if (b.maxX - b.minX > ed.tol(3) || b.maxY - b.minY > ed.tol(3)) {
        const ids = [];
        for (const id of ed.renderer.spatial.query(b)) {
          const o = this.doc.get(id);
          if (o && ed.isEditable(o) && boundsContainsBounds(b, getShapeBounds(o))) ids.push(id);
        }
        const all = ed.expandGroups(ids);
        if (s.additive) ed.selection.add(all); else ed.selection.set(all);
      }
      this.requestOverlay();
      return;
    }
    if (!s.moved) { s.live.cancel(); this.requestOverlay(); return; }
    if (s.kind === 'move') s.live.commit(() => this.movePatches(s, e), 'Move');
    else if (s.kind === 'resize') s.live.commit(() => this.resizePatches(s, e, false), 'Resize');
    else if (s.kind === 'rotate') s.live.commit(() => this.rotatePatches(s, e, false), 'Rotate');
    else if (s.kind === 'vertex') {
      let result;
      s.live.commit(() => { result = this.vertexPatches(s, e, true); return result.patches; }, s.v.mode === 'hitbox' ? 'Modify Hitbox' : 'Modify Point');
    }
    this.requestOverlay();
  }

  // ---------- patch builders (always from originals) ----------

  movePatches(s, e) {
    const ed = this.editor;
    let dx = e.world.x - s.start.x;
    let dy = e.world.y - s.start.y;
    if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (ed.settings.snapToGrid) {
      const ref = s.live.original(s.ref.id);
      const g = this.doc.world.gridSize;
      const rx = isBoxType(ref) ? ref.x : getShapeBounds(ref).minX;
      const ry = isBoxType(ref) ? ref.y : getShapeBounds(ref).minY;
      dx = snapValue(rx + dx, g) - rx;
      dy = snapValue(ry + dy, g) - ry;
    }
    const m = translation(dx, dy);
    return new Map(s.objs.map((o) => [o.id, transformPatch(s.live.original(o.id), m, { live: true })]));
  }

  resizePatches(s, e, live) {
    const f = s.frame;
    const [hx, hy] = HANDLE_SIGNS[s.index];
    if (f.single) {
      // Resize in the object's local frame, keeping the opposite edge fixed.
      const o = s.live.original(f.single.id);
      const ax = o.anchorX ?? 0.5; const ay = o.anchorY ?? 0.5;
      const lp = worldToLocal(o, e.world);
      let left = -ax * o.width; let right = left + o.width;
      let top = -ay * o.height; let bottom = top + o.height;
      if (hx > 0) right = Math.max(left + 1, lp.x); else if (hx < 0) left = Math.min(right - 1, lp.x);
      if (hy > 0) bottom = Math.max(top + 1, lp.y); else if (hy < 0) top = Math.min(bottom - 1, lp.y);
      let w = right - left; let h = bottom - top;
      if (e.shift && hx && hy) {
        const k = Math.max(w / o.width, h / o.height);
        w = o.width * k; h = o.height * k;
        if (hx < 0) left = right - w; else right = left + w;
        if (hy < 0) top = bottom - h; else bottom = top + h;
      }
      const anchorLocal = { x: left + ax * w, y: top + ay * h };
      const p = localToWorld(o, anchorLocal);
      const patch = { x: p.x, y: p.y, width: w, height: h };
      if (o.hitbox) patch.hitbox = { type: o.hitbox.type, points: o.hitbox.points.map((q) => ({ x: q.x * (w / o.width), y: q.y * (h / o.height) })) };
      return new Map([[o.id, patch]]);
    }
    const c = f.corners;
    const minX = c[0].x; const minY = c[0].y; const maxX = c[2].x; const maxY = c[2].y;
    const pivot = { x: hx > 0 ? minX : hx < 0 ? maxX : (minX + maxX) / 2, y: hy > 0 ? minY : hy < 0 ? maxY : (minY + maxY) / 2 };
    const hpt = { x: hx > 0 ? maxX : minX, y: hy > 0 ? maxY : minY };
    let sx = hx ? (e.world.x - pivot.x) / (hpt.x - pivot.x || 1) : 1;
    let sy = hy ? (e.world.y - pivot.y) / (hpt.y - pivot.y || 1) : 1;
    if (e.shift || (hx && hy && f.objs.some((o) => !isBoxType(o)) && !e.alt)) {
      if (hx && hy) { const k = Math.max(Math.abs(sx), Math.abs(sy)); sx = k; sy = k; }
    }
    sx = Math.max(0.02, sx); sy = Math.max(0.02, sy);
    const m = scaleAbout(sx, sy, pivot);
    return new Map(f.objs.map((o) => [o.id, transformPatch(s.live.original(o.id), m, { live })]));
  }

  rotatePatches(s, e, live) {
    const f = s.frame;
    const c = f.center;
    let ang = Math.atan2(e.world.y - c.y, e.world.x - c.x) - Math.atan2(s.start.y - c.y, s.start.x - c.x);
    if (e.shift) ang = Math.round(ang / (15 * DEG)) * 15 * DEG;
    const m = rotationAbout(ang, c);
    return new Map(f.objs.map((o) => [o.id, transformPatch(s.live.original(o.id), m, { live })]));
  }

  // Vertex drag with snapping: road points snap to other roads, bridge ends snap to coastlines.
  vertexPatches(s, e, final = false) {
    const ed = this.editor;
    const o = s.live.original(s.v.id);
    let p = ed.snap(e.world);
    let extra = {};
    let link = null; // snapped onto another road's point
    let segLink = null; // snapped onto the middle of another road
    if (s.v.mode === 'shape' && o.type === 'road' && s.v.kind === 'vertex' && ed.settings.snapToObjects) {
      const snapPt = this.snapRoadPoint(o, e.world);
      if (snapPt) { p = { x: snapPt.x, y: snapPt.y }; link = snapPt; } else {
        const seg = this.snapRoadSegment(o, e.world);
        if (seg) { p = { x: seg.x, y: seg.y }; segLink = seg; }
      }
    }
    if (s.v.mode === 'shape' && o.type === 'bridge' && s.v.kind === 'endpoint') {
      const isl = this.nearestIsland(e.world, ed.tol(30));
      if (isl) {
        const c = nearestCoastPoint(isl.island, e.world);
        p = { x: c.x, y: c.y };
        extra = { [s.v.key === 'start' ? 'startIslandId' : 'endIslandId']: isl.island.id };
      }
    }
    const patch = { ...moveVertexPatch(o, s.v.key, p), ...extra };
    const patches = new Map([[o.id, patch]]);
    if (final && o.type === 'road' && (link || segLink)) {
      const pid = o.points[s.v.index].id;
      let target = link;
      if (segLink) {
        // Insert a junction point into the other road where the end was dropped.
        const other = this.doc.get(segLink.roadId);
        const np = roadPoint(p.x, p.y);
        const pts = other.points.slice();
        pts.splice(segLink.segment + 1, 0, np);
        patches.set(other.id, roadPatch(other, { points: pts }));
        target = { roadId: other.id, pointId: np.id };
      }
      if (!o.connections.some((c) => c.pointId === pid && c.roadId === target.roadId && c.targetPointId === target.pointId)) {
        patch.connections = [...o.connections, { pointId: pid, roadId: target.roadId, targetPointId: target.pointId }];
      }
    }
    s.snapHint = link || segLink || extra.startIslandId || extra.endIslandId ? p : null;
    return { patches };
  }

  // Nearest point on the centre line of another road (for T-junctions).
  snapRoadSegment(road, p) {
    let best = null;
    for (const id of this.editor.renderer.spatial.queryPoint(p, this.editor.tol(10) + 80)) {
      const r = this.doc.get(id);
      if (!r || r.type !== 'road' || r.id === road.id || !this.editor.isEditable(r)) continue;
      const c = closestRoadSegment(r, p);
      const tol = Math.max(this.editor.tol(10), r.width / 2);
      if (c && c.d <= tol && (!best || c.d < best.d)) best = { x: c.x, y: c.y, d: c.d, roadId: r.id, segment: c.segment };
    }
    return best;
  }

  snapRoadPoint(road, p) {
    const tol = this.editor.tol(10);
    let best = null;
    for (const id of this.editor.renderer.spatial.queryPoint(p, tol)) {
      const r = this.doc.get(id);
      if (!r || r.type !== 'road' || r.id === road.id) continue;
      for (const q of r.points) {
        const d = dist(q, p);
        if (d <= tol && (!best || d < best.d)) best = { x: q.x, y: q.y, d, roadId: r.id, pointId: q.id };
      }
    }
    return best;
  }

  nearestIsland(p, tol) {
    let best = null;
    for (const isl of this.doc.data.islands) {
      if (!isl.visible) continue;
      const c = nearestCoastPoint(isl, p);
      if (c.d <= tol && (!best || c.d < best.d)) best = { island: isl, d: c.d };
    }
    return best;
  }

  removeVertex(v) {
    const o = this.doc.get(v.id);
    const patch = removeVertexPatch(o, v.key, v.mode);
    if (typeof patch === 'string') { this.editor.toast(patch, 'warning'); return; }
    if (o.type === 'road' && v.kind === 'vertex') {
      const pid = o.points[v.index].id;
      patch.connections = o.connections.filter((c) => c.pointId !== pid);
    }
    this.editor.execute(PatchCommand.from(this.doc, [[o.id, patch]], 'Remove Point'));
    this.activeVertex = null;
    this.requestOverlay();
  }

  onDoubleClick(e) {
    const ed = this.editor;
    const t = this.vertexTarget();
    if (t) {
      const ins = insertionPoint(t.obj, e.world, t.mode);
      if (ins && ins.d <= ed.tol(14) + (t.obj.width && t.mode === 'shape' ? t.obj.width / 2 : 0)) {
        const patch = insertVertexPatch(t.obj, ins.index, ins.point, t.mode, (x, y) => roadPoint(x, y));
        if (patch) {
          ed.execute(PatchCommand.from(this.doc, [[t.obj.id, patch]], 'Add Point'));
          return;
        }
      }
    }
    const hit = ed.pick(e.world);
    if (hit?.type === 'island') {
      ed.selection.set([hit.id]);
      ed.tools.use('coastline');
      ed.toast('Coastline editing: drag vertices, double-click an edge to add one');
    }
  }

  // Selected objects when they are all roads/bridges (the ones that have a road/deck width).
  widthTargets() {
    const sel = this.editableSelection();
    return sel.length && sel.every((o) => o.type === 'road' || o.type === 'bridge') ? sel : null;
  }

  setWidth(objs, value) {
    const v = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));
    const ids = objs.map((o) => o.id);
    this.editor.execute(PatchCommand.from(this.doc, ids.map((id) => [id, { width: v }]), 'Road Width', `width:${ids.join(',')}`));
    this.requestOverlay();
    return v;
  }

  // Tool option bar: width control for selected roads / bridges.
  options() {
    const objs = this.widthTargets();
    if (!objs) return null;
    const cur = objs[0].width;
    const mixed = objs.some((o) => o.width !== cur);
    const range = h('input', { type: 'range', class: 'range', min: MIN_WIDTH, max: 200, step: 1, value: Math.min(200, cur), 'aria-label': 'Width' });
    const num = h('input', { type: 'number', class: 'input num', min: MIN_WIDTH, max: MAX_WIDTH, step: 1, value: mixed ? '' : cur, placeholder: 'mixed', style: { width: '70px' }, 'aria-label': 'Width in pixels' });
    const sync = (v) => { range.value = Math.min(200, v); num.value = v; };
    range.addEventListener('input', () => sync(this.setWidth(objs, Number(range.value))));
    range.addEventListener('change', () => this.editor.history.seal());
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (Number.isFinite(v) && v > 0) sync(this.setWidth(objs, v));
      this.editor.history.seal();
    });
    const step = (d) => h('button', { class: 'btn small', title: d < 0 ? 'Narrower ([)' : 'Wider (])', onclick: () => { sync(this.setWidth(objs, Number(num.value || cur) + d)); this.editor.history.seal(); } }, d < 0 ? '−' : '+');
    const kind = objs.every((o) => o.type === 'bridge') ? 'Deck width' : 'Road width';
    return h('div', { class: 'opts' },
      h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, `${kind}${objs.length > 1 ? ` (${objs.length})` : ''}`), step(-2), range, step(2), num, h('span', { class: 'muted small' }, 'px')),
      h('span', { class: 'tool-hint' }, '[ / ] = narrower / wider'));
  }

  onKeyDown(e) {
    // [ / ] narrower / wider; with Shift the keys arrive as { / } and step 10px.
    if (['[', ']', '{', '}'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
      const objs = this.widthTargets();
      if (objs) {
        const wider = e.key === ']' || e.key === '}';
        this.setWidth(objs, objs[0].width + (wider ? 2 : -2) * (e.shiftKey ? 5 : 1));
        this.editor.history.seal();
        this.editor.emit('tool-options');
        return true;
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.activeVertex) {
      const t = this.vertexTarget();
      if (t && t.obj.id === this.activeVertex.id) {
        const v = editableVertices(t.obj, t.mode).find((q) => q.key === this.activeVertex.key);
        if (v) { this.removeVertex({ ...v, id: t.obj.id, mode: t.mode }); return true; }
      }
    }
    return false;
  }

  cancel() {
    if (this.state?.live) { this.state.live.cancel(); this.state = null; return true; }
    if (this.editor.hitboxEditId) { this.editor.setHitboxEdit(null); return true; }
    if (this.activeVertex) { this.activeVertex = null; this.requestOverlay(); return true; }
    return false;
  }

  drawOverlay(g, zoom) {
    const ed = this.editor;
    const s = this.state;
    if (s?.kind === 'marquee') {
      const x = Math.min(s.start.x, s.current.x); const y = Math.min(s.start.y, s.current.y);
      g.rect(x, y, Math.abs(s.current.x - s.start.x), Math.abs(s.current.y - s.start.y))
        .fill({ color: ACCENT, alpha: 0.08 }).stroke({ width: 1 / zoom, color: ACCENT, alpha: 0.9 });
    }
    if (ed.hitboxEditId) {
      const o = this.doc.get(ed.hitboxEditId);
      if (o) drawHitbox(g, o, zoom);
    }
    const t = this.vertexTarget();
    if (t) drawVertices(g, editableVertices(t.obj, t.mode), zoom, this.activeVertex?.key, this.hoverVertex);
    if (s?.snapHint) g.circle(s.snapHint.x, s.snapHint.y, 10 / zoom).stroke({ width: 2 / zoom, color: 0x4cbf7a });
    const f = this.frame();
    if (!f || s?.kind === 'marquee') return;
    strokePts(g, f.corners, true, 1 / zoom, ACCENT, 0.9);
    strokePts(g, [f.handles[4], f.rot], false, 1 / zoom, ACCENT, 0.9);
    for (const hp of f.handles) drawHandle(g, hp, zoom, { size: 8, fill: 0xffffff, color: ACCENT });
    drawHandle(g, f.rot, zoom, { size: 10, fill: ACCENT, color: 0xffffff, shape: 'circle' });
  }
}

function handleCursorIndex(h) {
  if (h.kind !== 'resize') return 0;
  // rotate cursor choice with the frame rotation
  const step = Math.round(((h.frame.rotation % 180) + 180) / 45) % 4;
  const order = [0, 4, 1, 5]; // nwse, ns, nesw, ew sequence
  const base = { 0: 0, 2: 0, 1: 2, 3: 2, 4: 1, 6: 1, 5: 3, 7: 3 }[h.index];
  const map = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];
  return RESIZE_CURSORS.indexOf(map[(base + step) % 4]) >= 0 ? RESIZE_CURSORS.indexOf(map[(base + step) % 4]) : order[0];
}
