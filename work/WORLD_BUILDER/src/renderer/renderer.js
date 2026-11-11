// PixiJS renderer: owns the stage, applies the camera, keeps views in sync with the document,
// performs viewport culling through the spatial index, and draws grid + overlay.
import { Application, Container, Graphics, TilingSprite, Text } from '../../lib/pixi.min.js';
import { SpatialIndex } from '../core/spatial-index.js';
import { createView } from './views.js';
import { oceanTexture } from './textures.js';
import { getBounds, hitTest } from '../objects/shapes.js';
import { polygonCentroid } from '../utils/geometry.js';

export class Renderer {
  constructor(doc, camera, assetTextures) {
    this.doc = doc;
    this.camera = camera;
    this.assetTextures = assetTextures;
    this.spatial = new SpatialIndex(256);
    this.views = new Map();
    this.layerContainers = new Map();
    this.labels = new Map();
    this.visibleIds = new Set();
    this.overlayDrawers = [];
    this.lastCamVersion = -1;
    this.cullDirty = true;
    this.overlayDirty = true;
    this.gridDirty = true;
    this.settings = { showGrid: true, showLabels: true };
    this.stats = { fps: 0, visible: 0, total: 0 };
  }

  async init(host) {
    this.host = host;
    this.app = new Application();
    await this.app.init({
      resizeTo: host,
      background: '#0e151c',
      antialias: true,
      preference: 'webgl',
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.classList.add('world-canvas');

    const stage = this.app.stage;
    this.ocean = new TilingSprite({ texture: oceanTexture(), width: 1, height: 1 });
    this.world = new Container();
    this.border = new Graphics();
    this.layerRoot = new Container();
    this.grid = new Graphics();
    this.labelRoot = new Container();
    this.overlay = new Graphics();
    this.world.addChild(this.border, this.layerRoot, this.grid, this.labelRoot, this.overlay);
    stage.addChild(this.ocean, this.world);

    this.assetTextures.onLoad((assetId) => { this.refreshAsset(assetId); this.needsRender = true; });
    this.bindDocument();
    // Render on demand: the default per-frame render is replaced by one that only runs
    // when the camera, document, overlay or textures changed.
    this.app.ticker.remove(this.app.render, this.app);
    this.needsRender = true;
    this.lastRenderAt = 0;
    this.app.ticker.add(() => this.tick());
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(host);
    this.onResize();
  }

  onResize() {
    const r = this.host.getBoundingClientRect();
    this.camera.setViewSize(r.width, r.height);
  }

  bindDocument() {
    const d = this.doc;
    d.on('change', () => { this.needsRender = true; });
    d.on('reset', () => this.rebuildAll());
    d.on('add', ({ collection, obj }) => {
      if (collection === 'layers') this.rebuildLayers();
      else if (obj.type) this.addView(obj);
    });
    d.on('remove', ({ collection, obj }) => {
      if (collection === 'layers') this.rebuildLayers();
      else if (obj.type) this.removeView(obj.id);
    });
    d.on('update', ({ collection, obj, keys }) => {
      if (collection === 'layers') this.applyLayerProps();
      else if (collection === 'assets') this.refreshAsset(obj.id, true);
      else if (obj.type) this.updateView(obj, keys);
    });
    d.on('reorder', ({ collection }) => { if (collection === 'layers') this.rebuildLayers(); });
    d.on('section', ({ section }) => {
      if (section === 'world') {
        this.ocean.texture = oceanTexture(parseInt(this.doc.world.background.slice(1), 16));
        this.drawBorder();
        this.gridDirty = true;
      }
    });
    d.on('terrain', ({ id, rect }) => {
      this.needsRender = true;
      const v = this.views.get(id);
      const obj = this.doc.get(id);
      if (v && obj) v.terrainChanged(obj, rect);
    });
  }

  // ---------- layers ----------

  ensureLayerContainer(layer) {
    let lc = this.layerContainers.get(layer.id);
    if (!lc) {
      const root = new Container();
      const under = new Container(); const main = new Container(); const over = new Container();
      root.addChild(under, main, over);
      lc = { root, under, main, over };
      this.layerContainers.set(layer.id, lc);
    }
    return lc;
  }

  rebuildLayers() {
    const ids = new Set(this.doc.layers.map((l) => l.id));
    for (const [id, lc] of this.layerContainers) {
      if (!ids.has(id)) { lc.root.destroy({ children: false }); this.layerContainers.delete(id); }
    }
    this.layerRoot.removeChildren();
    for (const layer of this.doc.layers) this.layerRoot.addChild(this.ensureLayerContainer(layer).root);
    // Re-attach views whose layer container changed.
    for (const obj of this.doc.objects()) {
      const v = this.views.get(obj.id);
      if (v && v.layerId !== obj.layer) this.attachView(v, obj);
    }
    this.applyLayerProps();
  }

  applyLayerProps() {
    for (const layer of this.doc.layers) {
      const lc = this.ensureLayerContainer(layer);
      lc.root.visible = layer.visible;
      lc.root.alpha = layer.opacity;
    }
    const ocean = this.doc.layer('LYR_OCEAN');
    this.ocean.visible = ocean ? ocean.visible : true;
    this.ocean.alpha = ocean ? ocean.opacity : 1;
    this.overlayDirty = true;
  }

  attachView(view, obj) {
    view.detach();
    const layer = this.doc.layer(obj.layer) || this.doc.layers[this.doc.layers.length - 1];
    view.attach(this.ensureLayerContainer(layer));
    view.layerId = obj.layer;
  }

  // ---------- views ----------

  rebuildAll() {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    for (const t of this.labels.values()) t.destroy();
    this.labels.clear();
    this.spatial.clear();
    this.visibleIds.clear();
    this.rebuildLayers();
    this.ocean.texture = oceanTexture(parseInt(this.doc.world.background.slice(1), 16));
    for (const obj of this.doc.objects()) this.addView(obj, true);
    this.drawBorder();
    this.cullDirty = true;
    this.gridDirty = true;
    this.overlayDirty = true;
  }

  addView(obj) {
    const v = createView(this, obj);
    this.views.set(obj.id, v);
    this.attachView(v, obj);
    this.spatial.insert(obj.id, getBounds(obj));
    v.setVisible(false);
    if (obj.type === 'island') this.updateLabel(obj);
    this.cullDirty = true;
    this.overlayDirty = true;
  }

  removeView(id) {
    const v = this.views.get(id);
    if (v) v.destroy();
    this.views.delete(id);
    this.spatial.remove(id);
    this.visibleIds.delete(id);
    const t = this.labels.get(id);
    if (t) { t.destroy(); this.labels.delete(id); }
    this.overlayDirty = true;
  }

  updateView(obj, keys) {
    const v = this.views.get(obj.id);
    if (!v) return;
    const onlyFlags = keys && keys.every((k) => ['visible', 'locked', 'name', 'groupId', 'description', 'owner', 'address', 'investigatable', 'islandId', 'buildingType', 'islandType', 'elevation', 'speedLimit', 'status'].includes(k));
    if (keys && keys.includes('layer')) this.attachView(v, obj);
    if (!onlyFlags) {
      v.update(obj, keys);
      this.spatial.update(obj.id, getBounds(obj));
      if (obj.type === 'island') this.refreshBridgesFor(obj.id);
    }
    if (obj.type === 'island') this.updateLabel(obj);
    this.refreshVisibility(obj);
    this.overlayDirty = true;
  }

  // Bridges show a warning when their islands move away, so redraw them with the island.
  refreshBridgesFor(islandId) {
    for (const b of this.doc.data.bridges) {
      if (b.startIslandId === islandId || b.endIslandId === islandId) this.views.get(b.id)?.update(b);
    }
  }

  refreshAsset(assetId, reload = false) {
    if (reload) this.assetTextures.invalidate(assetId);
    for (const key of ['buildings', 'facilities', 'objects']) {
      for (const o of this.doc.data[key]) if (o.assetId === assetId) this.views.get(o.id)?.update(o);
    }
  }

  updateLabel(obj) {
    let t = this.labels.get(obj.id);
    if (!t) {
      t = new Text({
        text: '',
        style: { fontFamily: 'Inter, Segoe UI, sans-serif', fontSize: 13, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x0b1117, width: 3 }, letterSpacing: 0.5 },
        resolution: 2,
      });
      t.anchor.set(0.5);
      this.labelRoot.addChild(t);
      this.labels.set(obj.id, t);
    }
    t.text = obj.name;
    const c = polygonCentroid(obj.polygon);
    t.position.set(c.x, c.y);
    t.scale.set(1 / this.camera.zoom);
    t.visible = this.settings.showLabels && obj.visible && (this.doc.layer(obj.layer)?.visible ?? true);
  }

  refreshVisibility(obj) {
    const v = this.views.get(obj.id);
    if (!v) return;
    const inView = this.visibleIds.has(obj.id);
    v.setVisible(inView && obj.visible);
  }

  // ---------- culling ----------

  cull() {
    const rect = this.camera.viewBounds(120);
    const next = this.spatial.query(rect);
    for (const id of this.visibleIds) {
      if (!next.has(id)) this.views.get(id)?.setVisible(false);
    }
    for (const id of next) {
      const obj = this.doc.get(id);
      this.views.get(id)?.setVisible(!!obj?.visible);
    }
    this.visibleIds = next;
    this.stats.visible = next.size;
    this.stats.total = this.views.size;
  }

  // ---------- frame ----------

  tick() {
    const cam = this.camera;
    if (cam.version !== this.lastCamVersion) {
      this.lastCamVersion = cam.version;
      this.world.position.set(cam.offsetX, cam.offsetY);
      this.world.scale.set(cam.zoom);
      this.ocean.width = cam.viewWidth;
      this.ocean.height = cam.viewHeight;
      this.ocean.tileScale.set(Math.max(cam.zoom, 0.05));
      this.ocean.tilePosition.set(cam.offsetX, cam.offsetY);
      for (const t of this.labels.values()) t.scale.set(1 / cam.zoom);
      this.cullDirty = true;
      this.gridDirty = true;
      this.overlayDirty = true;
      this.needsRender = true;
    }
    if (this.cullDirty) { this.cullDirty = false; this.cull(); }
    if (this.gridDirty) { this.gridDirty = false; this.drawGrid(); this.needsRender = true; }
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.overlay.clear();
      for (const fn of this.overlayDrawers) fn(this.overlay, cam.zoom);
      this.needsRender = true;
    }
    const now = performance.now();
    if (this.needsRender || now - this.lastRenderAt > 1000) {
      this.needsRender = false;
      this.app.renderer.render(this.app.stage);
      const ms = performance.now() - now;
      this.stats.renderMs = this.stats.renderMs ? this.stats.renderMs * 0.9 + ms * 0.1 : ms;
      // frames actually rendered per second
      this.frameTimes = (this.frameTimes || []).filter((t) => now - t < 1000);
      this.frameTimes.push(now);
      this.lastRenderAt = now;
    }
    this.stats.fps = this.app.ticker.FPS;
    this.stats.renders = this.frameTimes?.filter((t) => now - t < 1000).length || 0;
  }

  requestOverlay() { this.overlayDirty = true; this.needsRender = true; }

  drawBorder() {
    const w = this.doc.world;
    this.border.clear();
    this.border.rect(0, 0, w.width, w.height).stroke({ width: 6, color: 0x4b9de8, alpha: 0.35 });
  }

  drawGrid() {
    const g = this.grid;
    g.clear();
    if (!this.settings.showGrid) return;
    const cam = this.camera;
    const w = this.doc.world;
    let step = w.gridSize;
    while (step * cam.zoom < 10) step *= 4;
    const major = step * 8;
    const vb = cam.viewBounds(0);
    const x0 = Math.max(0, Math.floor(vb.minX / step) * step);
    const x1 = Math.min(w.width, vb.maxX);
    const y0 = Math.max(0, Math.floor(vb.minY / step) * step);
    const y1 = Math.min(w.height, vb.maxY);
    if (x1 <= x0 || y1 <= y0) return;
    const lw = 1 / cam.zoom;
    for (let x = x0; x <= x1; x += step) g.moveTo(x, Math.max(0, vb.minY)).lineTo(x, y1);
    for (let y = y0; y <= y1; y += step) g.moveTo(Math.max(0, vb.minX), y).lineTo(x1, y);
    g.stroke({ width: lw, color: 0xffffff, alpha: 0.06 });
    for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) g.moveTo(x, Math.max(0, vb.minY)).lineTo(x, y1);
    for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) g.moveTo(Math.max(0, vb.minX), y).lineTo(x1, y);
    g.stroke({ width: lw, color: 0xffffff, alpha: 0.12 });
  }

  // Topmost pickable object at world point p.
  pick(p, { tol = 0, filter } = {}) {
    const ids = this.spatial.queryPoint(p, tol);
    const layers = this.doc.layers;
    let best = null;
    let bestRank = -1;
    for (const id of ids) {
      const obj = this.doc.get(id);
      if (!obj || (filter && !filter(obj))) continue;
      const li = layers.findIndex((l) => l.id === obj.layer);
      const coll = this.doc.data[this.doc.collectionOf(id)];
      const rank = li * 1e7 + kindRank(obj) * 1e6 + coll.indexOf(obj);
      if (rank > bestRank && this.hit(obj, p, tol)) { best = obj; bestRank = rank; }
    }
    return best;
  }

  hit(obj, p, tol) {
    return hitTest(obj, p, tol);
  }
}

// Within one layer, draw/pick order is islands < areas < roads < bridges < boxes.
function kindRank(o) {
  return { island: 0, area: 1, road: 2, bridge: 3 }[o.type] ?? 4;
}
