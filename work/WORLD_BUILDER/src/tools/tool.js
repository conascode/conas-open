// Base class for editor tools. Tools receive pointer events with both screen and world coordinates.
export class Tool {
  constructor(editor) {
    this.editor = editor;
    this.doc = editor.doc;
  }

  get name() { return 'tool'; }
  get cursor() { return 'default'; }
  get hint() { return ''; }
  activate() {}
  deactivate() {}
  onPointerDown() {}
  onPointerMove() {}
  onPointerUp() {}
  onDoubleClick() {}
  onKeyDown() { return false; }
  // Called by Escape when nothing else handled it. Return true if consumed.
  cancel() { return false; }
  drawOverlay() {}
  options() { return null; }
  requestOverlay() { this.editor.requestOverlay(); }
}
