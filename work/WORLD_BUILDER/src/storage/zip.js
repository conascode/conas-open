// ZIP project packages:
//   <PROJECT_NAME>/project.world.json
//   <PROJECT_NAME>/assets/...        (asset images at their asset.path)
//   <PROJECT_NAME>/thumbnails/preview.png
//   <PROJECT_NAME>/metadata.json
import { serializeProject, parseProject } from '../data/serialize.js';
import { APP_VERSION } from '../data/constants.js';

const JSZipLib = () => {
  const Z = globalThis.JSZip;
  if (!Z) throw new Error('JSZip is not loaded');
  return Z;
};

export function safeFolderName(name) {
  return (name || 'WORLD').replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'WORLD';
}

// getAssetBlob(asset) -> Promise<Blob|null>
export async function buildProjectZip(data, getAssetBlob, thumbnailBlob = null) {
  const JSZip = JSZipLib();
  const zip = new JSZip();
  const root = safeFolderName(data.project.name);
  const folder = zip.folder(root);
  const json = serializeProject(data);
  folder.file('project.world.json', JSON.stringify(json, null, 2));
  const missing = [];
  const usedIds = new Set();
  for (const key of ['buildings', 'facilities', 'objects']) for (const o of data[key]) if (o.assetId) usedIds.add(o.assetId);
  let count = 0;
  for (const asset of data.assets) {
    const blob = await getAssetBlob(asset);
    if (!blob) { missing.push(asset.id); continue; }
    folder.file(asset.path, await blob.arrayBuffer());
    count++;
  }
  folder.folder('thumbnails');
  if (thumbnailBlob) folder.file('thumbnails/preview.png', await thumbnailBlob.arrayBuffer());
  const counts = {};
  for (const key of ['islands', 'roads', 'bridges', 'buildings', 'facilities', 'objects']) counts[key] = data[key].length;
  folder.file('metadata.json', JSON.stringify({
    format: 'world-builder-package',
    appVersion: APP_VERSION,
    projectVersion: json.project.version,
    projectName: json.project.name,
    exportedAt: new Date().toISOString(),
    assetFiles: count,
    missingAssets: missing,
    usedAssets: [...usedIds],
    counts,
  }, null, 2));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const blob = new Blob([bytes], { type: 'application/zip' });
  return { blob, missing, root };
}

// Returns { ok, data, errors, warnings, assetBlobs: Map(assetId -> Blob), metadata }
export async function readProjectZip(fileOrBlob) {
  const JSZip = JSZipLib();
  let zip;
  try {
    const input = typeof fileOrBlob?.arrayBuffer === 'function' ? await fileOrBlob.arrayBuffer() : fileOrBlob;
    zip = await JSZip.loadAsync(input);
  } catch (e) {
    return { ok: false, errors: [`Not a valid ZIP file: ${e.message}`], warnings: [] };
  }
  const entry = Object.values(zip.files).find((f) => !f.dir && /(^|\/)project\.world\.json$/.test(f.name));
  if (!entry) return { ok: false, errors: ['The ZIP does not contain project.world.json'], warnings: [] };
  const prefix = entry.name.slice(0, entry.name.length - 'project.world.json'.length);
  const text = await entry.async('string');
  const res = parseProject(text);
  if (!res.ok) return res;
  let metadata = null;
  const metaEntry = zip.file(`${prefix}metadata.json`);
  if (metaEntry) {
    try { metadata = JSON.parse(await metaEntry.async('string')); } catch { res.warnings.push('metadata.json is not valid JSON (ignored)'); }
  }
  const assetBlobs = new Map();
  for (const asset of res.data.assets) {
    const f = zip.file(prefix + asset.path);
    if (f) {
      const bytes = await f.async('uint8array');
      assetBlobs.set(asset.id, new Blob([bytes], { type: asset.mime }));
    } else if (!asset.builtin) res.warnings.push(`Missing Asset: ${asset.id} (${asset.path}) is not in the package`);
  }
  return { ...res, assetBlobs, metadata };
}
