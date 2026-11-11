// Shared Playwright harness for WORLD BUILDER browser tests.
// Usage: serve WORLD_BUILDER on :8765 (python3 -m http.server 8765), then `node tests/e2e/phase1.cjs`.
// Needs Playwright with Chromium installed (NODE_PATH pointing at it if installed globally).
const { chromium } = require('playwright');
exports.open = async (opts = {}) => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto((process.env.WB_URL || 'http://localhost:8765/') + (opts.query || ''));
  await page.waitForFunction(() => document.body.classList.contains('ready') || document.querySelector('.fatal'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const W = (fn, arg) => page.evaluate(fn, arg);
  // world -> page coordinates
  const toPage = async (x, y) => W(({ x, y }) => {
    const { editor } = window.worldBuilder;
    const r = editor.tools.canvas.getBoundingClientRect();
    const s = editor.camera.worldToScreen({ x, y });
    return { x: r.left + s.x, y: r.top + s.y };
  }, { x, y });
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
  return { browser, context, page, errors, W, toPage, check, results };
};
