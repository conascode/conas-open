// File ▸ Import OpenStreetMap… : pick an .osm / GeoJSON / Overpass JSON file, choose what to
// import and the scale, then open the converted map as a new project.
import { h, icon, refreshIcons } from '../utils/dom.js';
import { parseOSM, summarizeOSM, convertOSM, OSM_ATTRIBUTION, DEFAULT_OSM_OPTIONS } from '../data/osm-import.js';
import { parseProject, projectToJSONText } from '../data/serialize.js';
import { checkboxControl } from './controls.js';

const MAX_FILE_BYTES = 200 * 1024 * 1024;

export async function importOsmDialog(editor, pm, ui) {
  if (!(await pm.confirmDiscard())) return;
  const state = { model: null, file: null, opts: { ...DEFAULT_OSM_OPTIONS } };
  const err = h('div', { class: 'field-error' });
  const summary = h('div', { class: 'osm-summary muted small' }, 'No file selected yet.');
  const fileInput = h('input', { type: 'file', class: 'input', accept: '.osm,.xml,.geojson,.json,application/json,application/xml,text/xml' });
  const nameIn = h('input', { class: 'input', value: 'OSM_MAP' });
  const mppIn = h('input', { class: 'input num', type: 'number', min: 0.05, max: 50, step: 0.05, value: state.opts.metersPerPixel });
  const sizeHint = h('span', { class: 'muted small' });
  for (const el of [nameIn, mppIn]) el.addEventListener('keydown', (e) => e.stopPropagation());

  const updateSize = () => {
    if (!state.model) { sizeHint.textContent = ''; return; }
    const s = state.summary;
    const mpp = Number(mppIn.value) || 0.5;
    sizeHint.textContent = `→ map about ${Math.round(s.widthM / mpp).toLocaleString()} × ${Math.round(s.heightM / mpp).toLocaleString()} px`;
  };
  mppIn.addEventListener('input', updateSize);

  fileInput.addEventListener('change', async () => {
    err.textContent = '';
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { err.textContent = 'File is larger than 200 MB.'; return; }
    summary.textContent = 'Reading…';
    try {
      const text = await f.text();
      state.model = parseOSM(text);
      state.file = f;
      state.summary = summarizeOSM(state.model);
      const s = state.summary;
      if (!s.bounds) throw new Error('The file has no map data with coordinates.');
      nameIn.value = f.name.replace(/\.(osm|xml|geojson|json)$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').toUpperCase() || 'OSM_MAP';
      summary.replaceChildren(
        h('div', {}, h('b', {}, `${(s.widthM / 1000).toFixed(2)} km × ${(s.heightM / 1000).toFixed(2)} km`), ` · ${s.nodes.toLocaleString()} nodes · ${s.ways.toLocaleString()} ways`),
        h('div', {}, `Found: ${s.roads} roads · ${s.buildings} buildings · ${s.coastlines} coastline pieces · ${s.areas} land-use / water areas`));
      updateSize();
    } catch (e) {
      state.model = null;
      summary.textContent = 'No file loaded.';
      err.textContent = e.message;
    }
  });

  const body = h('div', { class: 'osm-dialog' },
    h('div', { class: 'osm-help' },
      h('b', {}, 'How to get a file'),
      h('ol', {},
        h('li', {}, 'Open openstreetmap.org, move to the area you want and click ', h('b', {}, 'Export'), '.'),
        h('li', {}, 'Click "Manually select a different area", draw a box (about 2 × 2 km or less works best), then ', h('b', {}, 'Export'), ' → you get ', h('code', {}, 'map.osm'), '.'),
        h('li', {}, 'Larger areas: use overpass-turbo.eu and export as GeoJSON or raw OSM data.'))),
    h('label', { class: 'field' }, h('span', {}, '1. OpenStreetMap file (.osm, .geojson, Overpass .json)'), fileInput),
    summary,
    err,
    h('label', { class: 'field' }, h('span', {}, '2. Project name'), nameIn),
    h('label', { class: 'field' }, h('span', {}, '3. Scale: metres per map pixel'), h('div', { class: 'row' }, mppIn, sizeHint)),
    h('div', { class: 'field' }, h('span', {}, '4. Import'),
      checkboxControl('Roads (with real junctions, one-way streets, speed limits)', state.opts.roads, (v) => { state.opts.roads = v; }),
      checkboxControl('Footpaths, alleys and service roads', state.opts.minorRoads, (v) => { state.opts.minorRoads = v; }),
      checkboxControl('Buildings (footprint used as the hitbox)', state.opts.buildings, (v) => { state.opts.buildings = v; }),
      checkboxControl('Water, parks, beaches and land use (terrain)', state.opts.landuse, (v) => { state.opts.landuse = v; }),
      checkboxControl('Trees', state.opts.trees, (v) => { state.opts.trees = v; })),
    h('p', { class: 'muted small' }, `Map data ${OSM_ATTRIBUTION}. If you use it in a game, credit "© OpenStreetMap contributors". The attribution is stored in the project metadata.`));

  const ok = await ui.modal({
    title: 'Import OpenStreetMap', iconName: 'map', width: 620, body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Import map', value: true, kind: 'primary' }],
  });
  if (!ok) return;
  if (!state.model) { ui.errors('Nothing imported', ['Choose an OpenStreetMap file first.']); return; }
  const mpp = Number(mppIn.value);
  if (!(mpp > 0)) { ui.errors('Nothing imported', ['Scale must be greater than 0.']); return; }
  editor.toast('Converting OpenStreetMap data…');
  await new Promise((r) => setTimeout(r, 30));
  let result;
  try {
    result = convertOSM(state.model, { ...state.opts, name: nameIn.value || 'OSM_MAP', metersPerPixel: mpp });
  } catch (e) {
    ui.errors('Import failed', [e.message]);
    return;
  }
  // Validate exactly like a project file before opening it.
  const parsed = parseProject(projectToJSONText(result.data));
  if (!parsed.ok) { ui.errors('Import produced an invalid project', parsed.errors); return; }
  await pm.load(parsed.data, { name: `${state.file.name} (OpenStreetMap)`, warnings: result.warnings, dirty: true });
  pm.writeAutosave();
  const s = result.stats;
  editor.toast(`Imported: ${s.islands} land areas, ${s.roads} roads (${s.junctions} junctions), ${s.buildings} buildings, ${s.trees} trees`, 'success');
  refreshIcons(document.body);
  return result;
}

export { icon };
