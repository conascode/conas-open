// Display objects for each world object type. A view owns up to three parts that live in the
// owning layer's sub-containers: `under` (shadows, road beds), `main`, and `over` (markings, details).
import { Container, Graphics, Sprite, TilingSprite, Texture } from '../../lib/pixi.min.js';
import { boundsOfPoints, offsetPath, offsetRuns, dashPath, pathLength, DEG } from '../utils/geometry.js';
import { sampleRoad } from '../objects/road.js';
import { bridgePath, bridgeStatus } from '../objects/bridge.js';
import { materialTexture, materialCanvas, COASTLINE_STYLE, MATERIAL_COLORS } from './textures.js';
import { TERRAIN_MATERIALS, COLORS } from '../data/constants.js';

const flat = (pts) => {
  const out = new Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { out[i * 2] = pts[i].x; out[i * 2 + 1] = pts[i].y; }
  return out;
};

function strokePath(g, pts, style, closed = false) {
  if (pts.length < 2) return;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (closed) g.closePath();
  g.stroke({ cap: 'round', join: 'round', ...style });
}

function strokeDashed(g, pts, dash, gap, style) {
  for (const seg of dashPath(pts, dash, gap)) strokePath(g, seg, style);
}

// Lines parallel to a path; pieces that would cross over at sharp bends are left out.
function strokeOffset(g, path, offset, style) {
  if (Math.abs(offset) < 1e-6) { strokePath(g, path, style); return; }
  for (const run of offsetRuns(path, offset)) strokePath(g, run, style);
}

function strokeOffsetDashed(g, path, offset, dash, gap, style) {
  const runs = Math.abs(offset) < 1e-6 ? [path] : offsetRuns(path, offset);
  for (const run of runs) strokeDashed(g, run, dash, gap, style);
}

class BaseView {
  constructor(renderer, obj) {
    this.renderer = renderer;
    this.id = obj.id;
    this.parts = {};
    this.visible = true;
  }

  attach(layerContainers) {
    for (const [k, part] of Object.entries(this.parts)) layerContainers[k].addChild(part);
  }

  detach() {
    for (const part of Object.values(this.parts)) part.parent?.removeChild(part);
  }

  setVisible(v) {
    this.visible = v;
    for (const part of Object.values(this.parts)) part.visible = v;
  }

  destroy() {
    this.detach();
    for (const part of Object.values(this.parts)) part.destroy({ children: true });
  }
}

// ---------------- Island ----------------

// Paints terrain cells into a canvas (4px per cell) that is shown as a sprite inside the island mask.
const TERRAIN_RES = 4;
class TerrainSurface {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = null;
    this.sprite = new Sprite(Texture.EMPTY);
    this.patterns = new Map();
    this.key = '';
  }

  pattern(material, terrain) {
    let p = this.patterns.get(material);
    if (!p) {
      p = this.ctx.createPattern(materialCanvas(material), 'repeat');
      this.patterns.set(material, p);
    }
    const s = TERRAIN_RES / terrain.cellSize;
    p.setTransform(new DOMMatrix().scale(s).translate(-terrain.originX, -terrain.originY));
    return p;
  }

  sync(terrain, rect) {
    if (!terrain) { this.sprite.visible = false; return; }
    this.sprite.visible = true;
    const key = `${terrain.cols}x${terrain.rows}@${terrain.cellSize}`;
    if (key !== this.key) {
      this.key = key;
      this.canvas.width = terrain.cols * TERRAIN_RES;
      this.canvas.height = terrain.rows * TERRAIN_RES;
      if (this.texture) this.texture.destroy(true);
      this.texture = Texture.from(this.canvas);
      this.sprite.texture = this.texture;
      rect = null;
    }
    this.sprite.position.set(terrain.originX, terrain.originY);
    this.sprite.scale.set(terrain.cellSize / TERRAIN_RES);
    this.draw(terrain, rect);
    this.texture.source.update();
  }

  // Redraw a cell rect (with a 1-cell margin because cells are drawn as overlapping discs).
  draw(terrain, rect) {
    const { cols, rows, cells } = terrain;
    const r = rect || { c0: 0, r0: 0, c1: cols - 1, r1: rows - 1 };
    const c0 = Math.max(0, r.c0 - 1); const c1 = Math.min(cols - 1, r.c1 + 1);
    const r0 = Math.max(0, r.r0 - 1); const r1 = Math.min(rows - 1, r.r1 + 1);
    const ctx = this.ctx;
    ctx.clearRect(c0 * TERRAIN_RES, r0 * TERRAIN_RES, (c1 - c0 + 1) * TERRAIN_RES, (r1 - r0 + 1) * TERRAIN_RES);
    ctx.save();
    ctx.beginPath();
    ctx.rect(c0 * TERRAIN_RES, r0 * TERRAIN_RES, (c1 - c0 + 1) * TERRAIN_RES, (r1 - r0 + 1) * TERRAIN_RES);
    ctx.clip();
    const rad = TERRAIN_RES * 0.78;
    for (let v = 1; v <= TERRAIN_MATERIALS.length; v++) {
      let any = false;
      ctx.beginPath();
      for (let rr = Math.max(0, r0 - 1); rr <= Math.min(rows - 1, r1 + 1); rr++) {
        for (let cc = Math.max(0, c0 - 1); cc <= Math.min(cols - 1, c1 + 1); cc++) {
          if (cells[rr * cols + cc] !== v) continue;
          any = true;
          const x = (cc + 0.5) * TERRAIN_RES; const y = (rr + 0.5) * TERRAIN_RES;
          ctx.moveTo(x + rad, y);
          ctx.arc(x, y, rad, 0, Math.PI * 2);
        }
      }
      if (any) {
        ctx.fillStyle = this.pattern(TERRAIN_MATERIALS[v - 1], terrain);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  destroy() {
    this.texture?.destroy(true);
  }
}

export class IslandView extends BaseView {
  constructor(renderer, obj) {
    super(renderer, obj);
    this.glow = new Graphics();
    this.body = new Container();
    this.maskG = new Graphics();
    this.base = new TilingSprite({ texture: materialTexture(obj.texture), width: 1, height: 1 });
    this.terrain = new TerrainSurface();
    this.coast = new Graphics();
    this.body.addChild(this.base, this.terrain.sprite, this.maskG);
    this.body.mask = this.maskG;
    const under = new Container();
    under.addChild(this.glow);
    const main = new Container();
    main.addChild(this.body, this.coast);
    this.parts = { under, main };
    this.update(obj);
  }

  update(obj, keys) {
    const poly = flat(obj.polygon);
    const b = boundsOfPoints(obj.polygon);
    const cw = obj.coastline.width;

    if (!keys || keys.some((k) => k === 'polygon' || k === 'coastline')) {
      this.glow.clear();
      this.glow.poly(poly, true).stroke({ width: cw + 70, color: 0x2a6a84, alpha: 0.35, join: 'round' });
      this.glow.poly(poly, true).stroke({ width: cw + 30, color: 0x3f8aa3, alpha: 0.45, join: 'round' });
      this.maskG.clear();
      this.maskG.poly(poly, true).fill(0xffffff);
      this.drawCoast(obj);
    }
    if (!keys || keys.includes('texture')) this.base.texture = materialTexture(obj.texture);
    this.base.position.set(b.minX, b.minY);
    this.base.width = Math.max(1, b.maxX - b.minX);
    this.base.height = Math.max(1, b.maxY - b.minY);
    this.base.tilePosition.set(-b.minX, -b.minY); // world-aligned texture
    if (!keys || keys.includes('terrain')) this.terrain.sync(obj.terrain, null);
  }

  terrainChanged(obj, rect) {
    if (!obj.terrain) { this.terrain.sync(null); return; }
    if (rect && this.terrain.key === `${obj.terrain.cols}x${obj.terrain.rows}@${obj.terrain.cellSize}`) {
      this.terrain.draw(obj.terrain, rect);
      this.terrain.texture.source.update();
    } else this.terrain.sync(obj.terrain, null);
  }

  drawCoast(obj) {
    const g = this.coast;
    g.clear();
    const pts = obj.polygon;
    const n = pts.length;
    const cw = obj.coastline.width;
    const typeOf = (i) => obj.coastline.edgeTypes[i] || obj.coastline.type;
    // Group consecutive edges with the same coastline type into runs.
    const runs = [];
    for (let i = 0; i < n; i++) {
      const t = typeOf(i);
      const last = runs[runs.length - 1];
      if (last && last.type === t) last.pts.push(pts[(i + 1) % n]);
      else runs.push({ type: t, pts: [pts[i], pts[(i + 1) % n]] });
    }
    if (runs.length > 1 && runs[0].type === runs[runs.length - 1].type) {
      const lastRun = runs.pop();
      runs[0].pts = lastRun.pts.concat(runs[0].pts.slice(1));
    }
    const single = runs.length === 1;
    for (const run of runs) {
      const st = COASTLINE_STYLE[run.type];
      const p = single ? pts : run.pts;
      if (cw > 0) strokePath(g, p, { width: cw, color: st.color, cap: single ? 'butt' : 'round' }, single);
      if (run.type === 'Cliff') strokePath(g, p, { width: Math.max(3, cw * 0.35), color: st.edge }, single);
      else if (run.type === 'Seawall') strokePath(g, p, { width: 5, color: st.edge }, single);
      else if (run.type === 'Harbor') {
        strokePath(g, p, { width: 3, color: st.edge }, single);
        const loop = single ? p.concat([p[0]]) : p;
        strokeDashed(g, offsetPath(loop, cw * 0.25), 6, 22, { width: 6, color: 0x3d4248 });
      } else strokePath(g, p, { width: 1.5, color: st.edge, alpha: 0.9 }, single);
    }
  }

  destroy() {
    this.terrain.destroy();
    super.destroy();
  }
}

// ---------------- Area ----------------

export class AreaView extends BaseView {
  constructor(renderer, obj) {
    super(renderer, obj);
    this.g = new Graphics();
    this.parts = { main: this.g };
    this.update(obj);
  }

  update(obj) {
    const color = parseInt(obj.color.slice(1), 16);
    const g = this.g;
    g.clear();
    g.poly(flat(obj.polygon), true).fill({ color, alpha: 0.16 });
    strokeDashed(g, obj.polygon.concat([obj.polygon[0]]), 14, 8, { width: 3, color, alpha: 0.9 });
  }
}

// ---------------- Road ----------------

const SURFACE_COLORS = { Asphalt: 0x3b4046, Concrete: 0x8e9295, Cobblestone: 0x8b7b69, Gravel: 0x9b9384, Dirt: 0x8b6b49 };

export class RoadView extends BaseView {
  constructor(renderer, obj) {
    super(renderer, obj);
    this.bed = new Graphics();
    this.marks = new Graphics();
    this.junctions = new Graphics();
    this.parts = { under: this.bed, main: this.marks, over: this.junctions };
    this.update(obj);
  }

  update(obj) {
    const path = sampleRoad(obj);
    const w = obj.width;
    const surface = SURFACE_COLORS[obj.surface] ?? SURFACE_COLORS.Asphalt;
    const pedestrian = obj.roadType === 'Pedestrian Road' || obj.roadType === 'Alley';
    this.bed.clear();
    strokePath(this.bed, path, { width: w + 6, color: pedestrian ? 0x6e675d : 0xcfcfc6 });
    strokePath(this.bed, path, { width: w, color: surface });

    const g = this.marks;
    g.clear();
    const lanes = obj.lanes;
    if (!pedestrian && lanes > 0 && pathLength(path) > 1) {
      const edge = w / 2 - 3;
      strokeOffset(g, path, edge, { width: 1.4, color: 0xe9e9e2, alpha: 0.85 });
      strokeOffset(g, path, -edge, { width: 1.4, color: 0xe9e9e2, alpha: 0.85 });
      const laneW = (2 * edge) / lanes;
      const twoWay = obj.direction === 'Two-way';
      for (let k = 1; k < lanes; k++) {
        const off = -edge + k * laneW;
        const isCenter = twoWay && lanes % 2 === 0 && k === lanes / 2;
        if (isCenter) continue;
        strokeOffsetDashed(g, path, off, 12, 12, { width: 1.3, color: 0xffffff, alpha: 0.8 });
      }
      if (twoWay && lanes >= 2) {
        const c = lanes % 2 === 0 ? 0 : -edge + Math.floor(lanes / 2) * laneW;
        if (obj.roadType === 'Highway' || obj.roadType === 'Main Road') {
          strokeOffset(g, path, c - 1.6, { width: 1.4, color: 0xf2c94c });
          strokeOffset(g, path, c + 1.6, { width: 1.4, color: 0xf2c94c });
        } else strokeOffsetDashed(g, path, c, 16, 10, { width: 1.6, color: 0xf2c94c });
      }
      if (obj.direction === 'One-way') this.drawArrows(g, path);
    } else if (pedestrian) {
      strokeDashed(g, path, 4, 10, { width: Math.max(2, w * 0.15), color: 0xb9ad98, alpha: 0.6 });
    }

    this.junctions.clear();
    for (const c of obj.connections) {
      const p = obj.points.find((q) => q.id === c.pointId);
      const other = this.renderer.doc.get(c.roadId);
      if (!p || !other) continue;
      const r = Math.max(w, other.width) / 2 + 1;
      // the wider road decides the junction surface
      const jColor = other.width > w ? (SURFACE_COLORS[other.surface] ?? surface) : surface;
      this.junctions.circle(p.x, p.y, r).fill({ color: jColor });
    }
  }

  drawArrows(g, path) {
    const len = pathLength(path);
    for (let s = 40; s < len; s += 120) {
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]; const b = path[i];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + d >= s) {
          const t = (s - acc) / d;
          const x = a.x + (b.x - a.x) * t; const y = a.y + (b.y - a.y) * t;
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const c = Math.cos(ang); const sn = Math.sin(ang);
          const P = (px, py) => [x + px * c - py * sn, y + px * sn + py * c];
          g.poly([...P(6, 0), ...P(-4, -4), ...P(-4, 4)], true).fill({ color: 0xffffff, alpha: 0.75 });
          break;
        }
        acc += d;
      }
    }
  }
}

// ---------------- Bridge ----------------

const BRIDGE_COLORS = {
  'Road Bridge': 0x5d646b, 'Highway Bridge': 0x4f565d, 'Pedestrian Bridge': 0x9a7b55,
  'Railway Bridge': 0x6b5e52, 'Suspension Bridge': 0x5a6168, Drawbridge: 0x6a6f74,
};

export class BridgeView extends BaseView {
  constructor(renderer, obj) {
    super(renderer, obj);
    this.shadow = new Graphics();
    this.deck = new Graphics();
    this.detail = new Graphics();
    this.parts = { under: this.shadow, main: this.deck, over: this.detail };
    this.update(obj);
  }

  update(obj) {
    const path = bridgePath(obj);
    const w = obj.width;
    const color = BRIDGE_COLORS[obj.bridgeType] ?? 0x5d646b;
    this.shadow.clear();
    strokePath(this.shadow, path.map((p) => ({ x: p.x + 8, y: p.y + 10 })), { width: w + 8, color: 0x000000, alpha: 0.28 });

    const g = this.deck;
    g.clear();
    strokePath(g, path, { width: w + 6, color: 0x2b3036 });
    strokePath(g, path, { width: w, color });
    // railings
    strokeOffset(g, path, w / 2, { width: 2.5, color: 0xbfc4c8 });
    strokeOffset(g, path, -w / 2, { width: 2.5, color: 0xbfc4c8 });

    const d = this.detail;
    d.clear();
    switch (obj.bridgeType) {
      case 'Railway Bridge':
        strokeDashed(d, path, 3, 7, { width: w * 0.8, color: 0x4a3b2d, cap: 'butt' });
        strokeOffset(d, path, w * 0.18, { width: 2, color: 0xc9ced2 });
        strokeOffset(d, path, -w * 0.18, { width: 2, color: 0xc9ced2 });
        break;
      case 'Pedestrian Bridge':
        strokeDashed(d, path, 2, 6, { width: w * 0.9, color: 0x7d6143, cap: 'butt' });
        break;
      case 'Suspension Bridge': {
        const len = pathLength(path);
        const towers = [0.22, 0.78].map((t) => pointAt(path, len * t));
        for (const t of towers) d.rect(t.x - w * 0.55, t.y - w * 0.55, w * 1.1, w * 1.1).fill(0x8a9096).stroke({ width: 2, color: 0x30363c });
        strokeOffset(d, path, w / 2 - 1, { width: 2, color: 0xe0b14a, alpha: 0.9 });
        strokeOffset(d, path, -w / 2 + 1, { width: 2, color: 0xe0b14a, alpha: 0.9 });
        break;
      }
      case 'Drawbridge': {
        const len = pathLength(path);
        const m = pointAt(path, len / 2);
        d.circle(m.x, m.y, w * 0.35).fill({ color: 0x1d2328, alpha: 0.6 });
        strokeDashed(d, path, 10, 10, { width: 2, color: 0xf2c94c, alpha: 0.7 });
        break;
      }
      default:
        if (obj.lanes >= 2) strokeDashed(d, path, 14, 10, { width: 1.6, color: 0xf2c94c, alpha: 0.9 });
        break;
    }
    const st = bridgeStatus(obj, (id) => this.renderer.doc.island(id));
    this.status = st.status;
    if (st.status === 'warning') {
      strokeOffsetDashed(d, path, w / 2 + 6, 10, 8, { width: 3, color: COLORS.warning });
      strokeOffsetDashed(d, path, -w / 2 - 6, 10, 8, { width: 3, color: COLORS.warning });
      const m = pointAt(path, pathLength(path) / 2);
      d.circle(m.x, m.y, 12).fill(COLORS.warning).stroke({ width: 2, color: 0x111820 });
      d.rect(m.x - 1.5, m.y - 7, 3, 8).fill(0x111820);
      d.circle(m.x, m.y + 5, 1.8).fill(0x111820);
    }
  }
}

function pointAt(path, s) {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]; const b = path[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + d >= s) {
      const t = d ? (s - acc) / d : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += d;
  }
  return path[path.length - 1];
}

// ---------------- Box objects (building, prop) ----------------

export class SpriteView extends BaseView {
  constructor(renderer, obj) {
    super(renderer, obj);
    this.sprite = new Sprite(Texture.EMPTY);
    this.parts = { main: this.sprite };
    this.update(obj);
  }

  update(obj) {
    const asset = obj.assetId ? this.renderer.doc.asset(obj.assetId) : null;
    this.assetId = obj.assetId;
    this.sprite.texture = this.renderer.assetTextures.get(asset);
    this.sprite.anchor.set(obj.anchorX ?? 0.5, obj.anchorY ?? 0.5);
    this.sprite.position.set(obj.x, obj.y);
    this.sprite.width = obj.width;
    this.sprite.height = obj.height;
    this.sprite.rotation = (obj.rotation || 0) * DEG;
  }
}

export function createView(renderer, obj) {
  switch (obj.type) {
    case 'island': return new IslandView(renderer, obj);
    case 'area': return new AreaView(renderer, obj);
    case 'road': return new RoadView(renderer, obj);
    case 'bridge': return new BridgeView(renderer, obj);
    default: return new SpriteView(renderer, obj);
  }
}

export { MATERIAL_COLORS };
