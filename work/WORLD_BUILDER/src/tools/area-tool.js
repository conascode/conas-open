// Area tool: polygon zones (investigation areas, restricted zones, spawn areas...).
import { Tool } from './tool.js';
import { PolygonDrawer } from './polygon-drawer.js';
import { createArea } from '../data/defaults.js';
import { AREA_TYPES } from '../data/constants.js';
import { polygonCentroid } from '../utils/geometry.js';
import { h } from '../utils/dom.js';
import { segmented, selectControl } from '../panels/controls.js';

const AREA_COLORS = { Zone: '#4B9DE8', Investigation: '#E8A33D', Restricted: '#E0524D', Spawn: '#4CBF7A', Custom: '#B07CE8' };

export class AreaTool extends Tool {
  constructor(editor) {
    super(editor);
    this.areaType = 'Zone';
    this.drawer = new PolygonDrawer(editor, { onComplete: (pts) => this.create(pts), color: 0xe8a33d });
  }

  get name() { return 'Area'; }
  get cursor() { return 'crosshair'; }
  get hint() { return 'Click to add vertices · double-click to finish · Esc cancels'; }

  create(polygon) {
    const id = this.doc.newId('area');
    const islandId = this.editor.islandAt(polygonCentroid(polygon))?.id ?? null;
    const a = createArea(id, polygon, { areaType: this.areaType, color: AREA_COLORS[this.areaType], islandId, name: `${this.areaType} ${id.split('_')[1]}` });
    this.editor.createObjects([a], 'Create Polygon');
  }

  deactivate() { this.drawer.reset(); }
  onPointerDown(e) { this.drawer.down(e); }
  onPointerMove(e) { this.drawer.move(e); }
  onPointerUp(e) { this.drawer.up(e); }
  onDoubleClick(e) { this.drawer.dblclick(e); }
  cancel() { return this.drawer.cancel(); }
  onKeyDown(e) {
    if (e.key === 'Enter' && this.drawer.active) { this.drawer.finish(); return true; }
    return false;
  }

  drawOverlay(g, zoom) { this.drawer.draw(g, zoom); }

  options() {
    return h('div', { class: 'opts' },
      segmented(['Polygon', 'Freehand'], this.drawer.mode, (v) => { this.drawer.mode = v; this.drawer.reset(); }),
      selectControl('Area type', this.areaType, AREA_TYPES, (v) => { this.areaType = v; }));
  }
}
