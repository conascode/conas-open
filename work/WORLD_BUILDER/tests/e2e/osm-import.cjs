// OpenStreetMap import through the editor UI, then routing on the imported map in the Navigator.
const path = require('path');
const { open } = require('./harness.cjs');
(async () => {
  const { browser, context, page, errors, W, check, results } = await open();
  const fixture = path.join(__dirname, '..', 'fixtures', 'coastal-town.osm');
  await page.locator('.menu-btn', { hasText: 'File' }).dispatchEvent('mousedown');
  await page.locator('.menu-item', { hasText: 'Import OpenStreetMap' }).click();
  await page.waitForSelector('.osm-dialog');
  await page.setInputFiles('.osm-dialog input[type=file]', fixture);
  await page.waitForFunction(() => /Found: 7 roads/.test(document.querySelector('.osm-summary')?.innerText || ''));
  const sum = await page.locator('.osm-summary').innerText();
  check('dialog reads the file and shows area + contents', /1\.32 km × 1\.33 km/.test(sum) && /5 buildings/.test(sum), sum.replace(/\n/g, ' | '));
  check('project name suggested from the file name', (await page.locator('.osm-dialog .field input.input').nth(1).inputValue()) === 'COASTAL-TOWN');
  await page.locator('.dialog-foot .btn', { hasText: 'Import map' }).click();
  await page.waitForFunction(() => window.worldBuilder.editor.doc.data.metadata?.source === 'OpenStreetMap', null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const info = await W(() => { const d = window.worldBuilder.editor.doc.data; return { islands: d.islands.map((i) => i.name), roads: d.roads.length, buildings: d.buildings.length, name: d.project.name, dirty: window.worldBuilder.editor.dirty, attr: document.querySelector('.status-item.attribution')?.textContent }; });
  check('imported map opens as the current project', info.islands.includes('Mainland') && info.islands.includes('Gulmaegi-do') && info.roads === 7 && info.buildings === 5 && info.name === 'COASTAL-TOWN', JSON.stringify(info));
  check('OpenStreetMap attribution shown in the status bar', /OpenStreetMap contributors/.test(info.attr || ''));
  check('imported project is marked unsaved (autosave/recovery protect it)', info.dirty === true);
  // the imported data is editable like any other map
  await W(() => { const { editor } = window.worldBuilder; const b = editor.doc.data.buildings[0]; editor.selection.set([b.id]); editor.nudge(10, 0); });
  check('imported objects are editable (undo works)', (await W(() => { const { editor } = window.worldBuilder; const b = editor.doc.data.buildings[0]; const x = b.x; editor.undo(); return x - editor.doc.data.buildings[0].x; })) === 10);
  await W(() => { const { editor } = window.worldBuilder; editor.selection.clear(); editor.fitContent(); });
  await page.waitForTimeout(600);
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });

  // Navigator on the imported map, crossing the bridge to the island
  const [nav] = await Promise.all([context.waitForEvent('page'), page.click('#btn-navigator')]);
  await nav.waitForFunction(() => window.navigatorApp && document.body.classList.contains('ready'), null, { timeout: 30000 });
  const r = await nav.evaluate(() => {
    const n = window.navigatorApp;
    const kx = 111320 * Math.cos(((37.5 + 37.512) / 2) * (Math.PI / 180));
    const px = (lat, lon) => ({ x: 300 + ((lon - 126.9) * kx) / 0.5, y: 300 + ((37.512 - lat) * 110574) / 0.5 });
    n.addStop(px(37.5081, 126.9000));
    n.addStop(px(37.5021, 126.9084));
    return { name: n.doc.project.name, mpp: n.S.mpp, ok: !!n.S.track, err: n.S.error, steps: n.S.steps.map((s) => s.name), attr: document.getElementById('nav-attribution').textContent };
  });
  check('Navigator opens the imported map with its real scale', r.name === 'COASTAL-TOWN' && r.mpp === 0.5 && /OpenStreetMap/.test(r.attr), JSON.stringify({ name: r.name, mpp: r.mpp }));
  check('route from the mainland to the island crosses the imported bridge', r.ok && r.steps.includes('Seom-daegyo'), r.steps.join(' > ') || r.err);
  if (process.argv[3]) { await nav.waitForTimeout(500); await nav.screenshot({ path: process.argv[3] }); }
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter((x) => x.ok).length}/${results.length} passed`);
  await browser.close();
})();
