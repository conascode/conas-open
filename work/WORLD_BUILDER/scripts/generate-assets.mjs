// Generates the sample top-down SVG assets in WORLD_BUILDER/assets/.
// Run: node scripts/generate-assets.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p, w, h, body) => {
  const file = join(root, 'assets', p);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`);
};

// Flat roof building: base, roof, parapet, rooftop units.
function building(p, w, h, roof, edge, extras = '') {
  out(p, w, h, `<rect x="4" y="6" width="${w - 6}" height="${h - 6}" rx="3" fill="#000" opacity=".28"/>`
    + `<rect x="2" y="2" width="${w - 6}" height="${h - 6}" rx="3" fill="${roof}" stroke="${edge}" stroke-width="3"/>`
    + `<rect x="8" y="8" width="${w - 18}" height="${h - 18}" rx="2" fill="none" stroke="${edge}" stroke-opacity=".45" stroke-width="1.5"/>${extras}`);
}
const unit = (x, y, w = 14, h = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="#8b949c" stroke="#5a6168"/>`;

building('buildings/office.svg', 160, 160, '#7f93a6', '#3d4c5a', unit(30, 30, 30, 22) + unit(100, 100, 26, 20) + '<circle cx="110" cy="45" r="14" fill="#5d6d7c" stroke="#3d4c5a" stroke-width="2"/><path d="M24 120h40M24 130h40" stroke="#c9d4dd" stroke-width="3"/>');
building('buildings/residential.svg', 140, 100, '#b98b6a', '#6a4a35', unit(22, 22) + unit(100, 60) + '<path d="M70 4v88" stroke="#6a4a35" stroke-width="2" opacity=".6"/>');
out('buildings/house.svg', 80, 70, '<rect x="5" y="6" width="72" height="62" fill="#000" opacity=".25"/><rect x="3" y="3" width="72" height="62" rx="2" fill="#b85d44"/><rect x="3" y="3" width="72" height="31" rx="2" fill="#cf7155"/><path d="M3 34h72" stroke="#7a3727" stroke-width="3"/><path d="M15 12v14M27 12v14M39 12v14M51 12v14M63 12v14" stroke="#b85d44" stroke-width="1.5"/><path d="M15 42v14M27 42v14M39 42v14M51 42v14M63 42v14" stroke="#a24e38" stroke-width="1.5"/><rect x="54" y="8" width="9" height="9" fill="#6b6b6b" stroke="#444"/>');
building('buildings/commercial.svg', 200, 140, '#8aa7a0', '#3e5952', unit(20, 20, 40, 24) + unit(140, 90, 40, 24) + '<rect x="80" y="40" width="40" height="40" rx="4" fill="#bfe3f0" stroke="#3e5952" stroke-width="2"/><path d="M100 40v40M80 60h40" stroke="#3e5952"/>');
building('buildings/industrial.svg', 220, 150, '#8c8f86', '#4a4d45', '<path d="M10 40h200M10 75h200M10 110h200" stroke="#5f625a" stroke-width="3"/><circle cx="185" cy="28" r="14" fill="#5c5f58" stroke="#3a3c36" stroke-width="3"/><circle cx="185" cy="28" r="6" fill="#222"/>' + unit(24, 120, 30, 18));
building('buildings/government.svg', 180, 140, '#d9d2c3', '#7b725f', '<circle cx="90" cy="70" r="30" fill="#b9ae96" stroke="#7b725f" stroke-width="3"/><circle cx="90" cy="70" r="14" fill="#9c8f74"/><rect x="74" y="122" width="32" height="12" fill="#7b725f"/>');
building('buildings/police.svg', 140, 110, '#5d7aa6', '#2b3f5d', '<rect x="50" y="35" width="40" height="40" rx="20" fill="#2b3f5d"/><path d="M70 42l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z" fill="#f2c94c"/>');
building('buildings/hospital.svg', 180, 160, '#e8ecef', '#8796a3', '<rect x="66" y="50" width="48" height="48" rx="24" fill="#d24a43"/><path d="M84 62h12v12h12v12H96v12H84V86H72V74h12z" fill="#fff"/>' + unit(20, 120, 30, 20));
building('buildings/school.svg', 200, 130, '#d7a34f', '#7c5a22', '<rect x="20" y="20" width="60" height="90" fill="#c99441" stroke="#7c5a22" stroke-width="2"/><circle cx="145" cy="65" r="30" fill="#5f9b4c" stroke="#3e6b30" stroke-width="3"/><path d="M145 35v60M115 65h60" stroke="#e8e2c9" stroke-width="2"/>');
building('buildings/hotel.svg', 150, 150, '#9b7fb6', '#4f3d63', '<rect x="45" y="45" width="60" height="60" rx="6" fill="#4fb3d9" stroke="#2e6f87" stroke-width="3"/>' + unit(16, 16) + unit(120, 120));
building('buildings/warehouse.svg', 200, 120, '#a1866b', '#5b4936', '<path d="M10 20h180M10 40h180M10 60h180M10 80h180M10 100h180" stroke="#8a7158" stroke-width="2"/>');
building('objects/tent.svg', 44, 44, '#7ba05b', '#3f5a2a', '<path d="M3 3l38 38M41 3L3 41" stroke="#3f5a2a" stroke-width="2"/>');

// Trees
out('objects/tree-pine.svg', 48, 48, '<circle cx="27" cy="27" r="20" fill="#000" opacity=".25"/><circle cx="24" cy="24" r="21" fill="#2f6b3a"/><circle cx="24" cy="24" r="14" fill="#3b7f46"/><circle cx="24" cy="24" r="7" fill="#4d9658"/>');
out('objects/tree-oak.svg', 56, 56, '<circle cx="31" cy="31" r="23" fill="#000" opacity=".25"/><circle cx="20" cy="22" r="14" fill="#4f8a3a"/><circle cx="36" cy="20" r="13" fill="#5a9a42"/><circle cx="28" cy="36" r="15" fill="#4a8236"/><circle cx="26" cy="26" r="9" fill="#6aac4f"/>');
out('objects/tree-palm.svg', 52, 52, '<circle cx="29" cy="29" r="20" fill="#000" opacity=".2"/><g fill="#4f9a45" stroke="#356b2f" stroke-width="1.5"><path d="M26 26L4 14c8-4 16-2 22 12z"/><path d="M26 26L48 12c-6 0-16 2-22 14z"/><path d="M26 26L10 48c-2-8 4-18 16-22z"/><path d="M26 26l18 20c2-8-6-18-18-20z"/><path d="M26 26L24 2c6 4 6 14 2 24z"/></g><circle cx="26" cy="26" r="4" fill="#7a5a3a"/>');

// Vehicles (pointing up)
out('objects/car.svg', 20, 40, '<rect x="1" y="1" width="18" height="38" rx="5" fill="#c7423b" stroke="#7a221d"/><rect x="3" y="9" width="14" height="7" rx="2" fill="#2d3d4c"/><rect x="3" y="27" width="14" height="6" rx="2" fill="#2d3d4c"/>');
out('objects/bus.svg', 26, 72, '<rect x="1" y="1" width="24" height="70" rx="4" fill="#e3b33c" stroke="#8a6a17"/><rect x="4" y="4" width="18" height="8" rx="2" fill="#2d3d4c"/>' + [20, 32, 44, 56].map((y) => `<rect x="6" y="${y}" width="14" height="6" rx="1" fill="#f3d27a"/>`).join(''));
out('objects/boat.svg', 36, 90, '<path d="M18 1C30 14 34 40 34 70v18H2V70C2 40 6 14 18 1z" fill="#eef1f3" stroke="#6c7a86" stroke-width="2"/><rect x="9" y="40" width="18" height="24" rx="3" fill="#4b9de8" stroke="#2b5f8f"/>');
out('objects/container.svg', 30, 70, '<rect x="1" y="1" width="28" height="68" fill="#c4612f" stroke="#7a3412" stroke-width="2"/>' + [8, 16, 24, 32, 40, 48, 56].map((y) => `<path d="M3 ${y}h24" stroke="#9a4a20" stroke-width="2"/>`).join(''));

// Facilities
out('objects/streetlight.svg', 16, 16, '<circle cx="8" cy="8" r="7" fill="#f2c94c" opacity=".35"/><circle cx="8" cy="8" r="3.5" fill="#fff3c4" stroke="#8a7a3a"/>');
out('objects/fountain.svg', 64, 64, '<circle cx="32" cy="32" r="30" fill="#b7b2a6" stroke="#77715f" stroke-width="2"/><circle cx="32" cy="32" r="24" fill="#4f9ec4"/><circle cx="32" cy="32" r="8" fill="#d9d4c7" stroke="#77715f"/><circle cx="32" cy="32" r="3" fill="#bfe6f5"/>');
out('objects/helipad.svg', 90, 90, '<circle cx="45" cy="45" r="43" fill="#4a5158" stroke="#f2c94c" stroke-width="3"/><circle cx="45" cy="45" r="30" fill="none" stroke="#fff" stroke-width="3"/><path d="M33 28v34M57 28v34M33 45h24" stroke="#fff" stroke-width="6"/>');
out('objects/lighthouse.svg', 56, 56, '<circle cx="31" cy="31" r="22" fill="#000" opacity=".25"/><circle cx="28" cy="28" r="24" fill="#e9e6df" stroke="#9a948a" stroke-width="2"/><circle cx="28" cy="28" r="16" fill="#cf3f37"/><circle cx="28" cy="28" r="8" fill="#f8e7a1" stroke="#8a7a3a"/>');

// Roads / bridges
out('roads/parking.svg', 160, 110, '<rect x="1" y="1" width="158" height="108" rx="4" fill="#3b4046" stroke="#cfcfc6" stroke-width="2"/>' + Array.from({ length: 9 }, (_, i) => `<path d="M${14 + i * 16} 6v30M${14 + i * 16} 74v30" stroke="#e9e9e2" stroke-width="2"/>`).join('') + '<path d="M10 55h140" stroke="#f2c94c" stroke-width="2" stroke-dasharray="10 8"/>');
out('roads/crosswalk.svg', 48, 24, Array.from({ length: 6 }, (_, i) => `<rect x="${2 + i * 8}" y="2" width="5" height="20" fill="#f2f2ec"/>`).join(''));
out('bridges/pier.svg', 40, 160, '<rect x="4" y="6" width="34" height="152" fill="#000" opacity=".25"/><rect x="2" y="2" width="34" height="154" fill="#9a7b55" stroke="#5e4a31" stroke-width="2"/>' + Array.from({ length: 19 }, (_, i) => `<path d="M3 ${10 + i * 8}h32" stroke="#7d6143" stroke-width="1.5"/>`).join(''));

// Terrain / islands
out('terrain/rocks.svg', 96, 80, '<g stroke="#4f524e" stroke-width="2"><path d="M8 50l12-24 22-6 12 18-8 22-28 6z" fill="#8a8d88"/><path d="M50 26l20-14 20 12-2 22-18 8-16-10z" fill="#7a7d78"/><path d="M48 58l18-4 14 10-6 12-20 2z" fill="#959893"/></g>');
out('terrain/pond.svg', 120, 90, '<path d="M10 45C10 18 40 6 64 8s48 14 50 38-26 40-56 40S10 72 10 45z" fill="#d9c48f"/><path d="M18 45c0-22 26-31 46-29s40 12 42 30-22 32-48 32-40-12-40-33z" fill="#2f7193"/><path d="M40 40c6-2 12-2 16 0M60 56c8-2 14-2 20 0" stroke="#fff" stroke-opacity=".25" stroke-width="2" fill="none"/>');
out('terrain/islet.svg', 140, 110, '<path d="M14 58C10 30 40 10 72 12s56 18 54 46-30 44-62 42S18 86 14 58z" fill="#e6d3a0" stroke="#cdb57a" stroke-width="2"/><path d="M28 56c0-20 22-32 44-30s38 14 38 32-22 30-44 30-38-12-38-32z" fill="#80837f"/><circle cx="60" cy="50" r="10" fill="#5a8a3f"/><circle cx="82" cy="62" r="7" fill="#5a8a3f"/>');

out('favicon.svg', 32, 32, '<rect width="32" height="32" rx="7" fill="#111820"/><path d="M5 22c4-1.5 5.5-6.5 11-6.5s6.5 4 11 3" fill="none" stroke="#4B9DE8" stroke-width="2.6" stroke-linecap="round"/><path d="M7 11c2-3.2 5.3-5.2 9-5.2 3.3 0 6 1.4 8 3.6" fill="none" stroke="#7FB8EE" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="15.5" r="2.4" fill="#4B9DE8"/>');
console.log('assets written');
