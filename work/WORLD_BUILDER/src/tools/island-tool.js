// Island tool: create islands by polygon clicks or freehand drawing.
import { Tool } from './tool.js';
import { PolygonDrawer } from './polygon-drawer.js';
import { createIsland } from '../data/defaults.js';
import { ISLAND_TYPES, TERRAIN_MATERIALS, COASTLINE_TYPES } from '../data/constants.js';
import { h } from '../utils/dom.js';
import { segmented, selectControl, rangeControl } from '../panels/controls.js';

export class IslandTool extends Tool {
  constructor(editor) {
    super(editor);
    this.opts = { islandType: 'Urban', texture: 'Grass', coastlineType: 'Sand' };
    this.drawer = new PolygonDrawer(editor, { onComplete: (pts) => this.create(pts) });
  }

  get name() { return 'Island'; }
  get cursor() { return 'crosshair'; }
  get hint() {
    return this.drawer.mode === 'Polygon'
      ? 'Click to add vertices · double-click or click the first point to finish · right-click removes last · Esc cancels'
      : 'Drag to draw the outline · release to finish (simplified automatically) · Esc cancels';
  }

  create(polygon) {
    const id = this.doc.newId('island');
    const isl = createIsland(id, polygon, { ...this.opts, name: `Island ${this.doc.data.islands.length + 1}` });
    this.editor.createObjects([isl], 'Create Polygon');
    this.editor.toast(`Created ${isl.name} (${polygon.length} vertices)`, 'success');
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
      segmented(['Polygon', 'Freehand'], this.drawer.mode, (v) => { this.drawer.mode = v; this.drawer.reset(); this.editor.emit('hint'); }),
      selectControl('Type', this.opts.islandType, ISLAND_TYPES, (v) => { this.opts.islandType = v; }),
      selectControl('Texture', this.opts.texture, TERRAIN_MATERIALS, (v) => { this.opts.texture = v; }),
      selectControl('Coast', this.opts.coastlineType, COASTLINE_TYPES, (v) => { this.opts.coastlineType = v; }),
      rangeControl('Simplify', this.drawer.tolerance, 1, 20, 1, (v) => { this.drawer.tolerance = v; }, (v) => `${v}px`));
  }
}
