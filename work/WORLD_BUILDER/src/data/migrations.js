// Project file migrations. Each step upgrades data from one schema version to the next.
// Add new steps to the end of MIGRATIONS when the schema changes.
import { SCHEMA_VERSION } from './constants.js';

export const MIGRATIONS = [
  {
    from: '0.9.0',
    to: '1.0.0',
    // 0.9 files predate facilities/routes/metadata, group ids and per-edge coastline types.
    up(data) {
      data.facilities ??= [];
      data.routes ??= [];
      data.metadata ??= {};
      data.objects ??= [];
      for (const key of ['islands', 'roads', 'bridges', 'buildings', 'facilities', 'objects']) {
        for (const o of data[key] || []) o.groupId ??= null;
      }
      for (const isl of data.islands || []) {
        isl.coastline ??= { type: 'Sand', width: 26 };
        isl.coastline.edgeTypes ??= isl.polygon.map(() => null);
        isl.terrain ??= null;
      }
      return data;
    },
  },
];

const cmp = (a, b) => {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// Returns { data, applied: [versions] } or throws if the file is from a newer version.
export function migrate(data) {
  const applied = [];
  let version = data?.project?.version || '0.9.0';
  if (cmp(version, SCHEMA_VERSION) > 0) {
    throw new Error(`This project was saved by a newer version (${version}). This editor supports up to ${SCHEMA_VERSION}.`);
  }
  for (const step of MIGRATIONS) {
    if (cmp(version, step.from) <= 0 && cmp(version, step.to) < 0) {
      data = step.up(data);
      version = step.to;
      applied.push(step.to);
    }
  }
  if (data.project) data.project.version = SCHEMA_VERSION;
  return { data, applied };
}
