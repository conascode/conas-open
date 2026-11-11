// Procedural textures (terrain materials, ocean) and asset texture loading/caching.
// Textures are created once and shared by every object that uses them.
import { Texture } from '../../lib/pixi.min.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
function shade(color, amt) {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (color & 255) + amt));
  return (r << 16) | (g << 8) | b;
}

export const MATERIAL_COLORS = {
  Grass: 0x5a8a3f,
  Sand: 0xd9c48f,
  Rock: 0x80837f,
  Concrete: 0xa6aaae,
  Soil: 0x7c5b3d,
  Water: 0x2f7193,
};

export const COASTLINE_STYLE = {
  Sand: { color: 0xe6d3a0, edge: 0xcdb57a },
  Rock: { color: 0x8a8c88, edge: 0x5f625e },
  Cliff: { color: 0x6b5643, edge: 0x3d3027 },
  Concrete: { color: 0xc4c7ca, edge: 0x8d9195 },
  Harbor: { color: 0x9aa0a6, edge: 0x4e555c },
  Seawall: { color: 0x7d858c, edge: 0x3b4248 },
};

function drawMaterial(ctx, name, size, seed) {
  const r = rng(seed);
  const base = MATERIAL_COLORS[name];
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, size, size);
  const speck = (count, rad, amt) => {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = hex(shade(base, (r() - 0.5) * amt));
      const x = r() * size; const y = r() * size; const s = rad * (0.4 + r());
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * (0.6 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      // wrap so the tile is seamless
      for (const [ox, oy] of [[size, 0], [-size, 0], [0, size], [0, -size]]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, s, s * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  switch (name) {
    case 'Grass': speck(260, 3, 40); speck(40, 7, 20); break;
    case 'Sand': speck(300, 1.6, 30); speck(30, 8, 12); break;
    case 'Rock': speck(60, 10, 40); speck(200, 2, 50); break;
    case 'Soil': speck(160, 3, 36); speck(30, 9, 20); break;
    case 'Concrete': {
      speck(400, 1, 22);
      ctx.strokeStyle = hex(shade(base, -18));
      ctx.lineWidth = 1;
      for (let i = 0; i <= size; i += size / 2) {
        ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(size, i + 0.5); ctx.stroke();
      }
      break;
    }
    case 'Water': {
      speck(40, 12, 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        const x = r() * size; const y = r() * size;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 6, y - 3, x + 12, y); ctx.stroke();
      }
      break;
    }
    default: break;
  }
}

const canvasCache = new Map();
// 128px seamless canvas tile for a material (also used as a 2D canvas pattern for terrain painting).
export function materialCanvas(name) {
  if (canvasCache.has(name)) return canvasCache.get(name);
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  drawMaterial(c.getContext('2d'), name, size, name.length * 977 + 13);
  canvasCache.set(name, c);
  return c;
}

const texCache = new Map();
export function materialTexture(name) {
  if (!texCache.has(name)) {
    const t = Texture.from(materialCanvas(name));
    t.source.addressMode = 'repeat';
    texCache.set(name, t);
  }
  return texCache.get(name);
}

export function oceanTexture(color = 0x173b50) {
  const key = `ocean:${color}`;
  if (texCache.has(key)) return texCache.get(key);
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const r = rng(42);
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = hex(shade(color, (r() - 0.5) * 10));
    const x = r() * size; const y = r() * size; const s = 10 + r() * 30;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath(); ctx.ellipse(x + ox, y + oy, s, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const x = r() * size; const y = r() * size; const w = 10 + r() * 18;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w / 2, y - 4, x + w, y); ctx.stroke();
  }
  const t = Texture.from(c);
  t.source.addressMode = 'repeat';
  texCache.set(key, t);
  return t;
}

// Placeholder for assets that are loading or missing.
export function placeholderTexture(missing) {
  const key = missing ? 'ph:missing' : 'ph:loading';
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = missing ? '#5a1f22' : '#2a3642';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = missing ? '#e0524d' : '#4b5b6a';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 61, 61);
  if (missing) {
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(56, 56); ctx.moveTo(56, 8); ctx.lineTo(8, 56); ctx.stroke();
  }
  const t = Texture.from(c);
  texCache.set(key, t);
  return t;
}

// Loads asset images (via the asset store URL resolver), rasterizes them and caches one texture per asset.
export class AssetTextures {
  constructor(resolveUrl) {
    this.resolveUrl = resolveUrl; // async (asset) => url | null
    this.cache = new Map(); // assetId -> { state, texture, promise, image }
    this.listeners = new Set();
  }

  onLoad(fn) { this.listeners.add(fn); }

  state(assetId) { return this.cache.get(assetId)?.state || 'none'; }

  get(asset) {
    if (!asset) return placeholderTexture(true);
    let e = this.cache.get(asset.id);
    if (!e) {
      e = { state: 'loading', texture: null };
      this.cache.set(asset.id, e);
      e.promise = this._load(asset, e);
    }
    if (e.state === 'ready') return e.texture;
    return placeholderTexture(e.state === 'missing');
  }

  async _load(asset, e) {
    try {
      const url = await this.resolveUrl(asset);
      if (!url) throw new Error('missing');
      const img = await loadImage(url);
      const canvas = rasterize(img, asset);
      e.canvas = canvas;
      e.texture = Texture.from(canvas);
      e.state = 'ready';
    } catch {
      e.state = 'missing';
    }
    for (const fn of this.listeners) fn(asset.id, e.state);
  }

  canvasOf(assetId) { return this.cache.get(assetId)?.canvas; }

  invalidate(assetId) {
    const e = this.cache.get(assetId);
    if (e?.texture) e.texture.destroy(true);
    this.cache.delete(assetId);
  }

  clear() {
    for (const id of [...this.cache.keys()]) this.invalidate(id);
  }
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

// Draw to a canvas (max 512px edge, at least 2x the asset's default size) so SVGs get a fixed resolution.
function rasterize(img, asset) {
  const iw = img.naturalWidth || asset.width || 128;
  const ih = img.naturalHeight || asset.height || 128;
  const aspect = iw / ih;
  let w = Math.max(iw, (asset.width || 64) * 2);
  w = Math.min(512, w);
  const h = Math.max(1, Math.round(w / aspect));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
