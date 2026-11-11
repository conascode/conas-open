const { open } = require('./harness.cjs');
(async () => {
  const { browser, page, errors, W, toPage, check, results } = await open();
  const click = async (x, y, opts) => { const p = await toPage(x, y); await page.mouse.click(p.x, p.y, opts); };
  const drag = async (pts, steps = 6) => { let p = await toPage(pts[0].x, pts[0].y); await page.mouse.move(p.x, p.y); await page.mouse.down(); for (const q of pts.slice(1)) { p = await toPage(q.x, q.y); await page.mouse.move(p.x, p.y, { steps }); } await page.mouse.up(); };
  // Empty ocean area around (2000, 8500), zoom 0.25
  await W(() => { const { editor } = window.worldBuilder; editor.camera.setZoom(0.25); editor.camera.centerOn({ x: 2200, y: 8200 }); editor.selection.clear(); });
  await page.waitForTimeout(200);

  // --- Island polygon tool ---
  await page.keyboard.press('3');
  const n0 = await W(() => window.worldBuilder.editor.doc.data.islands.length);
  const poly = [{ x: 1400, y: 7600 }, { x: 2700, y: 7500 }, { x: 3000, y: 8600 }, { x: 1700, y: 9000 }];
  for (const q of poly) await click(q.x, q.y);
  const last = await toPage(1300, 8300);
  await page.mouse.dblclick(last.x, last.y);
  let isl = await W(() => { const d = window.worldBuilder.editor.doc.data.islands; return d.length > 0 ? d[d.length - 1] : null; });
  check('polygon island created by clicks + double-click', (await W(() => window.worldBuilder.editor.doc.data.islands.length)) === n0 + 1 && isl.polygon.length === 5, `vertices=${isl.polygon.length}`);
  const islId = isl.id;
  // Esc cancels an in-progress polygon
  await click(4000, 9800); await click(4300, 9800); await page.keyboard.press('Escape');
  check('Esc cancels polygon drawing', (await W(() => window.worldBuilder.editor.doc.data.islands.length)) === n0 + 1);

  // --- Freehand island ---
  await W(() => { const t = window.worldBuilder.editor.tools.tools.get('island'); t.drawer.mode = 'Freehand'; });
  const fh = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; fh.push({ x: 8600 + Math.cos(a) * 500, y: 8600 + Math.sin(a) * 350 }); }
  await W(() => { const { editor } = window.worldBuilder; editor.camera.centerOn({ x: 8600, y: 8600 }); });
  await drag(fh, 2);
  const fhIsl = await W(() => { const d = window.worldBuilder.editor.doc.data.islands; return d[d.length - 1]; });
  check('freehand island created and simplified', fhIsl.id !== islId && fhIsl.polygon.length >= 8 && fhIsl.polygon.length < 60, `vertices=${fhIsl.polygon.length}`);
  await W(() => { window.worldBuilder.editor.tools.tools.get('island').drawer.mode = 'Polygon'; window.worldBuilder.editor.camera.centerOn({ x: 2200, y: 8200 }); });

  // --- Coastline: move / add / remove vertex ---
  await W((id) => window.worldBuilder.editor.selection.set([id]), islId);
  await page.keyboard.press('4');
  isl = await W((id) => window.worldBuilder.editor.doc.get(id), islId);
  const v0 = isl.polygon[0];
  await drag([v0, { x: v0.x - 200, y: v0.y - 150 }]);
  isl = await W((id) => window.worldBuilder.editor.doc.get(id), islId);
  check('coastline vertex drag moves vertex', Math.abs(isl.polygon[0].x - (v0.x - 200)) < 3, JSON.stringify(isl.polygon[0]));
  const mid = { x: (isl.polygon[1].x + isl.polygon[2].x) / 2, y: (isl.polygon[1].y + isl.polygon[2].y) / 2 };
  const mp = await toPage(mid.x, mid.y);
  await page.mouse.dblclick(mp.x, mp.y);
  isl = await W((id) => window.worldBuilder.editor.doc.get(id), islId);
  check('double-click edge adds a vertex (edgeTypes stay in sync)', isl.polygon.length === 6 && isl.coastline.edgeTypes.length === 6);
  const v3 = isl.polygon[3];
  const vp = await toPage(v3.x, v3.y);
  await page.keyboard.down('Alt'); await page.mouse.click(vp.x, vp.y); await page.keyboard.up('Alt');
  isl = await W((id) => window.worldBuilder.editor.doc.get(id), islId);
  check('Alt+click removes a vertex', isl.polygon.length === 5 && isl.coastline.edgeTypes.length === 5);
  // Paint coastline edge
  await W(() => { const t = window.worldBuilder.editor.tools.tools.get('coastline'); t.mode = 'Paint'; t.paintType = 'Cliff'; });
  const e1 = { x: (isl.polygon[1].x + isl.polygon[2].x) / 2, y: (isl.polygon[1].y + isl.polygon[2].y) / 2 };
  await click(e1.x, e1.y);
  isl = await W((id) => window.worldBuilder.editor.doc.get(id), islId);
  check('paint mode sets per-edge coastline type', isl.coastline.edgeTypes[1] === 'Cliff', JSON.stringify(isl.coastline.edgeTypes));
  await W(() => { window.worldBuilder.editor.tools.tools.get('coastline').mode = 'Vertices'; });
  await page.keyboard.press('Control+z');
  isl = await W((id) => window.worldBuilder.editor.doc.get(id), islId);
  check('undo coastline paint', isl.coastline.edgeTypes[1] === null);

  // --- Terrain brush ---
  await page.keyboard.press('5');
  await W(() => { const t = window.worldBuilder.editor.tools.tools.get('terrain'); t.material = 'Sand'; t.size = 120; t.strength = 1; t.mode = 'Brush'; });
  const c = { x: 2100, y: 8250 };
  await drag([c, { x: c.x + 300, y: c.y }, { x: c.x + 300, y: c.y + 200 }]);
  isl = await W((id) => { const o = window.worldBuilder.editor.doc.get(id); return { has: !!o.terrain, n: o.terrain ? o.terrain.cells.filter((v) => v === 2).length : 0 }; }, islId);
  check('terrain brush paints Sand cells', isl.has && isl.n > 50, `cells=${isl.n}`);
  // Outside island: no change
  const outside = await W(() => window.worldBuilder.editor.doc.data.islands.reduce((a, i) => a + (i.terrain ? i.terrain.cells.filter((v) => v).length : 0), 0));
  await drag([{ x: 200, y: 200 }, { x: 600, y: 200 }]);
  const outside2 = await W(() => window.worldBuilder.editor.doc.data.islands.reduce((a, i) => a + (i.terrain ? i.terrain.cells.filter((v) => v).length : 0), 0));
  check('brush outside an island changes nothing', outside === outside2);
  // Mask: painting near the coast never marks cells outside the polygon
  const masked = await W(async (id) => {
    const { insideMask } = await import('./src/objects/terrain.js');
    const o = window.worldBuilder.editor.doc.get(id);
    const m = insideMask(o.terrain, o.polygon);
    let bad = 0; o.terrain.cells.forEach((v, i) => { if (v && !m[i]) bad++; });
    return bad;
  }, islId);
  check('terrain stays inside the island polygon mask', masked === 0, `outside cells=${masked}`);
  await W(() => { const t = window.worldBuilder.editor.tools.tools.get('terrain'); t.mode = 'Fill'; t.material = 'Grass'; });
  await click(1600, 8700);
  const fillN = await W((id) => window.worldBuilder.editor.doc.get(id).terrain.cells.filter((v) => v === 1).length, islId);
  check('fill fills the connected region', fillN > 500, `grass cells=${fillN}`);
  await page.keyboard.press('Control+z');
  const fillU = await W((id) => window.worldBuilder.editor.doc.get(id).terrain.cells.filter((v) => v === 1).length, islId);
  check('undo terrain fill (diff-based)', fillU === 0);
  const tsize = await W(() => { const c = window.worldBuilder.editor.history.undoStack.at(-1); return { label: c.label, idx: c.idx?.length ?? c.commands?.at(-1)?.idx?.length }; });
  check('terrain undo record stores only changed cells', tsize.idx > 0 && tsize.idx < 3000, JSON.stringify(tsize));

  // --- Roads with junction ---
  await page.keyboard.press('6');
  await W(() => { const t = window.worldBuilder.editor.tools.tools.get('road'); t.roadType = 'Local Road'; t.width = 30; t.lanes = 2; t.curve = 'Straight'; });
  await click(1500, 8000); await click(2500, 8000);
  let rp = await toPage(2800, 8500); await page.mouse.dblclick(rp.x, rp.y);
  const road1 = await W(() => { const r = window.worldBuilder.editor.doc.data.roads; return r[r.length - 1]; });
  check('road created by clicks + double-click', road1.points.length === 3 && road1.width === 30, `points=${road1.points.length}`);
  // second road starting on road1's middle point (point snap) and crossing road1's segment
  await click(2500, 8000 + 3); await click(2400, 8800);
  rp = await toPage(2400, 8800); await page.keyboard.press('Enter');
  const road2 = await W(() => { const r = window.worldBuilder.editor.doc.data.roads; return r[r.length - 1]; });
  check('road snaps to existing point -> junction', road2.connections.length === 1 && road2.connections[0].roadId === road1.id, JSON.stringify(road2.connections));
  // third road ending on the middle of road1's first segment (segment snap inserts point)
  await click(2000, 7600); rp = await toPage(2000, 8002); await page.mouse.click(rp.x, rp.y); await page.keyboard.press('Enter');
  const r1b = await W((id) => window.worldBuilder.editor.doc.get(id), road1.id);
  const road3 = await W(() => { const r = window.worldBuilder.editor.doc.data.roads; return r[r.length - 1]; });
  check('segment snap inserts a junction point into the other road', r1b.points.length === 4 && road3.connections.length === 1, `road1 points=${r1b.points.length}`);
  // Moving the shared point moves both roads (select tool vertex drag)
  await page.keyboard.press('1');
  await W((id) => window.worldBuilder.editor.selection.set([id]), road1.id);
  const shared = r1b.points[2]; // the original middle point (2500,8000)
  await drag([shared, { x: shared.x + 100, y: shared.y - 100 }]);
  const after = await W(([a, b]) => ({ a: window.worldBuilder.editor.doc.get(a).points, b: window.worldBuilder.editor.doc.get(b).points }), [road1.id, road2.id]);
  check('dragging a junction point moves the linked road point too', Math.abs(after.a[2].x - after.b[0].x) < 1e-6 && Math.abs(after.b[0].y - (shared.y - 100)) < 2, `${JSON.stringify(after.a[2])} vs ${JSON.stringify(after.b[0])}`);
  await page.keyboard.press('Control+z');
  const undone = await W((id) => window.worldBuilder.editor.doc.get(id).points[0], road2.id);
  check('undo restores both linked roads', Math.abs(undone.x - 2500) < 2 && Math.abs(undone.y - 8000) < 5, JSON.stringify(undone));

  // --- Bridge between the new polygon island and the freehand island? use sample: Port Industrial (ISL_0003) to new island ---
  await page.keyboard.press('7');
  isl = await W((id) => window.worldBuilder.editor.doc.get(id), islId);
  const right = isl.polygon.reduce((a, p) => (p.x > a.x ? p : a));
  const south = await W(() => window.worldBuilder.editor.doc.get('ISL_0003').polygon);
  const left = south.reduce((a, p) => (p.x < a.x ? p : a));
  await W(() => window.worldBuilder.editor.camera.centerOn({ x: 3600, y: 8300 }));
  await click(right.x, right.y);
  await click((right.x + left.x) / 2, (right.y + left.y) / 2 - 150);
  await click(left.x, left.y);
  const br = await W(() => { const b = window.worldBuilder.editor.doc.data.bridges; return b[b.length - 1]; });
  const brStatus = await W(async (id) => { const { bridgeStatus } = await import('./src/objects/bridge.js'); const { editor } = window.worldBuilder; return bridgeStatus(editor.doc.get(id), (x) => editor.doc.island(x)); }, br.id);
  check('bridge created between two islands with a control point', br.startIslandId === islId && br.endIslandId === 'ISL_0003' && br.controlPoints.length === 1 && brStatus.status === 'connected', JSON.stringify(brStatus));
  // Move the island away -> bridge becomes warning
  await page.keyboard.press('1');
  await W((id) => { const { editor } = window.worldBuilder; editor.selection.set([id]); editor.nudge(-600, 0); }, islId);
  const warn = await W(async (id) => { const { bridgeStatus } = await import('./src/objects/bridge.js'); const { editor } = window.worldBuilder; return bridgeStatus(editor.doc.get(id), (x) => editor.doc.island(x)); }, br.id);
  check('bridge shows warning when an end is no longer on its island', warn.status === 'warning', warn.problems.join('; '));
  await page.keyboard.press('Control+z');
  // Same island start/end rejected
  await page.keyboard.press('7');
  await click(right.x, right.y);
  const isl2 = await W((id) => window.worldBuilder.editor.doc.get(id).polygon, islId);
  const toastCount = await W(() => document.querySelectorAll('.toast').length);
  await click(isl2[0].x, isl2[0].y);
  const brCount = await W(() => window.worldBuilder.editor.doc.data.bridges.length);
  check('bridge end on the same island is rejected', brCount === 4, `bridges=${brCount}`);
  await page.keyboard.press('Escape');

  // --- Buildings: building tool + drag & drop ---
  await W(() => { const { editor } = window.worldBuilder; editor.camera.setZoom(0.6); editor.camera.centerOn({ x: 2100, y: 8300 }); });
  await page.keyboard.press('8');
  await W(() => { window.worldBuilder.editor.currentAssetId = 'AST_HOTEL'; });
  const nb = await W(() => window.worldBuilder.editor.doc.data.buildings.length);
  await click(2000, 8400);
  const bld = await W(() => { const b = window.worldBuilder.editor.doc.data.buildings; return b[b.length - 1]; });
  check('building tool places selected building asset', (await W(() => window.worldBuilder.editor.doc.data.buildings.length)) === nb + 1 && bld.assetId === 'AST_HOTEL' && bld.islandId === islId, `${bld.id} island=${bld.islandId}`);
  // drag & drop from the library
  const dest = await toPage(2300, 8500);
  await page.evaluate(({ x, y }) => {
    const card = [...document.querySelectorAll('.asset-card')].find((c) => c.textContent.includes('Police Station'));
    const host = document.querySelector('#canvas-host');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    host.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  }, dest);
  const dropped = await W(() => { const b = window.worldBuilder.editor.doc.data.buildings; return b[b.length - 1]; });
  check('drag & drop from asset library creates a building', dropped.assetId === 'AST_POLICE' && Math.abs(dropped.x - 2300) < 3, `${dropped.id} at ${dropped.x.toFixed(0)},${dropped.y.toFixed(0)}`);
  // Hitbox editing
  await page.keyboard.press('1');
  await W((id) => { const { editor } = window.worldBuilder; editor.selection.set([id]); editor.setHitboxEdit(id); }, dropped.id);
  const hb0 = await W((id) => { const o = window.worldBuilder.editor.doc.get(id); return { o: { x: o.x, y: o.y, r: o.rotation }, p: o.hitbox.points[0] }; }, dropped.id);
  const hw = { x: hb0.o.x + hb0.p.x, y: hb0.o.y + hb0.p.y };
  await drag([hw, { x: hw.x + 20, y: hw.y + 15 }]);
  const hb1 = await W((id) => window.worldBuilder.editor.doc.get(id).hitbox.points[0], dropped.id);
  check('hitbox vertex can be edited (local coords)', Math.abs(hb1.x - hb0.p.x - 20) < 1.5 && Math.abs(hb1.y - hb0.p.y - 15) < 1.5, JSON.stringify(hb1));
  await W(() => window.worldBuilder.editor.setHitboxEdit(null));
  // Duplicate + delete
  await page.keyboard.press('Control+d');
  const dup = await W(() => window.worldBuilder.editor.selection.list);
  check('Ctrl+D duplicates with a new ID', dup.length === 1 && dup[0] !== dropped.id, dup[0]);
  await page.keyboard.press('Delete');
  check('Delete removes the duplicate', !(await W((id) => window.worldBuilder.editor.doc.has(id), dup[0])));
  // Delete island cascades references
  await W((id) => { const { editor } = window.worldBuilder; editor.selection.set([id]); editor.deleteSelection(); }, islId);
  const casc = await W(([b, bl]) => ({ br: window.worldBuilder.editor.doc.get(b).startIslandId, bld: window.worldBuilder.editor.doc.get(bl).islandId }), [br.id, bld.id]);
  check('deleting an island clears references (no dangling IDs)', casc.br === null && casc.bld === null, JSON.stringify(casc));
  await page.keyboard.press('Control+z');
  const rest = await W(([b, bl, i]) => ({ br: window.worldBuilder.editor.doc.get(b).startIslandId, bld: window.worldBuilder.editor.doc.get(bl).islandId, isl: window.worldBuilder.editor.doc.has(i) }), [br.id, bld.id, islId]);
  check('undo island delete restores island and references', rest.isl && rest.br === islId && rest.bld === islId, JSON.stringify(rest));

  // Area tool
  await page.keyboard.press('9');
  for (const q of [{ x: 1800, y: 8100 }, { x: 2100, y: 8100 }, { x: 2100, y: 8350 }]) await click(q.x, q.y);
  await page.keyboard.press('Enter');
  const area = await W(() => window.worldBuilder.editor.doc.data.objects.filter((o) => o.type === 'area').length);
  check('area tool creates an area polygon', area === 3, `areas=${area}`);

  await W(() => { const { editor } = window.worldBuilder; editor.selection.clear(); editor.camera.setZoom(0.32); editor.camera.centerOn({ x: 3200, y: 8250 }); });
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await browser.close();
})();
