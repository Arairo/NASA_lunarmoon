// Browser end-to-end test for Lunar Site Planner: drives every control and
// checks the results.
//
//   npm i --no-save playwright && npx playwright install chromium
//   npm run dev            # or: npm run build && npm run preview
//   node test/browser-e2e.cjs http://localhost:5174/
//
// Optional: SHOTS=/some/dir saves screenshots. Cesium ion requests are
// ignored when judging console errors, so it runs without a token.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:5174/';
const SHOTS = process.env.SHOTS;
const results = [];
const errors = [];
let page, browser;

async function check(name, fn) {
  const n = errors.length;
  try {
    const detail = await fn();
    const newErrs = errors.slice(n);
    if (newErrs.length) throw new Error(`console/page errors: ${newErrs.join(' | ').slice(0, 400)}`);
    results.push(['PASS', name, detail ?? '']);
  } catch (e) {
    results.push(['FAIL', name, String(e.message || e).slice(0, 500)]);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const app = (expr) => page.evaluate(expr);
const text = (sel) => page.$eval(sel, (el) => el.innerText);
const wait = (ms) => page.waitForTimeout(ms);
const BAD = /NaN|undefined|Infinity|\[object/;

async function canvasInk(sel) {
  return page.$eval(sel, (c) => {
    const tmp = document.createElement('canvas');
    tmp.width = c.width; tmp.height = c.height;
    const g = tmp.getContext('2d'); g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, tmp.width, tmp.height).data;
    let lit = 0; const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 37) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; colors.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4); }
    return { lit, colors: colors.size };
  });
}
async function cesiumPixels() {
  // Read back the WebGL canvas after a forced render.
  return page.evaluate(() => {
    const v = window.lunarApp.scene.viewer;
    v.scene.requestRender();
    v.render();
    const c = v.scene.canvas;
    const tmp = document.createElement('canvas'); tmp.width = 200; tmp.height = 120;
    tmp.getContext('2d').drawImage(c, 0, 0, 200, 120);
    const d = tmp.getContext('2d').getImageData(0, 0, 200, 120).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 45) lit++;
    return lit / (d.length / 4);
  });
}
async function camPos() {
  return app(() => { const p = window.lunarApp.scene.viewer.camera.positionWC; return [p.x, p.y, p.z]; });
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
async function selectSiteByName(name) {
  await page.fill('#siteFilter', '');
  await page.click(`.site-item:has-text("${name}")`);
  await wait(400);
}
async function assessmentClean() {
  const t = await text('#assessment');
  const m = t.match(BAD);
  assert(!m, `bad token "${m && m[0]}" in panel: …${m ? t.slice(Math.max(0, m.index - 60), m.index + 40) : ''}…`);
  return t;
}

(async () => {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  // The first-visit tour invitation is tested on its own below.
  await ctx.addInitScript(() => { try { localStorage.setItem('lsp.tourSeen', '1'); } catch {} });
  page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  let ionRequests = 0;
  page.on('request', (r) => { if (/api\.cesium\.com/.test(r.url())) ionRequests++; });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/api\.cesium\.com|ion|ERR_TUNNEL|Failed to load resource|net::/i.test(t)) return; // ion is blocked in this sandbox
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // ---------------------------------------------------------------- load
  await check('Page loads, terrain + analysis ready', async () => {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.lunarApp && window.lunarApp.scene && document.querySelector('#vPower .big'), null, { timeout: 60000 });
    await wait(3000);
    const t = await assessmentClean();
    assert(t.includes('Shackleton connecting ridge'), 'default site not shown');
    assert(t.includes('LOLA 240 m grid'), 'terrain not loaded');
    return 'default site = connecting ridge, LOLA 240 m terrain';
  });
  await check('3D Cesium scene renders (WebGL pixels drawn)', async () => {
    await page.click('#viewSystem'); await wait(3500);
    const f = await cesiumPixels();
    assert(f > 0.02, `only ${(f * 100).toFixed(1)}% of canvas lit`);
    return `${(f * 100).toFixed(1)}% of canvas lit (Earth–Moon view)`;
  });
  await check('Moon, Earth and Sun entities placed from ephemeris', async () => {
    const r = await app(() => {
      const v = window.lunarApp.scene.viewer; const now = v.clock.currentTime;
      const e = v.entities.values.find((x) => x.name === 'Earth').position.getValue(now);
      const s = v.entities.values.find((x) => x.name === 'Sun').position.getValue(now);
      const st = window.lunarApp.scene.state;
      return { earthKm: Math.hypot(e.x, e.y, e.z) / 1000, stKm: st.earthDistM / 1000, sunKm: Math.hypot(s.x, s.y, s.z) / 1000, light: v.scene.light.constructor.name, ellipsoidR: v.scene.globe.ellipsoid.radii.x };
    });
    assert(Math.abs(r.earthKm - r.stKm) < 1, 'Earth entity not at ephemeris distance');
    assert(r.earthKm > 356000 && r.earthKm < 407000, 'Earth distance out of range');
    assert(r.ellipsoidR === 1737400, 'globe is not the Moon ellipsoid');
    return `Earth at ${r.earthKm.toFixed(0)} km, globe radius ${r.ellipsoidR} m, light=${r.light}`;
  });
  await check('Sky plot and timeline canvases draw', async () => {
    const a = await canvasInk('#skyplot'); const b = await canvasInk('#timeline');
    assert(a.colors > 8 && b.colors > 8, `sky ${JSON.stringify(a)} timeline ${JSON.stringify(b)}`);
    return `sky plot ${a.colors} colours, timeline ${b.colors} colours`;
  });
  await check('Verdict tiles, countdowns, window stats and link block populated', async () => {
    const t = await assessmentClean();
    for (const s of ['POWER', 'EARTH LINK', 'Time sunlit', 'Longest continuous darkness', 'Battery', 'Light time', 'Free-space loss', 'Goldstone', 'Madrid', 'Canberra']) assert(t.toUpperCase().includes(s.toUpperCase()), `missing "${s}"`);
    assert(/(Sunset|Sunrise)/.test(t) && /(Earthset|Earthrise)/.test(t), 'countdowns missing');
    return 'all blocks present, no NaN/undefined';
  });

  // ---------------------------------------------------------------- every curated site
  await check('Every curated site selects and evaluates cleanly', async () => {
    const names = await page.$$eval('.site-item .name', (els) => els.map((e) => e.textContent));
    const bad = [];
    for (const n of names) {
      await page.click(`.site-item:has(.name:text-is("${n.replace(/"/g, '\\"')}"))`);
      await wait(250);
      const title = await text('.site-title h2');
      const t = await text('#assessment');
      if (title !== n) bad.push(`${n}: title=${title}`);
      if (BAD.test(t)) bad.push(`${n}: bad token`);
      const sel = await page.$eval('.site-item.selected .name', (e) => e.textContent).catch(() => null);
      if (sel !== n) bad.push(`${n}: list highlight=${sel}`);
    }
    assert(!bad.length, bad.join('; '));
    return `${names.length} sites OK`;
  });
  await check('Physics spot-checks: crater floor, far side, Apollo', async () => {
    await page.fill('#siteFilter', 'Shackleton crater');
    await page.click('.site-item'); await wait(400);
    let t = await text('#assessment');
    assert(t.includes('0 W') && t.includes('No sunlight'), 'Shackleton floor should have no sunlight');
    assert(/Time sunlit[^\n]*\n?\s*0\.0%/.test(t), 'Shackleton sunlit should be 0.0%');
    await page.fill('#siteFilter', 'Chang’e 4'); await page.click('.site-item'); await wait(400);
    t = await text('#assessment');
    assert(t.includes('Unavailable') && /Earth visible \(any part of disk\)\s*0\.0%/.test(t), 'Chang’e 4 should never see Earth');
    await page.fill('#siteFilter', 'Apollo 11'); await page.click('.site-item'); await wait(400);
    t = await text('#assessment');
    assert(/Earth visible \(any part of disk\)\s*100\.0%/.test(t), 'Apollo 11 should always see Earth');
    assert(t.includes('smooth sphere'), 'Apollo 11 should report no terrain grid');
    await page.fill('#siteFilter', '');
    return 'floor 0% sun, Chang’e 4 0% Earth, Apollo 11 100% Earth';
  });

  // ---------------------------------------------------------------- filter + coords
  await check('Site filter narrows the list', async () => {
    await page.fill('#siteFilter', 'apollo');
    const n = await page.$$eval('.site-item', (e) => e.length);
    await page.fill('#siteFilter', 'zzzz');
    const z = await page.$$eval('.site-item', (e) => e.length);
    await page.fill('#siteFilter', '');
    const all = await page.$$eval('.site-item', (e) => e.length);
    assert(n === 6 && z === 0 && all > 25, `apollo=${n} zzzz=${z} all=${all}`);
    return `apollo→${n}, nonsense→0, cleared→${all}`;
  });
  await check('Coordinate entry: decimal, N/S/E/W and invalid input', async () => {
    await page.fill('#coordInput', '-88.5, 120'); await page.press('#coordInput', 'Enter'); await wait(500);
    let title = await text('.site-title h2');
    assert(title.includes('88.50°S 120.00°E'), `got ${title}`);
    await page.fill('#coordInput', '85.2S 30.5W'); await page.click('#coordForm button'); await wait(500);
    title = await text('.site-title h2');
    assert(title.includes('85.20°S 30.50°W'), `got ${title}`);
    await page.fill('#coordInput', 'not a place'); await page.click('#coordForm button'); await wait(300);
    const st = await text('#coordError');
    assert(/Enter latitude and longitude/.test(st) && (await page.isVisible('#coordError')), `no validation message (${st})`);
    assert((await page.getAttribute('#coordInput', 'aria-invalid')) === 'true', 'input not marked invalid');
    assert((await text('.site-title h2')).includes('85.20°S'), 'invalid input changed the site');
    return 'parsed both formats, rejected garbage with a message';
  });

  // ---------------------------------------------------------------- time controls
  await selectSiteByName('Shackleton connecting ridge');
  await check('Date picker re-anchors the analysis window', async () => {
    await page.fill('#datetime', '2027-06-15T12:00'); await page.dispatchEvent('#datetime', 'change'); await wait(600);
    const lbl = await text('#winLabel');
    const ms = await app(() => window.lunarApp.timeMs);
    assert(lbl.startsWith('2027-06-15'), `window label ${lbl}`);
    assert(ms === Date.UTC(2027, 5, 15, 12), 'time not set (UTC)');
    return `window ${lbl}`;
  });
  await check('Step buttons ±1 h / ±1 d', async () => {
    const t0 = await app(() => window.lunarApp.timeMs);
    for (const id of ['#stepFwdHour', '#stepFwdDay', '#stepBackHour']) await page.click(id);
    await wait(200);
    const t1 = await app(() => window.lunarApp.timeMs);
    assert(t1 - t0 === 86400000, `delta ${(t1 - t0) / 3600000} h`);
    await page.click('#stepBackDay'); await wait(200);
    assert((await app(() => window.lunarApp.timeMs)) === t0, 'back day did not return');
    const v = await page.inputValue('#datetime');
    assert(v === '2027-06-15T12:00', `input shows ${v}`);
    return '+1h +1d −1h −1d = 0, input synced';
  });
  await check('Play / pause and speed selector', async () => {
    await page.selectOption('#speed', '86400');
    const t0 = await app(() => window.lunarApp.timeMs);
    await page.click('#playPause'); await wait(2000);
    const playing = await app(() => window.lunarApp.playing);
    await page.click('#playPause'); await wait(200);
    const t1 = await app(() => window.lunarApp.timeMs);
    await wait(800);
    const t2 = await app(() => window.lunarApp.timeMs);
    const days = (t1 - t0) / 86400000;
    assert(playing && days > 0.5, `advanced ${days.toFixed(2)} d`);
    assert(t2 === t1, 'time kept moving after pause');
    assert((await text('#playPause')) === 'Play', 'button did not reset');
    await page.selectOption('#speed', '3600');
    return `1 day/s advanced ${days.toFixed(2)} d in ~2 s, stopped on pause`;
  });
  await check('Clock moving past the window end re-anchors the window', async () => {
    await page.click('[data-window="15"]'); await wait(300);
    const start1 = await app(() => window.lunarApp.windowStartMs);
    await page.click('.site-title h2');
    for (let i = 0; i < 16; i++) await page.keyboard.press('Shift+ArrowRight');
    await wait(500);
    const [start2, now] = await app(() => [window.lunarApp.windowStartMs, window.lunarApp.timeMs]);
    assert(start2 > start1 && now >= start2 && now <= start2 + 15 * 86400000, `start ${start1}→${start2}, now ${now}`);
    await page.click('[data-window="30"]');
    return `stepped 16 d through a 15 d window → window moved to ${new Date(start2).toISOString().slice(0, 10)}`;
  });
  await check('Now button', async () => {
    await page.click('#nowBtn'); await wait(300);
    const t = await app(() => window.lunarApp.timeMs);
    assert(Math.abs(t - Date.now()) < 120000, 'not current time');
    return new Date(t).toISOString();
  });
  await check('Window length buttons 15 d / 30 d / 90 d / 1 yr', async () => {
    const out = [];
    for (const w of [15, 30, 90, 365]) {
      await page.click(`[data-window="${w}"]`); await wait(w === 365 ? 1500 : 500);
      const lbl = await text('#winLabel');
      const active = await page.$eval(`[data-window="${w}"]`, (b) => b.classList.contains('active'));
      assert(lbl.includes(`${w} days`) && active, `w=${w}: ${lbl}`);
      out.push(lbl.split('→')[1].trim());
    }
    await page.click('[data-window="30"]'); await wait(400);
    await assessmentClean();
    return out.join(', ');
  });
  await check('Clicking the timeline scrubs the clock', async () => {
    const box = await page.$eval('#timeline', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const [s, e] = await app(() => [window.lunarApp.scan.startMs, window.lunarApp.scan.endMs]);
    await page.mouse.click(box.x + 64 + (box.w - 74) * 0.5, box.y + box.h / 2); await wait(300);
    const t = await app(() => window.lunarApp.timeMs);
    const f = (t - s) / (e - s);
    assert(Math.abs(f - 0.5) < 0.02, `landed at ${f.toFixed(3)} of window`);
    // drag
    await page.mouse.move(box.x + 64 + (box.w - 74) * 0.2, box.y + 20); await page.mouse.down();
    await page.mouse.move(box.x + 64 + (box.w - 74) * 0.8, box.y + 20, { steps: 6 }); await page.mouse.up(); await wait(300);
    const f2 = ((await app(() => window.lunarApp.timeMs)) - s) / (e - s);
    assert(Math.abs(f2 - 0.8) < 0.02, `drag ended at ${f2.toFixed(3)}`);
    return 'click → 50%, drag → 80%';
  });
  await check('Countdown matches the actual sun/Earth transition', async () => {
    await page.fill('#siteFilter', 'Apollo 11'); await page.click('.site-item'); await wait(300);
    await page.fill('#datetime', '2027-01-01T00:00'); await page.dispatchEvent('#datetime', 'change'); await wait(500);
    const r = await app(() => {
      const t = document.querySelector('#cdSun .when').textContent;
      const ms = Date.parse(t.replace(' UTC', 'Z').replace(' ', 'T'));
      return { label: document.querySelector('#cdSun .label').textContent, when: t, ms };
    });
    // verify with a jump: one minute before vs after the event the panel flips
    await page.fill('#datetime', new Date(r.ms - 120000).toISOString().slice(0, 16)); await page.dispatchEvent('#datetime', 'change'); await wait(300);
    const before = await text('#vPower .big');
    await page.fill('#datetime', new Date(r.ms + 120000).toISOString().slice(0, 16)); await page.dispatchEvent('#datetime', 'change'); await wait(300);
    const after = await text('#vPower .big');
    assert((before === '0 W') !== (after === '0 W'), `before=${before} after=${after}`);
    await page.fill('#siteFilter', '');
    return `${r.label} ${r.when}: ${before} → ${after}`;
  });

  // ---------------------------------------------------------------- learn + settings
  await check('Learn mode toggles explanations', async () => {
    await selectSiteByName('Shackleton connecting ridge');
    await page.click('#learnBtn'); await wait(200);
    const vis = await page.$eval('#learnTop', (e) => getComputedStyle(e).display);
    const t = await text('#learnTop');
    await page.click('#learnBtn'); await wait(200);
    const hid = await page.$eval('#learnTop', (e) => getComputedStyle(e).display);
    assert(vis === 'block' && hid === 'none', `${vis}/${hid}`);
    assert(t.includes('pole is so extreme') && !t.includes('no Earth here'), 'wrong learn text for ridge');
    return 'shown/hidden; polar text correct';
  });
  await check('Spacecraft dialog: power, radio, mast and cancel', async () => {
    await page.fill('#datetime', '2026-11-05T00:00'); await page.dispatchEvent('#datetime', 'change'); await wait(400);
    const w0 = await app(() => window.lunarApp.lastNow.sun.watts);
    await page.click('#settingsBtn');
    await page.fill('input[name=areaM2]', '4');
    await page.selectOption('select[name=preset]', 'x_hga');
    await page.click('button[value=save]'); await wait(800);
    const w1 = await app(() => window.lunarApp.lastNow.sun.watts);
    const radio = await text('#radioLabel');
    assert(Math.abs(w1 / w0 - 2) < 0.01, `power ratio ${w1 / w0}`);
    assert(radio.startsWith('X-band'), radio);
    // cancel leaves config alone
    await page.click('#settingsBtn'); await page.fill('input[name=areaM2]', '9'); await page.click('button[value=cancel]'); await wait(300);
    assert((await app(() => window.lunarApp.config.power.areaM2)) === 4, 'cancel applied changes');
    // mast height changes the horizon
    const g0 = await app(() => window.lunarApp.ctx.height - window.lunarApp.ctx.groundHeight);
    await page.click('#settingsBtn'); await page.fill('input[name=mastHeightM]', '10'); await page.click('button[value=save]');
    await page.waitForFunction(() => window.lunarApp.ctx.height - window.lunarApp.ctx.groundHeight === 10, null, { timeout: 10000 }).catch(() => {});
    const diag = await page.evaluate(() => ({ open: document.querySelector('#settings').open, rv: document.querySelector('#settings').returnValue, invalid: [...document.querySelectorAll('#settingsForm :invalid')].map((e) => `${e.name}=${e.value}`), mast: window.lunarApp.config.mastHeightM }));
    if (diag.open) await page.keyboard.press('Escape');
    const g1 = await app(() => window.lunarApp.ctx.height - window.lunarApp.ctx.groundHeight);
    assert(g0 === 2 && g1 === 10, `mast ${g0}→${g1} ${JSON.stringify(diag)}`);
    return `2 m²→4 m² doubled power (${w0.toFixed(0)}→${w1.toFixed(0)} W), X-band applied, cancel ignored, mast 2→10 m`;
  });
  await check('Settings persist across reload', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.lunarApp && document.querySelector('#vPower .big'), null, { timeout: 60000 });
    const c = await app(() => ({ a: window.lunarApp.config.power.areaM2, p: window.lunarApp.config.comms.preset, m: window.lunarApp.config.mastHeightM }));
    assert(c.a === 4 && c.p === 'x_hga' && c.m === 10, JSON.stringify(c));
    // restore defaults
    await page.click('#settingsBtn');
    await page.fill('input[name=areaM2]', '2'); await page.selectOption('select[name=preset]', 's_mga'); await page.fill('input[name=mastHeightM]', '2');
    await page.click('button[value=save]'); await wait(600);
    return JSON.stringify(c);
  });

  // ---------------------------------------------------------------- views
  await check('South-pole map: shows, overlays, zoom, click-to-pick', async () => {
    await page.click('[data-view="polar"]'); await wait(800);
    assert(!(await page.$eval('#polarWrap', (e) => e.hidden)), 'polar map hidden');
    const a = await canvasInk('#polarMap');
    await page.check('input[name=overlay][value=illum]'); await wait(400);
    const b = await canvasInk('#polarMap');
    assert(!(await page.$eval('#overlayScale', (e) => e.hidden)), 'legend scale hidden');
    await page.check('input[name=overlay][value=earth]'); await wait(400);
    const c = await canvasInk('#polarMap');
    const box = await page.$eval('#polarMap', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.wheel(0, -400); await wait(300);
    // click an empty spot off-centre -> custom point south of 75S
    await page.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.71); await wait(700);
    const title = await text('.site-title h2');
    // Imagery is greyscale with neutral markers, so the base map has few distinct colours.
    assert(a.colors > 8 && b.colors > a.colors && c.colors > a.colors, `ink ${a.colors}/${b.colors}/${c.colors}`);
    const lat = await app(() => window.lunarApp.site.lat);
    assert(lat < -75, `picked lat ${lat}`);
    await page.check('input[name=overlay][value=none]');
    return `overlays redraw, wheel zoom OK, clicked → ${title}`;
  });
  await check('Polar map: clicking a site marker selects that site', async () => {
    try {
      await selectSiteByName('Shackleton connecting ridge');
      await page.click('[data-view="polar"]'); await wait(500);
      const box = await page.$eval('#polarMap', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top }; });
      const pt = await app(() => window.lunarApp.polar.project(-89.67, 129.78));
      await page.mouse.click(box.x + pt.x, box.y + pt.y); await wait(500);
      const title = await text('.site-title h2');
      assert(title === 'Shackleton crater floor', `got ${title}`);
      return 'clicked the Shackleton floor marker → selected it';
    } finally {
      await page.click('[data-view="globe"]'); await wait(300);
    }
  });
  await check('3D camera buttons move the camera', async () => {
    const moved = [];
    await page.click('#viewSite'); await wait(3500);
    for (const id of ['#viewOverview', '#viewPole', '#viewSite', '#viewSystem', '#viewStandSun', '#viewStandEarth']) {
      // Poll: a flight can take a moment to start when rendering is slow.
      const p0 = await camPos(); await page.click(id);
      let d = 0; const t0 = Date.now();
      while (Date.now() - t0 < 15000) { await wait(250); d = dist(p0, await camPos()); if (d > 1000) break; }
      await wait(2500); // let the flight finish before the next button
      assert(d > 1000, `${id} moved only ${d.toFixed(0)} m`);
      moved.push(`${id.slice(5)} ${(d / 1000).toFixed(0)} km`);
    }
    // stand-on-site: camera should be within ~1 km of the surface at the site
    const h = await app(() => { const v = window.lunarApp.scene.viewer; const c = v.scene.globe.ellipsoid.cartesianToCartographic(v.camera.positionWC); return c.height - window.lunarApp.ctx.groundHeight; });
    assert(h > 0 && h < 100, `stand view height ${h}`);
    return moved.join(', ') + `; stand view ${h.toFixed(1)} m above the LOLA ground`;
  });
  await check('Lighting toggle switches real/even lighting', async () => {
    await page.click('#lightingBtn'); await wait(200);
    const off = await app(() => [window.lunarApp.scene.viewer.scene.globe.enableLighting, window.lunarApp.scene.viewer.shadows]);
    await page.click('#lightingBtn'); await wait(200);
    const on = await app(() => [window.lunarApp.scene.viewer.scene.globe.enableLighting, window.lunarApp.scene.viewer.shadows]);
    assert(!off[0] && !off[1] && on[0] && on[1], JSON.stringify({ off, on }));
    return `${await text('#lightingBtn')}`;
  });
  await check('Idle globe stops re-rendering (request-render mode)', async () => {
    await wait(4000); // let flights and tile loads settle
    const n = await page.evaluate(() => new Promise((res) => { let k = 0; const sc = window.lunarApp.scene.viewer.scene; const f = () => k++; sc.postRender.addEventListener(f); setTimeout(() => { sc.postRender.removeEventListener(f); res(k); }, 3000); }));
    // A continuous loop would draw ~180 frames in 3 s on real hardware. Here the
    // only renders left are tile-load completions (slow in software WebGL).
    assert(n <= 30, `${n} frames rendered in 3 s while idle`);
    return `${n} frames in 3 s idle (continuous loop would be ~180)`;
  });
  await check('Clicking the 3D Moon picks a custom site', async () => {
    await page.click('#viewPole'); await wait(3500);
    const box = await page.$eval('#cesium canvas', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.click(box.x + box.w * 0.43, box.y + box.h * 0.62); await wait(1200);
    const s = await app(() => window.lunarApp.site);
    assert(s.precision === 'custom' && s.lat < -60, `picked ${JSON.stringify(s)}`);
    await assessmentClean();
    return `picked ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`;
  });
  await check('Without a Cesium ion token: no ion requests, bundled LOLA globe', async () => {
    const btnHidden = await page.$eval('#terrainBtn', (b) => b.hidden);
    const globe = await app(() => window.lunarApp.scene.viewer.scene.globe.show);
    const st = await text('#sceneStatus');
    assert(btnHidden && globe && ionRequests === 0 && !/ion/i.test(st), JSON.stringify({ btnHidden, globe, ionRequests, st }));
    return 'no requests to api.cesium.com, no ion error shown';
  });

  // ---------------------------------------------------------------- compare
  await check('Compare: add, slip ×3, nearby alternatives', async () => {
    if (!(await app(() => document.body.classList.contains('compare-open')))) await page.click('#compareBtn');
    await page.click('#clearScenarios');
    await selectSiteByName('Shackleton connecting ridge');
    await page.fill('#datetime', '2026-10-31T23:00'); await page.dispatchEvent('#datetime', 'change'); await wait(400);
    await page.click('#addThis'); await wait(400);
    let rows = await page.$$eval('table.cmp tbody tr', (r) => r.length);
    assert(rows === 1, `after add: ${rows}`);
    await page.click('#slipScenarios'); await wait(1500);
    rows = await page.$$eval('table.cmp tbody tr', (r) => r.length);
    assert(rows === 4, `after slip: ${rows} (planned row should not duplicate)`);
    const dates = await page.$$eval('table.cmp td.scenario .meta', (e) => e.map((x) => x.textContent.split('·')[1].trim()));
    await page.click('#nearbyScenarios');
    await page.waitForFunction(() => !document.querySelector('#nearbyScenarios').disabled, null, { timeout: 180000 });
    rows = await page.$$eval('table.cmp tbody tr', (r) => r.length);
    assert(rows === 7, `after nearby: ${rows}`);
    const st = await text('#sceneStatus');
    const t = await text('#compareBody');
    assert(!BAD.test(t), 'bad token in table');
    const strips = await page.$$eval('canvas.strip', (c) => c.length);
    assert(strips === 7, 'strips missing');
    return `dates ${dates.join(', ')}; ${st}`;
  });
  await check('Compare: best/worst highlighting and screening', async () => {
    const best = await page.$$eval('table.cmp td.best', (e) => e.length);
    const worst = await page.$$eval('table.cmp td.worst', (e) => e.length);
    const verdicts = await page.$$eval('table.cmp .status', (e) => e.map((x) => x.textContent));
    // Highlights only appear where a column's spread exceeds its tolerance.
    assert(best === worst || best > 0, `${best}/${worst}`);
    assert(verdicts.length === 7 && (await text('#compareBody')).includes('illustrative thresholds'), `${verdicts.length} screening labels`);
    return `${best} best / ${worst} worst cells; verdicts: ${[...new Set(verdicts)].join(', ')}`;
  });
  await check('Compare: row click loads that scenario', async () => {
    await page.click('table.cmp tbody tr:nth-child(3) button.open'); await wait(800);
    const st = await app(() => new Date(window.lunarApp.windowStartMs).toISOString().slice(0, 10));
    const active = await page.$eval('table.cmp tbody tr:nth-child(3)', (r) => r.classList.contains('active'));
    const rowDate = await page.$eval('table.cmp tbody tr:nth-child(3) td.scenario .meta', (e) => e.textContent.split('·')[1].trim());
    assert(active && st === rowDate, `window ${st} vs row ${rowDate}`);
    return `loaded slip +2 (${st})`;
  });
  await check('Compare: remove row, CSV export, clear, hide/show', async () => {
    await page.click('table.cmp tbody tr:last-child [data-remove]'); await wait(300);
    const rows = await page.$$eval('table.cmp tbody tr', (r) => r.length);
    assert(rows === 6, `after remove ${rows}`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsv')]);
    const path = await dl.path();
    const csv = require('fs').readFileSync(path, 'utf8').trim().split('\n');
    assert(csv.length === 7 && csv[0].startsWith('label,lat,lon'), `csv lines ${csv.length}`);
    assert(!/NaN|undefined/.test(csv.join()), 'bad csv values');
    await page.click('#toggleCompare'); await wait(300);
    const hidden = await page.$eval('#compareDrawer', (e) => getComputedStyle(e).display);
    await page.click('#compareBtn'); await wait(300);
    const shown = await page.$eval('#compareDrawer', (e) => getComputedStyle(e).display);
    await page.click('#clearScenarios'); await wait(200);
    const count = await text('#compareCount');
    assert(hidden === 'none' && shown !== 'none' && count === '0', `${hidden}/${shown}/${count}`);
    return `CSV ${csv.length - 1} rows (${dl.suggestedFilename()}), drawer toggles, clear → 0`;
  });

  // ---------------------------------------------------------------- links + keyboard
  await check('Copy link → reopening restores site, date and window', async () => {
    await selectSiteByName('Ridge high point near Shackleton (88.8°S)');
    await page.click('[data-window="90"]');
    await page.fill('#datetime', '2027-08-01T06:00'); await page.dispatchEvent('#datetime', 'change'); await wait(500);
    await page.click('#copyLink'); await wait(300);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => errors.push('pageerror(p2): ' + e.message));
    await p2.goto(link, { waitUntil: 'load' });
    // Wait for the analysis panel only; the 3D scene can be slow in a second software-WebGL page.
    await p2.waitForFunction(() => document.querySelector('#winLabel')?.textContent, null, { timeout: 120000 });
    const r = await p2.evaluate(() => ({ t: document.querySelector('.site-title h2').textContent, w: document.querySelector('#winLabel').textContent }));
    await p2.close();
    assert(r.t.startsWith('Ridge high point') && r.w.startsWith('2027-08-01') && r.w.includes('90 days'), JSON.stringify(r));
    await page.click('[data-window="30"]');
    return link.replace(/^.*#/, '#');
  });
  await check('Custom-point link restores coordinates', async () => {
    const b2 = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const p2 = await b2.newPage();
    p2.on('pageerror', (e) => errors.push('pageerror(link): ' + e.message));
    await p2.goto(BASE + '#site=-87.1234,45.5&t=2027-02-01T00:00Z&w=15', { waitUntil: 'load', timeout: 90000 });
    await p2.waitForFunction(() => window.lunarApp && document.querySelector('#winLabel')?.textContent, null, { timeout: 60000 });
    const r = await p2.evaluate(() => ({ lat: window.lunarApp.site.lat, lon: window.lunarApp.site.lon, w: window.lunarApp.windowDays, name: window.lunarApp.site.name }));
    await b2.close();
    assert(Math.abs(r.lat + 87.1234) < 1e-6 && r.lon === 45.5 && r.w === 15, JSON.stringify(r));
    return JSON.stringify(r);
  });
  await check('Keyboard: space plays/pauses, arrows step, typing in inputs ignored', async () => {
    await page.click('.site-title h2');
    const t0 = await app(() => window.lunarApp.timeMs);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await wait(200);
    const t1 = await app(() => window.lunarApp.timeMs);
    await page.keyboard.press('Space'); await wait(300);
    const playing = await app(() => window.lunarApp.playing);
    await page.keyboard.press('Space'); await wait(200);
    const stopped = !(await app(() => window.lunarApp.playing));
    await page.click('#siteFilter'); await page.keyboard.press('Space'); await wait(200);
    const notPlaying = !(await app(() => window.lunarApp.playing));
    await page.fill('#siteFilter', '');
    assert(t1 - t0 === 25 * 3600000 && playing && stopped && notPlaying, JSON.stringify({ d: (t1 - t0) / 3600000, playing, stopped, notPlaying }));
    return '→ +1 h, ⇧→ +1 d, space toggles, ignored in text field';
  });

  // ---------------------------------------------------------------- accessibility
  await check('Space activates a focused button instead of toggling playback', async () => {
    const n0 = await app(() => window.lunarApp.scenarios.length);
    await page.focus('#addScenario'); await page.keyboard.press('Space'); await wait(400);
    const r = await app(() => ({ n: window.lunarApp.scenarios.length, playing: window.lunarApp.playing }));
    assert(r.n === n0 + 1 && !r.playing, JSON.stringify(r));
    return `scenarios ${n0} → ${r.n}, playback stayed off`;
  });
  await check('View tabs: ARIA roles and arrow-key switching', async () => {
    await page.focus('#tab-globe'); await page.keyboard.press('ArrowRight'); await wait(400);
    const r = await page.evaluate(() => ({ focus: document.activeElement.id, sel: document.querySelector('#tab-polar').getAttribute('aria-selected'), map: !document.querySelector('#polarWrap').hidden }));
    await page.keyboard.press('ArrowLeft'); await wait(300);
    assert(r.focus === 'tab-polar' && r.sel === 'true' && r.map, JSON.stringify(r));
    return 'ArrowRight → South-pole map, ArrowLeft → 3D Moon';
  });
  await check('Timeline works as a keyboard slider', async () => {
    const t0 = await app(() => window.lunarApp.timeMs);
    await page.focus('#timeline'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('PageUp'); await wait(300);
    const t1 = await app(() => window.lunarApp.timeMs);
    const vt = await page.getAttribute('#timeline', 'aria-valuetext');
    await page.keyboard.press('Home'); await wait(300);
    const t2 = await app(() => [window.lunarApp.timeMs, window.lunarApp.scan.startMs]);
    assert(t1 - t0 === 25 * 3600000 && /UTC$/.test(vt) && t2[0] === t2[1], JSON.stringify({ d: (t1 - t0) / 3600000, vt }));
    return `→ +1 h, PageUp +1 d, Home → window start; aria-valuetext "${vt}"`;
  });
  await check('Editing the link hash in the same tab updates the app', async () => {
    await page.evaluate(() => { location.hash = 'id=a11&site=0.67416,23.47315&t=2027-03-01T00:00Z&w=15'; }); await wait(1500);
    const r = { t: await text('.site-title h2'), w: await text('#winLabel') };
    assert(r.t.startsWith('Apollo 11') && r.w.startsWith('2027-03-01') && r.w.includes('15 days'), JSON.stringify(r));
    return `${r.t} · ${r.w}`;
  });
  await check('Glossary "?" buttons open definitions', async () => {
    const n = await page.$$eval('#assessment .gloss', (b) => b.length);
    await page.click('#skyBlock .gloss'); await wait(300);
    const open = await page.evaluate(() => document.querySelector('.gloss-pop:popover-open')?.textContent || '');
    await page.keyboard.press('Escape');
    assert(n >= 6 && open.includes('Terrain horizon'), `${n} buttons, popover "${open.slice(0, 40)}"`);
    return `${n} glossary buttons; popover opens and closes with Esc`;
  });
  await check('Guided tour: offered once, real tasks, skip and restart', async () => {
    // A fresh context without the "tour seen" flag, as a first-time visitor.
    const tctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await tctx.newPage();
    page.setDefaultTimeout(180000);
    const text = (sel) => page.$eval(sel, (el) => el.innerText);
    const app = (expr) => page.evaluate(expr);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.lunarApp && window.lunarApp.scene && document.querySelector('.tour-prompt'), null, { timeout: 180000 });
    await page.click('.tour-prompt [data-act="yes"]');
    const titles = [];
    for (let i = 0; i < 12 && (await page.$('.tour-panel')); i++) {
      titles.push(await text('.tour-panel h2'));
      if (await page.$('.tour-panel [data-act="do"]')) {
        assert(await page.isDisabled('.tour-panel [data-act="next"]'), `step ${i + 1}: Next enabled before the task`);
        await page.click('.tour-panel [data-act="do"]');
        await page.waitForSelector('.tour-panel .tour-task.done', { timeout: 20000 });
      }
      await page.click('.tour-panel [data-act="next"]'); await wait(300);
    }
    const st = await app(() => ({ site: window.lunarApp.site.id, n: window.lunarApp.scenarios.length }));
    assert(titles.length === 9 && st.site === 'ridge' && st.n >= 4, JSON.stringify({ titles, st }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.lunarApp && document.querySelector('#vPower .big'), null, { timeout: 120000 });
    await wait(1500);
    const offeredAgain = !!(await page.$('.tour-prompt'));
    await page.click('#tourBtn'); await wait(300);
    const restarted = !!(await page.$('.tour-panel'));
    await page.keyboard.press('Escape'); await wait(200);
    const closed = !(await page.$('.tour-panel'));
    await tctx.close();
    assert(!offeredAgain && restarted && closed, JSON.stringify({ offeredAgain, restarted, closed }));
    return `${titles.length} steps completed with real actions; not offered again; Tour button restarts; Esc exits`;
  });

  // ---------------------------------------------------------------- mobile
  await check('Phone layout (390 px): no horizontal scroll, panels reachable', async () => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-final.png`, timeout: 60000 }).catch(() => {});
    await page.close();
    const b3 = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const m = await b3.newPage({ viewport: { width: 390, height: 844 } });
    m.setDefaultTimeout(120000);
    await m.addInitScript(() => { try { localStorage.setItem('lsp.tourSeen', '1'); } catch {} });
    m.on('pageerror', (e) => errors.push('pageerror(mobile): ' + e.message));
    const tl = Date.now(); await m.goto(BASE, { waitUntil: 'load', timeout: 90000 }); const loadMs = Date.now() - tl;
    await m.waitForFunction(() => window.lunarApp && document.querySelector('#vPower .big'), null, { timeout: 60000 });
    const views = {};
    for (const pane of ['site', 'results', 'compare', 'view']) {
      await m.click(`[data-pane-target="${pane}"]`); await m.waitForTimeout(400);
      views[pane] = await m.evaluate((p) => ({ site: !!document.querySelector('#siteList').offsetParent, results: !!document.querySelector('#vPower').offsetParent, compare: !!document.querySelector('#compareBody').offsetParent, view: getComputedStyle(document.querySelector('.stage')).visibility === 'visible' })[p], pane);
    }
    const r = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    r.panel = Object.values(views).every(Boolean);
    r.views = views;
    r.loadMs = loadMs;
    if (SHOTS) await m.screenshot({ path: `${SHOTS}/e2e-mobile.png` });
    await b3.close();
    assert(r.sw <= r.iw && r.panel, JSON.stringify(r));
    return JSON.stringify(r);
  });

  await browser.close();
  const pass = results.filter((r) => r[0] === 'PASS').length;
  for (const [s, n, d] of results) console.log(`${s === 'PASS' ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`);
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(async (e) => { console.error('HARNESS ERROR', e); for (const [s, n, d] of results) console.log(`${s} ${n} ${d}`); await browser?.close(); process.exit(2); });
