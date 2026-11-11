// Navigator E2E: route planning on the sample map and GPS-style playback.
const { chromium } = require('playwright');
(async () => {
  const base = process.env.WB_URL || 'http://localhost:8765/';
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const results = [];
  const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
  const W = (fn, a) => page.evaluate(fn, a);
  const toPage = (x, y) => W(({ x, y }) => { const { camera, renderer } = window.navigatorApp; const r = renderer.app.canvas.getBoundingClientRect(); const s = camera.worldToScreen({ x, y }); return { x: r.left + s.x, y: r.top + s.y }; }, { x, y });
  const click = async (x, y, opts) => { const p = await toPage(x, y); await page.mouse.click(p.x, p.y, opts); };

  await page.goto(`${base}navigator.html?map=sample`);
  await page.waitForFunction(() => window.navigatorApp && document.body.classList.contains('ready'), null, { timeout: 30000 });
  const info = await W(() => ({ roads: window.navigatorApp.doc.data.roads.length, lines: window.navigatorApp.S.graph.lines.length }));
  check('sample map loads and builds the road network', info.roads >= 14 && info.lines > 10, JSON.stringify(info));

  // Start on the west of Serim Avenue, destination on Haneul-ro (east island)
  await click(3720, 5005);
  await click(9150, 4390);
  let s = await W(() => ({ stops: window.navigatorApp.S.stops.length, track: !!window.navigatorApp.S.track, err: window.navigatorApp.S.error, steps: window.navigatorApp.S.steps.map((x) => x.name) }));
  check('two clicks set start + destination and compute a route', s.stops === 2 && s.track && !s.err, s.steps.join(' > '));
  check('route crosses the suspension bridge', s.steps.includes('Haneul Suspension Bridge'));
  // Add a waypoint at the city hall area (via Harbor Street)
  await click(5200, 4300);
  s = await W(() => ({ stops: window.navigatorApp.S.stops.length, legs: window.navigatorApp.S.legs?.length, steps: window.navigatorApp.S.steps.map((x) => x.name) }));
  check('third click adds a waypoint and the route goes through it', s.stops === 3 && s.legs === 2 && s.steps.includes('Harbor Street'), s.steps.join(' > '));
  const panel = await page.locator('#nav-panel').innerText();
  check('panel shows distance, time and turn-by-turn steps', /km|m\b/.test(panel) && /Turn (left|right) onto/.test(panel) && /Arrive at Waypoint 1/.test(panel));

  // Run at high playback speed until arrival
  await page.selectOption('#nav-panel select', '120');
  await page.locator('#nav-panel button', { hasText: 'Run' }).click();
  await page.waitForTimeout(700);
  const mid = await W(() => { const t = document.getElementById('telemetry').innerText; return { t, running: window.navigatorApp.S.running, simT: window.navigatorApp.S.t }; });
  check('vehicle moves while running (live telemetry)', mid.running && mid.simT > 0 && /km\/h/.test(mid.t) && /Driving/.test(mid.t), mid.t.replace(/\n/g, ' | ').slice(0, 160));
  await page.keyboard.press('Space');
  const paused = await W(() => window.navigatorApp.S.t);
  await page.waitForTimeout(400);
  check('Space pauses playback', (await W(() => window.navigatorApp.S.t)) === paused && !(await W(() => window.navigatorApp.S.running)));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.navigatorApp.S.running && window.navigatorApp.S.t >= window.navigatorApp.S.track.totalSec, null, { timeout: 60000 });
  const done = await W(() => { const { S } = window.navigatorApp; const ev = S.log.filter((r) => r.event).map((r) => r.event); const last = S.log[S.log.length - 1]; const end = S.stops[2]; return { n: S.log.length, ev, last, total: S.track.totalSec }; });
  check('arrives at the destination and logs GPS positions + events', done.n > 20 && done.ev.join() === 'start,arrived Waypoint 1,arrived Destination', `${done.n} rows, events: ${done.ev.join(' / ')}`);
  await page.screenshot({ path: process.argv[2] || '/dev/null' }).catch(() => {});

  // Export CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'GPS log CSV' }).click()]);
  const csv = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  check('GPS log exports as CSV', csv.startsWith('t_sec,clock,x,y,speed_kmh,heading_deg,road,event') && csv.split('\n').length === done.n + 1);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'Route + log JSON' }).click()]);
  const json = JSON.parse(await (await dl2.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
  check('route + log exports as JSON', json.format === 'world-builder-route' && json.stops.length === 3 && json.route.points.length > 10 && json.gps.length === done.n);

  // Drag the destination marker and right-click to remove the waypoint
  const before = await W(() => window.navigatorApp.S.track.totalPx);
  const sn = await W(() => window.navigatorApp.S.snaps[2]);
  const a = await toPage(sn.x, sn.y); const b = await toPage(8500, 4250);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  const after = await W(() => window.navigatorApp.S.track.totalPx);
  check('dragging a marker re-routes', Math.abs(after - before) > 50, `${before.toFixed(0)} -> ${after.toFixed(0)}`);
  const wp = await W(() => window.navigatorApp.S.snaps[1]);
  const wpp = await toPage(wp.x, wp.y);
  await page.mouse.click(wpp.x, wpp.y, { button: 'right' });
  check('right-click removes a waypoint', (await W(() => window.navigatorApp.S.stops.length)) === 2);

  // Walk mode to the lighthouse islet; car mode reports why it cannot
  await W(() => { const n = window.navigatorApp; n.S.stops = []; n.addStop({ x: 5200, y: 5000 }); n.addStop({ x: 2390, y: 2760 }); });
  const carErr = await W(() => window.navigatorApp.S.error);
  check('car mode explains an unreachable (foot-only) destination', /too far from any drivable road/.test(carErr), carErr);
  await page.locator('#nav-panel .seg', { hasText: 'Walk' }).click();
  const walk = await W(() => ({ ok: !!window.navigatorApp.S.track, steps: window.navigatorApp.S.steps.map((x) => x.name) }));
  check('walk mode routes over the footbridge to the islet', walk.ok && walk.steps.includes('Gull Footbridge'), walk.steps.join(' > '));

  // Editor -> Navigator hand-over uses the editor's current map
  const ed = await context.newPage();
  await ed.goto(base);
  await ed.waitForFunction(() => document.body.classList.contains('ready'));
  await ed.evaluate(() => { const { editor } = window.worldBuilder; editor.doc.updateSection('project', { name: 'HANDOVER_TEST' }); });
  const [nav2] = await Promise.all([context.waitForEvent('page'), ed.click('#btn-navigator')]);
  await nav2.waitForFunction(() => window.navigatorApp && document.body.classList.contains('ready'), null, { timeout: 30000 });
  const name = await nav2.evaluate(() => window.navigatorApp.doc.project.name);
  check('editor "Navigator" button opens the map being edited', name === 'HANDOVER_TEST', name);
  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await browser.close();
})();
