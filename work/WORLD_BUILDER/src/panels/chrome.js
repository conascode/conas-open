// Application chrome: menu bar, toolbar, tool options bar, status bar, and settings / help dialogs.
import { h, icon, refreshIcons } from '../utils/dom.js';
import { APP_VERSION, TERRAIN_MATERIALS } from '../data/constants.js';
import { checkboxControl, numberControl } from './controls.js';

export const TOOLS = [
  { id: 'select', label: 'Select', icon: 'mouse-pointer-2', keys: ['1', 'v'] },
  { id: 'pan', label: 'Pan', icon: 'hand', keys: ['2', 'h'] },
  { id: 'island', label: 'Island', icon: 'land-plot', keys: ['3', 'i'] },
  { id: 'coastline', label: 'Coastline', icon: 'spline', keys: ['4', 'c'] },
  { id: 'terrain', label: 'Terrain Brush', icon: 'paintbrush', keys: ['5', 't'] },
  { id: 'road', label: 'Road', icon: 'route', keys: ['6', 'r'] },
  { id: 'bridge', label: 'Bridge', icon: 'rainbow', keys: ['7', 'b'] },
  { id: 'building', label: 'Building', icon: 'building-2', keys: ['8', 'u'] },
  { id: 'area', label: 'Area', icon: 'square-dashed', keys: ['9', 'a'] },
  { id: 'asset', label: 'Asset', icon: 'package', keys: ['0', 'e'] },
];

export function buildToolbar(editor, root) {
  const buttons = new Map();
  root.replaceChildren(...TOOLS.map((t) => {
    const b = h('button', {
      class: 'tool-btn', title: `${t.label} (${t.keys.map((k) => k.toUpperCase()).join(' / ')})`, 'aria-label': t.label, dataset: { tool: t.id },
      onclick: () => editor.tools.use(t.id),
    }, icon(t.icon), h('span', { class: 'tool-key' }, t.keys[0]));
    buttons.set(t.id, b);
    return b;
  }));
  const sync = (id) => { for (const [k, b] of buttons) { b.classList.toggle('active', k === id); b.setAttribute('aria-pressed', k === id ? 'true' : 'false'); } };
  editor.tools.on('change', sync);
  sync(editor.tools.activeId);
  refreshIcons(root);
}

export function buildMenus(editor, root, actions) {
  const s = editor.settings;
  const toggle = (key) => () => editor.setSetting(key, !editor.settings[key]);
  const menus = [
    ['File', [
      { label: 'New Project', key: 'Ctrl+N', run: actions.newProject },
      { label: 'Open…', key: 'Ctrl+O', run: actions.open },
      { label: 'Open Sample Project', run: actions.openSample },
      'sep',
      { label: 'Save', key: 'Ctrl+S', run: actions.save },
      { label: 'Save As…', key: 'Ctrl+Shift+S', run: actions.saveAs },
      'sep',
      { label: 'Export JSON', run: actions.exportJSON },
      { label: 'Export ZIP Package', run: actions.exportZip },
      { label: 'Import ZIP Package…', run: actions.importZip },
      'sep',
      { label: 'Recover Autosave…', run: actions.recover },
      { label: 'Project Settings', run: () => editor.selection.clear() },
    ]],
    ['Edit', [
      { label: () => `Undo${editor.history.undoLabel ? ` ${editor.history.undoLabel}` : ''}`, key: 'Ctrl+Z', run: () => editor.undo(), enabled: () => editor.history.canUndo },
      { label: () => `Redo${editor.history.redoLabel ? ` ${editor.history.redoLabel}` : ''}`, key: 'Ctrl+Shift+Z', run: () => editor.redo(), enabled: () => editor.history.canRedo },
      'sep',
      { label: 'Duplicate', key: 'Ctrl+D', run: () => editor.duplicateSelection(), enabled: () => editor.selection.size > 0 },
      { label: 'Delete', key: 'Del', run: () => editor.deleteSelection(), enabled: () => editor.selection.size > 0 },
      { label: 'Select All', key: 'Ctrl+A', run: () => editor.selectAll() },
      { label: 'Deselect', key: 'Esc', run: () => editor.selection.clear(), enabled: () => editor.selection.size > 0 },
      'sep',
      { label: 'Group', key: 'Ctrl+G', run: () => editor.groupSelection(), enabled: () => editor.selection.size > 1 },
      { label: 'Ungroup', key: 'Ctrl+Shift+G', run: () => editor.ungroupSelection(), enabled: () => editor.selection.size > 0 },
    ]],
    ['View', [
      { label: 'Zoom In', key: '+', run: () => editor.camera.zoomAt(center(editor), 1.25) },
      { label: 'Zoom Out', key: '-', run: () => editor.camera.zoomAt(center(editor), 0.8) },
      { label: 'Zoom 100%', key: 'Ctrl+1', run: () => editor.camera.setZoom(1) },
      { label: 'Fit Whole Map', key: 'Home', run: () => editor.fitWorld() },
      { label: 'Fit Content', key: 'Shift+Home', run: () => editor.fitContent() },
      { label: 'Frame Selection', key: 'F', run: () => editor.frameSelection(), enabled: () => editor.selection.size > 0 },
      'sep',
      { label: 'Show Grid', key: 'G', check: () => s.showGrid, run: toggle('showGrid') },
      { label: 'Snap to Grid', key: 'Shift+G', check: () => s.snapToGrid, run: toggle('snapToGrid') },
      { label: 'Snap to Objects', check: () => s.snapToObjects, run: toggle('snapToObjects') },
      { label: 'Show Object Outlines', key: 'O', check: () => s.showOutlines, run: toggle('showOutlines') },
      { label: 'Show Island Labels', check: () => s.showLabels, run: toggle('showLabels') },
    ]],
    ['Terrain', [
      { label: 'Island Tool', key: '3', run: () => editor.tools.use('island') },
      { label: 'Coastline Tool', key: '4', run: () => editor.tools.use('coastline') },
      { label: 'Terrain Brush', key: '5', run: () => editor.tools.use('terrain') },
      'sep',
      ...['Brush', 'Eraser', 'Fill'].map((m) => ({ label: `Mode: ${m}`, check: () => editor.tools.tools.get('terrain').mode === m, run: () => { editor.tools.tools.get('terrain').mode = m; editor.tools.use('terrain'); editor.emit('tool-options'); } })),
      'sep',
      ...TERRAIN_MATERIALS.map((m) => ({ label: `Material: ${m}`, check: () => editor.tools.tools.get('terrain').material === m, run: () => { editor.tools.tools.get('terrain').material = m; editor.tools.use('terrain'); editor.emit('tool-options'); } })),
      'sep',
      { label: 'Clear Terrain of Selected Island', enabled: () => selectedIsland(editor)?.terrain, run: () => editor.setProps(selectedIsland(editor).id, { terrain: null }, 'Clear Terrain') },
    ]],
    ['Objects', [
      { label: 'Road Tool', key: '6', run: () => editor.tools.use('road') },
      { label: 'Bridge Tool', key: '7', run: () => editor.tools.use('bridge') },
      { label: 'Building Tool', key: '8', run: () => editor.tools.use('building') },
      { label: 'Area Tool', key: '9', run: () => editor.tools.use('area') },
      { label: 'Asset Tool', key: '0', run: () => editor.tools.use('asset') },
      'sep',
      ...[['left', 'Align Left'], ['center', 'Align Center'], ['right', 'Align Right'], ['top', 'Align Top'], ['middle', 'Align Middle'], ['bottom', 'Align Bottom']]
        .map(([m, l]) => ({ label: l, run: () => editor.align(m), enabled: () => editor.selection.size > 1 })),
      'sep',
      { label: 'Edit Hitbox of Selected Building', enabled: () => selectedType(editor, 'building'), run: () => { editor.tools.use('select'); editor.setHitboxEdit(editor.selection.first); } },
      { label: 'Import Asset…', run: actions.importAsset },
    ]],
    ['Window', [
      { label: 'Inspector', check: () => !document.body.classList.contains('hide-inspector'), run: () => togglePanel('hide-inspector', editor) },
      { label: 'Layers & Hierarchy', check: () => !document.body.classList.contains('hide-layers'), run: () => togglePanel('hide-layers', editor) },
      { label: 'Asset Library', check: () => !document.body.classList.contains('hide-library'), run: () => togglePanel('hide-library', editor) },
      { label: 'Toolbar', check: () => !document.body.classList.contains('hide-toolbar'), run: () => togglePanel('hide-toolbar', editor) },
      'sep',
      { label: 'Reset Layout', run: () => { document.body.classList.remove('hide-inspector', 'hide-layers', 'hide-library', 'hide-toolbar'); } },
    ]],
    ['Help', [
      { label: 'Keyboard Shortcuts', key: '?', run: actions.shortcuts },
      { label: 'User Guide', run: () => window.open('https://github.com/conascode/conas-open/blob/main/work/WORLD_BUILDER/docs/user-guide.md', '_blank', 'noopener') },
      { label: 'Performance Test (5,000 objects)', run: actions.perfTest },
      'sep',
      { label: 'About WORLD BUILDER', run: actions.about },
    ]],
  ];

  let openMenu = null;
  const close = () => { openMenu?.classList.remove('open'); openMenu = null; };
  document.addEventListener('mousedown', (e) => { if (openMenu && !e.target.closest('.menu')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu) { close(); e.stopPropagation(); } }, true);

  root.replaceChildren(...menus.map(([title, items]) => {
    const list = h('div', { class: 'menu-list', role: 'menu' });
    const btn = h('button', { class: 'menu-btn', 'aria-haspopup': 'true' }, title);
    const menu = h('div', { class: 'menu' }, btn, list);
    const fill = () => {
      list.replaceChildren(...items.map((it) => {
        if (it === 'sep') return h('div', { class: 'menu-sep', role: 'separator' });
        const enabled = it.enabled ? !!it.enabled() : true;
        const checked = it.check ? it.check() : null;
        return h('button', {
          class: 'menu-item', role: 'menuitem', disabled: !enabled,
          onclick: () => { close(); it.run(); },
        }, h('span', { class: 'check' }, checked === null ? '' : checked ? '✓' : ''),
        h('span', { class: 'menu-label' }, typeof it.label === 'function' ? it.label() : it.label),
        h('span', { class: 'menu-key' }, it.key || ''));
      }));
    };
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (openMenu === menu) { close(); return; }
      close(); fill(); menu.classList.add('open'); openMenu = menu;
    });
    btn.addEventListener('mouseenter', () => { if (openMenu && openMenu !== menu) { close(); fill(); menu.classList.add('open'); openMenu = menu; } });
    return menu;
  }));
}

function togglePanel(cls, editor) {
  document.body.classList.toggle(cls);
  // the canvas host resizes; let the renderer observe it
  setTimeout(() => editor.renderer.onResize(), 50);
}

function center(editor) {
  return { x: editor.camera.viewWidth / 2, y: editor.camera.viewHeight / 2 };
}

function selectedIsland(editor) {
  if (editor.selection.size !== 1) return null;
  const o = editor.doc.get(editor.selection.first);
  return o?.type === 'island' ? o : null;
}

function selectedType(editor, type) {
  return editor.selection.size === 1 && editor.doc.get(editor.selection.first)?.type === type;
}

export function buildStatusBar(editor, root) {
  const hintEl = h('span', { class: 'status-hint' });
  const coords = h('span', { class: 'status-item mono', title: 'Cursor world coordinates' }, 'X — Y —');
  const zoom = h('button', { class: 'status-item mono link', title: 'Click to reset zoom to 100%', onclick: () => editor.camera.setZoom(1) }, '100%');
  const sel = h('span', { class: 'status-item' }, '0 selected');
  const objs = h('span', { class: 'status-item mono', title: 'Rendered (in view) / total objects' }, '');
  const fps = h('span', { class: 'status-item mono', title: 'Frames per second' }, '');
  const snap = h('button', { class: 'status-item link', title: 'Toggle snap to grid (Shift+G)', onclick: () => editor.setSetting('snapToGrid', !editor.settings.snapToGrid) }, '');
  root.replaceChildren(hintEl, h('span', { class: 'spacer' }), snap, sel, objs, coords, zoom, fps);
  const updateHint = () => { hintEl.textContent = editor.tools.active?.hint || ''; };
  editor.on('hint', updateHint);
  editor.tools.on('change', updateHint);
  editor.on('selection', (ids) => { sel.textContent = `${ids.length} selected`; updateHint(); });
  editor.tools.on('cursor', (p) => { coords.textContent = p ? `X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}` : 'X — Y —'; });
  const updSnap = () => { snap.textContent = `Snap ${editor.settings.snapToGrid ? 'ON' : 'OFF'}`; snap.classList.toggle('on', editor.settings.snapToGrid); };
  editor.on('settings', updSnap);
  updSnap();
  setInterval(() => {
    const st = editor.renderer.stats;
    zoom.textContent = `${Math.round(editor.camera.zoom * 100)}%`;
    objs.textContent = `${st.visible} / ${st.total} objects`;
    fps.textContent = `${Math.round(st.fps)} FPS · ${(st.renderMs || 0).toFixed(1)} ms`;
    fps.title = `Display ${Math.round(st.fps)} FPS; last frame render ${(st.renderMs || 0).toFixed(1)} ms; ${st.renders} renders in the last second (renders only when something changes)`;
  }, 250);
  updateHint();
}

export function buildToolOptions(editor, root) {
  const render = () => {
    const tool = editor.tools.active;
    const opts = tool?.options();
    root.replaceChildren(h('span', { class: 'opts-title' }, tool?.name || ''), opts || h('span', { class: 'muted small' }, 'No options'));
    root.querySelectorAll('input, select').forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));
    refreshIcons(root);
  };
  editor.tools.on('change', render);
  editor.on('tool-options', render);
  editor.on('selection', () => { if (editor.tools.activeId === 'coastline') render(); });
  render();
}

export function settingsDialog(editor, ui) {
  const s = editor.settings;
  const body = h('div', { class: 'settings' },
    h('h3', {}, 'Canvas'),
    checkboxControl('Show grid', s.showGrid, (v) => editor.setSetting('showGrid', v)),
    checkboxControl('Snap to grid', s.snapToGrid, (v) => editor.setSetting('snapToGrid', v)),
    checkboxControl('Snap to objects (roads, coastlines)', s.snapToObjects, (v) => editor.setSetting('snapToObjects', v)),
    checkboxControl('Show object outlines', s.showOutlines, (v) => editor.setSetting('showOutlines', v)),
    checkboxControl('Show island labels', s.showLabels, (v) => editor.setSetting('showLabels', v)),
    h('h3', {}, 'Saving'),
    checkboxControl('Auto save to browser storage (IndexedDB)', s.autosave, (v) => editor.setSetting('autosave', v)),
    numberControl('Auto save delay (seconds)', s.autosaveDelay, (v) => { if (v >= 0.5 && v <= 120) editor.setSetting('autosaveDelay', v); }, { min: 0.5, max: 120, step: 0.5 }),
    h('h3', {}, 'History'),
    numberControl('Undo steps kept', s.undoLimit, (v) => { if (Number.isInteger(v) && v >= 10 && v <= 5000) editor.setSetting('undoLimit', v); }, { min: 10, max: 5000, step: 10 }),
    h('p', { class: 'muted small' }, 'Grid size and world size are project properties: deselect everything to edit them in the Inspector.'));
  body.querySelectorAll('input').forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));
  return ui.modal({ title: 'Settings', body, iconName: 'settings', buttons: [{ label: 'Close', value: true, kind: 'primary' }] });
}

export function shortcutsDialog(ui) {
  const rows = [
    ['Tools', '1–0 or V H I C T R B U A E'],
    ['Pan', 'Middle mouse drag · Space + drag · Pan tool'],
    ['Zoom', 'Mouse wheel · + / −'],
    ['Fit whole map / fit content / frame selection', 'Home / Shift+Home / F'],
    ['Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y)'],
    ['Save / Save As', 'Ctrl+S / Ctrl+Shift+S'],
    ['Open / New', 'Ctrl+O / Ctrl+N'],
    ['Duplicate / Delete', 'Ctrl+D / Delete'],
    ['Select all / Deselect', 'Ctrl+A / Esc'],
    ['Group / Ungroup', 'Ctrl+G / Ctrl+Shift+G'],
    ['Nudge', 'Arrow keys (Shift = 10×)'],
    ['Constrain move / rotate snap', 'Shift while dragging'],
    ['Finish polygon / road', 'Double-click or Enter'],
    ['Remove last point while drawing', 'Right-click or Backspace'],
    ['Remove a vertex', 'Alt+click it (or select it and press Delete)'],
    ['Terrain brush size', '[ and ]'],
    ['Rotate asset before placing', 'R (Building / Asset tool)'],
    ['Toggle grid / snap / outlines', 'G / Shift+G / O'],
  ];
  return ui.modal({
    title: 'Keyboard Shortcuts', iconName: 'keyboard', width: 560,
    body: h('table', { class: 'shortcuts' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, h('kbd', {}, b))))),
  });
}

export function aboutDialog(ui) {
  return ui.modal({
    title: 'About WORLD BUILDER', iconName: 'map',
    body: h('div', { class: 'about' },
      h('p', {}, h('b', {}, `WORLD BUILDER ${APP_VERSION}`), ' — 2D world map editor for mystery and open-world games.'),
      h('p', {}, 'Built with HTML5, Vanilla JavaScript, PixiJS 8, Lucide, Zod, JSZip and IndexedDB. Runs entirely in the browser.'),
      h('p', { class: 'muted small' }, 'Implemented: Phase 1 (core editor), Phase 2 (islands, coastline, terrain, roads, bridges, buildings), Phase 3 (assets, layers, inspector, ZIP, autosave). Phase 4 (characters, routes, incidents, evidence, timeline playback) is not implemented yet; the Characters / Routes / Investigation layers and the "routes" array are reserved for it.')),
  });
}
