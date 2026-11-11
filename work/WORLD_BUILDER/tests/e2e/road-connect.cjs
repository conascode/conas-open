// Connecting an existing road end to another road by dragging it (Select tool).
const { open } = require('./harness.cjs');
(async () => {
  const { browser, page, errors, W, toPage, check, results } = await open();
  const drag = async (a, b) => { const p = await toPage(a.x, a.y); const q = await toPage(b.x, b.y); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up(); };
  const clk = async (x, y) => { const p = await toPage(x, y); await page.mouse.click(p.x, p.y); };
  await W(() => { const { editor } = window.worldBuilder; editor.camera.setZoom(0.7); editor.camera.centerOn({ x: 8600, y: 4700 }); editor.tools.use('road'); });
  await clk(8300, 4500); await clk(8900, 4500); await page.keyboard.press('Enter');
  await clk(8600, 4900); await clk(8600, 4700); await page.keyboard.press('Enter');
  const [A, B] = await W(() => window.worldBuilder.editor.doc.data.roads.slice(-2).map((r) => r.id));
  const get = () => W(([a, b]) => { const d = window.worldBuilder.editor.doc; return { a: d.get(a), b: d.get(b) }; }, [A, B]);
  await page.keyboard.press('1');
  await W((id) => window.worldBuilder.editor.selection.set([id]), B);

  // 1) onto another road's existing point
  await drag({ x: 8600, y: 4700 }, { x: 8903, y: 4503 });
  let r = await get();
  check('end dropped on a road point becomes a junction', r.b.connections.length === 1 && r.b.points[1].x === 8900 && r.b.points[1].y === 4500);
  await page.keyboard.press('Control+z');
  r = await get();
  check('undo removes that junction', r.b.connections.length === 0 && r.b.points[1].y === 4700);

  // 2) onto the middle of another road (no point there)
  await drag({ x: 8600, y: 4700 }, { x: 8600, y: 4508 });
  r = await get();
  const np = r.a.points.find((q) => q.id === r.b.connections[0]?.targetPointId);
  check('end dropped on a road middle inserts a junction point (T-junction)', r.b.connections.length === 1 && r.a.points.length === 3 && np && np.x === 8600 && np.y === 4500 && r.b.points[1].y === 4500, JSON.stringify(r.b.connections));
  // the junction now moves both roads
  await W((id) => window.worldBuilder.editor.selection.set([id]), A);
  await drag({ x: 8600, y: 4500 }, { x: 8650, y: 4450 });
  r = await get();
  check('moving the junction moves both roads', r.b.points[1].x === 8650 && r.b.points[1].y === 4450);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  r = await get();
  check('undo removes inserted point and connection in one step', r.a.points.length === 2 && r.b.connections.length === 0 && r.b.points[1].y === 4700);

  // 3) dropping far from any road connects nothing
  await W((id) => window.worldBuilder.editor.selection.set([id]), B);
  await drag({ x: 8600, y: 4700 }, { x: 8600, y: 4620 });
  r = await get();
  check('dropping away from roads just moves the point', r.b.connections.length === 0 && r.b.points[1].y === 4620);
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter((x) => x.ok).length}/${results.length} passed`);
  await browser.close();
})();
