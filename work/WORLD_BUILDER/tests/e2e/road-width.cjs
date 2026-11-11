// Road width editing: tool option bar, [ ] keys, multi-select, Inspector, undo.
const { open } = require('./harness.cjs');
(async () => {
  const { browser, page, errors, W, check, results } = await open();
  const width = (id) => W((i) => window.worldBuilder.editor.doc.get(i).width, id);
  await W(() => { const { editor } = window.worldBuilder; editor.tools.use('select'); editor.selection.set(['RD_0004']); editor.camera.setZoom(0.6); editor.camera.centerOn({ x: 4550, y: 5400 }); });
  await page.waitForTimeout(200);
  const bar = page.locator('#tool-options');
  check('selecting a road shows the width control', /Road width/.test(await bar.innerText()));
  const w0 = await width('RD_0004');
  await bar.locator('input[type=range]').fill('80');
  check('slider changes road width', (await width('RD_0004')) === 80);
  await bar.locator('input[type=number]').fill('55');
  await bar.locator('input[type=number]').press('Enter');
  check('number box sets an exact width', (await width('RD_0004')) === 55);
  await bar.locator('button', { hasText: '+' }).click();
  check('+ button widens by 2px', (await width('RD_0004')) === 57);
  await page.locator('#canvas-host canvas').focus();
  await page.keyboard.press(']');
  await page.keyboard.press('Shift+BracketLeft');
  check('] widens, Shift+[ narrows by 10', (await width('RD_0004')) === 49, String(await width('RD_0004')));
  check('number box follows keyboard changes', (await bar.locator('input[type=number]').inputValue()) === '49');
  await page.keyboard.press('Control+z');
  check('undo restores previous width', (await width('RD_0004')) === 59, String(await width('RD_0004')));
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  check('undo back to the original width', (await width('RD_0004')) === w0, `${await width('RD_0004')} vs ${w0}`);
  // multiple roads at once
  await W(() => window.worldBuilder.editor.selection.set(['RD_0004', 'RD_0005', 'RD_0003']));
  await page.waitForTimeout(100);
  check('multi-selection shows the control with a count', /Road width \(3\)/.test(await bar.innerText()));
  await bar.locator('input[type=range]').fill('24');
  const ws = await W(() => ['RD_0004', 'RD_0005', 'RD_0003'].map((i) => window.worldBuilder.editor.doc.get(i).width));
  check('all selected roads get the new width', ws.every((w) => w === 24), ws.join(','));
  // bridge deck + inspector field
  await W(() => window.worldBuilder.editor.selection.set(['BR_0002']));
  await page.waitForTimeout(100);
  check('bridge selection shows Deck width', /Deck width/.test(await bar.innerText()));
  await page.locator('.prop', { hasText: 'Deck width' }).locator('input').fill('70');
  await page.keyboard.press('Enter');
  check('Inspector deck width works', (await width('BR_0002')) === 70);
  // non-road selection: no width control
  await W(() => window.worldBuilder.editor.selection.set(['BLD_0001']));
  await page.waitForTimeout(100);
  check('building selection does not show road width', !/Road width/.test(await bar.innerText()));
  await W(() => window.worldBuilder.editor.selection.set(['RD_0001']));
  await page.waitForTimeout(300);
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await browser.close();
})();
