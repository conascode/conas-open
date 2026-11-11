const { open } = require('./harness.cjs');
(async () => {
  const { browser, page, errors, W, check, results } = await open();
  await page.locator('.menu-btn', { hasText: 'Help' }).dispatchEvent('mousedown');
  await page.locator('.menu-item', { hasText: 'Performance Test' }).click();
  await page.waitForFunction(() => window.lastPerfResult, null, { timeout: 90000 });
  const r = await W(() => window.lastPerfResult);
  console.log(JSON.stringify(r));
  // Culling: at a close zoom only a fraction of objects should be visible
  const cull = await W(() => { const { editor, renderer } = window.worldBuilder; editor.camera.setZoom(1); editor.camera.centerOn({ x: 1500, y: 1500 }); renderer.tick(); return { visible: renderer.stats.visible, total: renderer.stats.total }; });
  check('viewport culling renders only objects in view', cull.visible < cull.total / 5, JSON.stringify(cull));
  // Drag-move 200 objects and undo as one step
  const t = await W(() => {
    const { editor } = window.worldBuilder;
    const ids = editor.doc.data.buildings.slice(0, 200).map((b) => b.id);
    editor.selection.set(ids);
    const t0 = performance.now(); editor.nudge(5, 5); const t1 = performance.now(); editor.undo(); const t2 = performance.now();
    return { move: t1 - t0, undo: t2 - t1 };
  });
  check('moving 200 objects + undo is fast', t.move < 500 && t.undo < 500, JSON.stringify(t));
  const tex = await W(() => { const { renderer } = window.worldBuilder; const set = new Set(); for (const v of renderer.views.values()) if (v.sprite) set.add(v.sprite.texture.uid ?? v.sprite.texture); return set.size; });
  check('textures are shared (few unique textures for 5,000 sprites)', tex < 40, `${tex} unique textures`);
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter((x) => x.ok).length}/${results.length} passed`);
  await browser.close();
})();
