import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { createMoonScene } from './scene/moonScene.js';
import { loadTerrain } from './core/horizon.js';
import { DEFAULT_CONFIG, evaluate, isEarthUp, isSunUp, nextTransition, prepareSite, scan } from './core/analysis.js';
import { SITES, SITE_GROUPS, parseCoordinates } from './core/sites.js';
import { RADIO_PRESETS } from './core/comms.js';
import { PANEL_MODES } from './core/power.js';
import { SYNODIC_MONTH_DAYS } from './core/ephemeris.js';
import { destination, fromSouthPolar, surfaceDistance } from './core/geo.js';
import { renderNow, renderSkeleton, renderWindow } from './ui/assessment.js';
import { drawSkyPlot } from './ui/skyplot.js';
import { createTimeline } from './ui/timeline.js';
import { createPolarMap, RAMP_CSS } from './ui/polarMap.js';
import { renderCompare, scenariosToCsv } from './ui/compare.js';
import { compass, escapeHtml, fmtLatLon, fromLocalInputValue, toLocalInputValue } from './ui/format.js';
import { createTour } from './ui/tour.js';

const DATA = `${import.meta.env.BASE_URL}data`;
const $ = (sel) => document.querySelector(sel);
const STEP_FOR_WINDOW = { 15: 10, 30: 20, 90: 60, 365: 180 }; // minutes

// Hand-picked ridge points. Their computed values appear in the window summary;
// near crests they depend strongly on the 240 m terrain resolution.
const CURATED_COMPUTED = [
  {
    id: 'ridge',
    name: 'Shackleton connecting ridge',
    short: 'Connecting ridge',
    group: 'computed',
    lat: -89.45,
    lon: -137.31,
    precision: 'computed',
    note: 'High point on the ridge joining Shackleton and de Gerlache craters, an area that LOLA lighting studies rank among the best-lit at the pole. At a ridge crest a 240 m terrain grid cannot resolve the local slope, so treat the sunlight figures here as approximate (they can shift by several percentage points).',
  },
  {
    id: 'peak-shackleton',
    name: 'Ridge high point near Shackleton (88.8°S)',
    short: 'Peak near Shackleton',
    group: 'computed',
    lat: -88.81,
    lon: 123.64,
    precision: 'computed',
    note: 'An elevated massif about 30 km from Shackleton. It is well lit, but Earth is hidden for long stretches: the classic power-versus-communication trade-off. Crest values are sensitive to terrain resolution.',
  },
];

const app = {
  terrain: null,
  scene: null,
  config: structuredClone(DEFAULT_CONFIG),
  ionToken: '',
  timeMs: Math.floor(Date.now() / 3600000) * 3600000,
  windowStartMs: null,
  windowDays: 30,
  playing: false,
  speed: 3600,
  site: null,
  ctx: null,
  scan: null,
  events: { sun: null, earth: null },
  scenarios: [],
  activeScenario: null,
  sites: [...CURATED_COMPUTED, ...SITES],
  illum: null,
};
app.windowStartMs = app.timeMs;

// ------------------------------------------------------------------ persistence
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('lsp.prefs') || '{}');
    if (p.power) Object.assign(app.config.power, p.power);
    if (p.comms) Object.assign(app.config.comms, p.comms);
    if (Number.isFinite(p.mastHeightM)) app.config.mastHeightM = p.mastHeightM;
    app.ionToken = localStorage.getItem('lsp.ionToken') || '';
  } catch {
    /* private mode */
  }
}
function savePrefs() {
  try {
    localStorage.setItem('lsp.prefs', JSON.stringify({ power: app.config.power, comms: app.config.comms, mastHeightM: app.config.mastHeightM }));
    if (app.ionToken) localStorage.setItem('lsp.ionToken', app.ionToken);
    else localStorage.removeItem('lsp.ionToken');
  } catch {
    /* ignore */
  }
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const out = {};
  if (h.get('site')) {
    const c = parseCoordinates(h.get('site'));
    if (c) out.site = c;
  }
  if (h.get('id')) out.id = h.get('id');
  if (h.get('t')) {
    const ms = Date.parse(h.get('t'));
    if (Number.isFinite(ms)) out.t = ms;
  }
  if (h.get('w') && STEP_FOR_WINDOW[h.get('w')]) out.w = Number(h.get('w'));
  return out;
}
function scenarioLink() {
  const p = new URLSearchParams();
  if (app.site.id && !app.site.id.startsWith('custom')) p.set('id', app.site.id);
  p.set('site', `${app.site.lat.toFixed(5)},${app.site.lon.toFixed(5)}`);
  p.set('t', new Date(app.windowStartMs).toISOString().slice(0, 16) + 'Z');
  p.set('w', app.windowDays);
  return `${location.origin}${location.pathname}#${p.toString()}`;
}

// ------------------------------------------------------------------ status
function setStatus(msg) {
  if (!msg) {
    $('#sceneStatus').textContent = '';
    return;
  }
  const el = $('#sceneStatus');
  el.textContent = msg;
  clearTimeout(setStatus.t);
  if (msg) setStatus.t = setTimeout(() => (el.textContent = ''), 9000);
}

// ------------------------------------------------------------------ site list
function renderSiteList() {
  const q = $('#siteFilter').value.trim().toLowerCase();
  const groups = {};
  for (const s of app.sites) {
    if (q && !s.name.toLowerCase().includes(q)) continue;
    (groups[s.group] ||= []).push(s);
  }
  const order = ['computed', 'south', 'clps', 'intl', 'apollo'];
  $('#siteList').innerHTML = order
    .filter((g) => groups[g]?.length)
    .map(
      (g) => `<h3>${SITE_GROUPS[g]}</h3>${groups[g]
        .map(
          (s) => `<button class="site-item ${app.site && app.site.id === s.id ? 'selected' : ''}" data-site="${s.id}">
            <span class="name">${escapeHtml(s.name)}</span><span class="coords">${s.lat.toFixed(1)}, ${s.lon.toFixed(1)}</span></button>`,
        )
        .join('')}`,
    )
    .join('');
  $('#siteList').querySelectorAll('[data-site]').forEach((b) =>
    b.addEventListener('click', () => selectSite(app.sites.find((s) => s.id === b.dataset.site), { fly: true })),
  );
}

// ------------------------------------------------------------------ core flow
function computeScan(ctx, startMs, days) {
  return scan(ctx, { startMs, endMs: startMs + days * 86400000, stepMs: STEP_FOR_WINDOW[days] * 60000 }, app.config);
}

function selectSite(site, { fly = false, keepScenario = false } = {}) {
  if (!site) return;
  app.site = site;
  app.ctx = prepareSite(site, app.terrain, app.config);
  if (!keepScenario) app.activeScenario = null;
  app.scene?.setSelected(site);
  polar?.setSelected(site);
  renderSkeleton($('#assessment'), site, app.ctx);
  $('#addThis').addEventListener('click', addCurrentScenario);
  $('#copyLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(scenarioLink());
      setStatus('Scenario link copied');
    } catch {
      setStatus(scenarioLink());
    }
  });
  recomputeWindow();
  renderSiteList();
  if (fly) app.scene?.flyToSite(site);
  history.replaceState(null, '', scenarioLink());
}

function recomputeWindow() {
  app.scan = computeScan(app.ctx, app.windowStartMs, app.windowDays);
  app.eventsKey = null;
  renderWindow($('#assessment'), { scan: app.scan, config: app.config });
  $('#timelineTitle').textContent = `Operations timeline · ${app.site.short ?? app.site.name}`;
  updateNow(true);
}

/** Next sunset/sunrise and Earthset/Earthrise: from the window scan, else a forward search. */
function findEvents(now) {
  const s = app.scan.series;
  const i0 = Math.floor((now.ms - app.scan.startMs) / app.scan.stepMs);
  const sunUp = isSunUp(now);
  const earthUp = isEarthUp(now);
  const refine = (pred, from, lo, hi) => {
    while (hi - lo > 30000) {
      const mid = Math.round((lo + hi) / 2);
      if (pred(evaluate(mid, app.ctx, app.config, { withDsn: false })) === from) lo = mid;
      else hi = mid;
    }
    return { ms: hi };
  };
  const fromScan = (arr, pred, from) => {
    if (i0 < 0 || i0 >= s.times.length - 1) return undefined;
    for (let i = Math.max(0, i0 + 1); i < s.times.length; i++) {
      if (!!arr[i] !== from) return refine(pred, from, Math.max(now.ms, s.times[i - 1]), s.times[i]);
    }
    return undefined;
  };
  let sun = fromScan(s.lit, isSunUp, sunUp);
  let earth = fromScan(s.los, isEarthUp, earthUp);
  const key = `${app.site.lat},${app.site.lon},${app.windowStartMs},${app.windowDays},${sunUp},${earthUp}`;
  if (sun === undefined || earth === undefined) {
    if (app.eventsKey !== key) {
      app.eventsCache = {
        sun: nextTransition(app.ctx, now.ms, isSunUp, app.config),
        earth: nextTransition(app.ctx, now.ms, isEarthUp, app.config),
      };
      app.eventsKey = key;
    }
    sun ??= app.eventsCache.sun;
    earth ??= app.eventsCache.earth;
  }
  return { sun, earth };
}

let lastUi = 0;
function updateNow(force = false) {
  if (!app.ctx) return;
  const now = evaluate(app.timeMs, app.ctx, app.config);
  app.scene?.setState(now.state, app.ctx);
  const t = performance.now();
  if (!force && t - lastUi < 90) return;
  lastUi = t;
  $('#datetime').value = toLocalInputValue(app.timeMs);
  renderNow($('#assessment'), { now, events: findEvents(now), config: app.config });
  const sky = $('#skyplot');
  if (sky) drawSkyPlot(sky, { horizon: app.ctx.horizon, scan: app.scan, now });
  timeline.update({
    scan: app.scan,
    now: app.timeMs,
    loadW: app.config.power.loadW,
    minClearanceDeg: app.config.comms.minClearanceDeg,
    targetMarginDb: app.config.comms.targetMarginDb,
  });
  app.lastNow = now;
}

function setTime(ms, { reanchor = false } = {}) {
  app.timeMs = ms;
  const end = app.windowStartMs + app.windowDays * 86400000;
  if (reanchor || ms < app.windowStartMs || ms > end) {
    app.windowStartMs = ms;
    recomputeWindow();
    history.replaceState(null, '', scenarioLink());
  } else updateNow();
}

// ------------------------------------------------------------------ playback
let lastFrame = 0;
function frame(t) {
  if (!app.playing) return;
  const dt = lastFrame ? Math.min(0.25, (t - lastFrame) / 1000) : 0;
  lastFrame = t;
  setTime(app.timeMs + dt * app.speed * 1000);
  requestAnimationFrame(frame);
}
function setPlaying(on) {
  app.playing = on;
  $('#playPause').textContent = on ? 'Pause' : 'Play';
  $('#playPause').setAttribute('aria-label', on ? 'Pause' : 'Play');
  lastFrame = 0;
  if (on) requestAnimationFrame(frame);
  else updateNow(true);
}

// ------------------------------------------------------------------ scenarios
let scenarioSeq = 0;
function addScenario({ site, startMs, label }) {
  const ctx = site === app.site ? app.ctx : prepareSite(site, app.terrain, app.config);
  const sc = { id: `s${++scenarioSeq}`, site, startMs, windowDays: app.windowDays, label, ctx };
  sc.scan = startMs === app.windowStartMs && site === app.site ? app.scan : computeScan(ctx, startMs, app.windowDays);
  app.scenarios.push(sc);
  renderScenarios();
  return sc;
}
function addCurrentScenario() {
  addScenario({ site: app.site, startMs: app.windowStartMs, label: `${app.site.short ?? app.site.name}` });
  openCompare(true);
  setStatus('Added to the comparison');
}
function renderScenarios() {
  $('#compareCount').textContent = app.scenarios.length;
  renderCompare($('#compareBody'), app.scenarios, {
    activeId: app.activeScenario,
    onSelect: (id) => {
      const sc = app.scenarios.find((s) => s.id === id);
      if (!sc) return;
      app.activeScenario = id;
      app.windowDays = sc.windowDays;
      syncWindowButtons();
      app.windowStartMs = sc.startMs;
      app.timeMs = sc.startMs;
      selectSite(sc.site, { fly: true, keepScenario: true });
      renderScenarios();
    },
    onRemove: (id) => {
      app.scenarios = app.scenarios.filter((s) => s.id !== id);
      renderScenarios();
    },
  });
}
function openCompare(open) {
  document.body.classList.toggle('compare-open', open);
  for (const id of ['#toggleCompare', '#compareBtn']) $(id).setAttribute('aria-expanded', String(open));
  if (open && isNarrow()) showPane('compare');
  requestAnimationFrame(() => {
    timeline.draw();
    polar?.draw();
    updateNow(true);
  });
}

function slipScenarios() {
  const base = app.windowStartMs;
  if (!app.scenarios.some((s) => s.site === app.site && s.startMs === base)) {
    addScenario({ site: app.site, startMs: base, label: `${app.site.short ?? app.site.name} · planned` });
  }
  for (let k = 1; k <= 3; k++) {
    const startMs = Math.round(base + k * SYNODIC_MONTH_DAYS * 86400000);
    addScenario({ site: app.site, startMs, label: `${app.site.short ?? app.site.name} · slip +${k} lunar month${k > 1 ? 's' : ''}` });
  }
  openCompare(true);
  setStatus('Added the same site with the landing slipped by 1, 2 and 3 lunar months (29.5 d each)');
}

async function nearbyAlternatives() {
  if (!app.ctx.horizon.terrain) {
    setStatus('Nearby search needs LOLA terrain: pick a site south of 75°S');
    return;
  }
  const btn = $('#nearbyScenarios');
  btn.disabled = true;
  try {
    await searchNearby(btn);
  } catch (err) {
    setStatus(`Nearby search failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find nearby alternatives';
  }
}

async function searchNearby(btn) {
  const origin = app.site;
  const candidates = [];
  const rings = [0.6, 1.2, 2, 3, 4, 5];
  for (const r of rings) {
    const n = Math.max(8, Math.round(r * 5));
    for (let k = 0; k < n; k++) candidates.push(destination(origin.lat, origin.lon, (360 * k) / n, r * 1000));
  }
  const results = [];
  // Simple screening score: sunlight weighted 0.6, Earth visibility 0.4, minus a
  // penalty of up to 0.2 for nights approaching 30 days. Shown in the status text.
  const scoreOf = (st) => st.litFraction * 0.6 + st.earthVisibleFraction * 0.4 - Math.min(1, st.longestDarkH / 720) * 0.2;
  const coarseStep = STEP_FOR_WINDOW[app.windowDays] * 2 * 60000;
  const windowEnd = app.windowStartMs + app.windowDays * 86400000;
  const baseScore = scoreOf(scan(app.ctx, { startMs: app.windowStartMs, endMs: windowEnd, stepMs: coarseStep }, app.config, { withDsn: false }).stats);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const ctx = prepareSite(c, app.terrain, app.config);
    const r = scan(ctx, { startMs: app.windowStartMs, endMs: windowEnd, stepMs: coarseStep }, app.config, { withDsn: false });
    results.push({ c, score: scoreOf(r.stats) });
    if (i % 6 === 0) {
      btn.textContent = `Searching… ${Math.round((100 * i) / candidates.length)}%`;
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  results.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const r of results) {
    if (picked.every((p) => surfaceDistance(p.c.lat, p.c.lon, r.c.lat, r.c.lon) > 900)) picked.push(r);
    if (picked.length === 3) break;
  }
  if (!app.scenarios.some((s) => s.site === origin && s.startMs === app.windowStartMs)) {
    addScenario({ site: origin, startMs: app.windowStartMs, label: `${origin.short ?? origin.name} · baseline` });
  }
  for (const p of picked) {
    const d = surfaceDistance(origin.lat, origin.lon, p.c.lat, p.c.lon);
    const az = (Math.atan2(
      Math.sin((p.c.lon - origin.lon) * Math.PI / 180) * Math.cos(p.c.lat * Math.PI / 180),
      Math.cos(origin.lat * Math.PI / 180) * Math.sin(p.c.lat * Math.PI / 180) - Math.sin(origin.lat * Math.PI / 180) * Math.cos(p.c.lat * Math.PI / 180) * Math.cos((p.c.lon - origin.lon) * Math.PI / 180),
    ) * 180) / Math.PI;
    const site = {
      id: `custom-${p.c.lat.toFixed(4)}-${p.c.lon.toFixed(4)}`,
      name: `${(d / 1000).toFixed(1)} km ${compass((az + 360) % 360)} of ${origin.short ?? origin.name}`,
      lat: p.c.lat,
      lon: p.c.lon,
      precision: 'custom',
    };
    addScenario({ site, startMs: app.windowStartMs, label: `Alt: ${site.name}` });
  }
  openCompare(true);
  const better = picked.filter((p) => p.score > baseScore + 0.005).length;
  setStatus(
    better
      ? `Searched ${candidates.length} terrain points within 5 km and added the 3 best (score: 0.6 × sunlit + 0.4 × Earth visible − night penalty). ${better} beat the original site.`
      : `Searched ${candidates.length} terrain points within 5 km: none scored better than the original site, so the closest runners-up were added for reference.`,
  );
}

// ------------------------------------------------------------------ settings
function openSettings() {
  const f = $('#settingsForm');
  f.mode.innerHTML = Object.entries(PANEL_MODES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  f.preset.innerHTML = Object.entries(RADIO_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const { power, comms } = app.config;
  f.mode.value = power.mode;
  f.areaM2.value = power.areaM2;
  f.efficiency.value = (power.efficiency * 100).toFixed(1);
  f.fixedAzDeg.value = power.fixedAzDeg;
  f.loadW.value = power.loadW;
  f.mastHeightM.value = app.config.mastHeightM;
  f.preset.value = comms.preset;
  f.dataRateKbps.value = comms.dataRateBps / 1000;
  f.minClearanceDeg.value = comms.minClearanceDeg;
  f.targetMarginDb.value = comms.targetMarginDb;
  f.ionToken.value = app.ionToken;
  $('#settings').showModal();
}
function applySettings() {
  const f = $('#settingsForm');
  const num = (el, fallback) => (Number.isFinite(Number(el.value)) && el.value !== '' ? Number(el.value) : fallback);
  const p = app.config.power;
  p.mode = f.mode.value;
  p.areaM2 = num(f.areaM2, p.areaM2);
  p.efficiency = num(f.efficiency, p.efficiency * 100) / 100;
  p.fixedAzDeg = num(f.fixedAzDeg, p.fixedAzDeg);
  p.loadW = num(f.loadW, p.loadW);
  app.config.mastHeightM = num(f.mastHeightM, app.config.mastHeightM);
  const c = app.config.comms;
  c.preset = f.preset.value;
  c.dataRateBps = num(f.dataRateKbps, c.dataRateBps / 1000) * 1000;
  c.minClearanceDeg = num(f.minClearanceDeg, c.minClearanceDeg);
  c.targetMarginDb = num(f.targetMarginDb, c.targetMarginDb);
  const token = f.ionToken.value.trim();
  const tokenChanged = token !== app.ionToken;
  app.ionToken = token;
  savePrefs();
  selectSite(app.site, { keepScenario: true });
  for (const sc of app.scenarios) {
    sc.ctx = prepareSite(sc.site, app.terrain, app.config);
    sc.scan = computeScan(sc.ctx, sc.startMs, sc.windowDays);
  }
  renderScenarios();
  if (tokenChanged && token) app.scene?.enableIon(token).then(reportIon);
}
function reportIon(r) {
  if (!r.terrain) return;
  setStatus(`Cesium Moon Terrain loaded${r.artemis ? ' with the Artemis candidate landing regions' : ''}. Analysis still uses the bundled LOLA grids.`);
  $('#terrainBtn').hidden = false;
}

function syncWindowButtons() {
  document.querySelectorAll('[data-window]').forEach((b) => {
    const on = Number(b.dataset.window) === app.windowDays;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// ------------------------------------------------------------------ narrow-screen sections
const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;
function showPane(name) {
  document.body.dataset.pane = name;
  document.querySelectorAll('[data-pane-target]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.paneTarget === name)));
  requestAnimationFrame(() => {
    timeline.draw();
    polar?.draw();
    updateNow(true);
  });
}

function selectView(view) {
  document.querySelectorAll('[data-view]').forEach((x) => {
    const on = x.dataset.view === view;
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', String(on));
    x.tabIndex = on ? 0 : -1;
  });
  const polarOn = view === 'polar';
  $('#polarWrap').hidden = !polarOn;
  if (polarOn) requestAnimationFrame(() => polar.draw());
}

/** Apply a #site=…&t=…&w=… link to the running app (also used on hashchange). */
function applyHash(hash) {
  if (hash.w) {
    app.windowDays = hash.w;
    syncWindowButtons();
  }
  if (hash.t) app.timeMs = app.windowStartMs = hash.t;
  let site = hash.id ? app.sites.find((s) => s.id === hash.id) : null;
  if (!site && hash.site) site = { id: 'custom-link', name: `Custom point ${fmtLatLon(hash.site.lat, hash.site.lon, 2)}`, short: 'Custom point', ...hash.site, precision: 'custom' };
  return site;
}

// ------------------------------------------------------------------ wiring
const timeline = createTimeline($('#timeline'), { onScrub: (ms) => setTime(ms) });
let polar = null;
const tour = createTour({ app, actions: { selectView, showPane, isNarrow, openCompare, setTime } });

function pickHandler(p) {
  if (p.site) return selectSite(p.site, { fly: false });
  const site = {
    id: `custom-${p.lat.toFixed(4)}-${p.lon.toFixed(4)}`,
    name: `Custom point ${fmtLatLon(p.lat, p.lon, 2)}`,
    short: 'Custom point',
    lat: p.lat,
    lon: p.lon,
    precision: 'custom',
  };
  selectSite(site);
}

function wire() {
  $('#siteFilter').addEventListener('input', renderSiteList);
  $('#coordForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('#coordError');
    const c = parseCoordinates($('#coordInput').value);
    if (!c) {
      err.textContent = 'Enter latitude and longitude in degrees, for example -89.45, -137.3 or 89.45S 137.3W.';
      err.hidden = false;
      $('#coordInput').setAttribute('aria-invalid', 'true');
      return;
    }
    err.hidden = true;
    $('#coordInput').removeAttribute('aria-invalid');
    pickHandler(c);
    app.scene?.flyToSite(app.site);
  });
  $('#datetime').addEventListener('change', () => {
    const ms = fromLocalInputValue($('#datetime').value);
    if (ms != null) setTime(ms, { reanchor: true });
  });
  const step = (ms) => setTime(app.timeMs + ms);
  $('#stepBackDay').addEventListener('click', () => step(-86400000));
  $('#stepBackHour').addEventListener('click', () => step(-3600000));
  $('#stepFwdHour').addEventListener('click', () => step(3600000));
  $('#stepFwdDay').addEventListener('click', () => step(86400000));
  $('#playPause').addEventListener('click', () => setPlaying(!app.playing));
  $('#speed').addEventListener('change', () => (app.speed = Number($('#speed').value)));
  $('#nowBtn').addEventListener('click', () => setTime(Math.floor(Date.now() / 60000) * 60000, { reanchor: true }));
  $('#learnBtn').addEventListener('click', () => {
    const on = !document.body.classList.contains('learn-on');
    document.body.classList.toggle('learn-on', on);
    $('#learnBtn').setAttribute('aria-pressed', String(on));
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  // Apply on submit (synchronous) rather than on the dialog's later 'close' event.
  $('#settingsForm').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'save') applySettings();
  });
  document.querySelectorAll('[data-window]').forEach((b) =>
    b.addEventListener('click', () => {
      app.windowDays = Number(b.dataset.window);
      syncWindowButtons();
      recomputeWindow();
      history.replaceState(null, '', scenarioLink());
    }),
  );
  const tabs = [...document.querySelectorAll('[data-view]')];
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => selectView(b.dataset.view));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = tabs[(i + d + tabs.length) % tabs.length];
      selectView(next.dataset.view);
      next.focus();
    });
  });
  document.querySelectorAll('[data-pane-target]').forEach((b) => b.addEventListener('click', () => showPane(b.dataset.paneTarget)));
  $('#compareBtn').addEventListener('click', () => openCompare(!document.body.classList.contains('compare-open')));
  $('#tourBtn').addEventListener('click', () => tour.start());
  window.addEventListener('hashchange', () => {
    const site = applyHash(readHash());
    if (site) selectSite(site, { fly: true });
    else recomputeWindow();
  });
  document.querySelectorAll('input[name="overlay"]').forEach((r) =>
    r.addEventListener('change', () => {
      polar.setOverlay(r.value);
      $('#overlayScale').hidden = r.value === 'none';
    }),
  );
  $('#overlayScale .scale-bar').style.background = RAMP_CSS;
  $('#viewSystem').addEventListener('click', () => app.scene?.earthMoonView());
  $('#viewOverview').addEventListener('click', () => app.scene?.overview());
  $('#viewPole').addEventListener('click', () => app.scene?.southPole());
  $('#viewSite').addEventListener('click', () => app.scene?.flyToSite(app.site));
  $('#viewStandSun').addEventListener('click', () => app.lastNow && app.scene?.siteView(app.ctx, app.lastNow.sun.az, Math.max(0, app.lastNow.sun.el)));
  $('#viewStandEarth').addEventListener('click', () => app.lastNow && app.scene?.siteView(app.ctx, app.lastNow.earth.az, Math.max(0, app.lastNow.earth.el)));
  $('#lightingBtn').addEventListener('click', () => {
    const real = $('#lightingBtn').getAttribute('aria-pressed') !== 'true';
    $('#lightingBtn').setAttribute('aria-pressed', String(real));
    $('#lightingBtn').textContent = real ? 'Real sunlight' : 'Even lighting';
    app.scene?.setLighting(real ? 'real' : 'flat');
  });
  $('#terrainBtn').addEventListener('click', () => {
    const ion = $('#terrainBtn').getAttribute('aria-pressed') !== 'true';
    $('#terrainBtn').setAttribute('aria-pressed', String(ion));
    $('#terrainBtn').textContent = ion ? 'Terrain: Cesium ion' : 'Terrain: bundled LOLA';
    app.scene?.setIonTerrainVisible(ion);
  });
  $('#addScenario').addEventListener('click', addCurrentScenario);
  $('#slipScenarios').addEventListener('click', slipScenarios);
  $('#nearbyScenarios').addEventListener('click', nearbyAlternatives);
  $('#clearScenarios').addEventListener('click', () => {
    app.scenarios = [];
    renderScenarios();
  });
  $('#exportCsv').addEventListener('click', () => {
    if (!app.scenarios.length) return setStatus('Add scenarios first');
    const blob = new Blob([scenariosToCsv(app.scenarios)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lunar-site-scenarios.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#toggleCompare').addEventListener('click', () => openCompare(!document.body.classList.contains('compare-open')));
  window.addEventListener('keydown', (e) => {
    // Leave keys to the focused control: buttons need Space, tabs and the
    // timeline slider need the arrow keys.
    if (e.target.closest('input, select, textarea, dialog, button, a, [role="tab"], [role="slider"], canvas, [popover]')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      setPlaying(!app.playing);
    } else if (e.code === 'ArrowRight') step(e.shiftKey ? 86400000 : 3600000);
    else if (e.code === 'ArrowLeft') step(e.shiftKey ? -86400000 : -3600000);
  });
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      timeline.draw();
      polar?.draw();
      updateNow(true);
    }, 120);
  });
}

async function boot() {
  window.lunarApp = app; // handy for demos, debugging and the browser tests
  loadPrefs();
  wire();
  $('#assessment').innerHTML = '<div class="empty">Loading LOLA terrain…</div>';
  try {
    app.terrain = await loadTerrain(DATA);
  } catch (err) {
    setStatus(`Terrain grids failed to load (${err.message}); horizons fall back to a bare sphere`);
  }
  try {
    const res = await fetch(`${DATA}/sp_illum_2027.json`);
    if (res.ok) {
      app.illum = await res.json();
      app.illum.best.slice(0, 3).forEach((b, i) => {
        if (app.sites.some((s) => surfaceDistance(s.lat, s.lon, b.lat, b.lon) < 2500)) return;
        app.sites.splice(CURATED_COMPUTED.length + i, 0, {
          id: `best-${i}`,
          name: `Best-lit cell #${i + 1} (1 km map, 2027)`,
          short: `Best-lit #${i + 1}`,
          group: 'computed',
          lat: b.lat,
          lon: b.lon,
          precision: 'computed',
          note: `One of the best-lit cells in this tool's 1 km map for 2027: on average ${Math.round(b.illum * 100)}% of the solar disk was above the terrain, and Earth's centre was above it ${Math.round(b.earth * 100)}% of the time. The window summary counts any part of the disk, so it reads higher.`,
        });
      });
    }
  } catch {
    /* overlay is optional */
  }

  polar = createPolarMap($('#polarMap'), { onPick: pickHandler });
  if (app.illum) polar.setIllumination(app.illum);
  polar.setSites(app.sites);

  // A link names a curated site by id; a custom point travels as coordinates only.
  let initial = applyHash(readHash());
  syncWindowButtons();
  initial ??= app.sites.find((s) => s.id === 'ridge') ?? app.sites[0];

  // Analysis first, so the panel is useful even while WebGL spins up.
  selectSite(initial);
  renderScenarios();

  try {
    app.scene = await createMoonScene($('#cesium'), { terrain: app.terrain, onPick: pickHandler, onStatus: setStatus });
    app.scene.setSites(app.sites);
    app.scene.setSelected(app.site);
    app.scene.overview();
    setTimeout(() => app.scene.flyToSite(app.site), 2300);
    updateNow(true);
    const ionToken = app.ionToken || import.meta.env.VITE_CESIUM_ION_TOKEN || '';
    if (ionToken) app.scene.enableIon(ionToken).then(reportIon);
  } catch (err) {
    console.error('3D scene failed:', err?.message, err?.stack);
    setStatus(`3D view unavailable (${err.message}). The south-pole map and all analysis still work.`);
    selectView('polar');
  }
  app.polar = polar;
  tour.offer();
}

boot();
