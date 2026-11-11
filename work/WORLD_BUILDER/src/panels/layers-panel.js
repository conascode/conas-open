// Layer Manager and Object Hierarchy.
import { h, icon, refreshIcons, debounce } from '../utils/dom.js';
import { AddCommand, RemoveCommand, PatchCommand, MoveItemCommand, BatchCommand } from '../core/commands.js';
import { bridgeStatus } from '../objects/bridge.js';

export class LayersPanel {
  constructor(editor, root, ui) {
    this.editor = editor;
    this.doc = editor.doc;
    this.root = root;
    this.ui = ui;
    this.activeId = null;
    const rerender = debounce(() => this.render(), 50);
    this.doc.on('reset', () => this.render());
    this.doc.on('change', (c) => { if (c.collection === 'layers' || c.kind === 'add' || c.kind === 'remove' || (c.keys && c.keys.includes('layer'))) rerender(); });
    this.render();
  }

  counts() {
    const m = new Map();
    for (const o of this.doc.objects()) m.set(o.layer, (m.get(o.layer) || 0) + 1);
    return m;
  }

  setProp(layer, patch, label = 'Layer Property', merge = null) {
    this.editor.execute(PatchCommand.from(this.doc, [[layer.id, patch]], label, merge));
  }

  render() {
    if (!this.doc.data) return;
    const counts = this.counts();
    const layers = [...this.doc.layers].reverse(); // top of list = drawn last (on top)
    const list = h('div', { class: 'layer-list', role: 'list' }, layers.map((l) => this.row(l, counts.get(l.id) || 0)));
    const toolbar = h('div', { class: 'panel-toolbar' },
      h('button', { class: 'icon-btn', title: 'New layer', 'aria-label': 'New layer', onclick: () => this.addLayer() }, icon('plus')),
      h('button', { class: 'icon-btn', title: 'Move layer up', 'aria-label': 'Move layer up', onclick: () => this.moveActive(1) }, icon('arrow-up')),
      h('button', { class: 'icon-btn', title: 'Move layer down', 'aria-label': 'Move layer down', onclick: () => this.moveActive(-1) }, icon('arrow-down')),
      h('button', { class: 'icon-btn', title: 'Move selection to this layer', 'aria-label': 'Move selection to layer', onclick: () => this.moveSelectionHere() }, icon('folder-input')),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn danger', title: 'Delete layer', 'aria-label': 'Delete layer', onclick: () => this.deleteActive() }, icon('trash-2')));
    this.root.replaceChildren(toolbar, list);
    refreshIcons(this.root);
  }

  row(l, count) {
    const active = l.id === this.activeId;
    const name = h('span', { class: 'layer-name', title: 'Double-click to rename' }, l.name);
    name.addEventListener('dblclick', async () => {
      const v = await this.ui.prompt('Rename layer', 'Layer name', l.name);
      if (v) this.setProp(l, { name: v }, 'Rename Layer');
    });
    const opacity = h('input', {
      type: 'range', min: 0, max: 1, step: 0.05, value: l.opacity, class: 'range mini', title: `Opacity ${Math.round(l.opacity * 100)}%`, 'aria-label': `${l.name} opacity`,
      oninput: (e) => this.setProp(l, { opacity: Number(e.target.value) }, 'Layer Opacity', `opacity:${l.id}`),
      onchange: () => this.editor.history.seal(),
    });
    return h('div', {
      class: `layer-row${active ? ' active' : ''}${l.visible ? '' : ' hidden'}`, role: 'listitem',
      onclick: (e) => { if (e.target.closest('button, input')) return; this.activeId = l.id; this.render(); },
    },
    h('button', { class: 'icon-btn tiny', title: l.visible ? 'Hide' : 'Show', 'aria-label': `${l.visible ? 'Hide' : 'Show'} ${l.name}`, onclick: () => this.setProp(l, { visible: !l.visible }, l.visible ? 'Hide Layer' : 'Show Layer') }, icon(l.visible ? 'eye' : 'eye-off')),
    h('button', { class: `icon-btn tiny${l.locked ? ' on' : ''}`, title: l.locked ? 'Unlock' : 'Lock', 'aria-label': `${l.locked ? 'Unlock' : 'Lock'} ${l.name}`, onclick: () => this.setProp(l, { locked: !l.locked }, l.locked ? 'Unlock Layer' : 'Lock Layer') }, icon(l.locked ? 'lock' : 'lock-open')),
    name,
    h('span', { class: 'count' }, String(count)),
    opacity);
  }

  async addLayer() {
    const name = await this.ui.prompt('New layer', 'Layer name', `Layer ${this.doc.layers.length + 1}`);
    if (!name) return;
    const id = this.doc.newId('layer');
    const idx = this.activeId ? this.doc.layers.findIndex((l) => l.id === this.activeId) + 1 : this.doc.layers.length;
    this.editor.execute(new AddCommand(this.doc, [{ collection: 'layers', obj: { id, name, visible: true, locked: false, opacity: 1 }, index: idx }], 'Create Layer'));
    this.activeId = id;
    this.render();
  }

  moveActive(dir) {
    if (!this.activeId) { this.editor.toast('Click a layer first', 'warning'); return; }
    const i = this.doc.layers.findIndex((l) => l.id === this.activeId);
    const j = i + dir;
    if (j < 0 || j >= this.doc.layers.length) return;
    this.editor.execute(new MoveItemCommand(this.doc, this.activeId, j, 'Reorder Layer'));
  }

  moveSelectionHere() {
    if (!this.activeId) { this.editor.toast('Click a layer first', 'warning'); return; }
    if (!this.editor.selection.size) { this.editor.toast('Select objects first', 'warning'); return; }
    this.editor.moveSelectionToLayer(this.activeId);
  }

  async deleteActive() {
    const l = this.doc.layer(this.activeId);
    if (!l) { this.editor.toast('Click a layer first', 'warning'); return; }
    if (l.id === 'LYR_OCEAN') { this.editor.toast('The Ocean layer cannot be deleted', 'warning'); return; }
    if (this.doc.layers.length <= 1) { this.editor.toast('A project needs at least one layer', 'warning'); return; }
    const objs = [...this.doc.objects()].filter((o) => o.layer === l.id);
    const i = this.doc.layers.indexOf(l);
    const fallback = this.doc.layers[i - 1] || this.doc.layers[i + 1];
    if (objs.length && !(await this.ui.confirm('Delete layer', `"${l.name}" contains ${objs.length} object(s). They will be moved to "${fallback.name}".`, 'Delete layer'))) return;
    const cmds = [];
    if (objs.length) cmds.push(PatchCommand.from(this.doc, objs.map((o) => [o.id, { layer: fallback.id }]), 'Delete Layer'));
    cmds.push(new RemoveCommand(this.doc, [l.id], 'Delete Layer'));
    this.editor.execute(new BatchCommand(cmds, 'Delete Layer'));
    this.activeId = null;
  }
}

const ICONS = { island: 'land-plot', road: 'route', bridge: 'rainbow', building: 'building-2', prop: 'box', area: 'square-dashed' };
const CHILD_LIMIT = 150;

export class HierarchyPanel {
  constructor(editor, root) {
    this.editor = editor;
    this.doc = editor.doc;
    this.root = root;
    this.filter = '';
    this.expanded = new Set(['__bridges']);
    this.list = h('div', { class: 'tree', role: 'tree' });
    const search = h('input', { class: 'input search', placeholder: 'Filter objects…', 'aria-label': 'Filter objects', oninput: (e) => { this.filter = e.target.value.toLowerCase(); this.render(); } });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.replaceChildren(h('div', { class: 'panel-toolbar' }, h('div', { class: 'search-wrap' }, icon('search'), search)), this.list);
    const rerender = debounce(() => this.render(), 120);
    this.doc.on('reset', () => this.render());
    this.doc.on('change', (c) => {
      if (c.kind === 'terrain' || c.kind === 'section') return;
      if (c.kind === 'update' && c.keys && !c.keys.some((k) => ['name', 'islandId', 'visible', 'locked', 'startIslandId', 'endIslandId', 'polygon', 'startPosition', 'endPosition'].includes(k))) return;
      rerender();
    });
    editor.on('selection', () => this.markSelection());
  }

  // Selecting an island also expands it so its children are visible.
  markSelection() {
    let needRender = false;
    for (const id of this.editor.selection.ids) {
      const o = this.doc.get(id);
      if (o?.type === 'island' && !this.expanded.has(id)) { this.expanded.add(id); needRender = true; }
    }
    if (needRender) { this.render(); return; }
    for (const el of this.list.querySelectorAll('.tree-item')) el.classList.toggle('selected', this.editor.selection.has(el.dataset.id));
  }

  matches(o) {
    return !this.filter || o.name.toLowerCase().includes(this.filter) || o.id.toLowerCase().includes(this.filter);
  }

  item(o, depth, { expandable = false, count = 0, warn = false } = {}) {
    const sel = this.editor.selection.has(o.id);
    const open = this.expanded.has(o.id);
    const el = h('div', {
      class: `tree-item${sel ? ' selected' : ''}${o.visible ? '' : ' dim'}`, role: 'treeitem', dataset: { id: o.id },
      style: { paddingLeft: `${8 + depth * 14}px` },
      onclick: (e) => {
        if (e.target.closest('.twisty')) return;
        if (e.shiftKey) this.editor.selection.toggle([o.id]); else this.editor.selection.set([o.id]);
      },
      ondblclick: () => { this.editor.selection.set([o.id]); this.editor.frameSelection(); },
    },
    expandable ? h('button', { class: 'twisty', 'aria-label': open ? 'Collapse' : 'Expand', onclick: () => { if (open) this.expanded.delete(o.id); else this.expanded.add(o.id); this.render(); } }, icon(open ? 'chevron-down' : 'chevron-right')) : h('span', { class: 'twisty-pad' }),
    icon(ICONS[o.type] || 'box'),
    h('span', { class: 'tree-name' }, o.name || o.id),
    warn ? icon('alert-triangle', 'warn-icon') : null,
    o.locked ? icon('lock', 'muted-icon') : null,
    expandable ? h('span', { class: 'count' }, String(count)) : h('span', { class: 'tree-id' }, o.id));
    return el;
  }

  group(key, label, iconName, items, depth = 0) {
    const open = this.expanded.has(key);
    const head = h('div', { class: 'tree-group', style: { paddingLeft: `${8 + depth * 14}px` } },
      h('button', { class: 'twisty', 'aria-label': open ? 'Collapse' : 'Expand', onclick: () => { if (open) this.expanded.delete(key); else this.expanded.add(key); this.render(); } }, icon(open ? 'chevron-down' : 'chevron-right')),
      icon(iconName), h('span', { class: 'tree-name' }, label), h('span', { class: 'count' }, String(items.length)));
    return [head, ...(open ? this.limited(items.map((o) => this.item(o, depth + 1, { warn: o.type === 'bridge' && this.bridgeWarn(o) })), depth + 1) : [])];
  }

  limited(nodes, depth) {
    if (nodes.length <= CHILD_LIMIT) return nodes;
    return [...nodes.slice(0, CHILD_LIMIT), h('div', { class: 'tree-more', style: { paddingLeft: `${22 + depth * 14}px` } }, `… ${nodes.length - CHILD_LIMIT} more (use the filter)`)];
  }

  bridgeWarn(b) {
    return bridgeStatus(b, (id) => this.doc.island(id)).status === 'warning';
  }

  render() {
    if (!this.doc.data) return;
    const d = this.doc.data;
    const byIsland = new Map(d.islands.map((i) => [i.id, []]));
    const unassigned = [];
    for (const key of ['roads', 'buildings', 'facilities', 'objects']) {
      for (const o of d[key]) {
        if (!this.matches(o)) continue;
        const list = o.islandId && byIsland.get(o.islandId);
        if (list) list.push(o); else unassigned.push(o);
      }
    }
    const nodes = [];
    for (const isl of d.islands) {
      const kids = byIsland.get(isl.id);
      if (!this.matches(isl) && !kids.length) continue;
      nodes.push(this.item(isl, 0, { expandable: true, count: kids.length }));
      if (this.expanded.has(isl.id) || (this.filter && kids.length)) nodes.push(...this.limited(kids.map((o) => this.item(o, 1)), 1));
    }
    const bridges = d.bridges.filter((b) => this.matches(b));
    if (bridges.length) nodes.push(...this.group('__bridges', 'Bridges', 'rainbow', bridges));
    if (unassigned.length) nodes.push(...this.group('__unassigned', 'Not on an island', 'circle-dashed', unassigned));
    if (!nodes.length) nodes.push(h('div', { class: 'empty small' }, this.filter ? 'No matches' : 'No objects yet — create an island with the Island tool'));
    this.list.replaceChildren(...nodes);
    refreshIcons(this.list);
  }
}
