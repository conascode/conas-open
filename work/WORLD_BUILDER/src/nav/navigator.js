// Navigator: loads a WORLD BUILDER map, finds routes over its road network
// (start → waypoints → destination) and plays them back like a GPS tracker.
import { Container, Text } from '../../lib/pixi.min.js';
import { WorldDocument } from '../core/document.js';
import { Camera } from '../core/camera.js';
import { Renderer } from '../renderer/renderer.js';
import { AssetTextures } from '../renderer/textures.js';
import { AssetStore } from '../storage/asset-store.js';
import { idb } from '../storage/idb.js';
import { readProjectZip } from '../storage/zip.js';
import { parseProject } from '../data/serialize.js';
import { createProjectData } from '../data/defaults.js';
import { getShapeBounds } from '../objects/shapes.js';
import { unionBounds, dist, dashPath } from '../utils/geometry.js';
import { h, icon, refreshIcons, downloadBlob } from '../utils/dom.js';
import { UI } from '../panels/dialogs.js';
import { segmented, selectControl, checkboxControl } from '../panels/controls.js';
import { buildRoadGraph, snapToNetwork, findRoute, routeSteps } from './road-graph.js';
import { buildTrack, stateAt, formatDistance, formatDuration, toCSV } from './simulation.js';

const APP_BASE = new URL('../../', import.meta.url).href;
const SAMPLE_URL = new URL('samples/serim-city.world.json', APP_BASE).href;
const MAX_SNAP_PX = 600; // a stop must be within this many world px of a usable road
const LOG_EVERY_SEC = 2;
const COLORS = { start: 0x4cbf7a, way: 0xe8a33d, end: 0xe0524d, route: 0x4b9de8, done: 0x8fa3b5, car: 0xffffff };
const $ = (s) => document.querySelector(s);

const S = {
  mapName: '',
  mode: 'car',
  metric: 'time',
  mpp: 0.5,
  crossings: true,
  showNetwork: false,
  follow: true,
  playback: 10,
  clickMode: 'auto',
  stops: [], // [{ x, y }] — first = start, last = destination, middle = waypoints
  snaps: [],
  graph: null,
  legs: null,
  track: null,
  steps: [],
  error: '',
  t: 0,
  running: false,
  log: [],
  lastLogT: -Infinity,
  lastLeg: 0,
};

let doc; let camera; let renderer; let ui; let assetStore; let markerLayer;
const labelPool = [];

async function boot() {
  ui = new UI(document.body);
  doc = new WorldDocument();
  camera = new Camera();
  assetStore = new AssetStore(APP_BASE);
  const textures = new AssetTextures((a) => assetStore.resolveUrl(a));
  renderer = new Renderer(doc, camera, textures);
  renderer.settings.showGrid = false;
  doc.load(createProjectData('EMPTY'));
  await renderer.init($('#nav-canvas'));
  markerLayer = new Container();
  renderer.world.addChild(markerLayer);
  renderer.overlayDrawers.push(drawOverlay);
  renderer.app.ticker.add((tk) => tick(tk));
  bindCanvas(renderer.app.canvas);
  buildHeader();
  renderPanel();
  document.body.classList.add('ui-ready');

  const want = new URLSearchParams(location.search).get('map');
  const rec = want === 'sample' ? null : await readAutosave();
  if (rec) await loadText(rec.json, `${rec.name} (editor map)`);
  else await loadUrl(SAMPLE_URL, 'SERIM_CITY (sample)');
  document.body.classList.add('ready');
  window.navigatorApp = { S, doc, camera, renderer, addStop, run, pause, stop, recompute, setOption };
}

// ---------------- map loading ----------------

async function readAutosave() {
  try { return (await idb.get('autosave', 'current')) || null; } catch { return null; }
}

async function loadText(text, name) {
  const res = parseProject(text);
  if (!res.ok) { ui.errors(`Could not open ${name}`, res.errors); return false; }
  return loadData(res.data, name);
}

async function loadUrl(url, name) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return loadText(await r.text(), name);
  } catch (e) {
    ui.errors(`Could not load ${name}`, [e.message]);
    return false;
  }
}

async function loadFile(file) {
  if (/\.zip$/i.test(file.name)) {
    const res = await readProjectZip(file);
    if (!res.ok) { ui.errors(`Could not open ${file.name}`, res.errors); return; }
    for (const [id, blob] of res.assetBlobs) await assetStore.putBlob(id, blob);
    await loadData(res.data, file.name);
  } else await loadText(await file.text(), file.name);
}

function loadData(data, name) {
  stop();
  renderer.assetTextures.clear();
  doc.load(data);
  camera.setWorldSize(data.world.width, data.world.height);
  S.mapName = name;
  S.stops = [];
  rebuildGraph();
  fitContent();
  $('#map-name').textContent = name;
  ui.toast(`Loaded ${name}: ${doc.data.roads.length} roads, ${doc.data.bridges.length} bridges`, 'success');
  return true;
}

function fitContent() {
  let b = null;
  for (const o of doc.objects()) b = b ? unionBounds(b, getShapeBounds(o)) : getShapeBounds(o);
  camera.fitBounds(b || { minX: 0, minY: 0, maxX: doc.world.width, maxY: doc.world.height }, 50);
}

// ---------------- routing ----------------

function rebuildGraph() {
  S.graph = buildRoadGraph(doc.data, { mode: S.mode, crossings: S.crossings });
  recompute();
}

function stopName(i) {
  if (i === 0) return 'Start';
  if (i === S.stops.length - 1) return 'Destination';
  return `Waypoint ${i}`;
}

function recompute() {
  stop(true);
  S.legs = null; S.track = null; S.steps = []; S.error = ''; S.snaps = [];
  const g = S.graph;
  if (!g || !g.edges.length) {
    if (S.stops.length) S.error = `This map has no ${S.mode === 'car' ? 'drivable roads' : 'roads'}.`;
  } else {
    S.snaps = S.stops.map((p) => snapToNetwork(g, p, MAX_SNAP_PX));
    const bad = S.snaps.findIndex((s) => !s);
    if (bad >= 0) {
      S.error = `${stopName(bad)} is too far from any ${S.mode === 'car' ? 'drivable road' : 'road'}${S.mode === 'car' ? ' (try Walk mode for footpaths)' : ''}.`;
    } else if (S.stops.length >= 2) {
      const legs = [];
      for (let i = 0; i < S.snaps.length - 1; i++) {
        const leg = findRoute(g, S.snaps[i], S.snaps[i + 1], { metric: S.metric, mpp: S.mpp });
        if (!leg) {
          S.error = `No ${S.mode === 'car' ? 'driving' : 'walking'} route from ${stopName(i)} to ${stopName(i + 1)} — the roads are not connected${S.mode === 'car' ? ' for cars' : ''}.`;
          break;
        }
        legs.push(leg);
      }
      if (!S.error) {
        S.legs = legs;
        S.track = buildTrack(legs, S.mpp);
        let offset = 0;
        legs.forEach((leg, li) => {
          for (const st of routeSteps(g, leg)) {
            S.steps.push({ ...st, startSeg: st.startSeg + offset, endSeg: st.endSeg + offset, leg: li, turn: li > 0 && st.turn === 'start' ? 'continue' : st.turn });
          }
          offset += leg.segs.length;
          S.steps.push({ arrive: true, leg: li, name: stopName(li + 1), startSeg: offset, endSeg: offset, len: 0 });
        });
      }
    }
  }
  renderer.requestOverlay();
  renderPanel();
}

// ---------------- stops ----------------

function addStop(p, mode = S.clickMode) {
  const pt = { x: p.x, y: p.y };
  if (mode === 'start') { if (S.stops.length) S.stops[0] = pt; else S.stops.push(pt); }
  else if (mode === 'destination') { if (S.stops.length >= 2) S.stops[S.stops.length - 1] = pt; else S.stops.push(pt); }
  else if (mode === 'waypoint') { if (S.stops.length >= 2) S.stops.splice(S.stops.length - 1, 0, pt); else S.stops.push(pt); }
  else if (S.stops.length < 2) S.stops.push(pt);
  else S.stops.splice(S.stops.length - 1, 0, pt); // auto: extra clicks become waypoints
  recompute();
}

function removeStop(i) { S.stops.splice(i, 1); recompute(); }
function moveStop(i, d) {
  const j = i + d;
  if (j < 0 || j >= S.stops.length) return;
  [S.stops[i], S.stops[j]] = [S.stops[j], S.stops[i]];
  recompute();
}

function setOption(key, value) {
  S[key] = value;
  if (key === 'mode' || key === 'crossings') rebuildGraph();
  else if (key === 'metric' || key === 'mpp') recompute();
  else { renderer.requestOverlay(); renderPanel(); }
}

// ---------------- driving ----------------

function roadName(seg) {
  const s = S.track?.segs[seg];
  if (!s) return '—';
  return s.lineIdx < 0 ? 'Connector' : S.graph.lines[s.lineIdx].name;
}

function logPoint(st, event = '') {
  const t = Math.min(S.t, S.track.totalSec);
  S.log.push({
    t_sec: Math.round(t * 10) / 10,
    clock: formatDuration(t),
    x: Math.round(st.x * 10) / 10,
    y: Math.round(st.y * 10) / 10,
    speed_kmh: st.speedKmh,
    heading_deg: Math.round((st.heading * 180) / Math.PI),
    road: roadName(st.seg),
    event,
  });
  S.lastLogT = t;
}

function run() {
  if (!S.track) { ui.toast(S.error || 'Set a start and a destination first', 'warning'); return; }
  if (S.t >= S.track.totalSec) { S.t = 0; S.log = []; S.lastLogT = -Infinity; S.lastLeg = 0; }
  if (S.t === 0 && !S.log.length) logPoint(stateAt(S.track, 0), 'start');
  S.running = true;
  renderPanel();
}

function pause() { S.running = false; renderPanel(); }

function stop(silent = false) {
  S.running = false; S.t = 0; S.log = []; S.lastLogT = -Infinity; S.lastLeg = 0;
  if (!silent) { renderer?.requestOverlay(); renderPanel(); }
}

let lastPanel = 0;
function tick(tk) {
  if (!S.running || !S.track) return;
  S.t += (tk.deltaMS / 1000) * S.playback;
  const st = stateAt(S.track, S.t);
  if (st.leg !== S.lastLeg) {
    for (let k = S.lastLeg; k < st.leg; k++) logPoint(stateAt(S.track, S.track.cumSec[S.track.legEnds[k]]), `arrived ${stopName(k + 1)}`);
    S.lastLeg = st.leg;
  }
  if (S.t - S.lastLogT >= LOG_EVERY_SEC) logPoint(st);
  if (st.done) {
    S.running = false;
    S.t = S.track.totalSec;
    logPoint(st, 'arrived Destination');
    ui.toast(`Arrived at the destination · ${formatDistance(S.track.totalPx * S.mpp)} in ${formatDuration(S.track.totalSec)}`, 'success');
    renderPanel();
  }
  if (S.follow) camera.centerOn(st);
  renderer.requestOverlay();
  const now = performance.now();
  if (now - lastPanel > 100) { lastPanel = now; updateTelemetry(); }
}

// ---------------- drawing ----------------

function polyline(g, pts, width, color, alpha = 1) {
  if (pts.length < 2) return;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
}

function labelAt(i, text, p, zoom) {
  let t = labelPool[i];
  if (!t) {
    t = new Text({ text: '', style: { fontFamily: 'Inter, Segoe UI, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xffffff }, resolution: 2 });
    t.anchor.set(0.5);
    markerLayer.addChild(t);
    labelPool[i] = t;
  }
  t.text = text;
  t.visible = true;
  t.position.set(p.x, p.y);
  t.scale.set(1 / zoom);
}

function drawOverlay(g, zoom) {
  const gr = S.graph;
  if (S.showNetwork && gr) {
    for (const e of gr.edges) {
      const a = gr.nodes[e.u]; const b = gr.nodes[e.v];
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ width: 2 / zoom, color: 0x5ce1e6, alpha: 0.75 });
    for (const c of gr.connectors) for (const seg of dashPath([c.a, c.b], 8 / zoom, 6 / zoom)) polyline(g, seg, 2 / zoom, 0xe8a33d);
    for (const n of gr.nodes) g.circle(n.x, n.y, 2 / zoom);
    g.fill({ color: 0x5ce1e6, alpha: 0.8 });
  }
  const tr = S.track;
  if (tr) {
    polyline(g, tr.points, 13 / zoom, 0x0b2340, 0.75);
    polyline(g, tr.points, 7 / zoom, COLORS.route);
    const st = stateAt(tr, S.t);
    if (S.t > 0) polyline(g, [...tr.points.slice(0, st.seg + 1), st], 7 / zoom, COLORS.done);
    for (const r of S.log) g.circle(r.x, r.y, 2.4 / zoom);
    if (S.log.length) g.fill({ color: 0xffffff, alpha: 0.85 });
  }
  // dotted link from where the user clicked to where the stop snapped onto the road
  S.stops.forEach((p, i) => {
    const sn = S.snaps[i];
    if (sn && sn.d > 4 / zoom) for (const seg of dashPath([p, sn], 5 / zoom, 5 / zoom)) polyline(g, seg, 1.5 / zoom, 0xffffff, 0.8);
  });
  for (const t of labelPool) t.visible = false;
  S.stops.forEach((p, i) => {
    const last = i === S.stops.length - 1 && S.stops.length >= 2;
    const color = i === 0 ? COLORS.start : last ? COLORS.end : COLORS.way;
    const at = S.snaps[i] || p;
    g.circle(at.x, at.y, 11 / zoom).fill(color).stroke({ width: 2 / zoom, color: 0xffffff });
    labelAt(i, i === 0 ? 'S' : last ? 'E' : String(i), at, zoom);
  });
  if (tr) {
    const st = stateAt(tr, S.t);
    const r = 11 / zoom;
    g.circle(st.x, st.y, 20 / zoom).fill({ color: COLORS.route, alpha: 0.22 });
    const c = Math.cos(st.heading); const s = Math.sin(st.heading);
    const P = (fx, fy) => [st.x + (fx * c - fy * s) * r, st.y + (fx * s + fy * c) * r];
    g.poly([...P(1.3, 0), ...P(-0.9, -0.85), ...P(-0.45, 0), ...P(-0.9, 0.85)], true).fill(COLORS.car).stroke({ width: 2.5 / zoom, color: COLORS.route });
  }
}

// ---------------- canvas input ----------------

function bindCanvas(canvas) {
  let drag = null;
  const ev = (e) => {
    const r = canvas.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { screen, world: camera.screenToWorld(screen) };
  };
  const hitStop = (screen) => S.stops.findIndex((p, i) => dist(camera.worldToScreen(S.snaps[i] || p), screen) <= 14);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const i = hitStop(ev(e).screen);
    if (i >= 0) removeStop(i);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const { screen } = ev(e);
    canvas.setPointerCapture(e.pointerId);
    const i = e.button === 0 ? hitStop(screen) : -1;
    drag = i >= 0 ? { kind: 'stop', i, start: screen } : { kind: 'pan', last: screen, start: screen, moved: false, button: e.button };
    canvas.style.cursor = drag.kind === 'pan' ? 'grabbing' : 'move';
  });
  canvas.addEventListener('pointermove', (e) => {
    const { screen, world } = ev(e);
    $('#nav-coords').textContent = `X ${world.x.toFixed(0)}  Y ${world.y.toFixed(0)}`;
    if (!drag) {
      canvas.style.cursor = hitStop(screen) >= 0 ? 'move' : 'crosshair';
      return;
    }
    if (drag.kind === 'stop') {
      S.stops[drag.i] = world;
      S.snaps[drag.i] = null;
      renderer.requestOverlay();
    } else {
      if (dist(screen, drag.start) > 4) drag.moved = true;
      camera.panBy(screen.x - drag.last.x, screen.y - drag.last.y);
      drag.last = screen;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    canvas.style.cursor = 'crosshair';
    if (!d) return;
    if (d.kind === 'stop') recompute();
    else if (!d.moved && d.button === 0) addStop(ev(e).world);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoomAt(ev(e).screen, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    $('#nav-zoom').textContent = `${Math.round(camera.zoom * 100)}%`;
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || document.querySelector('.backdrop')) return;
    if (e.key === ' ') { e.preventDefault(); if (S.running) pause(); else run(); }
    if (e.key === 'Escape') stop();
    if (e.key === 'Home') fitContent();
  });
}

// ---------------- panel ----------------

function buildHeader() {
  const open = async () => {
    const f = await ui.pickFile('.json,.zip,application/json,application/zip');
    if (f) await loadFile(f);
  };
  $('#btn-open').addEventListener('click', open);
  $('#btn-editor-map').addEventListener('click', async () => {
    const rec = await readAutosave();
    if (!rec) { ui.toast('No map found from the editor in this browser yet', 'warning'); return; }
    await loadText(rec.json, `${rec.name} (editor map)`);
  });
  $('#btn-sample').addEventListener('click', () => loadUrl(SAMPLE_URL, 'SERIM_CITY (sample)'));
  refreshIcons(document.querySelector('.nav-top'));
}

function section(title, ...children) {
  return h('section', { class: 'nav-section' }, h('h3', {}, title), ...children.flat().filter(Boolean));
}

function stopRow(p, i) {
  const last = i === S.stops.length - 1 && S.stops.length >= 2;
  const cls = i === 0 ? 'start' : last ? 'end' : 'way';
  const sn = S.snaps[i];
  const road = sn ? (sn.edge.lineIdx < 0 ? 'Connector' : S.graph.lines[sn.edge.lineIdx].name) : 'not on a road';
  return h('div', { class: 'stop-row' },
    h('span', { class: `stop-badge ${cls}` }, i === 0 ? 'S' : last ? 'E' : String(i)),
    h('div', { class: 'stop-text' }, h('b', {}, stopName(i)), h('span', { class: sn ? '' : 'bad' }, `${road} · ${Math.round(p.x)}, ${Math.round(p.y)}`)),
    h('button', { class: 'icon-btn tiny', title: 'Move up', 'aria-label': `Move ${stopName(i)} up`, disabled: i === 0, onclick: () => moveStop(i, -1) }, icon('arrow-up')),
    h('button', { class: 'icon-btn tiny', title: 'Move down', 'aria-label': `Move ${stopName(i)} down`, disabled: i === S.stops.length - 1, onclick: () => moveStop(i, 1) }, icon('arrow-down')),
    h('button', { class: 'icon-btn tiny danger', title: 'Remove', 'aria-label': `Remove ${stopName(i)}`, onclick: () => removeStop(i) }, icon('x')));
}

const TURN_ICON = { start: 'navigation', continue: 'navigation', straight: 'arrow-up', left: 'corner-up-left', right: 'corner-up-right' };

function stepRow(st) {
  if (st.arrive) return h('div', { class: 'step arrive', dataset: { seg: st.startSeg, end: st.startSeg } }, icon('flag'), h('span', {}, `Arrive at ${st.name}`));
  const verb = { start: 'Head along', continue: 'Continue on', straight: 'Continue onto', left: 'Turn left onto', right: 'Turn right onto' }[st.turn];
  return h('div', { class: 'step', dataset: { seg: st.startSeg, end: st.endSeg } }, icon(TURN_ICON[st.turn] || 'arrow-up'),
    h('span', {}, `${verb} ${st.name}`), h('span', { class: 'step-dist' }, formatDistance(st.len * S.mpp)));
}

function renderPanel() {
  const root = $('#nav-panel');
  if (!root) return;
  const tr = S.track;
  const summary = tr
    ? h('div', { class: 'summary' },
      h('div', {}, h('b', {}, formatDistance(tr.totalPx * S.mpp)), h('span', {}, 'distance')),
      h('div', {}, h('b', {}, formatDuration(tr.totalSec)), h('span', {}, S.mode === 'car' ? 'drive time' : 'walk time')),
      h('div', {}, h('b', {}, String(S.legs.length)), h('span', {}, S.legs.length === 1 ? 'leg' : 'legs')))
    : h('div', { class: `hint-box${S.error ? ' error' : ''}` }, S.error || (S.stops.length === 0
      ? 'Click on the map to set the start.'
      : S.stops.length === 1 ? 'Click on the map to set the destination.' : ''));

  const playbackSel = selectControl('Speed', String(S.playback), [['1', '1× real time'], ['5', '5×'], ['10', '10×'], ['30', '30×'], ['60', '60×'], ['120', '120×']], (v) => { S.playback = Number(v); });
  root.replaceChildren(
    section('Travel mode',
      segmented([['car', 'Car'], ['walk', 'Walk']], S.mode, (v) => setOption('mode', v)),
      segmented([['time', 'Fastest'], ['distance', 'Shortest']], S.metric, (v) => setOption('metric', v))),
    section('Route points',
      h('div', { class: 'click-mode' }, h('span', { class: 'muted small' }, 'Map click sets:'),
        segmented([['auto', 'Auto'], ['start', 'Start'], ['waypoint', 'Waypoint'], ['destination', 'Destination']], S.clickMode, (v) => { S.clickMode = v; })),
      S.stops.length ? h('div', { class: 'stops' }, S.stops.map(stopRow)) : null,
      h('p', { class: 'muted small' }, 'Auto: 1st click = start, 2nd = destination, more clicks add waypoints. Drag a marker to move it, right-click it to remove it.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', disabled: S.stops.length < 2, onclick: () => { S.stops.reverse(); recompute(); } }, icon('arrow-up-down'), 'Reverse'),
        h('button', { class: 'btn small', disabled: !S.stops.length, onclick: () => { S.stops = []; recompute(); } }, icon('trash-2'), 'Clear'))),
    section('Route', summary, S.steps.length ? h('div', { class: 'steps', id: 'steps' }, S.steps.map(stepRow)) : null),
    section('Drive',
      h('div', { class: 'drive-buttons' },
        S.running
          ? h('button', { class: 'btn primary', onclick: pause }, icon('pause'), 'Pause')
          : h('button', { class: 'btn primary', disabled: !tr, onclick: run }, icon('play'), S.t > 0 && tr && S.t < tr.totalSec ? 'Resume' : 'Run'),
        h('button', { class: 'btn', disabled: !tr || (S.t === 0 && !S.running), onclick: () => stop() }, icon('square'), 'Stop'),
        playbackSel),
      checkboxControl('Camera follows the vehicle', S.follow, (v) => { S.follow = v; }),
      h('div', { class: 'telemetry', id: 'telemetry' }),
      h('div', { class: 'progress' }, h('div', { class: 'bar', id: 'progress-bar' }))),
    section('GPS log',
      h('div', { class: 'muted small', id: 'log-count' }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', disabled: !S.log.length, onclick: exportCSV }, icon('file-down'), 'GPS log CSV'),
        h('button', { class: 'btn small', disabled: !tr, onclick: exportJSON }, icon('file-json'), 'Route + log JSON'))),
    section('Settings',
      h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Metres per map pixel'),
        h('input', { class: 'input num', type: 'number', min: 0.01, max: 100, step: 0.05, value: S.mpp, onchange: (e) => { const v = Number(e.target.value); if (v > 0) setOption('mpp', v); } })),
      checkboxControl('Crossing roads are junctions', S.crossings, (v) => setOption('crossings', v)),
      checkboxControl('Show road network', S.showNetwork, (v) => setOption('showNetwork', v)),
      S.graph ? h('p', { class: 'muted small' }, `${S.graph.lines.length} roads/bridges · ${S.graph.nodes.length} nodes · ${S.graph.connectors.length} auto connectors`) : null));
  root.querySelectorAll('input').forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));
  refreshIcons(root);
  updateTelemetry();
}

function updateTelemetry() {
  const box = document.getElementById('telemetry');
  if (!box) return;
  const tr = S.track;
  if (!tr) { box.replaceChildren(h('span', { class: 'muted small' }, 'Run a route to see live position, speed and ETA.')); return; }
  const st = stateAt(tr, S.t);
  // next manoeuvre: the first upcoming turn or arrival
  const next = S.steps.find((x) => x.startSeg > st.seg && (x.arrive || x.turn === 'left' || x.turn === 'right'));
  let nextText = '—';
  if (next && !st.done) {
    const d = (tr.cumPx[next.startSeg] - st.distPx) * S.mpp;
    nextText = next.arrive ? `${formatDistance(d)} · arrive ${next.name}` : `${formatDistance(d)} · ${next.turn === 'left' ? 'turn left' : next.turn === 'right' ? 'turn right' : 'continue'} onto ${next.name}`;
  }
  const rows = [
    ['Status', st.done && S.t > 0 ? 'Arrived' : S.running ? 'Driving' : S.t > 0 ? 'Paused' : 'Ready'],
    ['Speed', `${st.speedKmh} km/h`],
    ['Road', st.done && S.t > 0 ? '—' : roadName(st.seg)],
    ['Next', nextText],
    ['Travelled', formatDistance(st.distPx * S.mpp)],
    ['Remaining', formatDistance((tr.totalPx - st.distPx) * S.mpp)],
    ['Elapsed', formatDuration(Math.min(S.t, tr.totalSec))],
    ['ETA', `in ${formatDuration(tr.totalSec - Math.min(S.t, tr.totalSec))}`],
    ['Position', `${Math.round(st.x)}, ${Math.round(st.y)}`],
  ];
  box.replaceChildren(...rows.map(([k, v]) => h('div', { class: 'tm' }, h('span', {}, k), h('b', {}, v))));
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = `${tr.totalSec ? (Math.min(S.t, tr.totalSec) / tr.totalSec) * 100 : 0}%`;
  const lc = document.getElementById('log-count');
  if (lc) lc.textContent = S.log.length ? `${S.log.length} positions recorded (every ${LOG_EVERY_SEC} s of simulated time)` : 'No positions recorded yet.';
  for (const el of document.querySelectorAll('.step')) {
    const end = Number(el.dataset.end);
    const started = S.t > 0;
    const passed = started && (st.done || (el.classList.contains('arrive') ? st.seg >= end : st.seg > end));
    const current = started && !st.done && !el.classList.contains('arrive') && st.seg >= Number(el.dataset.seg) && st.seg <= end;
    el.classList.toggle('passed', passed);
    el.classList.toggle('current', current);
  }
}

function fileBase() {
  return (doc.project.name || 'route').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function exportCSV() {
  downloadBlob(new Blob([toCSV(S.log)], { type: 'text/csv' }), `${fileBase()}-gps-log.csv`);
}

function exportJSON() {
  const tr = S.track;
  const out = {
    format: 'world-builder-route',
    version: '1.0.0',
    project: { id: doc.project.id, name: doc.project.name },
    mode: S.mode,
    metric: S.metric,
    metersPerPixel: S.mpp,
    stops: S.stops.map((p, i) => ({ role: stopName(i), x: p.x, y: p.y, snapped: S.snaps[i] ? { x: S.snaps[i].x, y: S.snaps[i].y } : null })),
    route: {
      distanceM: Math.round(tr.totalPx * S.mpp * 10) / 10,
      durationSec: Math.round(tr.totalSec * 10) / 10,
      points: tr.points.map((p, i) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, t: Math.round(tr.cumSec[i] * 10) / 10 })),
      steps: S.steps.map((s) => (s.arrive ? { arrive: s.name } : { instruction: s.turn, road: s.name, distanceM: Math.round(s.len * S.mpp) })),
    },
    gps: S.log,
  };
  downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), `${fileBase()}-route.json`);
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h('div', { class: 'fatal' }, h('h2', {}, 'Navigator failed to start'), h('pre', {}, String(e?.stack || e))));
});
