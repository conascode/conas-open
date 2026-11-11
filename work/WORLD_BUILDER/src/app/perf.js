// Performance test: builds a project with 5,000+ objects, then pans/zooms the camera and measures FPS.
import { createProjectData, createIsland, createBuilding, createProp, createRoad } from '../data/defaults.js';
import { BUILTIN_ASSETS } from '../data/builtin-assets.js';

export function buildPerfProject(count = 5000) {
  const data = createProjectData('PERF_TEST_5000');
  const buildingAssets = BUILTIN_ASSETS.filter((a) => a.category === 'Buildings');
  const treeAssets = BUILTIN_ASSETS.filter((a) => a.category === 'Trees');
  let seq = 0;
  // 4 x 4 islands across the world
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const cx = 1500 + gx * 2900; const cy = 1500 + gy * 2900;
      const pts = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r = 1250 + Math.sin(i * 1.7 + gx) * 90;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      const isl = createIsland(`ISL_${String(++seq).padStart(4, '0')}`, pts, { name: `Perf Island ${gx},${gy}` });
      data.islands.push(isl);
      data.roads.push(createRoad(`RD_${String(seq).padStart(4, '0')}`, [{ x: cx - 1100, y: cy }, { x: cx + 1100, y: cy }], { roadType: 'Main Road', islandId: isl.id }));
    }
  }
  let b = 0;
  while (data.buildings.length + data.objects.length < count) {
    const isl = data.islands[b % data.islands.length];
    const k = Math.floor(b / data.islands.length);
    const col = k % 18; const row = Math.floor(k / 18);
    const x = isl.x - 950 + col * 112;
    const y = isl.y - 950 + row * 112;
    if (b % 3 === 2) {
      data.objects.push(createProp(`OBJ_${String(b + 1).padStart(5, '0')}`, treeAssets[b % treeAssets.length], x, y, { islandId: isl.id }));
    } else {
      data.buildings.push(createBuilding(`BLD_${String(b + 1).padStart(5, '0')}`, buildingAssets[b % buildingAssets.length], x, y, { width: 70, height: 60, islandId: isl.id }));
    }
    b++;
  }
  return data;
}

// Animate the camera for `ms` and report frame statistics.
export function measureFps(editor, ms = 4000) {
  return new Promise((resolve) => {
    const cam = editor.camera;
    const frames = [];
    const start = performance.now();
    let last = start;
    const w = editor.doc.world;
    const step = (now) => {
      frames.push(now - last);
      last = now;
      const t = (now - start) / ms;
      // zoom in across the map, then zoom out to see everything
      const zoom = t < 0.5 ? 0.6 : 0.06 + (1 - t) * 0.3;
      cam.zoom = zoom;
      cam.centerOn({ x: w.width * (0.2 + 0.6 * t), y: w.height * (0.3 + 0.4 * Math.sin(t * Math.PI)) });
      if (now - start < ms) requestAnimationFrame(step);
      else {
        frames.shift();
        const avg = frames.reduce((a, c) => a + c, 0) / frames.length;
        const sorted = [...frames].sort((a, c) => a - c);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || avg;
        resolve({ frames: frames.length, avgFps: 1000 / avg, p95FrameMs: p95, objects: editor.doc.objectCount() });
      }
    };
    requestAnimationFrame(step);
  });
}
