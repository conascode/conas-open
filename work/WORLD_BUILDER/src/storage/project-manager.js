// Project lifecycle: new / open / save / save as / export JSON / export & import ZIP,
// File System Access API with download fallbacks, and IndexedDB autosave + recovery.
import { createProjectData } from '../data/defaults.js';
import { parseProject, projectToJSONText, serializeProject } from '../data/serialize.js';
import { buildProjectZip, readProjectZip, safeFolderName } from './zip.js';
import { idb } from './idb.js';
import { renderThumbnail, canvasToBlob } from '../utils/thumbnail.js';
import { downloadBlob, debounce } from '../utils/dom.js';

const hasFSA = () => typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';

export class ProjectManager {
  constructor(editor, ui) {
    this.editor = editor;
    this.ui = ui;
    this.fileHandle = null;
    this.fileKind = null; // 'json' | 'zip'
    this.fileName = null;
    this.lastAutosave = null;
    this.autosave = debounce(() => this.writeAutosave(), 2000);
    editor.doc.on('change', () => { if (editor.settings.autosave) this.autosave(); });
    editor.on('settings', ({ key }) => {
      if (key === 'autosaveDelay') this.resetAutosaveTimer();
    });
    this.resetAutosaveTimer();
    window.addEventListener('beforeunload', (e) => {
      if (this.editor.dirty) {
        this.autosave.flush();
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  resetAutosaveTimer() {
    this.autosave?.cancel();
    this.autosave = debounce(() => this.writeAutosave(), Math.max(0.5, this.editor.settings.autosaveDelay) * 1000);
  }

  get canUseFileSystem() { return hasFSA(); }

  // ---------- loading ----------

  async load(data, { name, handle = null, kind = null, warnings = [], dirty = false } = {}) {
    const ed = this.editor;
    ed.selection.clear();
    ed.setHitboxEdit(null);
    ed.renderer.assetTextures.clear();
    ed.doc.load(data);
    ed.history.clear();
    this.fileHandle = handle;
    this.fileKind = kind;
    this.fileName = name || null;
    ed.dirty = dirty;
    ed.emit('dirty', dirty);
    ed.emit('project');
    ed.fitWorld();
    const missing = await this.findMissingAssets();
    const all = [...warnings];
    if (missing.length) all.push(...missing.map((a) => `Missing Asset: ${a.id} "${a.name}" (${a.path})`));
    if (all.length) this.ui.warnings('Project loaded with warnings', all);
    return { missing };
  }

  async findMissingAssets() {
    const missing = [];
    const store = this.editor.assetStore;
    await Promise.all(this.editor.doc.assets.map(async (a) => { if (!(await store.has(a))) missing.push(a); }));
    this.editor.emit('missing-assets', missing.map((a) => a.id));
    return missing;
  }

  async newProject() {
    if (!(await this.confirmDiscard())) return;
    const name = await this.ui.prompt('New Project', 'Project name', 'NEW_WORLD');
    if (name === null) return;
    await this.load(createProjectData(safeFolderName(name)), {});
    this.editor.toast('New project created', 'success');
    this.writeAutosave();
  }

  async confirmDiscard() {
    if (!this.editor.dirty) return true;
    return this.ui.confirm('Unsaved changes', 'The current project has unsaved changes. Continue and discard them?', 'Discard');
  }

  // Open a .json or .zip file object.
  async openFile(file, handle = null) {
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
    let res;
    if (isZip) {
      res = await readProjectZip(file);
      if (res.ok) for (const [id, blob] of res.assetBlobs) await this.editor.assetStore.putBlob(id, blob);
    } else {
      res = parseProject(await file.text());
    }
    if (!res.ok) {
      this.ui.errors(`Could not open ${file.name}`, res.errors);
      return false;
    }
    await this.load(res.data, { name: file.name, handle, kind: isZip ? 'zip' : 'json', warnings: res.warnings });
    this.editor.toast(`Opened ${file.name}`, 'success');
    this.writeAutosave();
    return true;
  }

  async open() {
    if (!(await this.confirmDiscard())) return;
    if (hasFSA()) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'WORLD BUILDER project', accept: { 'application/json': ['.json'], 'application/zip': ['.zip'] } }],
        });
        const file = await handle.getFile();
        await this.openFile(file, handle);
      } catch (e) {
        if (e.name !== 'AbortError') this.ui.errors('Open failed', [e.message]);
      }
      return;
    }
    const file = await this.ui.pickFile('.json,.zip,application/json,application/zip');
    if (file) await this.openFile(file);
  }

  async importZip() {
    if (!(await this.confirmDiscard())) return;
    const file = await this.ui.pickFile('.zip,application/zip');
    if (file) await this.openFile(file);
  }

  async openUrl(url, name) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseProject(await res.text());
      if (!parsed.ok) { this.ui.errors(`Could not open ${name}`, parsed.errors); return false; }
      await this.load(parsed.data, { name, warnings: parsed.warnings });
      return true;
    } catch (e) {
      this.ui.errors(`Could not load ${name}`, [e.message]);
      return false;
    }
  }

  // ---------- saving ----------

  jsonBlob() {
    return new Blob([projectToJSONText(this.editor.doc.data)], { type: 'application/json' });
  }

  async zipBlob() {
    let thumb = null;
    try { thumb = await canvasToBlob(renderThumbnail(this.editor.doc.data)); } catch { thumb = null; }
    const res = await buildProjectZip(this.editor.doc.data, (a) => this.editor.assetStore.getBlob(a), thumb);
    if (res.missing.length) this.ui.warnings('Some assets were not packaged', res.missing.map((id) => `Missing Asset: ${id}`));
    return res.blob;
  }

  baseName() { return safeFolderName(this.editor.doc.project.name); }

  async save() {
    if (this.fileHandle && hasFSA()) {
      try {
        const blob = this.fileKind === 'zip' ? await this.zipBlob() : this.jsonBlob();
        const w = await this.fileHandle.createWritable();
        await w.write(blob);
        await w.close();
        this.markSaved(this.fileHandle.name);
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        this.ui.errors('Save failed', [e.message]);
        return false;
      }
    }
    return this.saveAs();
  }

  async saveAs() {
    if (hasFSA()) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${this.baseName()}.world.json`,
          types: [
            { description: 'WORLD BUILDER project (JSON)', accept: { 'application/json': ['.json'] } },
            { description: 'WORLD BUILDER package (ZIP)', accept: { 'application/zip': ['.zip'] } },
          ],
        });
        const kind = /\.zip$/i.test(handle.name) ? 'zip' : 'json';
        const blob = kind === 'zip' ? await this.zipBlob() : this.jsonBlob();
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        this.fileHandle = handle;
        this.fileKind = kind;
        this.markSaved(handle.name);
        return true;
      } catch (e) {
        if (e.name !== 'AbortError') this.ui.errors('Save failed', [e.message]);
        return false;
      }
    }
    // Fallback: download the JSON file.
    this.exportJSON();
    this.markSaved(`${this.baseName()}.world.json`);
    return true;
  }

  exportJSON() {
    downloadBlob(this.jsonBlob(), `${this.baseName()}.world.json`);
    this.editor.toast('Exported JSON', 'success');
  }

  async exportZip() {
    this.editor.toast('Packaging ZIP…');
    const blob = await this.zipBlob();
    downloadBlob(blob, `${this.baseName()}.zip`);
    this.editor.toast(`Exported ZIP (${(blob.size / 1024).toFixed(0)} KB)`, 'success');
    return blob;
  }

  markSaved(name) {
    this.fileName = name;
    this.editor.dirty = false;
    this.editor.emit('dirty', false);
    this.editor.emit('saved', name);
    this.editor.toast(`Saved ${name}`, 'success');
    this.writeAutosave();
  }

  // ---------- autosave / recovery ----------

  async writeAutosave() {
    if (!this.editor.doc.data) return;
    try {
      const json = JSON.stringify(serializeProject(this.editor.doc.data));
      const rec = { savedAt: Date.now(), name: this.editor.doc.project.name, fileName: this.fileName, dirty: this.editor.dirty, json };
      await idb.put('autosave', 'current', rec);
      this.lastAutosave = rec.savedAt;
      this.editor.emit('autosaved', rec.savedAt);
    } catch (e) {
      console.warn('Autosave failed', e);
    }
  }

  async readAutosave() {
    try { return (await idb.get('autosave', 'current')) || null; } catch { return null; }
  }

  async restoreAutosave(rec, dirty) {
    const res = parseProject(rec.json);
    if (!res.ok) { this.ui.errors('Recovery failed', res.errors); return false; }
    await this.load(res.data, { name: rec.fileName, warnings: res.warnings, dirty });
    return true;
  }
}
