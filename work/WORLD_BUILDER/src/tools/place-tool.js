// Building / Asset placement tools: click to place the asset selected in the Asset Library.
import { Tool } from './tool.js';
import { boxCorners } from '../utils/geometry.js';
import { strokePts } from '../renderer/overlay.js';
import { h } from '../utils/dom.js';
import { rangeControl, hint as hintEl } from '../panels/controls.js';

export class PlaceTool extends Tool {
  constructor(editor, kind) {
    super(editor);
    this.kind = kind; // 'building' | 'asset'
    this.rotation = 0;
    this.cursorPos = null;
  }

  get name() { return this.kind === 'building' ? 'Building' : 'Asset'; }
  get cursor() { return 'copy'; }

  asset() {
    const a = this.doc.asset(this.editor.currentAssetId);
    if (!a) return null;
    if (this.kind === 'building' && a.category !== 'Buildings') return null;
    return a;
  }

  get hint() {
    const a = this.asset();
    if (!a) return this.kind === 'building' ? 'Pick a building in the Asset Library below, then click to place' : 'Pick an asset in the Asset Library below, then click to place';
    return `Click to place "${a.name}" · R rotates 90° · or drag any asset from the library onto the map`;
  }

  activate() {
    if (this.kind === 'building') this.editor.emit('library-category', 'Buildings');
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const a = this.asset();
    if (!a) { this.editor.toast(this.hint, 'warning'); return; }
    this.editor.placeAsset(a, e.world, { rotation: this.rotation });
  }

  onPointerMove(e) {
    this.cursorPos = this.editor.snap(e.world);
    this.requestOverlay();
  }

  onKeyDown(e) {
    if (e.key === 'r' || e.key === 'R') {
      this.rotation = (this.rotation + 90) % 360;
      this.editor.emit('tool-options');
      this.requestOverlay();
      return true;
    }
    return false;
  }

  deactivate() { this.cursorPos = null; }

  drawOverlay(g, zoom) {
    const a = this.asset();
    if (!a || !this.cursorPos) return;
    const box = { x: this.cursorPos.x, y: this.cursorPos.y, width: a.width, height: a.height, rotation: this.rotation, anchorX: a.anchor.x, anchorY: a.anchor.y };
    const c = boxCorners(box);
    g.poly(c.flatMap((p) => [p.x, p.y]), true).fill({ color: 0x4b9de8, alpha: 0.15 });
    strokePts(g, c, true, 1.5 / zoom, 0x4b9de8, 1);
  }

  options() {
    const a = this.asset();
    return h('div', { class: 'opts' },
      hintEl(a ? `Asset: ${a.name} (${a.width}×${a.height})` : 'No asset selected'),
      rangeControl('Rotation', this.rotation, 0, 359, 1, (v) => { this.rotation = v; this.requestOverlay(); }, (v) => `${v}°`));
  }
}

export class PanTool extends Tool {
  get name() { return 'Pan'; }
  get cursor() { return 'grab'; }
  get hint() { return 'Drag to pan · wheel to zoom · middle mouse or Space+drag pans in any tool'; }
}
