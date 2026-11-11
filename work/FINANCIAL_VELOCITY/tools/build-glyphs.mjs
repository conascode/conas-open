// Extracts glyph outlines from Pretendard Black (OTF) into src/glyphs.json so the film can
// build real extruded 3D letters with THREE.ExtrudeGeometry (no fake / generated characters).
// Usage: node tools/build-glyphs.mjs <path-to-opentype.js-module>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opentype = (await import(pathToFileURL(process.argv[2]).href)).default;
const buf = readFileSync(join(root, 'fonts', 'Pretendard-Black.otf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Words rendered as solid 3D type. Each entry is laid out with real font advance widths.
const WORDS = ['C', 'O', 'N', 'A', 'S', '2026', '98.42', '+12.8%', '145.82', '-3.41%', '자본', '혁신', '연결', '미래', '가치', '성장', 'CAPITAL', 'VELOCITY', 'EQUITY'];
const out = { font: 'Pretendard Black', unitsPerEm: font.unitsPerEm, ascender: font.ascender, words: {} };
for (const w of WORDS) {
  const size = 1; // em = 1 world unit
  const path = font.getPath(w, 0, 0, size);
  const cmds = path.commands.map((c) => {
    const r = (v) => Math.round(v * 10000) / 10000;
    switch (c.type) {
      case 'M': case 'L': return [c.type, r(c.x), r(-c.y)];
      case 'Q': return ['Q', r(c.x1), r(-c.y1), r(c.x), r(-c.y)];
      case 'C': return ['C', r(c.x1), r(-c.y1), r(c.x2), r(-c.y2), r(c.x), r(-c.y)];
      default: return ['Z'];
    }
  });
  const missing = [...w].filter((ch) => font.charToGlyph(ch).index === 0);
  if (missing.length) throw new Error(`Font has no glyph for ${missing.join('')}`);
  const bb = path.getBoundingBox();
  out.words[w] = { cmds, width: Math.round((bb.x2 - bb.x1) * 10000) / 10000, minX: bb.x1, maxY: -bb.y1, minY: -bb.y2, advance: font.getAdvanceWidth(w, size) };
}
writeFileSync(join(root, 'src', 'glyphs.json'), JSON.stringify(out));
console.log(`glyphs.json: ${WORDS.length} words, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
