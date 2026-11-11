// Application bootstrap: wires the editor, renderer, tools, panels, menus, keyboard and storage together.
import { Editor } from './editor.js';
import { Renderer } from '../renderer/renderer.js';
import { AssetTextures } from '../renderer/textures.js';
import { drawAllOutlines, drawObjectOutline } from '../renderer/overlay.js';
import { ToolManager } from '../tools/tool-manager.js';
import { SelectTool } from '../tools/select-tool.js';
import { IslandTool } from '../tools/island-tool.js';
import { AreaTool } from '../tools/area-tool.js';
import { CoastlineTool } from '../tools/coastline-tool.js';
import { TerrainTool } from '../tools/terrain-tool.js';
import { RoadTool } from '../tools/road-tool.js';
import { BridgeTool } from '../tools/bridge-tool.js';
import { PlaceTool, PanTool } from '../tools/place-tool.js';
import { UI } from '../panels/dialogs.js';
import { Inspector } from '../panels/inspector.js';
import { LayersPanel, HierarchyPanel } from '../panels/layers-panel.js';
import { AssetLibrary, ASSET_DRAG_TYPE } from '../panels/asset-library.js';
import {
  TOOLS, buildToolbar, buildMenus, buildStatusBar, buildToolOptions, settingsDialog, shortcutsDialog, aboutDialog,
} from '../panels/chrome.js';
import { AssetStore } from '../storage/asset-store.js';
import { ProjectManager } from '../storage/project-manager.js';
import { createProjectData } from '../data/defaults.js';
import { buildPerfProject, measureFps } from './perf.js';
import { h, icon, refreshIcons } from '../utils/dom.js';

const $ = (sel) => document.querySelector(sel);
const APP_BASE = new URL('../../', import.meta.url).href;

async function boot() {
  const editor = new Editor();
  const ui = new UI(document.body);
  editor.on('toast', ({ message, kind }) => ui.toast(message, kind));

  editor.assetStore = new AssetStore(APP_BASE);
  const textures = new AssetTextures((asset) => editor.assetStore.resolveUrl(asset));
  const renderer = new Renderer(editor.doc, editor.camera, textures);
  editor.renderer = renderer;
  renderer.settings.showGrid = editor.settings.showGrid;
  renderer.settings.showLabels = editor.settings.showLabels;

  // Empty document first so panels can render; the real project is loaded below.
  editor.doc.load(createProjectData('UNTITLED_WORLD'));
  await renderer.init($('#canvas-host'));

  const tools = new ToolManager(editor, renderer.app.canvas);
  editor.tools = tools;
  renderer.app.canvas.tabIndex = 0;
  tools.register('select', new SelectTool(editor));
  tools.register('pan', new PanTool(editor));
  tools.register('island', new IslandTool(editor));
  tools.register('coastline', new CoastlineTool(editor));
  tools.register('terrain', new TerrainTool(editor));
  tools.register('road', new RoadTool(editor));
  tools.register('bridge', new BridgeTool(editor));
  tools.register('building', new PlaceTool(editor, 'building'));
  tools.register('area', new AreaTool(editor));
  tools.register('asset', new PlaceTool(editor, 'asset'));

  // Overlay: outlines, selection highlight, then the active tool's own drawing.
  renderer.overlayDrawers.push((g, zoom) => {
    if (editor.settings.showOutlines) drawAllOutlines(g, editor, zoom);
    for (const o of editor.selectedObjects()) drawObjectOutline(g, o, zoom, o.locked ? 0xe8a33d : 0x4b9de8, 1, 2);
    tools.active?.drawOverlay(g, zoom);
  });

  const pm = new ProjectManager(editor, ui);
  editor.projects = pm;

  // ---------- panels ----------
  buildToolbar(editor, $('#toolbar'));
  new Inspector(editor, $('#inspector-body'));
  new LayersPanel(editor, $('#layers-body'), ui);
  new HierarchyPanel(editor, $('#hierarchy-body'));
  const library = new AssetLibrary(editor, $('#library'), ui);
  buildStatusBar(editor, $('#statusbar'));
  buildToolOptions(editor, $('#tool-options'));
  tools.use('select');

  // Right panel tabs (Layers / Hierarchy)
  for (const tab of document.querySelectorAll('.tab[data-tab]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.tab[data-tab]')) { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); }
      for (const p of document.querySelectorAll('.tab-panel')) p.hidden = p.id !== `${tab.dataset.tab}-body`;
    });
  }

  const actions = {
    newProject: () => pm.newProject(),
    open: () => pm.open(),
    openSample: async () => { if (await pm.confirmDiscard()) { if (await pm.openUrl(new URL('samples/serim-city.world.json', APP_BASE).href, 'serim-city.world.json')) editor.toast('Sample project loaded', 'success'); } },
    save: () => pm.save(),
    saveAs: () => pm.saveAs(),
    exportJSON: () => pm.exportJSON(),
    exportZip: () => pm.exportZip(),
    importZip: () => pm.importZip(),
    recover: () => recoverDialog(editor, pm, ui, true),
    importAsset: () => library.openDialog(),
    shortcuts: () => shortcutsDialog(ui),
    about: () => aboutDialog(ui),
    perfTest: () => runPerfTest(editor, pm, ui),
    settings: () => settingsDialog(editor, ui),
    // The Navigator reads the editor's autosave, so write it first to hand over the current map.
    openNavigator: async () => {
      const win = window.open('', '_blank');
      await pm.writeAutosave();
      if (win) win.location.href = new URL('navigator.html?map=editor', APP_BASE).href;
      else window.location.href = new URL('navigator.html?map=editor', APP_BASE).href;
    },
  };
  buildMenus(editor, $('#menus'), actions);
  buildTopBar(editor, pm, actions);

  // ---------- drag & drop from the library ----------
  const host = $('#canvas-host');
  host.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; host.classList.add('drop'); }
  });
  host.addEventListener('dragleave', () => host.classList.remove('drop'));
  host.addEventListener('drop', (e) => {
    host.classList.remove('drop');
    const id = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    const r = renderer.app.canvas.getBoundingClientRect();
    const world = editor.camera.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    const obj = editor.placeAsset(editor.doc.asset(id), world);
    if (obj) editor.toast(`Placed ${obj.name}`, 'success');
  });

  bindKeyboard(editor, tools, actions);

  // ---------- start-up: recovery or sample ----------
  document.body.classList.add('ui-ready'); // hide the splash so start-up dialogs are clickable
  const rec = await pm.readAutosave();
  if (rec && rec.dirty) {
    await recoverDialog(editor, pm, ui, false, rec);
  } else if (rec) {
    await pm.restoreAutosave(rec, false);
    editor.toast(`Restored last session: ${rec.name}`);
  } else {
    await pm.openUrl(new URL('samples/serim-city.world.json', APP_BASE).href, 'serim-city.world.json');
    editor.toast('Loaded sample project SERIM_CITY');
  }
  document.body.classList.add('ready');
  window.worldBuilder = { editor, pm, renderer }; // handy for debugging and automated tests
}

function buildTopBar(editor, pm, actions) {
  const nameBtn = $('#project-name');
  const status = $('#save-status');
  const syncName = () => { nameBtn.textContent = editor.doc.project.name; };
  nameBtn.addEventListener('click', () => editor.selection.clear());
  editor.on('project', syncName);
  editor.doc.on('section', syncName);
  syncName();
  let autosavedAt = null;
  const syncStatus = () => {
    if (editor.dirty) {
      status.className = 'save-status dirty';
      status.textContent = autosavedAt ? `Unsaved · autosaved ${new Date(autosavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Unsaved changes';
    } else {
      status.className = 'save-status saved';
      status.textContent = pm.fileName ? `Saved · ${pm.fileName}` : 'Saved';
    }
  };
  editor.on('dirty', syncStatus);
  editor.on('saved', syncStatus);
  editor.on('project', syncStatus);
  editor.on('autosaved', (t) => { autosavedAt = t; syncStatus(); });
  syncStatus();

  const undo = $('#btn-undo'); const redo = $('#btn-redo');
  const syncHistory = () => {
    undo.disabled = !editor.history.canUndo;
    redo.disabled = !editor.history.canRedo;
    undo.title = editor.history.canUndo ? `Undo ${editor.history.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    redo.title = editor.history.canRedo ? `Redo ${editor.history.redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  };
  editor.on('history', syncHistory);
  syncHistory();
  undo.addEventListener('click', () => editor.undo());
  redo.addEventListener('click', () => editor.redo());
  $('#btn-save').addEventListener('click', actions.save);
  $('#btn-navigator').addEventListener('click', actions.openNavigator);
  $('#btn-settings').addEventListener('click', actions.settings);
  const exportMenu = $('#export-menu');
  $('#btn-export').addEventListener('click', (e) => { e.stopPropagation(); exportMenu.classList.toggle('open'); });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#export-wrap')) exportMenu.classList.remove('open'); });
  $('#export-json').addEventListener('click', () => { exportMenu.classList.remove('open'); actions.exportJSON(); });
  $('#export-zip').addEventListener('click', () => { exportMenu.classList.remove('open'); actions.exportZip(); });
  refreshIcons(document.querySelector('.topbar'));
}

function bindKeyboard(editor, tools, actions) {
  const toolKeys = new Map();
  for (const t of TOOLS) for (const k of t.keys) toolKeys.set(k, t.id);
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    if (document.querySelector('.backdrop')) return; // a dialog is open
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.toLowerCase();
    if (key === ' ' && !e.repeat) { tools.setSpace(true); e.preventDefault(); return; }
    if (ctrl) {
      const map = {
        z: () => (e.shiftKey ? editor.redo() : editor.undo()),
        y: () => editor.redo(),
        s: () => (e.shiftKey ? actions.saveAs() : actions.save()),
        o: () => actions.open(),
        n: () => actions.newProject(),
        d: () => editor.duplicateSelection(),
        a: () => editor.selectAll(),
        g: () => (e.shiftKey ? editor.ungroupSelection() : editor.groupSelection()),
        1: () => editor.camera.setZoom(1),
      };
      if (map[lower]) { e.preventDefault(); map[lower](); }
      return;
    }
    if (tools.active?.onKeyDown(e)) { e.preventDefault(); return; }
    if (key === 'Escape') {
      if (!tools.active?.cancel()) editor.selection.clear();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); editor.deleteSelection(); return; }
    if (key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
      editor.nudge(d[0], d[1]);
      return;
    }
    if (key === '+' || key === '=') { editor.camera.zoomAt({ x: editor.camera.viewWidth / 2, y: editor.camera.viewHeight / 2 }, 1.25); return; }
    if (key === '-' || key === '_') { editor.camera.zoomAt({ x: editor.camera.viewWidth / 2, y: editor.camera.viewHeight / 2 }, 0.8); return; }
    if (key === 'Home') { if (e.shiftKey) editor.fitContent(); else editor.fitWorld(); return; }
    if (lower === 'f') { editor.frameSelection(); return; }
    if (key === 'G') { editor.setSetting('snapToGrid', !editor.settings.snapToGrid); return; }
    if (key === 'g') { editor.setSetting('showGrid', !editor.settings.showGrid); return; }
    if (lower === 'o') { editor.setSetting('showOutlines', !editor.settings.showOutlines); return; }
    if (key === '?') { actions.shortcuts(); return; }
    if (!e.altKey && toolKeys.has(lower)) tools.use(toolKeys.get(lower));
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') tools.setSpace(false); });
  window.addEventListener('blur', () => tools.setSpace(false));
}

async function recoverDialog(editor, pm, ui, manual, rec) {
  rec = rec || await pm.readAutosave();
  if (!rec) { ui.toast('No autosave found in this browser', 'warning'); return; }
  const when = new Date(rec.savedAt).toLocaleString();
  const v = await ui.modal({
    title: manual ? 'Recover autosave' : 'Recover unsaved work?', iconName: 'life-buoy',
    body: h('div', {},
      h('p', {}, manual ? 'Load the project snapshot stored in this browser:' : 'WORLD BUILDER found unsaved changes from a previous session (browser closed, refreshed or crashed).'),
      h('div', { class: 'recover-card' }, icon('file-clock'), h('div', {}, h('b', {}, rec.name), h('div', { class: 'muted small' }, `Autosaved ${when}${rec.fileName ? ` · from ${rec.fileName}` : ''}`)))),
    buttons: manual
      ? [{ label: 'Cancel', value: null }, { label: 'Recover', value: 'recover', kind: 'primary' }]
      : [{ label: 'Discard & open sample', value: 'sample' }, { label: 'Recover', value: 'recover', kind: 'primary' }],
  });
  if (v === 'recover') {
    if (manual && !(await pm.confirmDiscard())) return;
    if (await pm.restoreAutosave(rec, true)) editor.toast('Recovered autosaved project', 'success');
  } else if (!manual) {
    await pm.openUrl(new URL('samples/serim-city.world.json', APP_BASE).href, 'serim-city.world.json');
    pm.writeAutosave();
  }
}

async function runPerfTest(editor, pm, ui) {
  if (!(await pm.confirmDiscard())) return;
  ui.toast('Building 5,000-object test world…');
  const t0 = performance.now();
  await pm.load(buildPerfProject(5000), { name: 'perf-test (not saved)' });
  const loadMs = performance.now() - t0;
  ui.toast('Measuring frame rate while panning and zooming…');
  const r = await measureFps(editor, 4000);
  editor.fitContent();
  window.lastPerfResult = { ...r, loadMs };
  ui.modal({
    title: 'Performance test result', iconName: 'gauge',
    body: h('table', { class: 'shortcuts' },
      [['Objects', r.objects.toLocaleString()], ['Build + load time', `${loadMs.toFixed(0)} ms`], ['Frames measured', r.frames], ['Average FPS', r.avgFps.toFixed(1)], ['95th percentile frame', `${r.p95FrameMs.toFixed(1)} ms`]]
        .map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, h('b', {}, String(b)))))),
  });
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h('div', { class: 'fatal' }, h('h2', {}, 'WORLD BUILDER failed to start'), h('pre', {}, String(e?.stack || e)),
    h('p', {}, 'Open this page through a web server (e.g. GitHub Pages or "python3 -m http.server"); ES modules do not load from file://.')));
});
