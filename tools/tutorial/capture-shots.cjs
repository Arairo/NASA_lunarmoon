// Captures the screenshots used by the in-app video tutorial, plus the screen
// position of every control the narration points at, so the zooms, spotlights
// and cursor always land on the real controls.
//
//   npm run dev                                    # in another terminal
//   node tools/tutorial/capture-shots.cjs http://localhost:5174/
//
// Writes public/tutorial/shots/*.webp and src/ui/tutorial/shots.json.
// Needs Playwright (npm i --no-save playwright) and ffmpeg with libwebp.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:5174/';
const ROOT = path.resolve(__dirname, '../..');
const OUT_IMG = path.join(ROOT, 'public/tutorial/shots');
const OUT_JSON = path.join(ROOT, 'src/ui/tutorial/shots.json');
const W = 1600;
const H = 900;
const SCALE = 2;
const DATE = '2027-01-15T00:00Z'; // ridge: power and Earth link both available

const SELECTORS = {
  brand: '.brand',
  timebar: '.timebar',
  datetime: 'label[for="datetime"]',
  stepSeg: '.timebar .seg',
  play: '#playPause',
  topActions: '.top-actions',
  videoBtn: '#videoBtn',
  tourBtn: '#tourBtn',
  learnBtn: '#learnBtn',
  settingsBtn: '#settingsBtn',
  compareBtn: '#compareBtn',
  sitePanel: '.panel.left',
  coordForm: '#coordForm',
  siteFilter: '#siteFilter',
  siteList: '#siteList',
  ridgeItem: '.site-item[data-site="ridge"]',
  floorItem: '.site-item[data-site="shackleton"]',
  stage: '.stage',
  viewTabs: '.view-tabs',
  viewActions: '.view-actions',
  standSun: '#viewStandSun',
  viewport: '.viewport',
  timelineDock: '.timeline-dock',
  timeline: '#timeline',
  windowBtns: '.timeline-head .seg',
  results: '.panel.right',
  siteTitle: '.site-title',
  addThis: '#addThis',
  verdicts: '.verdicts',
  vPower: '#vPower',
  vComms: '#vComms',
  countdowns: '.countdowns',
  skyBlock: '#skyBlock',
  skyplot: '#skyplot',
  windowBlock: '#windowBlock',
  learnTop: '#learnTop',
  gloss: '.panel.right .gloss',
  polarLegend: '.polar-legend',
  polarMap: '#polarMap',
  compare: '#compareDrawer',
  compareActions: '.compare-actions',
  compareBody: '#compareBody',
  slip: '#slipScenarios',
  nearby: '#nearbyScenarios',
  exportCsv: '#exportCsv',
  settings: '#settings',
  settingsArray: '#settings fieldset:nth-of-type(1)',
  settingsRadio: '#settings fieldset:nth-of-type(2)',
};

async function rects(page) {
  return page.evaluate(({ SELECTORS, W, H }) => {
    const out = {};
    for (const [name, sel] of Object.entries(SELECTORS)) {
      const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
      const x1 = Math.min(W, r.right), y1 = Math.min(H, r.bottom);
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      out[name] = [x0, y0, x1 - x0, y1 - y0].map((v) => Math.round(v));
    }
    return out;
  }, { SELECTORS, W, H });
}

async function settle(page, ms = 1500) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => {
    const v = window.lunarApp?.scene?.viewer;
    return !v || v.scene.globe.tilesLoaded;
  }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT_IMG, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-shots-'));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  page.setDefaultTimeout(240000);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('lsp.welcomeOff', '1');
    } catch {}
  });
  await page.goto(`${BASE}#id=ridge&t=${DATE}&w=30`);
  await page.waitForFunction(() => window.lunarApp?.scene && window.lunarApp.lastNow, null, { timeout: 180000 });
  await page.waitForTimeout(7000); // initial overview, then the fly-to
  await settle(page);

  const manifest = { width: W, height: H, date: DATE, shots: {} };
  async function shot(name) {
    const png = path.join(tmp, `${name}.png`);
    // Freeze the WebGL render loop: screenshots of a live software-rendered
    // globe at 2x are otherwise very slow.
    await page.evaluate(() => {
      const v = window.lunarApp.scene?.viewer;
      if (v) {
        v.render();
        v.useDefaultRenderLoop = false;
      }
    });
    await page.screenshot({ path: png });
    await page.evaluate(() => {
      const v = window.lunarApp.scene?.viewer;
      if (v) v.useDefaultRenderLoop = true;
    });
    const webp = path.join(OUT_IMG, `${name}.webp`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', webp]);
    manifest.shots[name] = { src: `tutorial/shots/${name}.webp`, rects: await rects(page) };
    console.log(new Date().toISOString().slice(11, 19), name, `${(fs.statSync(webp).size / 1024).toFixed(0)} KB`);
  }
  const scrollResults = (sel) =>
    page.evaluate((sel) => {
      const panel = document.querySelector('.panel.right');
      const el = sel && document.querySelector(sel);
      panel.scrollTop = el ? el.offsetTop - 16 : 0;
    }, sel);

  await shot('overview');

  await page.click('.site-item[data-site="shackleton"]');
  await settle(page, 6000);
  await shot('floor');

  await page.click('.site-item[data-site="ridge"]');
  await settle(page, 6000);
  await scrollResults('#skyBlock');
  await page.waitForTimeout(300);
  await shot('sky');
  await scrollResults(null);

  await page.click('#viewStandSun');
  await settle(page, 5000);
  await shot('standSun');

  await page.click('#tab-polar');
  await page.check('input[name="overlay"][value="illum"]');
  await page.waitForTimeout(1500);
  await shot('polar');
  await page.check('input[name="overlay"][value="none"]');
  await page.click('#tab-globe');
  await page.click('#viewSite');
  await settle(page, 5000);

  await page.click('#learnBtn');
  await page.waitForTimeout(500);
  await shot('learn');
  await page.click('#learnBtn');

  await page.click('#addThis');
  await page.click('#slipScenarios');
  await page.waitForFunction(() => window.lunarApp.scenarios.length >= 4, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  await shot('compare');
  await page.click('#toggleCompare');

  await page.click('#settingsBtn');
  await page.waitForTimeout(500);
  await shot('settings');

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(manifest, null, 1)}\n`);
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
