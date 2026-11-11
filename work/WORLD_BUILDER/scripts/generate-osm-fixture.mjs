// Writes tests/fixtures/coastal-town.osm: a small synthetic coastal town in the same XML
// format that openstreetmap.org "Export" produces. Used by the OSM importer tests.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'coastal-town.osm');
const nodes = []; const ways = []; const rels = [];
let nid = 1000; let wid = 5000; let rid = 9000;
const node = (lat, lon, tags = {}) => { const id = ++nid; nodes.push({ id, lat, lon, tags }); return id; };
const way = (refs, tags) => { const id = ++wid; ways.push({ id, refs, tags }); return id; };
const rect = (lat0, lon0, lat1, lon1) => { const a = node(lat0, lon0); return [a, node(lat0, lon1), node(lat1, lon1), node(lat1, lon0), a]; };
const ring = (lat, lon, rLat, rLon, n, wob = 0) => {
  const ids = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; const k = 1 + Math.sin(t * 3) * wob; ids.push(node(lat + Math.sin(t) * rLat * k, lon + Math.cos(t) * rLon * k)); }
  return [...ids, ids[0]]; // counter-clockwise (y up): land on the left
};

// Mainland coastline, west -> east (land to the north), split into two ways, extends past the box.
const coast = [];
for (let i = 0; i <= 20; i++) { const lon = 126.8985 + i * 0.0009; coast.push(node(37.5045 + Math.sin(i * 0.8) * 0.0004, lon)); }
way(coast.slice(0, 11), { natural: 'coastline' });
way(coast.slice(10), { natural: 'coastline' });

// Offshore island (closed coastline ring) with a place node
way(ring(37.5020, 126.9075, 0.0009, 0.0012, 18, 0.08), { natural: 'coastline' });
node(37.5020, 126.9070, { place: 'island', name: 'Gulmaegi-do' });

// Roads
const J1 = node(37.5080, 126.9075); const J2 = node(37.5080, 126.9040);
const primary = [node(37.5081, 126.8995), node(37.5082, 126.9020), J2, J1, node(37.5079, 126.9110), node(37.5078, 126.9155)];
way(primary, { highway: 'primary', name: 'Haebyeon-ro', maxspeed: '50', lanes: '4' });
const S = node(37.5052, 126.9075);
way([node(37.5110, 126.9075), J1, node(37.5065, 126.9075), S], { highway: 'residential', name: 'Sandbox-gil' });
const islandMid = node(37.5022, 126.9075);
way([S, node(37.5040, 126.9075), node(37.5030, 126.9075), islandMid], { highway: 'secondary', bridge: 'yes', layer: '1', name: 'Seom-daegyo' });
way([node(37.5022, 126.9066), islandMid, node(37.5021, 126.9085)], { highway: 'residential', name: 'Seom-ro' });
way([J2, node(37.5095, 126.9042), node(37.5108, 126.9045)], { highway: 'tertiary', oneway: 'yes', name: 'Ilbang-gil' });
way([node(37.5098, 126.9100), node(37.5103, 126.9120), node(37.5099, 126.9135)], { highway: 'footway', name: 'Park path' });
way([node(37.5070, 126.9120), node(37.5072, 126.9135)], { highway: 'service', service: 'parking_aisle' });

// Buildings
way(rect(37.5084, 126.9050, 37.5088, 126.9058), { building: 'yes', amenity: 'police', name: 'Haebyeon Police Station', 'addr:street': 'Haebyeon-ro', 'addr:housenumber': '12' });
way(rect(37.5090, 126.9080, 37.5097, 126.9092), { building: 'school', name: 'Haebyeon Elementary School' });
const house = [node(37.5070, 126.9060), node(37.50715, 126.90625), node(37.50700, 126.90645), node(37.50685, 126.90620)];
way([...house, house[0]], { building: 'house', 'addr:street': 'Sandbox-gil', 'addr:housenumber': '3' });
way(rect(37.5070, 126.9085, 37.5075, 126.9095), { building: 'apartments', name: 'Bada Apartments' });
way(rect(37.5023, 126.9078, 37.5026, 126.9082), { building: 'yes', name: 'Island Store', shop: 'convenience' });

// Land use / water
way(ring(37.5100, 126.9010, 0.0004, 0.0005, 14), { natural: 'water', name: 'Seo Lake' });
way(rect(37.5047, 126.9020, 37.5056, 126.9060), { natural: 'beach' });
way(rect(37.5066, 126.9110, 37.5076, 126.9140), { landuse: 'commercial' });
const parkA = [node(37.5095, 126.9095), node(37.5095, 126.9140), node(37.5110, 126.9140)];
const parkB = [parkA[2], node(37.5110, 126.9095), parkA[0]];
const pa = way(parkA, {}); const pb = way(parkB, {});
rels.push({ id: ++rid, members: [{ type: 'way', ref: pa, role: 'outer' }, { type: 'way', ref: pb, role: 'outer' }], tags: { type: 'multipolygon', leisure: 'park', name: 'Haebyeon Park' } });
way([node(37.5115, 126.8990), node(37.5105, 126.9000), node(37.5098, 126.9012)], { waterway: 'stream', name: 'Small stream' });

// Trees
node(37.5100, 126.9105, { natural: 'tree' }); node(37.5102, 126.9112, { natural: 'tree' }); node(37.5085, 126.9030, { natural: 'tree' });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const tagXml = (t) => Object.entries(t).map(([k, v]) => `\n    <tag k="${esc(k)}" v="${esc(v)}"/>`).join('');
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="WORLD BUILDER test fixture" copyright="synthetic test data" attribution="https://www.openstreetmap.org/copyright" license="https://opendatacommons.org/licenses/odbl/1-0/">\n';
xml += ' <bounds minlat="37.5000000" minlon="126.9000000" maxlat="37.5120000" maxlon="126.9150000"/>\n';
for (const n of nodes) {
  const t = tagXml(n.tags);
  xml += t ? ` <node id="${n.id}" visible="true" version="1" lat="${n.lat.toFixed(7)}" lon="${n.lon.toFixed(7)}">${t}\n </node>\n` : ` <node id="${n.id}" visible="true" version="1" lat="${n.lat.toFixed(7)}" lon="${n.lon.toFixed(7)}"/>\n`;
}
for (const w of ways) xml += ` <way id="${w.id}" visible="true" version="1">${w.refs.map((r) => `\n  <nd ref="${r}"/>`).join('')}${tagXml(w.tags)}\n </way>\n`;
for (const r of rels) xml += ` <relation id="${r.id}" visible="true" version="1">${r.members.map((m) => `\n  <member type="${m.type}" ref="${m.ref}" role="${m.role}"/>`).join('')}${tagXml(r.tags)}\n </relation>\n`;
xml += '</osm>\n';
writeFileSync(out, xml);
console.log(`fixture written: ${nodes.length} nodes, ${ways.length} ways, ${rels.length} relations`);
