// Asset Library (bottom panel) and the asset import / edit dialog.
import { h, icon, refreshIcons, debounce } from '../utils/dom.js';
import { AddCommand, RemoveCommand, PatchCommand } from '../core/commands.js';
import { ASSET_CATEGORIES, ANCHOR_PRESETS, ASSET_MIME } from '../data/constants.js';
import { createAsset } from '../data/defaults.js';
import { loadImage } from '../renderer/textures.js';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ASSET_DRAG_TYPE = 'application/x-world-asset';

export class AssetLibrary {
  constructor(editor, root, ui) {
    this.editor = editor;
    this.doc = editor.doc;
    this.root = root;
    this.ui = ui;
    this.category = 'All';
    this.query = '';
    this.missing = new Set();
    this.build();
    const rerender = debounce(() => this.renderGrid(), 60);
    this.doc.on('reset', () => this.render());
    this.doc.on('change', (c) => { if (c.collection === 'assets') rerender(); });
    editor.on('missing-assets', (ids) => { this.missing = new Set(ids); this.renderGrid(); });
    editor.on('library-category', (cat) => { this.category = cat; this.render(); });
  }

  build() {
    this.tabs = h('div', { class: 'lib-tabs', role: 'tablist' });
    const search = h('input', { class: 'input search', placeholder: 'Search assets…', 'aria-label': 'Search assets', oninput: (e) => { this.query = e.target.value.toLowerCase(); this.renderGrid(); } });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.grid = h('div', { class: 'lib-grid' });
    this.root.replaceChildren(
      h('div', { class: 'lib-head' }, this.tabs, h('div', { class: 'lib-actions' },
        h('div', { class: 'search-wrap' }, icon('search'), search),
        h('button', { class: 'btn small primary', onclick: () => this.openDialog() }, icon('upload'), 'Import Asset'))),
      this.grid);
    refreshIcons(this.root);
  }

  render() {
    const counts = new Map();
    for (const a of this.doc.assets) counts.set(a.category, (counts.get(a.category) || 0) + 1);
    this.tabs.replaceChildren(...['All', ...ASSET_CATEGORIES].map((c) => h('button', {
      class: `lib-tab${c === this.category ? ' active' : ''}`, role: 'tab', 'aria-selected': c === this.category ? 'true' : 'false',
      onclick: () => { this.category = c; this.render(); },
    }, c, h('span', { class: 'count' }, String(c === 'All' ? this.doc.assets.length : counts.get(c) || 0)))));
    this.renderGrid();
  }

  filtered() {
    return this.doc.assets.filter((a) => (this.category === 'All' || a.category === this.category)
      && (!this.query || a.name.toLowerCase().includes(this.query) || a.id.toLowerCase().includes(this.query)));
  }

  renderGrid() {
    if (!this.doc.data) return;
    const items = this.filtered();
    if (!items.length) {
      this.grid.replaceChildren(h('div', { class: 'empty small' }, this.query ? 'No assets match the search' : 'No assets in this category — use Import Asset'));
      return;
    }
    this.grid.replaceChildren(...items.map((a) => this.card(a)));
    refreshIcons(this.grid);
  }

  card(a) {
    const img = h('img', { alt: a.name, draggable: 'false' });
    this.editor.assetStore.resolveUrl(a).then((u) => { if (u) img.src = u; else img.replaceWith(h('div', { class: 'missing-thumb' }, icon('image-off'))); refreshIcons(this.grid); });
    const selected = this.editor.currentAssetId === a.id;
    const card = h('div', {
      class: `asset-card${selected ? ' selected' : ''}${this.missing.has(a.id) ? ' missing' : ''}`, draggable: 'true', tabindex: 0,
      title: `${a.name}\n${a.id} · ${a.category}\n${a.width}×${a.height} · anchor ${a.anchor.preset}\nDrag onto the map or click then place with the Building/Asset tool`,
      onclick: () => this.select(a.id),
      ondblclick: () => this.editor.placeAsset(a, this.editor.camera.screenToWorld({ x: this.editor.camera.viewWidth / 2, y: this.editor.camera.viewHeight / 2 })),
      onkeydown: (e) => { if (e.key === 'Enter') this.select(a.id); },
    },
    h('div', { class: 'thumb' }, img),
    h('div', { class: 'asset-name' }, a.name),
    h('div', { class: 'asset-meta' }, a.category),
    h('div', { class: 'card-actions' },
      h('button', { class: 'icon-btn tiny', title: 'Edit asset', 'aria-label': `Edit ${a.name}`, onclick: (e) => { e.stopPropagation(); this.openDialog(a); } }, icon('pencil')),
      h('button', { class: 'icon-btn tiny danger', title: 'Delete asset', 'aria-label': `Delete ${a.name}`, onclick: (e) => { e.stopPropagation(); this.deleteAsset(a); } }, icon('trash-2'))));
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id);
      e.dataTransfer.setData('text/plain', a.id);
      e.dataTransfer.effectAllowed = 'copy';
      this.select(a.id);
    });
    return card;
  }

  select(id) {
    this.editor.currentAssetId = id;
    const a = this.doc.asset(id);
    for (const el of this.grid.querySelectorAll('.asset-card')) el.classList.remove('selected');
    this.renderGrid();
    // Switch to the matching placement tool unless the user is already placing.
    const t = this.editor.tools.activeId;
    if (t !== 'building' && t !== 'asset') this.editor.tools.use(a?.category === 'Buildings' ? 'building' : 'asset');
    this.editor.emit('tool-options');
    this.editor.emit('hint');
  }

  references(assetId) {
    const refs = [];
    for (const key of ['buildings', 'facilities', 'objects']) for (const o of this.doc.data[key]) if (o.assetId === assetId) refs.push(o);
    return refs;
  }

  async deleteAsset(a) {
    const refs = this.references(a.id);
    if (refs.length) {
      this.ui.warnings(`Cannot delete "${a.name}"`, [
        `${refs.length} object(s) still use this asset. Change or delete them first:`,
        ...refs.slice(0, 20).map((o) => `${o.id} — ${o.name}`),
        ...(refs.length > 20 ? [`…and ${refs.length - 20} more`] : []),
      ]);
      return;
    }
    if (!(await this.ui.confirm('Delete asset', `Delete "${a.name}" (${a.id}) from the project?`, 'Delete'))) return;
    this.editor.execute(new RemoveCommand(this.doc, [a.id], 'Delete Asset'));
    if (this.editor.currentAssetId === a.id) this.editor.currentAssetId = null;
    this.editor.toast(`Deleted asset ${a.name}`);
  }

  // Import (asset = undefined) or edit an existing asset.
  async openDialog(asset) {
    const editing = !!asset;
    const state = {
      file: null, image: null, url: null,
      name: asset?.name || '', category: asset?.category || (this.category !== 'All' ? this.category : 'Buildings'),
      width: asset?.width || 128, height: asset?.height || 128,
      anchorPreset: asset?.anchor.preset || 'Center', ax: asset?.anchor.x ?? 0.5, ay: asset?.anchor.y ?? 0.5,
    };
    if (editing) {
      const u = await this.editor.assetStore.resolveUrl(asset);
      if (u) { try { state.image = await loadImage(u); } catch { /* missing */ } }
    }
    const err = h('div', { class: 'field-error' });
    const preview = h('canvas', { class: 'asset-preview', width: 260, height: 200 });
    const fileInput = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml', class: 'input' });
    const nameIn = h('input', { class: 'input', value: state.name });
    const catIn = h('select', { class: 'input' }, ASSET_CATEGORIES.map((c) => h('option', { value: c, selected: c === state.category }, c)));
    const wIn = h('input', { class: 'input num', type: 'number', min: 1, value: state.width });
    const hIn = h('input', { class: 'input num', type: 'number', min: 1, value: state.height });
    const anchorIn = h('select', { class: 'input' }, [...Object.keys(ANCHOR_PRESETS), 'Custom'].map((c) => h('option', { value: c, selected: c === state.anchorPreset }, c)));
    const axIn = h('input', { class: 'input num', type: 'number', min: 0, max: 1, step: 0.05, value: state.ax });
    const ayIn = h('input', { class: 'input num', type: 'number', min: 0, max: 1, step: 0.05, value: state.ay });
    const customRow = h('div', { class: 'field-row' }, h('label', { class: 'field' }, h('span', {}, 'Anchor X (0–1)'), axIn), h('label', { class: 'field' }, h('span', {}, 'Anchor Y (0–1)'), ayIn));

    const draw = () => {
      const ctx = preview.getContext('2d');
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.fillStyle = '#0e151c';
      ctx.fillRect(0, 0, preview.width, preview.height);
      for (let x = 0; x < preview.width; x += 16) for (let y = 0; y < preview.height; y += 16) {
        if (((x + y) / 16) % 2) { ctx.fillStyle = '#16212b'; ctx.fillRect(x, y, 16, 16); }
      }
      const w = Number(wIn.value) || 1; const hh = Number(hIn.value) || 1;
      const s = Math.min((preview.width - 40) / w, (preview.height - 40) / hh);
      const dw = w * s; const dh = hh * s;
      const x0 = (preview.width - dw) / 2; const y0 = (preview.height - dh) / 2;
      if (state.image) ctx.drawImage(state.image, x0, y0, dw, dh);
      else { ctx.fillStyle = '#2a3642'; ctx.fillRect(x0, y0, dw, dh); }
      ctx.strokeStyle = '#4b9de8';
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, dw - 1, dh - 1);
      const ax = x0 + state.ax * dw; const ay = y0 + state.ay * dh;
      ctx.strokeStyle = '#e8a33d';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax - 9, ay); ctx.lineTo(ax + 9, ay); ctx.moveTo(ax, ay - 9); ctx.lineTo(ax, ay + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(ax, ay, 4, 0, Math.PI * 2); ctx.stroke();
    };
    const syncAnchor = () => {
      state.anchorPreset = anchorIn.value;
      customRow.style.display = state.anchorPreset === 'Custom' ? '' : 'none';
      if (state.anchorPreset !== 'Custom') { state.ax = ANCHOR_PRESETS[state.anchorPreset].x; state.ay = ANCHOR_PRESETS[state.anchorPreset].y; axIn.value = state.ax; ayIn.value = state.ay; } else { state.ax = Number(axIn.value); state.ay = Number(ayIn.value); }
      draw();
    };
    anchorIn.addEventListener('change', syncAnchor);
    axIn.addEventListener('input', syncAnchor);
    ayIn.addEventListener('input', syncAnchor);
    wIn.addEventListener('input', draw);
    hIn.addEventListener('input', draw);
    for (const el of [nameIn, wIn, hIn, axIn, ayIn]) el.addEventListener('keydown', (e) => e.stopPropagation());
    fileInput.addEventListener('change', async () => {
      err.textContent = '';
      const f = fileInput.files[0];
      if (!f) return;
      const ext = f.name.split('.').pop().toLowerCase();
      if (!ASSET_MIME[ext]) { err.textContent = 'Unsupported format. Use PNG, JPG, WebP or SVG.'; return; }
      if (f.size > MAX_FILE_BYTES) { err.textContent = 'File is larger than 15 MB.'; return; }
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = URL.createObjectURL(f);
      try {
        state.image = await loadImage(state.url);
      } catch {
        err.textContent = 'The image could not be decoded.';
        state.image = null;
        return;
      }
      state.file = f;
      if (!nameIn.value) nameIn.value = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const nw = state.image.naturalWidth || 128; const nh = state.image.naturalHeight || 128;
      const k = Math.min(1, 256 / Math.max(nw, nh));
      wIn.value = Math.max(1, Math.round(nw * k));
      hIn.value = Math.max(1, Math.round(nh * k));
      draw();
    });
    syncAnchor();

    const body = h('div', { class: 'asset-dialog' },
      h('div', { class: 'asset-form' },
        h('label', { class: 'field' }, h('span', {}, editing ? '1. Replace image (optional)' : '1. Image file (PNG, JPG, WebP, SVG)'), fileInput),
        h('label', { class: 'field' }, h('span', {}, '2. Asset name'), nameIn),
        h('label', { class: 'field' }, h('span', {}, '3. Category'), catIn),
        h('div', { class: 'field-row' }, h('label', { class: 'field' }, h('span', {}, '4. Default width'), wIn), h('label', { class: 'field' }, h('span', {}, 'Default height'), hIn)),
        h('label', { class: 'field' }, h('span', {}, '5. Anchor'), anchorIn),
        customRow,
        err),
      h('div', { class: 'asset-preview-wrap' }, h('span', { class: 'field-label' }, '6. Preview (orange = anchor)'), preview));

    const result = await this.ui.modal({
      title: editing ? `Edit asset ${asset.id}` : 'Import Asset', body, width: 640, iconName: 'image-plus',
      buttons: [{ label: 'Cancel', value: null }, {
        label: editing ? 'Save changes' : '7. Save asset', kind: 'primary',
        value: () => ({ name: nameIn.value.trim(), category: catIn.value, width: Number(wIn.value), height: Number(hIn.value) }),
      }],
    });
    if (state.url && !result) URL.revokeObjectURL(state.url);
    if (!result) return;
    const problems = [];
    if (!result.name) problems.push('Asset name is required');
    if (!(result.width > 0) || !(result.height > 0)) problems.push('Default width and height must be greater than 0');
    if (!(state.ax >= 0 && state.ax <= 1 && state.ay >= 0 && state.ay <= 1)) problems.push('Custom anchor must be between 0 and 1');
    if (!editing && !state.file) problems.push('Choose an image file');
    if (problems.length) {
      await this.ui.errors('Asset not saved', problems);
      return this.openDialog(asset);
    }
    const anchor = { preset: state.anchorPreset, x: state.ax, y: state.ay };
    if (editing) {
      const patch = { name: result.name, category: result.category, width: result.width, height: result.height, anchor };
      if (state.file) {
        const ext = state.file.name.split('.').pop().toLowerCase();
        patch.mime = ASSET_MIME[ext];
        patch.path = `assets/${folderFor(result.category)}/${asset.id}.${ext === 'jpeg' ? 'jpg' : ext}`;
        patch.builtin = false;
        await this.editor.assetStore.putBlob(asset.id, state.file);
      }
      this.editor.execute(PatchCommand.from(this.doc, [[asset.id, patch]], 'Edit Asset'));
      this.editor.renderer.refreshAsset(asset.id, true);
      this.editor.toast(`Updated ${result.name}`, 'success');
    } else {
      const id = this.doc.newId('asset');
      const ext = state.file.name.split('.').pop().toLowerCase();
      const a = createAsset(id, {
        name: result.name, category: result.category, path: `assets/${folderFor(result.category)}/${id}.${ext === 'jpeg' ? 'jpg' : ext}`,
        mime: ASSET_MIME[ext], width: result.width, height: result.height, anchor,
      });
      await this.editor.assetStore.putBlob(id, state.file);
      this.editor.execute(new AddCommand(this.doc, [{ collection: 'assets', obj: a }], 'Import Asset'));
      this.category = result.category;
      this.render();
      this.select(id);
      this.editor.toast(`Imported ${a.name} as ${id}`, 'success');
    }
    if (state.url) URL.revokeObjectURL(state.url);
  }
}

function folderFor(category) {
  return { Buildings: 'buildings', Roads: 'roads', Bridges: 'bridges', Terrain: 'terrain', Islands: 'terrain' }[category] || 'objects';
}
