// Run-length encoding for terrain cell arrays: "count*value,count*value".

export function encodeRLE(cells) {
  if (!cells || cells.length === 0) return '';
  const parts = [];
  let prev = cells[0];
  let count = 1;
  for (let i = 1; i < cells.length; i++) {
    if (cells[i] === prev) count++;
    else {
      parts.push(`${count}*${prev}`);
      prev = cells[i];
      count = 1;
    }
  }
  parts.push(`${count}*${prev}`);
  return parts.join(',');
}

export function decodeRLE(text, length) {
  const out = new Uint8Array(length);
  if (!text) return out;
  let i = 0;
  for (const part of text.split(',')) {
    const [c, v] = part.split('*');
    const count = Number(c);
    const value = Number(v);
    if (!Number.isFinite(count) || !Number.isFinite(value) || count < 0) throw new Error(`Invalid terrain data near "${part}"`);
    if (i + count > length) throw new Error('Terrain data longer than grid');
    out.fill(value, i, i + count);
    i += count;
  }
  if (i !== length) throw new Error(`Terrain data length ${i} does not match grid ${length}`);
  return out;
}
