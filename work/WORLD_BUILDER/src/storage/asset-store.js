// Asset image storage. Built-in assets are served from WORLD_BUILDER/assets/;
// imported assets are stored as blobs in IndexedDB (and in a ZIP package on export).
import { idb } from './idb.js';

export class AssetStore {
  constructor(baseUrl) {
    this.baseUrl = baseUrl; // URL of the app root, used to resolve built-in asset paths
    this.blobs = new Map(); // assetId -> Blob
    this.urls = new Map(); // assetId -> object URL
  }

  async putBlob(assetId, blob) {
    this.blobs.set(assetId, blob);
    this.revoke(assetId);
    try { await idb.put('assets', assetId, blob); } catch (e) { console.warn('Could not persist asset', e); }
  }

  async deleteBlob(assetId) {
    this.blobs.delete(assetId);
    this.revoke(assetId);
    try { await idb.delete('assets', assetId); } catch { /* ignore */ }
  }

  revoke(assetId) {
    const u = this.urls.get(assetId);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(assetId);
  }

  async getBlob(asset) {
    if (this.blobs.has(asset.id)) return this.blobs.get(asset.id);
    try {
      const b = await idb.get('assets', asset.id);
      if (b) { this.blobs.set(asset.id, b); return b; }
    } catch { /* IndexedDB unavailable */ }
    if (asset.builtin || asset.path) {
      try {
        const res = await fetch(new URL(asset.path, this.baseUrl));
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size) return blob;
        }
      } catch { /* missing */ }
    }
    return null;
  }

  // URL usable as <img src>. Returns null if the asset image cannot be found.
  async resolveUrl(asset) {
    if (this.urls.has(asset.id)) return this.urls.get(asset.id);
    let blob = this.blobs.get(asset.id);
    if (!blob) {
      try { blob = await idb.get('assets', asset.id); } catch { blob = null; }
      if (blob) this.blobs.set(asset.id, blob);
    }
    if (blob) {
      const u = URL.createObjectURL(blob);
      this.urls.set(asset.id, u);
      return u;
    }
    if (asset.builtin) return new URL(asset.path, this.baseUrl).href;
    // A non-builtin asset whose file sits next to the app (e.g. a project opened from disk)
    try {
      const url = new URL(asset.path, this.baseUrl).href;
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return url;
    } catch { /* missing */ }
    return null;
  }

  async has(asset) {
    return !!(await this.resolveUrl(asset));
  }
}
