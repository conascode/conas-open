// Routes canvas input to the active tool and handles camera navigation
// (wheel zoom, middle-mouse / Space / Pan-tool dragging).
import { Emitter } from '../utils/events.js';

export class ToolManager extends Emitter {
  constructor(editor, canvas) {
    super();
    this.editor = editor;
    this.canvas = canvas;
    this.tools = new Map();
    this.active = null;
    this.spaceDown = false;
    this.panning = null;
    this.lastWorld = { x: 0, y: 0 };
    this.lastScreen = { x: 0, y: 0 };
    this.bind();
  }

  register(id, tool) { this.tools.set(id, tool); }

  use(id) {
    const tool = this.tools.get(id);
    if (!tool || tool === this.active) return;
    this.active?.deactivate();
    this.active = tool;
    this.activeId = id;
    tool.activate();
    this.updateCursor();
    this.editor.requestOverlay();
    this.emit('change', id);
  }

  updateCursor() {
    const c = this.panning ? 'grabbing' : this.spaceDown ? 'grab' : this.active?.cursor || 'default';
    this.canvas.style.cursor = c;
  }

  event(e) {
    const r = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    const world = this.editor.camera.screenToWorld(screen);
    return {
      screen, world, button: e.button, buttons: e.buttons,
      shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, raw: e,
    };
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus({ preventScroll: true });
      const ev = this.event(e);
      const panTool = this.activeId === 'pan';
      if (e.button === 1 || (e.button === 0 && (this.spaceDown || panTool))) {
        e.preventDefault();
        this.panning = { x: e.clientX, y: e.clientY };
        c.setPointerCapture(e.pointerId);
        this.updateCursor();
        return;
      }
      c.setPointerCapture(e.pointerId);
      this.active?.onPointerDown(ev);
    });
    c.addEventListener('pointermove', (e) => {
      const ev = this.event(e);
      this.lastWorld = ev.world;
      this.lastScreen = ev.screen;
      this.emit('cursor', ev.world);
      if (this.panning) {
        this.editor.camera.panBy(e.clientX - this.panning.x, e.clientY - this.panning.y);
        this.panning = { x: e.clientX, y: e.clientY };
        return;
      }
      this.active?.onPointerMove(ev);
    });
    const up = (e) => {
      if (this.panning) {
        this.panning = null;
        this.updateCursor();
        return;
      }
      this.active?.onPointerUp(this.event(e));
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', (e) => this.active?.onDoubleClick(this.event(e)));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const ev = this.event(e);
      if (e.ctrlKey || !e.shiftKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.editor.camera.zoomAt(ev.screen, factor);
      } else {
        this.editor.camera.panBy(-e.deltaY, 0);
      }
      this.emit('cursor', this.editor.camera.screenToWorld(ev.screen));
    }, { passive: false });
    c.addEventListener('pointerleave', () => this.emit('cursor', null));
  }

  setSpace(down) {
    this.spaceDown = down;
    this.updateCursor();
  }
}
