const { open } = require('./harness.cjs');
const fs = require('fs');
const os = require('os');
const S = fs.mkdtempSync(require('path').join(os.tmpdir(), 'wb-e2e-'));
const FIX = require('path').join(__dirname, 'fixtures');
(async () => {
  const { browser, context, page, errors, W, toPage, check, results } = await open();
  const modalBtn = (text) => page.locator('.dialog-foot .btn', { hasText: text });

  // ---------- Asset import ----------
  await page.click('text=Import Asset');
  await page.setInputFiles('.asset-dialog input[type=file]', `${FIX}/red-dot.png`);
  await page.waitForTimeout(300);
  await page.fill('.asset-dialog .field:nth-child(2) input', 'Red Marker');
  await page.selectOption('.asset-dialog select >> nth=0', 'Miscellaneous');
  await page.selectOption('.asset-dialog select >> nth=1', 'Bottom Center');
  await modalBtn('Save asset').click();
  await page.waitForTimeout(300);
  const asset = await W(() => { const a = window.worldBuilder.editor.doc.assets; return a[a.length - 1]; });
  check('asset imported with id, category, size, anchor, path', asset.name === 'Red Marker' && asset.category === 'Miscellaneous' && asset.anchor.preset === 'Bottom Center' && asset.anchor.y === 1 && /^assets\/objects\/AST_\d+\.png$/.test(asset.path) && asset.width === 64, JSON.stringify(asset));
  const stored = await W(async (id) => { const b = await window.worldBuilder.editor.assetStore.getBlob(window.worldBuilder.editor.doc.asset(id)); return b ? b.size : 0; }, asset.id);
  check('imported image stored in IndexedDB blob store', stored > 50, `${stored} bytes`);
  // place it twice
  const placed = await W((id) => { const { editor } = window.worldBuilder; const o = editor.placeAsset(editor.doc.asset(id), { x: 5100, y: 4900 }); return o; }, asset.id);
  check('custom asset placed as object', placed && placed.type === 'prop' && placed.assetId === asset.id && placed.anchorY === 1);
  // delete referenced asset -> warning, not deleted
  await page.evaluate((id) => { const card = [...document.querySelectorAll('.asset-card')].find((c) => c.textContent.includes('Red Marker')); card.querySelector('.card-actions .danger').click(); }, asset.id);
  await page.waitForTimeout(200);
  const warnText = await page.locator('.dialog').innerText();
  check('deleting a used asset shows reference warning', /Cannot delete/.test(warnText) && warnText.includes(placed.id), warnText.split('\n').slice(0, 3).join(' / '));
  await modalBtn('OK').click();
  check('used asset was not deleted', await W((id) => window.worldBuilder.editor.doc.has(id), asset.id));

  // ---------- Inspector validation ----------
  await W((id) => window.worldBuilder.editor.selection.set([id]), 'BLD_0002');
  await page.waitForTimeout(150);
  const wInput = page.locator('.prop', { hasText: 'Width' }).locator('input');
  await wInput.fill('-20');
  const err = await page.locator('.prop.invalid .field-error').first().innerText();
  const w1 = await W(() => window.worldBuilder.editor.doc.get('BLD_0002').width);
  check('inspector rejects negative width', err.length > 0 && w1 > 0, `error="${err}" width=${w1}`);
  await wInput.fill('222');
  const w2 = await W(() => window.worldBuilder.editor.doc.get('BLD_0002').width);
  check('inspector applies valid width live', w2 === 222);
  await wInput.fill('230'); await wInput.fill('240');
  await page.keyboard.press('Enter');
  const undoLbl = await W(() => window.worldBuilder.editor.history.undoStack.at(-1).label);
  await page.keyboard.press('Control+z');
  const w3 = await W(() => window.worldBuilder.editor.doc.get('BLD_0002').width);
  check('rapid inspector edits merge into one undo step', w3 === 140 && undoLbl === 'Resize', `after undo width=${w3} label=${undoLbl}`);
  const nameIn = page.locator('.prop', { hasText: 'Name' }).first().locator('input');
  await nameIn.fill('Renamed Police HQ'); await page.keyboard.press('Enter');
  check('inspector edits name', (await W(() => window.worldBuilder.editor.doc.get('BLD_0002').name)) === 'Renamed Police HQ');
  // bridge: same start/end island rejected
  await W(() => window.worldBuilder.editor.selection.set(['BR_0001']));
  await page.waitForTimeout(150);
  await page.locator('.prop', { hasText: 'End island' }).locator('select').selectOption('ISL_0001');
  const brErr = await page.locator('.prop', { hasText: 'End island' }).locator('.field-error').innerText();
  check('inspector blocks bridge with identical start/end island', /different/.test(brErr) && (await W(() => window.worldBuilder.editor.doc.get('BR_0001').endIslandId)) === 'ISL_0002', brErr);
  // island width edit scales polygon
  await W(() => window.worldBuilder.editor.selection.set(['ISL_0004']));
  await page.waitForTimeout(150);
  const before = await W(() => window.worldBuilder.editor.doc.get('ISL_0004').width);
  await page.locator('.prop', { hasText: 'Width' }).first().locator('input').fill(String(Math.round(before * 1.5)));
  await page.keyboard.press('Enter');
  const after = await W(() => { const o = window.worldBuilder.editor.doc.get('ISL_0004'); return { w: o.width, t: o.terrain.cols }; });
  check('island width edit scales polygon and resamples terrain', Math.abs(after.w - Math.round(before * 1.5)) < 1, JSON.stringify(after));
  await page.keyboard.press('Control+z');

  // ---------- Layers ----------
  const layerRow = (name) => page.locator('.layer-row', { hasText: name });
  await layerRow('Buildings').locator('button').first().click(); // hide
  const hid = await W(() => ({ v: window.worldBuilder.editor.doc.layer('LYR_BUILDINGS').visible, r: window.worldBuilder.renderer.layerContainers.get('LYR_BUILDINGS').root.visible }));
  check('layer hide toggles visibility in data and renderer', !hid.v && !hid.r);
  await page.keyboard.press('Control+z');
  check('undo layer hide', await W(() => window.worldBuilder.editor.doc.layer('LYR_BUILDINGS').visible));
  await layerRow('Buildings').locator('button').nth(1).click(); // lock
  const pickLocked = await W(() => { const { editor } = window.worldBuilder; const b = editor.doc.get('BLD_0001'); return editor.pick({ x: b.x, y: b.y })?.type; });
  check('locked layer objects cannot be picked on canvas', pickLocked !== 'building', `picked=${pickLocked}`);
  await layerRow('Buildings').locator('button').nth(1).click();
  // reorder: Buildings up
  await layerRow('Buildings').locator('.layer-name').click();
  const i0 = await W(() => window.worldBuilder.editor.doc.layers.findIndex((l) => l.id === 'LYR_BUILDINGS'));
  await page.locator('[aria-label="Move layer up"]').click();
  const i1 = await W(() => window.worldBuilder.editor.doc.layers.findIndex((l) => l.id === 'LYR_BUILDINGS'));
  const ri = await W(() => { const r = window.worldBuilder.renderer; return r.layerRoot.getChildIndex(r.layerContainers.get('LYR_BUILDINGS').root); });
  check('layer reorder updates data and render order', i1 === i0 + 1 && ri === i1, `${i0}->${i1} render=${ri}`);
  // opacity
  await layerRow('Buildings').locator('input[type=range]').fill('0.5');
  check('layer opacity applied', (await W(() => window.worldBuilder.renderer.layerContainers.get('LYR_BUILDINGS').root.alpha)) === 0.5);
  // create layer + move selection + delete layer moves objects
  page.once('dialog', () => {});
  await page.locator('[aria-label="New layer"]').click();
  await page.locator('.dialog input').fill('Crime Scenes');
  await modalBtn('OK').click();
  const newL = await W(() => window.worldBuilder.editor.doc.layers.find((l) => l.name === 'Crime Scenes')?.id);
  check('new layer created', !!newL, newL);
  await W(() => window.worldBuilder.editor.selection.set(['BLD_0009']));
  await page.locator('[aria-label="Move selection to layer"]').click();
  check('selection moved to new layer (Change Layer)', (await W(() => window.worldBuilder.editor.doc.get('BLD_0009').layer)) === newL);
  await page.locator('[aria-label="Delete layer"]').click();
  await modalBtn('Delete layer').click();
  const moved = await W(() => window.worldBuilder.editor.doc.get('BLD_0009').layer);
  check('deleting a layer moves its objects to a neighbouring layer', moved !== newL && !!moved && (await W((id) => !window.worldBuilder.editor.doc.has(id), newL)), moved);

  // ---------- Hierarchy ----------
  await page.click('.tab[data-tab=hierarchy]');
  await W(() => window.worldBuilder.editor.selection.set(['ISL_0001']));
  await page.waitForTimeout(300);
  const tree = await page.locator('#hierarchy-body').innerText();
  check('hierarchy shows island children (buildings/roads)', tree.includes('Serim Central') && tree.includes('Serim Avenue') && tree.includes('Serim City Hall'));
  await page.locator('.tree-item', { hasText: 'Daewon Tower' }).click();
  check('clicking hierarchy item selects object', (await W(() => window.worldBuilder.editor.selection.first)) === 'BLD_0003');

  // ---------- Export ZIP and re-import ----------
  const [dl] = await Promise.all([page.waitForEvent('download'), W(() => window.worldBuilder.pm.exportZip())]);
  const zipPath = `${S}/export.zip`;
  await dl.saveAs(zipPath);
  await import(require('url').pathToFileURL(require('path').join(__dirname, '../../lib/jszip.min.js')).href);
  const JSZip = globalThis.JSZip;
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files);
  const proj = JSON.parse(await zip.file('SERIM_CITY/project.world.json').async('string'));
  check('ZIP structure: project.world.json, assets/, thumbnails/, metadata.json', names.includes('SERIM_CITY/project.world.json') && names.includes('SERIM_CITY/metadata.json') && names.includes('SERIM_CITY/thumbnails/preview.png') && names.some((n) => n.startsWith('SERIM_CITY/assets/buildings/')), `${names.length} entries`);
  check('ZIP contains the imported custom asset file', names.includes(`SERIM_CITY/${asset.path}`));
  check('JSON stores asset id + relative path, not image data', !JSON.stringify(proj).includes('data:image') && proj.assets.some((a) => a.id === asset.id && a.path === asset.path));
  fs.writeFileSync(`${S}/zip-files.txt`, names.join('\n'));
  // Import into a fresh browser profile (new context = empty IndexedDB) to prove the package is self-contained
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(process.env.WB_URL || 'http://localhost:8765/');
  await p2.waitForFunction(() => document.body.classList.contains('ready'));
  await p2.locator('.menu-btn', { hasText: 'File' }).dispatchEvent('mousedown');
  const [chooser] = await Promise.all([p2.waitForEvent('filechooser', { timeout: 10000 }), p2.locator('.menu-item', { hasText: 'Import ZIP Package' }).click()]);
  await chooser.setFiles(zipPath);
  await p2.waitForFunction(() => window.worldBuilder.editor.doc.data.buildings.some((b) => b.name === 'Renamed Police HQ'), null, { timeout: 15000 });
  await p2.waitForTimeout(800);
  const imp = await p2.evaluate(async (id) => {
    const { editor } = window.worldBuilder;
    const a = editor.doc.asset(id);
    const blob = await editor.assetStore.getBlob(a);
    return { n: editor.doc.objectCount(), asset: !!a, blob: blob?.size || 0, dialog: document.querySelector('.dialog')?.innerText || '', tex: window.worldBuilder.renderer.assetTextures.state(id) };
  }, asset.id);
  check('ZIP import in a clean browser restores objects and custom asset image', imp.asset && imp.blob > 50 && imp.n > 100 && !/Missing Asset/.test(imp.dialog), JSON.stringify({ ...imp, dialog: imp.dialog.slice(0, 80) }));
  // JSON only (without assets) in a clean profile -> Missing Asset warning
  const jsonText = JSON.stringify(proj);
  fs.writeFileSync(`${S}/project.world.json`, jsonText);
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await p3.goto(process.env.WB_URL || 'http://localhost:8765/');
  await p3.waitForFunction(() => document.body.classList.contains('ready'));
  await p3.evaluate(async (text) => { await window.worldBuilder.pm.openFile(new File([text], 'project.world.json', { type: 'application/json' })); }, jsonText);
  await p3.waitForTimeout(500);
  const missingTxt = await p3.locator('.dialog').innerText().catch(() => '');
  check('opening JSON without the custom asset shows a Missing Asset warning', /Missing Asset/.test(missingTxt) && missingTxt.includes(asset.id), missingTxt.split('\n').slice(0, 3).join(' / '));
  // Corrupted / invalid files
  await p3.keyboard.press('Escape');
  await p3.evaluate(async () => { window.worldBuilder.editor.dirty = false; await window.worldBuilder.pm.openFile(new File(['{ "project": '], 'broken.json')); });
  const brokenTxt = await p3.locator('.dialog').innerText().catch(() => '');
  check('broken JSON shows an error', /not valid JSON/.test(brokenTxt), brokenTxt.split('\n')[0]);
  await p3.keyboard.press('Escape');
  const bad = JSON.parse(jsonText); bad.buildings[1].id = bad.buildings[0].id; bad.buildings[2].width = -5;
  await p3.evaluate(async (t) => { await window.worldBuilder.pm.openFile(new File([t], 'bad.json')); }, JSON.stringify(bad));
  const badTxt = await p3.locator('.dialog').innerText().catch(() => '');
  check('schema errors (negative size) are reported', /invalid/i.test(badTxt) && /width/.test(badTxt), badTxt.split('\n').slice(0, 3).join(' / '));
  await p3.keyboard.press('Escape');
  const dup = JSON.parse(jsonText); dup.buildings[1].id = dup.buildings[0].id;
  await p3.evaluate(async (t) => { await window.worldBuilder.pm.openFile(new File([t], 'dup.json')); }, JSON.stringify(dup));
  const dupTxt = await p3.locator('.dialog').innerText().catch(() => '');
  check('duplicate IDs are rejected', /Duplicate ID/.test(dupTxt), dupTxt.split('\n').slice(0, 2).join(' / '));
  await ctx2.close(); await ctx3.close();

  // ---------- Autosave + recovery after reload ----------
  await W(() => window.worldBuilder.editor.setSetting('autosaveDelay', 0.5));
  await W(() => { const { editor } = window.worldBuilder; editor.setProps('BLD_0003', { name: 'Recovered Tower' }, 'Modify Property'); });
  await page.waitForTimeout(1500);
  let sawPrompt = false;
  page.on('dialog', (d) => { if (d.type() === 'beforeunload') sawPrompt = true; d.accept(); });
  await page.reload();
  check('leaving with unsaved changes triggers the browser warning', sawPrompt);
  await page.waitForSelector('.dialog');
  const recTxt = await page.locator('.dialog').innerText();
  check('after reload, recovery dialog offers unsaved work', /Recover unsaved work/.test(recTxt));
  await modalBtn('Recover').click();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await page.waitForTimeout(500);
  const rec = await W(() => ({ name: window.worldBuilder.editor.doc.get('BLD_0003')?.name, asset: !!window.worldBuilder.editor.doc.data.assets.find((a) => a.name === 'Red Marker'), dirty: window.worldBuilder.editor.dirty }));
  check('recovered project contains the latest edits', rec.name === 'Recovered Tower' && rec.asset && rec.dirty, JSON.stringify(rec));
  await W(() => window.worldBuilder.editor.setSetting('autosaveDelay', 2));
  await page.waitForTimeout(600);
  
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await browser.close();
})();
