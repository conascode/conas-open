// Frame-accurate renderer: steps the film frame by frame in headless Chromium and writes images.
// node tools/render.cjs --out DIR --w 3840 --h 2160 --blur 2 --msaa 0 --from 0 --to 900 [--step 1] [--format jpeg|png]
// Several workers can split the frame range (e.g. --from 0 --step 3, --from 1 --step 3, ...).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('out');
const W = +arg('w', 3840); const H = +arg('h', 2160);
const blur = +arg('blur', 2); const msaa = +arg('msaa', 0);
const from = +arg('from', 0); const to = +arg('to', 900); const step = +arg('step', 1);
const format = arg('format', 'jpeg');
const url = arg('url', 'http://localhost:8790/');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${url}?w=${W}&h=${H}&blur=${blur}&msaa=${msaa}`);
  await page.waitForFunction(() => document.title === 'ready' || document.title.startsWith('error'), null, { timeout: 600000 });
  if ((await page.title()) !== 'ready') throw new Error(await page.title());
  const fps = await page.evaluate(() => window.FILM.fps);
  const t0 = Date.now(); let done = 0;
  for (let f = from; f < to; f += step) {
    const file = path.join(out, `frame_${String(f).padStart(5, '0')}.${format === 'png' ? 'png' : 'jpg'}`);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) continue; // resumable
    await page.evaluate((t) => window.FILM.renderFrame(t), f / fps);
    const tmp = `${file}.tmp`;
    await page.screenshot({ path: tmp, type: format === 'png' ? 'png' : 'jpeg', ...(format === 'png' ? {} : { quality: 95 }) });
    fs.renameSync(tmp, file);
    done++;
    if (done % 10 === 0) console.log(`[${from}/${step}] frame ${f} · ${((Date.now() - t0) / done / 1000).toFixed(2)} s/frame`);
  }
  console.log(`[${from}/${step}] finished ${done} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
