// Inspector: edits every property of the selected object(s). Inputs validate before applying,
// apply live (merged into one undo step per field), and refresh when the object changes elsewhere.
import { h, icon, refreshIcons } from '../utils/dom.js';
import { PatchCommand, SectionCommand } from '../core/commands.js';
import { transformPatch, isBoxType, getShapeBounds } from '../objects/shapes.js';
import { bridgeStatus, nearestCoastPoint } from '../objects/bridge.js';
import { terrainUsage } from '../objects/terrain.js';
import { rectHitbox } from '../data/defaults.js';
import { roadMeta } from '../objects/road.js';
import { bridgeMeta } from '../objects/bridge.js';
import {
  ISLAND_TYPES, TERRAIN_MATERIALS, COASTLINE_TYPES, ROAD_TYPES, ROAD_SURFACES, ROAD_DIRECTIONS, CURVE_MODES,
  BRIDGE_TYPES, BUILDING_TYPES, HITBOX_TYPES, AREA_TYPES,
} from '../data/constants.js';
import { translation, scaleAbout, rotationAbout, DEG, boundsCenter, catmullRomHandles, convexHull, round } from '../utils/geometry.js';

const TYPE_LABEL = { island: 'Island', road: 'Road', bridge: 'Bridge', building: 'Building', prop: 'Object', area: 'Area' };
const TYPE_ICON = { island: 'land-plot', road: 'route', bridge: 'rainbow', building: 'building-2', prop: 'box', area: 'square-dashed' };

export class Inspector {
  constructor(editor, root) {
    this.editor = editor;
    this.doc = editor.doc;
    this.root = root;
    this.fields = [];
    this.currentKey = '';
    editor.on('selection', () => this.render());
    editor.on('project', () => this.render());
    editor.on('hitbox-edit', () => this.render());
    this.doc.on('update', ({ obj, collection }) => {
      if (this.editor.selection.has(obj.id)) this.refresh();
      else if (collection === 'layers' || collection === 'islands' || collection === 'assets') this.renderSoon();
    });
    this.doc.on('section', () => { if (!this.editor.selection.size) this.refresh(); });
    this.doc.on('add', ({ collection }) => { if (['layers', 'islands', 'assets'].includes(collection)) this.renderSoon(); });
    this.doc.on('remove', ({ collection }) => { if (['layers', 'islands', 'assets'].includes(collection)) this.renderSoon(); });
    this.doc.on('terrain', ({ id }) => { if (this.editor.selection.has(id)) this.refresh(); });
    this.render();
  }

  renderSoon() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.render(), 30);
  }

  // ---------- field builders ----------

  field(label, input, { error = true, wide = false } = {}) {
    const err = h('div', { class: 'field-error' });
    const row = h('div', { class: `prop${wide ? ' wide' : ''}` }, h('label', { class: 'prop-label' }, label), h('div', { class: 'prop-input' }, input, error ? err : null));
    return { row, err };
  }

  // spec: { key, label, kind: 'text'|'number'|'select'|'checkbox'|'textarea'|'color'|'readonly', get(obj), set(obj, value) -> patch|string(error), options, min, max, step, integer }
  build(spec) {
    let input;
    const commit = () => this.editor.history.seal();
    switch (spec.kind) {
      case 'readonly':
        input = h('div', { class: 'readonly' });
        break;
      case 'select':
        input = h('select', { class: 'input' });
        break;
      case 'checkbox':
        input = h('input', { type: 'checkbox' });
        break;
      case 'textarea':
        input = h('textarea', { class: 'input', rows: 3 });
        break;
      case 'color':
        input = h('input', { type: 'color', class: 'input color' });
        break;
      case 'number':
        input = h('input', { type: 'number', class: 'input num', step: spec.step ?? 'any' });
        break;
      default:
        input = h('input', { type: 'text', class: 'input' });
    }
    const { row, err } = this.field(spec.label, input, { wide: spec.kind === 'textarea' });
    const f = { spec, input, err, row };
    if (spec.kind !== 'readonly') {
      const evt = spec.kind === 'checkbox' || spec.kind === 'select' ? 'change' : 'input';
      input.addEventListener(evt, () => this.apply(f));
      input.addEventListener('change', commit);
      input.addEventListener('blur', () => { commit(); this.refreshField(f, true); });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // keep editor shortcuts from firing while typing
        if (e.key === 'Enter' && spec.kind !== 'textarea') input.blur();
        if (e.key === 'Escape') input.blur();
      });
    }
    this.fields.push(f);
    return row;
  }

  readValue(f) {
    const { spec, input } = f;
    if (spec.kind === 'checkbox') return input.checked;
    if (spec.kind === 'number') {
      if (input.value.trim() === '') return { error: 'Required' };
      const v = Number(input.value);
      if (!Number.isFinite(v)) return { error: 'Must be a number' };
      if (spec.integer && !Number.isInteger(v)) return { error: 'Must be a whole number' };
      if (spec.min !== undefined && v < spec.min) return { error: `Must be ≥ ${spec.min}` };
      if (spec.max !== undefined && v > spec.max) return { error: `Must be ≤ ${spec.max}` };
      return v;
    }
    if (spec.kind === 'select' && spec.nullable && input.value === '') return null;
    return input.value;
  }

  apply(f) {
    const v = this.readValue(f);
    if (v && typeof v === 'object' && v.error) return this.showError(f, v.error);
    if (f.spec.validate) {
      const msg = f.spec.validate(v);
      if (msg) return this.showError(f, msg);
    }
    const target = f.spec.target ? f.spec.target() : this.doc.get(this.editor.selection.first);
    const result = f.spec.set(target, v);
    if (typeof result === 'string') return this.showError(f, result);
    this.showError(f, '');
    if (!result) return;
    const mergeKey = `${f.spec.key}:${this.currentKey}`;
    if (result instanceof Map || Array.isArray(result)) {
      this.editor.execute(PatchCommand.from(this.doc, result, f.spec.label === 'Layer' ? 'Change Layer' : labelFor(f.spec.key), mergeKey));
    } else if (result.section) {
      this.editor.execute(Object.assign(new SectionCommand(this.doc, result.section, result.patch, 'Project Settings'), { mergeKey, merge: () => false }));
    } else {
      this.editor.execute(PatchCommand.from(this.doc, [[target.id, result]], labelFor(f.spec.key), mergeKey));
    }
    this.editor.requestOverlay();
  }

  showError(f, msg) {
    f.err.textContent = msg;
    f.row.classList.toggle('invalid', !!msg);
  }

  refreshField(f, force = false) {
    const { spec, input } = f;
    if (!force && document.activeElement === input) return;
    const target = spec.target ? spec.target() : this.doc.get(this.editor.selection.first);
    if (!target) return;
    const v = spec.get(target);
    if (spec.kind === 'checkbox') input.checked = !!v;
    else if (spec.kind === 'readonly') input.textContent = v ?? '—';
    else if (spec.kind === 'number') input.value = v === undefined || v === null ? '' : String(round(v, 2));
    else if (spec.kind === 'select') {
      if (spec.options) {
        const opts = typeof spec.options === 'function' ? spec.options(target) : spec.options;
        const key = JSON.stringify(opts);
        if (input._opts !== key) {
          input._opts = key;
          input.replaceChildren(...opts.map((o) => {
            const [val, text] = Array.isArray(o) ? o : [o, o];
            return h('option', { value: val ?? '' }, text);
          }));
        }
      }
      input.value = v ?? '';
    } else input.value = v ?? '';
    if (force) this.showError(f, '');
  }

  refresh() {
    for (const f of this.fields) this.refreshField(f);
    this.refreshExtras?.();
  }

  // ---------- render ----------

  render() {
    const ed = this.editor;
    this.fields = [];
    this.refreshExtras = null;
    const objs = ed.selectedObjects();
    this.currentKey = objs.map((o) => o.id).join(',') || 'project';
    let content;
    if (!this.doc.data) content = h('div', { class: 'empty' }, 'No project');
    else if (objs.length === 0) content = this.renderProject();
    else if (objs.length === 1) content = this.renderObject(objs[0]);
    else content = this.renderMulti(objs);
    this.root.replaceChildren(content);
    this.refresh();
    refreshIcons(this.root);
  }

  section(title, ...rows) {
    return h('section', { class: 'insp-section' }, h('h3', {}, title), ...rows.flat().filter(Boolean));
  }

  renderProject() {
    const sec = (section, key) => ({ target: () => this.doc.data[section], get: (o) => o[key] });
    return h('div', {},
      h('div', { class: 'insp-head' }, icon('globe'), h('div', {}, h('div', { class: 'insp-title' }, 'Project'), h('div', { class: 'insp-sub' }, 'Nothing selected'))),
      this.section('Project',
        this.build({ key: 'project.id', label: 'Project ID', kind: 'readonly', ...sec('project', 'id') }),
        this.build({ key: 'project.name', label: 'Name', kind: 'text', ...sec('project', 'name'), validate: (v) => (v.trim() ? '' : 'Required'), set: (o, v) => ({ section: 'project', patch: { name: v } }) }),
        this.build({ key: 'project.version', label: 'Version', kind: 'readonly', ...sec('project', 'version') }),
        this.build({ key: 'project.updatedAt', label: 'Updated', kind: 'readonly', ...sec('project', 'updatedAt') })),
      this.section('World',
        this.build({ key: 'world.width', label: 'Width', kind: 'number', min: 1000, max: 200000, ...sec('world', 'width'), set: (o, v) => ({ section: 'world', patch: { width: v } }) }),
        this.build({ key: 'world.height', label: 'Height', kind: 'number', min: 1000, max: 200000, ...sec('world', 'height'), set: (o, v) => ({ section: 'world', patch: { height: v } }) }),
        this.build({ key: 'world.background', label: 'Ocean', kind: 'color', ...sec('world', 'background'), set: (o, v) => ({ section: 'world', patch: { background: v.toUpperCase() } }) }),
        this.build({ key: 'world.gridSize', label: 'Grid size', kind: 'number', min: 4, max: 4096, integer: true, ...sec('world', 'gridSize'), set: (o, v) => ({ section: 'world', patch: { gridSize: v } }) })),
      this.section('Statistics', this.statsBlock()),
    );
  }

  statsBlock() {
    const d = this.doc.data;
    const rows = [['Islands', d.islands.length], ['Roads', d.roads.length], ['Bridges', d.bridges.length], ['Buildings', d.buildings.length], ['Facilities', d.facilities.length], ['Objects', d.objects.length], ['Assets', d.assets.length], ['Layers', d.layers.length]];
    return h('div', { class: 'stats' }, rows.map(([k, v]) => h('div', { class: 'stat' }, h('span', {}, k), h('b', {}, String(v)))));
  }

  renderMulti(objs) {
    const ed = this.editor;
    const layerOpts = () => [['', '— mixed —'], ...this.doc.layers.map((l) => [l.id, l.name])];
    const counts = {};
    for (const o of objs) counts[o.type] = (counts[o.type] || 0) + 1;
    const all = (k) => objs.map((o) => [o.id, k]);
    const btn = (label, ico, fn) => h('button', { class: 'btn small', onclick: fn, title: label }, icon(ico), label);
    return h('div', {},
      h('div', { class: 'insp-head' }, icon('layers-2'), h('div', {}, h('div', { class: 'insp-title' }, `${objs.length} objects selected`),
        h('div', { class: 'insp-sub' }, Object.entries(counts).map(([t, n]) => `${n} ${TYPE_LABEL[t] || t}`).join(' · ')))),
      this.section('Common',
        this.build({
          key: 'layer', label: 'Layer', kind: 'select', options: layerOpts, target: () => objs[0],
          get: () => (objs.every((o) => o.layer === objs[0].layer) ? objs[0].layer : ''),
          set: (o, v) => (v ? objs.map((x) => [x.id, { layer: v }]) : null),
        }),
        this.build({ key: 'visible', label: 'Visible', kind: 'checkbox', target: () => objs[0], get: () => objs.every((o) => o.visible), set: (o, v) => all({ visible: v }) }),
        this.build({ key: 'locked', label: 'Locked', kind: 'checkbox', target: () => objs[0], get: () => objs.every((o) => o.locked), set: (o, v) => all({ locked: v }) })),
      this.section('Arrange',
        h('div', { class: 'btn-grid' },
          btn('Left', 'align-start-vertical', () => ed.align('left')), btn('Center', 'align-center-vertical', () => ed.align('center')), btn('Right', 'align-end-vertical', () => ed.align('right')),
          btn('Top', 'align-start-horizontal', () => ed.align('top')), btn('Middle', 'align-center-horizontal', () => ed.align('middle')), btn('Bottom', 'align-end-horizontal', () => ed.align('bottom'))),
        h('div', { class: 'btn-row' }, btn('Group', 'group', () => ed.groupSelection()), btn('Ungroup', 'ungroup', () => ed.ungroupSelection()),
          btn('Duplicate', 'copy', () => ed.duplicateSelection()), btn('Delete', 'trash-2', () => ed.deleteSelection()))),
    );
  }

  renderObject(o) {
    const ed = this.editor;
    const editable = ed.isEditable(o) || o.locked;
    const layerOpts = () => this.doc.layers.map((l) => [l.id, l.name]);
    const islandOpts = () => [['', '— none —'], ...this.doc.data.islands.map((i) => [i.id, `${i.name} (${i.id})`])];
    const center = () => boundsCenter(getShapeBounds(this.doc.get(o.id)));
    const path = o.type === 'road' || o.type === 'bridge';
    const poly = o.type === 'island' || o.type === 'area';

    const transform = [
      this.build({
        key: 'x', label: 'Position X', kind: 'number', get: (t) => t.x,
        set: (t, v) => (isBoxType(t) ? { x: v } : transformPatch(t, translation(v - t.x, 0))),
      }),
      this.build({
        key: 'y', label: 'Position Y', kind: 'number', get: (t) => t.y,
        set: (t, v) => (isBoxType(t) ? { y: v } : transformPatch(t, translation(0, v - t.y))),
      }),
      this.build({
        key: 'width', label: path ? (o.type === 'road' ? 'Road width' : 'Deck width') : 'Width', kind: 'number', min: 1, get: (t) => t.width,
        set: (t, v) => {
          if (v <= 0) return 'Must be greater than 0';
          if (isBoxType(t)) return { width: v, hitbox: t.hitbox ? scaleHb(t.hitbox, v / t.width, 1) : undefined };
          if (poly) { const c = center(); return transformPatch(t, scaleAbout(v / t.width, 1, c)); }
          return { width: v };
        },
      }),
      this.build(path
        ? { key: 'length', label: 'Length', kind: 'readonly', get: (t) => `${round(t.height, 1)} px` }
        : {
          key: 'height', label: 'Height', kind: 'number', min: 1, get: (t) => t.height,
          set: (t, v) => {
            if (v <= 0) return 'Must be greater than 0';
            if (isBoxType(t)) return { height: v, hitbox: t.hitbox ? scaleHb(t.hitbox, 1, v / t.height) : undefined };
            const c = center(); return transformPatch(t, scaleAbout(1, v / t.height, c));
          },
        }),
      this.build({
        key: 'rotation', label: 'Rotation°', kind: 'number', min: -360, max: 360, get: (t) => t.rotation,
        set: (t, v) => (isBoxType(t) ? { rotation: v } : transformPatch(t, rotationAbout((v - t.rotation) * DEG, center()))),
      }),
    ];
    // Strip undefined hitbox keys.
    for (const f of this.fields) {
      const orig = f.spec.set;
      if (orig) f.spec.set = (t, v) => { const r = orig(t, v); if (r && typeof r === 'object' && !(r instanceof Map) && !Array.isArray(r)) for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k]; return r; };
    }

    const common = [
      this.build({ key: 'id', label: 'Object ID', kind: 'readonly', get: (t) => t.id }),
      this.build({ key: 'name', label: 'Name', kind: 'text', get: (t) => t.name, validate: (v) => (v.length > 200 ? 'Too long' : ''), set: (t, v) => ({ name: v }) }),
      this.build({ key: 'type', label: 'Type', kind: 'readonly', get: (t) => TYPE_LABEL[t.type] || t.type }),
      this.build({ key: 'layer', label: 'Layer', kind: 'select', options: layerOpts, get: (t) => t.layer, validate: (v) => (this.doc.layer(v) ? '' : 'Layer does not exist'), set: (t, v) => ({ layer: v }) }),
      this.build({ key: 'visible', label: 'Visible', kind: 'checkbox', get: (t) => t.visible, set: (t, v) => ({ visible: v }) }),
      this.build({ key: 'locked', label: 'Locked', kind: 'checkbox', get: (t) => t.locked, set: (t, v) => ({ locked: v }) }),
      o.groupId ? this.build({ key: 'groupId', label: 'Group', kind: 'readonly', get: (t) => t.groupId }) : null,
    ];

    const specific = this.specific(o, { islandOpts });
    const lockNote = o.locked ? h('div', { class: 'note warn' }, icon('lock'), 'Locked — unlock to edit on the canvas') : null;
    const node = h('div', { class: editable ? '' : 'disabled' },
      h('div', { class: 'insp-head' }, icon(TYPE_ICON[o.type] || 'box'),
        h('div', {}, h('div', { class: 'insp-title' }, o.name || o.id), h('div', { class: 'insp-sub' }, `${TYPE_LABEL[o.type]} · ${o.id}`))),
      lockNote,
      this.section('General', common),
      this.section('Transform', transform),
      specific);
    return node;
  }

  specific(o, { islandOpts }) {
    const ed = this.editor;
    const sel = (key, label, options, extra = {}) => this.build({ key, label, kind: 'select', options, get: (t) => t[key], set: (t, v) => ({ [key]: v }), ...extra });
    const islandRef = (key, label) => this.build({
      key, label, kind: 'select', options: islandOpts, nullable: true, get: (t) => t[key] ?? '',
      validate: (v) => (v === null || this.doc.island(v) ? '' : 'Island does not exist'),
      set: (t, v) => ({ [key]: v }),
    });
    switch (o.type) {
      case 'island': {
        const usage = h('div', { class: 'terrain-usage' });
        this.refreshExtras = () => {
          const t = this.doc.get(o.id);
          if (!t) return;
          const u = terrainUsage(t.terrain);
          usage.replaceChildren(...(u.size
            ? [...u.entries()].map(([v, n]) => h('span', { class: 'chip' }, `${TERRAIN_MATERIALS[v - 1]} ${n}`))
            : [h('span', { class: 'muted' }, t.terrain ? 'No painted cells' : 'Not painted yet (uses base texture)')]));
        };
        return [
          this.section('Island',
            sel('islandType', 'Island type', ISLAND_TYPES),
            sel('texture', 'Base texture', TERRAIN_MATERIALS),
            this.build({ key: 'elevation', label: 'Elevation', kind: 'number', min: -1000, max: 10000, get: (t) => t.elevation, set: (t, v) => ({ elevation: v }) }),
            this.build({ key: 'vertices', label: 'Vertices', kind: 'readonly', get: (t) => String(t.polygon.length) })),
          this.section('Coastline',
            this.build({ key: 'coast.type', label: 'Default type', kind: 'select', options: COASTLINE_TYPES, get: (t) => t.coastline.type, set: (t, v) => ({ coastline: { ...t.coastline, type: v } }) }),
            this.build({ key: 'coast.width', label: 'Width', kind: 'number', min: 0, max: 200, get: (t) => t.coastline.width, set: (t, v) => ({ coastline: { ...t.coastline, width: v } }) }),
            this.build({ key: 'coast.custom', label: 'Painted edges', kind: 'readonly', get: (t) => `${t.coastline.edgeTypes.filter(Boolean).length} / ${t.coastline.edgeTypes.length}` }),
            h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => ed.tools.use('coastline') }, icon('spline'), 'Edit coastline'),
              h('button', { class: 'btn small', onclick: () => { const t = this.doc.get(o.id); ed.setProps(o.id, { coastline: { ...t.coastline, edgeTypes: t.coastline.edgeTypes.map(() => null) } }, 'Reset Coastline'); } }, icon('rotate-ccw'), 'Reset edges'))),
          this.section('Terrain', usage,
            h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => ed.tools.use('terrain') }, icon('paintbrush'), 'Paint terrain'),
              h('button', { class: 'btn small', onclick: () => { if (this.doc.get(o.id).terrain) ed.setProps(o.id, { terrain: null }, 'Clear Terrain'); } }, icon('eraser'), 'Clear terrain'))),
        ];
      }
      case 'area':
        return this.section('Area',
          sel('areaType', 'Area type', AREA_TYPES),
          this.build({ key: 'color', label: 'Color', kind: 'color', get: (t) => t.color, set: (t, v) => ({ color: v.toUpperCase() }) }),
          islandRef('islandId', 'Island'),
          this.build({ key: 'description', label: 'Description', kind: 'textarea', get: (t) => t.description, set: (t, v) => ({ description: v }) }),
          this.build({ key: 'vertices', label: 'Vertices', kind: 'readonly', get: (t) => String(t.polygon.length) }));
      case 'road':
        return this.section('Road',
          sel('roadType', 'Road type', ROAD_TYPES),
          this.build({
            key: 'curve', label: 'Curve', kind: 'select', options: CURVE_MODES, get: (t) => t.curve,
            set: (t, v) => {
              const patch = { curve: v };
              if (v === 'Bezier' && t.points.every((p) => !p.hx && !p.hy)) {
                const hs = catmullRomHandles(t.points);
                patch.points = t.points.map((p, i) => ({ ...p, hx: hs[i].x, hy: hs[i].y }));
              }
              return { ...patch, ...roadMeta({ ...t, ...patch }) };
            },
          }),
          this.build({ key: 'lanes', label: 'Lanes', kind: 'number', min: 0, max: 16, integer: true, get: (t) => t.lanes, set: (t, v) => ({ lanes: v }) }),
          sel('direction', 'Direction', ROAD_DIRECTIONS),
          sel('surface', 'Surface', ROAD_SURFACES),
          this.build({ key: 'speedLimit', label: 'Speed limit', kind: 'number', min: 0, max: 400, get: (t) => t.speedLimit, set: (t, v) => ({ speedLimit: v }) }),
          islandRef('islandId', 'Island'),
          this.build({ key: 'points', label: 'Points', kind: 'readonly', get: (t) => `${t.points.length} (${t.connections.length} junction${t.connections.length === 1 ? '' : 's'})` }),
          h('p', { class: 'muted small' }, 'Select tool: drag points, double-click the road to add one, Alt+click a point to remove it.'));
      case 'bridge': {
        const statusBox = h('div', { class: 'status-box' });
        this.refreshExtras = () => {
          const t = this.doc.get(o.id);
          if (!t) return;
          const st = bridgeStatus(t, (id) => this.doc.island(id));
          statusBox.className = `status-box ${st.status}`;
          statusBox.replaceChildren(
            h('div', { class: 'status-title' }, icon(st.status === 'connected' ? 'circle-check' : 'alert-triangle'), st.status === 'connected' ? 'Connected' : 'Not connected'),
            ...st.problems.map((p) => h('div', { class: 'status-line' }, p)));
          refreshIcons(statusBox);
        };
        const pos = (key, axis) => this.build({
          key: `${key}.${axis}`, label: `${key === 'startPosition' ? 'Start' : 'End'} ${axis.toUpperCase()}`, kind: 'number',
          get: (t) => t[key][axis], set: (t, v) => { const np = { ...t[key], [axis]: v }; return { [key]: np, ...bridgeMeta({ ...t, [key]: np }) }; },
        });
        const endsDiffer = (key) => (v) => {
          const t = this.doc.get(o.id);
          const other = key === 'startIslandId' ? t.endIslandId : t.startIslandId;
          return v && v === other ? 'Start and end island must be different' : '';
        };
        const section = this.section('Bridge', statusBox,
          sel('bridgeType', 'Bridge type', BRIDGE_TYPES),
          this.build({ key: 'lanes', label: 'Lanes', kind: 'number', min: 0, max: 16, integer: true, get: (t) => t.lanes, set: (t, v) => ({ lanes: v }) }),
          islandRef('startIslandId', 'Start island'),
          islandRef('endIslandId', 'End island'),
          pos('startPosition', 'x'), pos('startPosition', 'y'), pos('endPosition', 'x'), pos('endPosition', 'y'),
          this.build({ key: 'cps', label: 'Control points', kind: 'readonly', get: (t) => String(t.controlPoints.length) }),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => this.snapBridgeEnds(o.id) }, icon('magnet'), 'Snap ends to coastline')));
        // Start and end must be different, existing islands.
        for (const f of this.fields) {
          if (f.spec.key !== 'startIslandId' && f.spec.key !== 'endIslandId') continue;
          const base = f.spec.validate;
          const differ = endsDiffer(f.spec.key);
          f.spec.validate = (v) => base(v) || differ(v);
        }
        return section;
      }
      case 'building': {
        const assetOpts = () => [['', '— none —'], ...this.doc.assets.filter((a) => a.category === 'Buildings').map((a) => [a.id, `${a.name} (${a.id})`])];
        const editing = ed.hitboxEditId === o.id;
        return [
          this.section('Building',
            sel('buildingType', 'Building type', BUILDING_TYPES),
            this.build({ key: 'assetId', label: 'Asset', kind: 'select', options: assetOpts, nullable: true, get: (t) => t.assetId ?? '', validate: (v) => (v === null || this.doc.asset(v) ? '' : 'Asset does not exist'), set: (t, v) => ({ assetId: v }) }),
            islandRef('islandId', 'Island'),
            this.build({ key: 'owner', label: 'Owner', kind: 'text', get: (t) => t.owner, set: (t, v) => ({ owner: v }) }),
            this.build({ key: 'address', label: 'Address', kind: 'text', get: (t) => t.address, set: (t, v) => ({ address: v }) }),
            this.build({ key: 'description', label: 'Description', kind: 'textarea', get: (t) => t.description, set: (t, v) => ({ description: v }) }),
            this.build({ key: 'investigatable', label: 'Investigatable', kind: 'checkbox', get: (t) => t.investigatable, set: (t, v) => ({ investigatable: v }) })),
          this.section('Hitbox',
            this.build({
              key: 'hitbox.type', label: 'Hitbox type', kind: 'select', options: HITBOX_TYPES, get: (t) => t.hitbox.type,
              set: (t, v) => this.hitboxFor(t, v),
            }),
            this.build({ key: 'hitbox.points', label: 'Points', kind: 'readonly', get: (t) => `${t.hitbox.points.length} (local coordinates)` }),
            h('div', { class: 'btn-row' },
              h('button', { class: `btn small${editing ? ' active' : ''}`, onclick: () => { ed.tools.use('select'); ed.setHitboxEdit(editing ? null : o.id); } }, icon('scan'), editing ? 'Done editing' : 'Edit hitbox'),
              h('button', { class: 'btn small', onclick: () => { const t = this.doc.get(o.id); ed.setProps(o.id, { hitbox: rectHitbox(t.width, t.height, t.anchorX, t.anchorY) }, 'Reset Hitbox'); } }, icon('rotate-ccw'), 'Reset'))),
        ];
      }
      case 'prop': {
        const assetOpts = () => this.doc.assets.filter((a) => a.category === o.category).map((a) => [a.id, `${a.name} (${a.id})`]);
        return this.section('Object',
          this.build({ key: 'category', label: 'Category', kind: 'readonly', get: (t) => t.category }),
          this.build({ key: 'assetId', label: 'Asset', kind: 'select', options: assetOpts, get: (t) => t.assetId, validate: (v) => (this.doc.asset(v) ? '' : 'Asset does not exist'), set: (t, v) => ({ assetId: v }) }),
          islandRef('islandId', 'Island'),
          this.build({ key: 'description', label: 'Description', kind: 'textarea', get: (t) => t.description, set: (t, v) => ({ description: v }) }));
      }
      default: return null;
    }
  }

  // Hitbox type changes: Rectangle resets to the image box, Polygon keeps points as an editable polygon,
  // Custom Shape traces the convex outline of the image's opaque pixels.
  hitboxFor(t, type) {
    if (type === 'Rectangle') return { hitbox: rectHitbox(t.width, t.height, t.anchorX, t.anchorY) };
    if (type === 'Polygon') {
      let pts = t.hitbox.points;
      if (t.hitbox.type === 'Rectangle') {
        // subdivide the rectangle so there are points to drag
        const out = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]; const b = pts[(i + 1) % pts.length];
          out.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
        pts = out;
      }
      return { hitbox: { type: 'Polygon', points: pts } };
    }
    const canvas = this.editor.renderer.assetTextures.canvasOf(t.assetId);
    if (!canvas) return 'Asset image is not loaded, cannot trace';
    const pts = traceAlpha(canvas);
    if (pts.length < 3) return 'Could not find opaque pixels in the image';
    const sx = t.width / canvas.width; const sy = t.height / canvas.height;
    const ox = -t.anchorX * t.width; const oy = -t.anchorY * t.height;
    return { hitbox: { type: 'Custom Shape', points: pts.map((p) => ({ x: round(ox + p.x * sx, 2), y: round(oy + p.y * sy, 2) })) } };
  }

  snapBridgeEnds(id) {
    const b = this.doc.get(id);
    const patch = {};
    const s = this.doc.island(b.startIslandId);
    const e = this.doc.island(b.endIslandId);
    if (s) { const c = nearestCoastPoint(s, b.startPosition); patch.startPosition = { x: c.x, y: c.y }; }
    if (e) { const c = nearestCoastPoint(e, b.endPosition); patch.endPosition = { x: c.x, y: c.y }; }
    if (!s && !e) { this.editor.toast('Set the start and end islands first', 'warning'); return; }
    this.editor.setProps(id, { ...patch, ...bridgeMeta({ ...b, ...patch }) }, 'Snap Bridge');
  }
}

function scaleHb(hb, sx, sy) {
  return { type: hb.type, points: hb.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) };
}

function labelFor(key) {
  if (key === 'x' || key === 'y') return 'Move';
  if (key === 'width' || key === 'height') return 'Resize';
  if (key === 'rotation') return 'Rotate';
  if (key === 'layer') return 'Change Layer';
  return 'Modify Property';
}

// Convex hull of opaque pixels (sampled on a coarse grid).
function traceAlpha(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor(Math.max(width, height) / 96));
  const pts = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] > 40) pts.push({ x, y }, { x: x + step, y }, { x, y: y + step }, { x: x + step, y: y + step });
    }
  }
  return convexHull(pts);
}
