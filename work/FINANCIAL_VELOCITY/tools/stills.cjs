// Renders still frames at given times for quick visual review.
// node tools/stills.cjs <outDir> <w> <h> <blur> t1 t2 ...
const { chromium } = require('playwright');
(async () => {
  const [outDir, w, h, blur, ...times] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:8790/?w=${w}&h=${h}&blur=${blur}`);
  await page.waitForFunction(() => document.title === 'ready' || document.title.startsWith('error'), null, { timeout: 300000 });
  console.log('boot', Date.now() - t0, 'ms', await page.title());
  if ((await page.title()) !== 'ready') { await browser.close(); return; }
  console.log(JSON.stringify(await page.evaluate(() => window.FILM.stats())));
  for (const t of times) {
    const s = Date.now();
    await page.evaluate((tt) => window.FILM.renderFrame(tt), Number(t));
    const r = Date.now();
    await page.screenshot({ path: `${outDir}/still-${String(t).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88 });
    console.log(`t=${t} render ${r - s}ms shot ${Date.now() - r}ms`);
  }
  await browser.close();
})();
