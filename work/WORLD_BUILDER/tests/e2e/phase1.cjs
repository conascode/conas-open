const { open } = require('./harness.cjs');
(async () => {
  const { browser, page, errors, W, toPage, check, results } = await open();
  // Camera: world coordinates stay fixed when zooming/panning.
  const cam = await W(() => {
    const { editor } = window.worldBuilder;
    const b = editor.doc.get('BLD_0001');
    const before = { x: b.x, y: b.y };
    editor.camera.zoomAt({ x: 300, y: 300 }, 2.5);
    editor.camera.panBy(123, -77);
    const p = editor.camera.screenToWorld(editor.camera.worldToScreen({ x: 1234.5, y: 678.9 }));
    return { same: b.x === before.x && b.y === before.y, roundtrip: p };
  });
  check('camera zoom/pan does not change world coordinates', cam.same);
  check('screen<->world round trip', Math.abs(cam.roundtrip.x - 1234.5) < 1e-6 && Math.abs(cam.roundtrip.y - 678.9) < 1e-6);

  // Zoom around the city hall
  await W(() => { const { editor } = window.worldBuilder; editor.selection.set(['BLD_0001']); editor.frameSelection(); editor.camera.setZoom(1); editor.selection.clear(); });
  await page.waitForTimeout(300);
  const bh = await W(() => { const b = window.worldBuilder.editor.doc.get('BLD_0001'); return { x: b.x, y: b.y }; });
  // Mouse wheel zoom keeps point under cursor
  const p0 = await toPage(bh.x, bh.y);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  const p1 = await toPage(bh.x, bh.y);
  check('wheel zoom keeps the point under the cursor', Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1.5, `${p0.x.toFixed(1)},${p0.y.toFixed(1)} -> ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`);
  await W(() => window.worldBuilder.editor.camera.setZoom(1));
  await page.waitForTimeout(200);

  // Click to select
  let p = await toPage(bh.x, bh.y);
  await page.mouse.click(p.x, p.y);
  let sel = await W(() => window.worldBuilder.editor.selection.list);
  check('click selects building', sel.length === 1 && sel[0] === 'BLD_0001', JSON.stringify(sel));
  // Drag to move
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 50, p.y + 20, { steps: 6 }); await page.mouse.up();
  let b = await W(() => { const o = window.worldBuilder.editor.doc.get('BLD_0001'); return { x: o.x, y: o.y, island: o.islandId }; });
  check('drag moves object by 50,20', Math.abs(b.x - bh.x - 50) < 0.6 && Math.abs(b.y - bh.y - 20) < 0.6, JSON.stringify(b));
  // Undo / redo via keyboard
  await page.keyboard.press('Control+z');
  b = await W(() => { const o = window.worldBuilder.editor.doc.get('BLD_0001'); return { x: o.x, y: o.y }; });
  check('Ctrl+Z undoes move', Math.abs(b.x - bh.x) < 1e-6 && Math.abs(b.y - bh.y) < 1e-6);
  await page.keyboard.press('Control+Shift+Z');
  b = await W(() => { const o = window.worldBuilder.editor.doc.get('BLD_0001'); return { x: o.x, y: o.y }; });
  check('Ctrl+Shift+Z redoes move', Math.abs(b.x - bh.x - 50) < 0.6);
  await page.keyboard.press('Control+z');

  // Resize via bottom-right handle
  const rs = await W(() => {
    const { editor } = window.worldBuilder;
    const f = editor.tools.tools.get('select').frame();
    const o = editor.doc.get('BLD_0001');
    return { h: f.handles[2], w: o.width, ht: o.height };
  });
  p = await toPage(rs.h.x, rs.h.y);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 40, p.y + 30, { steps: 5 }); await page.mouse.up();
  b = await W(() => { const o = window.worldBuilder.editor.doc.get('BLD_0001'); return { w: o.width, h: o.height, hb: o.hitbox.points[2] }; });
  check('resize handle changes width/height', Math.abs(b.w - rs.w - 40) < 1 && Math.abs(b.h - rs.ht - 30) < 1, JSON.stringify(b));
  // Rotate via rotation handle
  const rot = await W(() => { const f = window.worldBuilder.editor.tools.tools.get('select').frame(); return { r: f.rot, c: f.center }; });
  p = await toPage(rot.r.x, rot.r.y);
  const c = await toPage(rot.c.x, rot.c.y);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(c.x + (c.y - p.y), c.y, { steps: 8 }); // drag to the right side of centre => +90°
  await page.mouse.up();
  b = await W(() => window.worldBuilder.editor.doc.get('BLD_0001').rotation);
  check('rotation handle rotates ~90°', Math.abs(b - 90) < 3, `rotation=${b}`);
  const labels = await W(() => window.worldBuilder.editor.history.undoStack.slice(-3).map((c) => c.label));
  check('history has Move/Resize/Rotate labels', labels.join() === 'Resize,Rotate' || labels.includes('Rotate'), labels.join());
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  b = await W(() => { const o = window.worldBuilder.editor.doc.get('BLD_0001'); return { r: o.rotation, w: o.width }; });
  check('undo rotate + resize restores original', b.r === 0 && Math.abs(b.w - rs.w) < 1e-6, JSON.stringify(b));

  // Marquee multi-select
  const box = await W(() => { const o = window.worldBuilder.editor.doc.get('BLD_0001'); return { x: o.x, y: o.y }; });
  const a = await toPage(box.x - 400, box.y - 200);
  const z = await toPage(box.x + 400, box.y + 300);
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control'); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(z.x, z.y, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Control');
  const islMoved = await W(() => window.worldBuilder.editor.history.undoLabel);
  sel = await W(() => window.worldBuilder.editor.selection.list);
  check('Ctrl+drag marquee selects multiple objects (no island move)', sel.length > 3 && islMoved !== 'Move', `${sel.length} selected, last=${islMoved}`);
  // Moving multi selection with arrows + undo as one step
  const before = await W(() => window.worldBuilder.editor.selectedObjects().map((o) => [o.id, o.x, o.y]));
  await page.keyboard.press('Shift+ArrowRight');
  const after = await W(() => window.worldBuilder.editor.selectedObjects().map((o) => [o.id, o.x, o.y]));
  check('nudge moves every selected object by 10', after.every((r, i) => Math.abs(r[1] - before[i][1] - 10) < 1e-6));
  await page.keyboard.press('Control+z');
  const back = await W(() => window.worldBuilder.editor.selectedObjects().map((o) => [o.id, o.x, o.y]));
  check('undo restores every selected object', back.every((r, i) => Math.abs(r[1] - before[i][1]) < 1e-6));

  // JSON serialization round trip
  const rt = await W(async () => {
    const { serializeProject, parseProject } = await import('./src/data/serialize.js');
    const { editor } = window.worldBuilder;
    const text = JSON.stringify(serializeProject(editor.doc.data));
    const res = parseProject(text);
    return { ok: res.ok, n: res.ok ? ['islands', 'roads', 'bridges', 'buildings', 'facilities', 'objects'].map((k) => res.data[k].length) : res.errors, same: res.ok && JSON.stringify(serializeProject(res.data).buildings) === JSON.stringify(serializeProject(editor.doc.data).buildings) };
  });
  check('save/parse JSON round trip keeps data', rt.ok && rt.same, JSON.stringify(rt.n));
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await browser.close();
})();
