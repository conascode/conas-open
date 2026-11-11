// OpenStreetMap importer: OSM XML (.osm), Overpass JSON or GeoJSON -> WORLD BUILDER project data.
// Pure module (no DOM) so it runs in Node tests as well as the browser.
//
//  - Coastline ways are joined, clipped to the area and closed along its border to form land
//    polygons (OSM rule: land is on the left of a coastline's direction). Closed coastline rings
//    are islands. No coastline at all -> the whole area is one land mass.
//  - Water, parks, beaches, commercial/industrial land and farmland are painted into island terrain.
//  - Highways become roads; ways that share an OSM node become linked junctions.
//  - Buildings become building objects sized to their footprint's minimum-area rectangle, with the
//    real footprint as the hitbox (local coordinates).
import { createProjectData, createIsland, createRoad, createBuilding, createProp, roadPoint } from './defaults.js';
import { ROAD_DEFAULTS } from './constants.js';
import { createTerrainFor, insideMask, fillPolygon, paintDab } from '../objects/terrain.js';
import { simplifyClosed, polygonArea, pointInPolygon, boundsOfPoints, convexHull, worldToLocal, round } from '../utils/geometry.js';

const safeFolderName = (name) => (name || 'OSM_MAP').replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'OSM_MAP';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL 1.0)';

// ---------------------------------------------------------------- parsing

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

function attrs(s) {
  const o = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = decode(m[2] ?? m[3]);
  return o;
}

// Returns { nodes: Map(id -> {lat, lon, tags}), ways: [{id, refs, tags}], relations: [{id, members, tags}], bounds }
export function parseOSM(text) {
  const head = text.trimStart();
  if (head.startsWith('<')) return parseOsmXml(text);
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`Not OSM XML or JSON: ${e.message}`); }
  if (json && (json.type === 'FeatureCollection' || json.type === 'Feature')) return fromGeoJSON(json);
  if (json && Array.isArray(json.elements)) return fromOverpassJSON(json);
  throw new Error('Unsupported file: expected OSM XML (.osm), Overpass JSON or GeoJSON');
}

function parseOsmXml(text) {
  if (!/<osm[\s>]/.test(text)) throw new Error('This XML file is not OpenStreetMap data (no <osm> element)');
  const model = { nodes: new Map(), ways: [], relations: [], bounds: null };
  const re = /<(\/?)(node|way|relation|nd|tag|member|bounds)\b([^>]*?)(\/?)>/g;
  let cur = null;
  let m;
  while ((m = re.exec(text))) {
    const [, closing, name, body, selfClose] = m;
    if (closing) {
      if (cur && cur.kind === name) cur = null;
      continue;
    }
    const a = attrs(body);
    switch (name) {
      case 'bounds':
        model.bounds = { minlat: +a.minlat, minlon: +a.minlon, maxlat: +a.maxlat, maxlon: +a.maxlon };
        break;
      case 'node': {
        const n = { lat: +a.lat, lon: +a.lon, tags: {} };
        model.nodes.set(a.id, n);
        cur = selfClose ? null : { kind: 'node', el: n };
        break;
      }
      case 'way': {
        const w = { id: a.id, refs: [], tags: {} };
        model.ways.push(w);
        cur = selfClose ? null : { kind: 'way', el: w };
        break;
      }
      case 'relation': {
        const r = { id: a.id, members: [], tags: {} };
        model.relations.push(r);
        cur = selfClose ? null : { kind: 'relation', el: r };
        break;
      }
      case 'nd': if (cur?.kind === 'way') cur.el.refs.push(a.ref); break;
      case 'member': if (cur?.kind === 'relation') cur.el.members.push({ type: a.type, ref: a.ref, role: a.role || '' }); break;
      case 'tag': if (cur) cur.el.tags[a.k] = a.v; break;
      default: break;
    }
  }
  return model;
}

function fromOverpassJSON(json) {
  const model = { nodes: new Map(), ways: [], relations: [], bounds: null };
  let synth = 0;
  for (const e of json.elements) {
    if (e.type === 'node') model.nodes.set(String(e.id), { lat: e.lat, lon: e.lon, tags: e.tags || {} });
  }
  for (const e of json.elements) {
    if (e.type === 'way') {
      let refs = (e.nodes || []).map(String);
      if (e.geometry && refs.some((r) => !model.nodes.has(r))) {
        refs = e.geometry.map((g, i) => {
          const id = refs[i] || `s${++synth}`;
          if (!model.nodes.has(id)) model.nodes.set(id, { lat: g.lat, lon: g.lon, tags: {} });
          return id;
        });
      }
      model.ways.push({ id: String(e.id), refs, tags: e.tags || {} });
    } else if (e.type === 'relation') {
      model.relations.push({ id: String(e.id), members: (e.members || []).map((x) => ({ type: x.type, ref: String(x.ref), role: x.role || '' })), tags: e.tags || {} });
    }
  }
  if (json.bounds) model.bounds = json.bounds;
  return model;
}

function fromGeoJSON(json) {
  const model = { nodes: new Map(), ways: [], relations: [], bounds: null };
  const ids = new Map();
  let n = 0; let w = 0;
  const nodeId = ([lon, lat]) => {
    const k = `${lon.toFixed(7)},${lat.toFixed(7)}`;
    let id = ids.get(k);
    if (!id) { id = `g${++n}`; ids.set(k, id); model.nodes.set(id, { lat, lon, tags: {} }); }
    return id;
  };
  const feats = json.type === 'Feature' ? [json] : json.features || [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const props = f.properties || {};
    const tags = props.tags && typeof props.tags === 'object' ? props.tags : props;
    const line = (coords) => model.ways.push({ id: `gw${++w}`, refs: coords.map(nodeId), tags });
    switch (g.type) {
      case 'Point': model.nodes.get(nodeId(g.coordinates)).tags = tags; break;
      case 'LineString': line(g.coordinates); break;
      case 'MultiLineString': g.coordinates.forEach(line); break;
      case 'Polygon': line(g.coordinates[0]); break;
      case 'MultiPolygon': g.coordinates.forEach((poly) => line(poly[0])); break;
      default: break;
    }
  }
  return model;
}

// ---------------------------------------------------------------- helpers

// Join ways (arrays of node ids) end-to-end into the longest possible chains.
export function joinChains(lists) {
  const pool = lists.filter((l) => l.length >= 2).map((l) => l.slice());
  const chains = [];
  while (pool.length) {
    let chain = pool.pop();
    let grew = true;
    while (grew && chain[0] !== chain[chain.length - 1]) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const head = chain[0]; const tail = chain[chain.length - 1];
        if (w[0] === tail) chain = chain.concat(w.slice(1));
        else if (w[w.length - 1] === head) chain = w.concat(chain.slice(1));
        else if (w[w.length - 1] === tail) chain = chain.concat(w.slice(0, -1).reverse());
        else if (w[0] === head) chain = w.slice(1).reverse().concat(chain);
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push(chain);
  }
  return chains;
}

const isClosed = (refs) => refs.length >= 4 && refs[0] === refs[refs.length - 1];

// Clip a polyline (y-up metres) to the box [0,W]x[0,H]; returns runs of points inside.
function clipPolyline(pts, W, H) {
  const inside = (p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
  const runs = [];
  let cur = inside(pts[0]) ? [pts[0]] : null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i];
    // Liang-Barsky
    let t0 = 0; let t1 = 1;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy]; const q = [a.x, W - a.x, a.y, H - a.y];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { ok = false; break; } } else {
        const r = q[k] / p[k];
        if (p[k] < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
      }
    }
    if (!ok) { if (cur) { runs.push(cur); cur = null; } continue; }
    const P0 = { x: a.x + dx * t0, y: a.y + dy * t0 };
    const P1 = { x: a.x + dx * t1, y: a.y + dy * t1 };
    if (!cur) cur = [P0];
    cur.push(P1);
    if (t1 < 1) { runs.push(cur); cur = null; }
  }
  if (cur && cur.length > 1) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

// Perimeter position, counter-clockwise (y-up) from (0,0).
function perim(p, W, H) {
  const d = [Math.abs(p.y), Math.abs(W - p.x), Math.abs(H - p.y), Math.abs(p.x)];
  const e = d.indexOf(Math.min(...d));
  if (e === 0) return Math.min(Math.max(p.x, 0), W);
  if (e === 1) return W + Math.min(Math.max(p.y, 0), H);
  if (e === 2) return W + H + (W - Math.min(Math.max(p.x, 0), W));
  return 2 * W + H + (H - Math.min(Math.max(p.y, 0), H));
}

function snapToBorder(p, W, H) {
  const d = [Math.abs(p.y), Math.abs(W - p.x), Math.abs(H - p.y), Math.abs(p.x)];
  const e = d.indexOf(Math.min(...d));
  return [{ x: p.x, y: 0 }, { x: W, y: p.y }, { x: p.x, y: H }, { x: 0, y: p.y }][e];
}

// Build land polygons from open coastline pieces that cross the box (land on the left).
function closeAlongBorder(runs, W, H) {
  const P = 2 * (W + H);
  const corners = [[0, { x: 0, y: 0 }], [W, { x: W, y: 0 }], [W + H, { x: W, y: H }], [2 * W + H, { x: 0, y: H }]];
  const items = runs.map((r) => {
    const pts = r.slice();
    pts[0] = snapToBorder(pts[0], W, H);
    pts[pts.length - 1] = snapToBorder(pts[pts.length - 1], W, H);
    return { pts, sIn: perim(pts[0], W, H), sOut: perim(pts[pts.length - 1], W, H), used: false };
  });
  const polys = [];
  for (const first of items) {
    if (first.used) continue;
    const poly = [];
    let cur = first;
    let guard = 0;
    while (cur && !cur.used && guard++ < items.length + 2) {
      cur.used = true;
      poly.push(...cur.pts);
      // walk counter-clockwise from this run's exit to the nearest run entry
      let best = null; let bestD = Infinity;
      for (const it of items) {
        if (it.used && it !== first) continue;
        const d = (it.sIn - cur.sOut + P) % P;
        if (d < bestD) { bestD = d; best = it; }
      }
      if (!best) break;
      for (const [s, c] of corners.map(([s0, c0]) => [(s0 - cur.sOut + P) % P, c0]).sort((a, b) => a[0] - b[0])) {
        if (s > 1e-9 && s < bestD - 1e-9) poly.push(c);
      }
      if (best === first) break;
      cur = best;
    }
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

function minAreaRect(pts) {
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]; const b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-ang); const s = Math.sin(-ang);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const p of hull) {
      const x = p.x * c - p.y * s; const y = p.x * s + p.y * c;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area < best.area) {
      const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
      const ci = Math.cos(ang); const si = Math.sin(ang);
      best = { area, cx: cx * ci - cy * si, cy: cx * si + cy * ci, w: maxX - minX, h: maxY - minY, rot: (ang * 180) / Math.PI };
    }
  }
  return best;
}

// ---------------------------------------------------------------- classification

const ROAD_TYPE = {
  motorway: 'Highway', motorway_link: 'Highway', trunk: 'Highway', trunk_link: 'Highway',
  primary: 'Main Road', primary_link: 'Main Road',
  secondary: 'Secondary Road', secondary_link: 'Secondary Road', tertiary: 'Secondary Road', tertiary_link: 'Secondary Road',
  residential: 'Local Road', unclassified: 'Local Road', living_street: 'Local Road', road: 'Local Road', busway: 'Local Road',
  service: 'Alley', track: 'Alley',
  pedestrian: 'Pedestrian Road', footway: 'Pedestrian Road', path: 'Pedestrian Road', steps: 'Pedestrian Road', cycleway: 'Pedestrian Road', bridleway: 'Pedestrian Road', corridor: 'Pedestrian Road',
};
const MINOR = new Set(['Pedestrian Road', 'Alley']);

function roadTypeOf(tags) {
  const hw = tags.highway;
  if (!hw || tags.area === 'yes') return null;
  if (hw === 'service' && tags.service === 'parking_aisle') return 'Parking Road';
  return ROAD_TYPE[hw] || null;
}

function terrainOf(tags) {
  if (tags.building) return null;
  const n = tags.natural; const l = tags.landuse; const le = tags.leisure;
  if (n === 'water' || tags.water || tags.waterway === 'riverbank' || tags.waterway === 'dock' || l === 'reservoir' || l === 'basin' || le === 'swimming_pool') return 'Water';
  if (n === 'beach' || n === 'sand' || le === 'beach_resort') return 'Sand';
  if (n === 'bare_rock' || n === 'scree' || n === 'shingle' || l === 'quarry') return 'Rock';
  if (['residential', 'commercial', 'retail', 'industrial', 'railway', 'construction', 'garages', 'brownfield', 'port'].includes(l) || tags.amenity === 'parking' || tags.aeroway) return 'Concrete';
  if (['farmland', 'farmyard', 'allotments', 'orchard', 'vineyard', 'plant_nursery'].includes(l)) return 'Soil';
  if (['grass', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'forest', 'greenfield'].includes(l)
    || ['park', 'garden', 'pitch', 'golf_course', 'playground', 'nature_reserve', 'dog_park'].includes(le)
    || ['wood', 'grassland', 'scrub', 'heath', 'wetland'].includes(n)) return 'Grass';
  return null;
}
// later entries paint over earlier ones (parks over residential blocks, water over everything)
const TERRAIN_ORDER = ['Soil', 'Concrete', 'Grass', 'Rock', 'Sand', 'Water'];
const TERRAIN_VALUE = { Grass: 1, Sand: 2, Rock: 3, Concrete: 4, Soil: 5, Water: 6 };
const RIVER_WIDTH_M = { river: 30, canal: 15, stream: 4, ditch: 2, drain: 2 };

function buildingTypeOf(tags) {
  const b = tags.building; const a = tags.amenity;
  if (a === 'police') return 'Police';
  if (a === 'hospital' || b === 'hospital') return 'Hospital';
  if (a === 'school' || a === 'university' || a === 'college' || ['school', 'university', 'college', 'kindergarten'].includes(b)) return 'School';
  if (tags.tourism === 'hotel' || b === 'hotel') return 'Hotel';
  if (['townhall', 'courthouse'].includes(a) || ['government', 'civic', 'public'].includes(b)) return 'Government';
  if (['industrial', 'factory', 'manufacture'].includes(b)) return 'Industrial';
  if (['warehouse', 'storage_tank', 'hangar'].includes(b)) return 'Warehouse';
  if (['office'].includes(b) || tags.office) return 'Office';
  if (['commercial', 'retail', 'supermarket', 'kiosk', 'mall'].includes(b) || tags.shop) return 'Commercial';
  if (['military', 'bunker'].includes(b) || tags.military) return 'Military';
  if (['house', 'detached', 'residential', 'apartments', 'terrace', 'semidetached_house', 'bungalow', 'dormitory'].includes(b)) return 'Residential';
  return 'Custom';
}
const BUILDING_ASSET = {
  Police: 'AST_POLICE', Hospital: 'AST_HOSPITAL', School: 'AST_SCHOOL', Hotel: 'AST_HOTEL', Government: 'AST_GOVERNMENT',
  Industrial: 'AST_INDUSTRIAL', Warehouse: 'AST_WAREHOUSE', Office: 'AST_OFFICE', Commercial: 'AST_COMMERCIAL', Military: 'AST_WAREHOUSE',
};

function parseSpeed(v) {
  if (!v) return null;
  if (v === 'walk') return 5;
  const m = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?/.exec(String(v).trim());
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === 'mph' ? 1.609 : 1));
}

// ---------------------------------------------------------------- conversion

export const DEFAULT_OSM_OPTIONS = {
  name: 'OSM_MAP',
  metersPerPixel: 0.5,
  roads: true,
  minorRoads: true,
  buildings: true,
  landuse: true,
  trees: true,
  margin: 300,
  maxBuildings: 8000,
};

export function summarizeOSM(model) {
  const b = areaBounds(model);
  let roads = 0; let buildings = 0; let coast = 0; let areas = 0;
  for (const w of model.ways) {
    if (roadTypeOf(w.tags)) roads++;
    else if (w.tags.building) buildings++;
    else if (w.tags.natural === 'coastline') coast++;
    else if (terrainOf(w.tags)) areas++;
  }
  for (const r of model.relations) { if (r.tags.building) buildings++; else if (terrainOf(r.tags)) areas++; }
  return { nodes: model.nodes.size, ways: model.ways.length, relations: model.relations.length, roads, buildings, coastlines: coast, areas, widthM: b ? b.widthM : 0, heightM: b ? b.heightM : 0, bounds: b };
}

function areaBounds(model) {
  let { bounds } = model;
  if (!bounds || !Number.isFinite(bounds.minlat)) {
    let minlat = Infinity; let minlon = Infinity; let maxlat = -Infinity; let maxlon = -Infinity;
    const used = new Set();
    for (const w of model.ways) for (const r of w.refs) used.add(r);
    for (const [id, n] of model.nodes) {
      if (!used.has(id) && !Object.keys(n.tags).length) continue;
      if (n.lat < minlat) minlat = n.lat; if (n.lat > maxlat) maxlat = n.lat;
      if (n.lon < minlon) minlon = n.lon; if (n.lon > maxlon) maxlon = n.lon;
    }
    if (!Number.isFinite(minlat)) return null;
    bounds = { minlat, minlon, maxlat, maxlon };
  }
  const lat0 = ((bounds.minlat + bounds.maxlat) / 2) * (Math.PI / 180);
  const kx = 111320 * Math.cos(lat0);
  const ky = 110574;
  return { ...bounds, kx, ky, widthM: (bounds.maxlon - bounds.minlon) * kx, heightM: (bounds.maxlat - bounds.minlat) * ky };
}

/**
 * Convert a parsed OSM model into project data (runtime form).
 * Returns { data, stats, warnings }.
 */
export function convertOSM(model, options = {}) {
  const opt = { ...DEFAULT_OSM_OPTIONS, ...options };
  const warnings = [];
  const B = areaBounds(model);
  if (!B || B.widthM <= 0 || B.heightM <= 0) throw new Error('The file contains no map area (no nodes with coordinates)');

  let mpp = opt.metersPerPixel;
  const maxSpanPx = 200000 - opt.margin * 2;
  if (Math.max(B.widthM, B.heightM) / mpp > maxSpanPx) {
    mpp = Math.ceil((Math.max(B.widthM, B.heightM) / maxSpanPx) * 100) / 100;
    warnings.push(`The area is large; scale changed to ${mpp} m per pixel to fit the 200,000 px world limit.`);
  }
  const M = opt.margin;
  const Wm = B.widthM; const Hm = B.heightM;
  // y-up metres inside the area box
  const meters = (n) => ({ x: (n.lon - B.minlon) * B.kx, y: (n.lat - B.minlat) * B.ky });
  const toPx = (p) => ({ x: round(M + p.x / mpp, 2), y: round(M + (Hm - p.y) / mpp, 2) });
  const nodePx = (id) => { const n = model.nodes.get(id); return n ? toPx(meters(n)) : null; };

  const data = createProjectData(safeFolderName(opt.name));
  data.world.width = Math.max(2000, Math.ceil(Wm / mpp + 2 * M));
  data.world.height = Math.max(2000, Math.ceil(Hm / mpp + 2 * M));
  data.world.gridSize = Math.max(16, Math.round(64 * (0.5 / mpp)));
  data.metadata = {
    source: 'OpenStreetMap',
    attribution: OSM_ATTRIBUTION,
    license: 'ODbL-1.0',
    metersPerPixel: mpp,
    bounds: { minlat: B.minlat, minlon: B.minlon, maxlat: B.maxlat, maxlon: B.maxlon },
    importedAt: new Date().toISOString(),
  };
  const wayById = new Map(model.ways.map((w) => [w.id, w]));
  const stats = { islands: 0, roads: 0, junctions: 0, buildings: 0, terrainAreas: 0, rivers: 0, trees: 0, skipped: 0 };

  // ---- land ----
  const coastWays = model.ways.filter((w) => w.tags.natural === 'coastline').map((w) => w.refs.filter((r) => model.nodes.has(r)));
  let landPolysM = [];
  if (coastWays.length) {
    const chains = joinChains(coastWays);
    const open = [];
    for (const ch of chains) {
      const pts = ch.map((r) => meters(model.nodes.get(r)));
      if (ch[0] === ch[ch.length - 1]) landPolysM.push({ pts: pts.slice(0, -1), name: null });
      else open.push(...clipPolyline(pts, Wm, Hm));
    }
    if (open.length) {
      for (const poly of closeAlongBorder(open, Wm, Hm)) landPolysM.push({ pts: poly, name: null, mainland: true });
    }
    if (!landPolysM.length) {
      warnings.push('Coastline data could not be closed into land; the whole area is treated as land.');
    }
  }
  if (!landPolysM.length) {
    // island polygons tagged place=island when there is no coastline, else everything is land
    for (const w of model.ways) {
      if ((w.tags.place === 'island' || w.tags.place === 'islet') && isClosed(w.refs)) {
        const pts = w.refs.slice(0, -1).map((r) => model.nodes.get(r)).filter(Boolean).map(meters);
        if (pts.length >= 3) landPolysM.push({ pts, name: w.tags.name || null });
      }
    }
    if (!landPolysM.length) landPolysM.push({ pts: [{ x: 0, y: 0 }, { x: Wm, y: 0 }, { x: Wm, y: Hm }, { x: 0, y: Hm }], name: 'Mainland', whole: true });
  }
  // names for islands from place=island ways / nodes inside them
  const placeNames = [];
  for (const w of model.ways) if ((w.tags.place === 'island' || w.tags.place === 'islet') && w.tags.name && w.refs.length) {
    const pts = w.refs.map((r) => model.nodes.get(r)).filter(Boolean).map(meters);
    if (pts.length) placeNames.push({ p: pts[0], name: w.tags.name, poly: pts });
  }
  for (const n of model.nodes.values()) if ((n.tags.place === 'island' || n.tags.place === 'islet') && n.tags.name) placeNames.push({ p: meters(n), name: n.tags.name });

  let isl = 0;
  const mainlandCount = landPolysM.filter((l) => l.mainland).length;
  let mainlandNo = 0;
  const worldW = data.world.width; const worldH = data.world.height;
  const edgeX = [M, M + Wm / mpp]; const edgeY = [M, M + Hm / mpp];
  for (const lp of landPolysM) {
    let poly = lp.pts.map(toPx);
    // Where land reaches the edge of the exported area it continues to the world edge
    // (that edge is a cut in the data, not a real coastline).
    if (lp.mainland || lp.whole) {
      poly = poly.map((p) => ({
        x: Math.abs(p.x - edgeX[0]) < 0.5 ? 0 : Math.abs(p.x - edgeX[1]) < 0.5 ? worldW : p.x,
        y: Math.abs(p.y - edgeY[0]) < 0.5 ? 0 : Math.abs(p.y - edgeY[1]) < 0.5 ? worldH : p.y,
      }));
    }
    if (poly.length > 12) poly = simplifyClosed(poly, 1.5);
    if (poly.length < 3 || Math.abs(polygonArea(poly)) < 400) { stats.skipped++; continue; }
    const named = lp.name || placeNames.find((pn) => (pn.poly ? pointInPolygon(lp.pts[0], pn.poly) || pointInPolygon(pn.p, lp.pts) : pointInPolygon(pn.p, lp.pts)))?.name;
    const island = createIsland(`ISL_${String(++isl).padStart(4, '0')}`, poly, {
      name: named || (lp.whole || (lp.mainland && mainlandCount === 1) ? 'Mainland' : lp.mainland ? `Mainland ${++mainlandNo}` : `Island ${isl}`),
      islandType: 'Urban', texture: 'Grass', coastlineType: lp.whole ? 'Concrete' : 'Sand',
      coastlineWidth: lp.whole ? 0 : Math.max(6, Math.round(13 * (0.5 / mpp))),
    });
    if (lp.mainland || lp.whole) {
      const onBorder = (a, b) => (a.x === 0 && b.x === 0) || (a.x === worldW && b.x === worldW) || (a.y === 0 && b.y === 0) || (a.y === worldH && b.y === worldH);
      island.coastline.edgeTypes = poly.map((a, i) => (onBorder(a, poly[(i + 1) % poly.length]) ? 'Concrete' : null));
    }
    data.islands.push(island);
  }
  stats.islands = data.islands.length;
  const islandFor = (p) => data.islands.find((i) => p.x >= i.x - i.width / 2 && p.x <= i.x + i.width / 2 && p.y >= i.y - i.height / 2 && p.y <= i.y + i.height / 2 && pointInPolygon(p, i.polygon));

  // ---- terrain (land use, water, rivers) ----
  if (opt.landuse && data.islands.length) {
    const areas = [];
    for (const w of model.ways) {
      const t = terrainOf(w.tags);
      if (t && isClosed(w.refs)) areas.push({ t, refs: w.refs });
    }
    for (const r of model.relations) {
      const t = terrainOf(r.tags);
      if (!t || r.tags.type !== 'multipolygon') continue;
      const outers = r.members.filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')).map((m) => wayById.get(m.ref)?.refs).filter(Boolean);
      for (const ring of joinChains(outers)) if (isClosed(ring)) areas.push({ t, refs: ring });
    }
    areas.sort((a, b) => TERRAIN_ORDER.indexOf(a.t) - TERRAIN_ORDER.indexOf(b.t));
    const rivers = model.ways.filter((w) => RIVER_WIDTH_M[w.tags.waterway] && !isClosed(w.refs));
    for (const island of data.islands) {
      const area = island.width * island.height;
      const cellSize = Math.max(16, Math.ceil(Math.sqrt(area / 3e6)));
      island.terrain = createTerrainFor(island.polygon, cellSize);
      const mask = insideMask(island.terrain, island.polygon);
      const ib = boundsOfPoints(island.polygon);
      let painted = 0;
      for (const a of areas) {
        const poly = a.refs.slice(0, -1).map(nodePx).filter(Boolean);
        if (poly.length < 3) continue;
        const pb = boundsOfPoints(poly);
        if (pb.maxX < ib.minX || pb.minX > ib.maxX || pb.maxY < ib.minY || pb.minY > ib.maxY) continue;
        if (fillPolygon(island.terrain, poly, TERRAIN_VALUE[a.t], mask)) painted++;
      }
      for (const rv of rivers) {
        const pts = rv.refs.map(nodePx).filter(Boolean);
        const radius = Math.max(island.terrain.cellSize * 0.75, RIVER_WIDTH_M[rv.tags.waterway] / mpp / 2);
        let hit = false;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]; const b = pts[i];
          const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (radius * 0.6)));
          for (let s = 0; s <= steps; s++) {
            const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
            if (paintDab(island.terrain, island.polygon, p, radius, TERRAIN_VALUE.Water, 1, new Map())) hit = true;
          }
        }
        if (hit) stats.rivers++;
      }
      stats.terrainAreas += painted;
      if (!island.terrain.cells.some((v) => v)) island.terrain = null;
    }
  }

  // ---- roads ----
  const usage = new Map(); // osm node id -> [{ road, pointId }]
  if (opt.roads) {
    let rd = 0;
    for (const w of model.ways) {
      const type = roadTypeOf(w.tags);
      if (!type || (!opt.minorRoads && MINOR.has(type))) continue;
      let refs = w.refs.filter((r) => model.nodes.has(r)).filter((r, i, a) => i === 0 || r !== a[i - 1]);
      if (refs.length < 2) { stats.skipped++; continue; }
      const oneway = w.tags.oneway === 'yes' || w.tags.oneway === '1' || w.tags.oneway === 'true' || w.tags.oneway === '-1' || w.tags.junction === 'roundabout' || w.tags.highway === 'motorway';
      if (w.tags.oneway === '-1') refs = refs.slice().reverse();
      const pts = refs.map((r) => { const p = nodePx(r); return roadPoint(p.x, p.y); });
      const d = ROAD_DEFAULTS[type];
      let width = Math.max(3, Math.round(d.width * (0.5 / mpp)));
      const lanes = Number.parseInt(w.tags.lanes, 10);
      if (Number.isFinite(lanes) && lanes > 0) width = Math.max(width, Math.round((lanes * 3.3) / mpp + 2));
      const road = createRoad(`RD_${String(++rd).padStart(4, '0')}`, pts, {
        roadType: type,
        name: w.tags.name || w.tags['name:en'] || w.tags.ref || type,
        width,
        lanes: Number.isFinite(lanes) && lanes > 0 ? Math.min(16, lanes) : d.lanes,
        direction: oneway && type !== 'Pedestrian Road' ? 'One-way' : 'Two-way',
        speedLimit: parseSpeed(w.tags.maxspeed) ?? d.speedLimit,
        surface: { paved: 'Asphalt', asphalt: 'Asphalt', concrete: 'Concrete', paving_stones: 'Cobblestone', sett: 'Cobblestone', cobblestone: 'Cobblestone', gravel: 'Gravel', unpaved: 'Dirt', dirt: 'Dirt', ground: 'Dirt' }[w.tags.surface] || d.surface,
      });
      const mid = pts[Math.floor(pts.length / 2)];
      road.islandId = islandFor(mid)?.id ?? null;
      data.roads.push(road);
      refs.forEach((r, i) => {
        if (!usage.has(r)) usage.set(r, []);
        usage.get(r).push({ road, pointId: road.points[i].id });
      });
    }
    // OSM ways that share a node are connected: link every other use to the first one.
    for (const uses of usage.values()) {
      if (uses.length < 2) continue;
      const [anchor, ...rest] = uses;
      for (const u of rest) {
        if (u.road === anchor.road) continue;
        u.road.connections.push({ pointId: u.pointId, roadId: anchor.road.id, targetPointId: anchor.pointId });
        stats.junctions++;
      }
    }
    stats.roads = data.roads.length;
  }

  // ---- buildings ----
  if (opt.buildings) {
    const assets = new Map(data.assets.map((a) => [a.id, a]));
    const footprints = [];
    for (const w of model.ways) if (w.tags.building && w.tags.building !== 'no' && isClosed(w.refs)) footprints.push({ refs: w.refs, tags: w.tags });
    for (const r of model.relations) {
      if (!r.tags.building || r.tags.type !== 'multipolygon') continue;
      const outers = r.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => wayById.get(m.ref)?.refs).filter(Boolean);
      for (const ring of joinChains(outers)) if (isClosed(ring)) footprints.push({ refs: ring, tags: r.tags });
    }
    if (footprints.length > opt.maxBuildings) warnings.push(`Only the first ${opt.maxBuildings} of ${footprints.length} buildings were imported.`);
    let b = 0;
    for (const f of footprints.slice(0, opt.maxBuildings)) {
      const poly = f.refs.slice(0, -1).map(nodePx).filter(Boolean);
      if (poly.length < 3) { stats.skipped++; continue; }
      const rect = minAreaRect(poly);
      if (!rect || rect.w < 2 || rect.h < 2) { stats.skipped++; continue; }
      // keep rotation within (-45, 45] so images stay roughly upright
      while (rect.rot > 45) { rect.rot -= 90; [rect.w, rect.h] = [rect.h, rect.w]; }
      while (rect.rot <= -45) { rect.rot += 90; [rect.w, rect.h] = [rect.h, rect.w]; }
      const type = buildingTypeOf(f.tags);
      const small = rect.w * rect.h * mpp * mpp < 180;
      const houseLike = ['house', 'detached', 'bungalow', 'semidetached_house', 'hut', 'cabin'].includes(f.tags.building);
      const assetId = BUILDING_ASSET[type] || (type === 'Residential' ? (small || houseLike ? 'AST_HOUSE' : 'AST_RESIDENTIAL') : small ? 'AST_HOUSE' : 'AST_OFFICE');
      const asset = assets.get(assetId);
      const bld = createBuilding(`BLD_${String(++b).padStart(4, '0')}`, asset, round(rect.cx, 2), round(rect.cy, 2), {
        width: round(rect.w, 2), height: round(rect.h, 2), rotation: round(rect.rot, 3),
        buildingType: type,
      });
      bld.name = f.tags.name || f.tags['name:en'] || '';
      if (!bld.name) bld.name = f.tags['addr:housenumber'] ? `${f.tags['addr:street'] || 'Building'} ${f.tags['addr:housenumber']}` : `${type === 'Custom' ? 'Building' : type} ${b}`;
      bld.address = [f.tags['addr:street'], f.tags['addr:housenumber']].filter(Boolean).join(' ');
      bld.owner = f.tags.operator || f.tags.owner || '';
      bld.description = [f.tags.amenity, f.tags.shop, f.tags.office, f.tags.tourism].filter(Boolean).join(', ');
      bld.investigatable = ['Police', 'Hospital', 'Government', 'Hotel'].includes(type);
      bld.hitbox = { type: 'Polygon', points: poly.map((p) => { const l = worldToLocal(bld, p); return { x: round(l.x, 2), y: round(l.y, 2) }; }) };
      bld.islandId = islandFor({ x: bld.x, y: bld.y })?.id ?? null;
      data.buildings.push(bld);
    }
    stats.buildings = data.buildings.length;
  }

  // ---- trees ----
  if (opt.trees) {
    const oak = data.assets.find((a) => a.id === 'AST_OAK');
    const size = Math.max(10, Math.round(9 / mpp));
    let t = 0;
    for (const n of model.nodes.values()) {
      if (n.tags.natural !== 'tree') continue;
      if (t >= 5000) { warnings.push('Only the first 5000 trees were imported.'); break; }
      const p = toPx(meters(n));
      const tree = createProp(`OBJ_${String(++t).padStart(4, '0')}`, oak, p.x, p.y, { width: size, height: size });
      tree.islandId = islandFor(p)?.id ?? null;
      data.objects.push(tree);
    }
    stats.trees = t;
  }

  if (!data.roads.length && opt.roads) warnings.push('No roads were found in this area.');
  return { data, stats, warnings, metersPerPixel: mpp };
}
