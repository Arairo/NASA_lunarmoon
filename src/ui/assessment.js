// Right-hand panel: the selected scenario's current status, next events, sky
// plot, window statistics and link details. The skeleton is built once per site
// so the sky plot canvas survives the frequent number updates.

import { RADIO_PRESETS } from '../core/comms.js';
import { SITE_GROUPS } from '../core/sites.js';
import { compass, deg, escapeHtml, fmtDuration, fmtHours, fmtLatLon, fmtRate, fmtUtc, pct } from './format.js';
import { learnForSite } from './learn.js';
import { term } from './glossary.js';

const PRECISION = {
  surveyed: 'surveyed position',
  reported: 'reported position',
  approx: 'approximate position',
  custom: 'custom point',
  computed: 'point chosen from LOLA terrain',
};

// Plain-language status text. Status is always shown as shape + text + colour.
const POWER_TEXT = { go: 'Meets load', marginal: 'Below load', 'no-go': 'No sunlight' };
const COMMS_TEXT = { go: 'Available', marginal: 'Degraded', 'no-go': 'Unavailable' };
const status = (cls, text) => `<span class="status ${cls}">${text}</span>`;

export function renderSkeleton(root, site, ctx) {
  const group = site.group ? SITE_GROUPS[site.group] : 'Custom point';
  root.innerHTML = `
    <div class="site-title">
      <div>
        <h2>${escapeHtml(site.name)}</h2>
        <p class="site-meta"><span class="mono">${fmtLatLon(site.lat, site.lon)}</span> · ${escapeHtml(group)}${site.group === 'computed' || !site.group ? '' : ` · ${PRECISION[site.precision ?? 'custom']}`}</p>
        <p class="site-meta">Terrain: ${escapeHtml(ctx.horizon.source)}${ctx.horizon.terrain ? ` · ground <span class="mono">${ctx.groundHeight >= 0 ? '+' : '−'}${Math.abs(ctx.groundHeight).toFixed(0)} m</span>` : ''} ${term('lola')}</p>
      </div>
      <div class="actions">
        <button id="addThis" class="small" title="Add this site and date to the comparison table">Add to compare</button>
        <button id="copyLink" class="small ghost" title="Copy a link to this scenario">Copy link</button>
      </div>
    </div>
    ${site.note ? `<div class="note">${escapeHtml(site.note)}</div>` : ''}
    ${ctx.horizon.terrain ? '' : `<div class="note">No bundled LOLA grid covers this point (the grids span the south pole to 75°S), so the horizon is the bare lunar sphere. Away from the poles the Sun climbs high, so local terrain matters much less.</div>`}
    <div class="verdicts">
      <div class="verdict" id="vPower"></div>
      <div class="verdict" id="vComms"></div>
    </div>
    <div class="countdowns">
      <div class="countdown sun" id="cdSun"></div>
      <div class="countdown earth" id="cdEarth"></div>
    </div>
    <div class="learn" id="learnTop"></div>
    <div class="block" id="skyBlock">
      <h3>Sky from the site ${term('horizon')} <small>terrain horizon with Sun and Earth paths over the window</small></h3>
      <canvas id="skyplot" role="img" aria-label="Sky plot of the terrain horizon with the Sun and Earth paths"></canvas>
      <div class="sky-legend" aria-hidden="true"><span class="k-terrain">Terrain (LOLA)</span><span class="k-sun">Sun</span><span class="k-earth">Earth</span></div>
      <div class="learn" id="learnSky"></div>
    </div>
    <div class="block" id="windowBlock">
      <h3>Window summary <small id="winLabel"></small></h3>
      <dl class="kv" id="winStats"></dl>
      <p class="fine">Percentages count time with any part of the Sun's or Earth's disk above the terrain, the definition NASA Goddard uses for its polar illumination maps. Power, energy and battery values are estimates from the spacecraft assumptions. Near ridge crests, results depend strongly on the 240 m terrain resolution.</p>
      <div class="learn" id="learnWindow"></div>
    </div>
    <div class="block" id="linkBlock">
      <h3>Direct-to-Earth link ${term('dte')} <small id="radioLabel"></small></h3>
      <dl class="kv" id="linkStats"></dl>
      <div class="dsn" id="dsnChips" role="group" aria-label="Moon elevation at each Deep Space Network complex"></div>
      <p class="fine">First-order link budget to a DSN 34 m antenna ${term('dsn')}. Relay satellites and other ground networks are not modelled.</p>
      <div class="learn" id="learnLink"></div>
    </div>
  `;
  const learn = learnForSite(site, ctx);
  root.querySelector('#learnTop').innerHTML = learn.top;
  root.querySelector('#learnSky').innerHTML = learn.sky;
  root.querySelector('#learnWindow').innerHTML = learn.window;
  root.querySelector('#learnLink').innerHTML = learn.link;
}

// While a "?" button inside a block is focused, pressed or hovered, rebuilding the
// block (every frame during playback) would remove it mid-click.
const busy = (el) => el.contains(document.activeElement) || !!el.querySelector('.gloss:hover, .gloss:active');

export function renderNow(root, { now, events, config }) {
  const vPower = root.querySelector('#vPower');
  if (!vPower) return;
  const sun = now.sun;
  // 8. "No sunlight" only when no part of the Sun is above the terrain.
  const powerText = now.powerStatus === 'no-go' && sun.fraction > 0 ? 'No array output' : POWER_TEXT[now.powerStatus];
  vPower.className = `verdict ${now.powerStatus}`;
  if (!busy(vPower)) vPower.innerHTML = `
    <div class="label"><span>Power</span>${status(now.powerStatus, powerText)}</div>
    <div class="big">${sun.watts >= 1 ? `${sun.watts.toFixed(0)} W` : '0 W'}</div>
    <div class="sub">Load ${config.power.loadW} W · Sun ${deg(sun.el)} at ${sun.az.toFixed(0)}° ${compass(sun.az)} · ${pct(sun.fraction)} of disk above terrain ${term('disk')}</div>`;

  const earth = now.earth;
  const vComms = root.querySelector('#vComms');
  vComms.className = `verdict ${now.commsStatus}`;
  vComms.innerHTML = `
    <div class="label"><span>Earth link</span>${status(now.commsStatus, COMMS_TEXT[now.commsStatus])}</div>
    <div class="big">${deg(earth.clearance, 1)}</div>
    <div class="sub">Earth centre ${earth.clearance >= 0 ? 'above' : 'below'} terrain · ${earth.lightTimeS.toFixed(2)} s one-way${now.commsReasons.length ? ` · ${escapeHtml(now.commsReasons[0])}` : ''}</div>`;

  const cd = (sel, kind, ev, upNow, labels) => {
    const target = root.querySelector(sel);
    const title = upNow ? labels.set : labels.rise;
    if (!ev) {
      target.innerHTML = `<div class="label">${title}</div><div class="value">Not within 40 days</div><div class="when">${kind} ${upNow ? 'stays up' : 'stays down'}</div>`;
      return;
    }
    target.innerHTML = `<div class="label">${title} in</div><div class="value">${fmtDuration(ev.ms - now.ms)}</div><div class="when">${fmtUtc(ev.ms)}</div>`;
  };
  cd('#cdSun', 'Sun', events.sun, sun.fraction > 0, { set: 'Sunset', rise: 'Sunrise' });
  cd('#cdEarth', 'Earth centre', events.earth, earth.los, { set: 'Earth centre sets', rise: 'Earth centre rises' });

  const link = now.link;
  const radio = RADIO_PRESETS[config.comms.preset];
  root.querySelector('#radioLabel').textContent = `${radio.label}, ${radio.txPowerW} W`;
  const cls = (v, good, ok) => (v >= good ? 'go' : v >= ok ? 'marginal' : 'no-go');
  const rateNote = link.rateLimitedBy === 'radio' ? '<span class="qual">radio limit</span>' : '<span class="qual">link limit</span>';
  const linkStats = root.querySelector('#linkStats');
  if (!busy(linkStats)) linkStats.innerHTML = `
    <dt>Range to Earth</dt><dd>${(earth.distM / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} km</dd>
    <dt>Light time one-way / round trip ${term('lightTime')}</dt><dd>${earth.lightTimeS.toFixed(3)} s / ${(2 * earth.lightTimeS).toFixed(2)} s</dd>
    <dt>Earth azimuth / elevation</dt><dd>${earth.az.toFixed(1)}° / ${deg(earth.el)}</dd>
    <dt>Terrain clearance (target ≥ ${config.comms.minClearanceDeg}°)</dt><dd data-status="${earth.los ? cls(earth.clearance, config.comms.minClearanceDeg, 0) : 'no-go'}">${deg(earth.clearance)}</dd>
    <dt>Free-space loss</dt><dd>${link.fspl.toFixed(1)} dB</dd>
    <dt>Received C/N₀ ${term('cn0')}</dt><dd>${earth.los ? `${link.cn0.toFixed(1)} dB-Hz` : 'blocked'}</dd>
    <dt>Margin at ${(config.comms.dataRateBps / 1000).toFixed(0)} kbps ${term('margin')}</dt><dd>${earth.los ? `${link.margin.toFixed(1)} dB` : 'blocked'}</dd>
    <dt>Highest rate at ${config.comms.targetMarginDb} dB margin</dt><dd>${earth.los ? `${fmtRate(link.maxRateBps)}${rateNote}` : 'blocked'}</dd>`;
  root.querySelector('#dsnChips').innerHTML = now.dsn
    .map((d) => `<span class="${d.visible ? 'on' : ''}" title="Moon elevation at ${d.name}: ${d.el.toFixed(1)}°">${d.name} ${d.el >= 0 ? '+' : '−'}${Math.abs(d.el).toFixed(0)}°${d.visible ? '' : ' (not usable)'}</span>`)
    .join('');
}

export function renderWindow(root, { scan, config }) {
  const el = root.querySelector('#winStats');
  if (!el) return;
  const s = scan.stats;
  const open = (flag) => (flag ? '≥ ' : '');
  root.querySelector('#winLabel').textContent = `${fmtUtc(scan.startMs).slice(0, 10)} → ${s.days.toFixed(0)} days`;
  el.innerHTML = `
    <dt>Time sunlit (any part of disk)</dt><dd>${pct(s.litFraction, 1)}</dd>
    <dt>Average array output (estimate)</dt><dd>${s.avgPowerW.toFixed(0)} W</dd>
    <dt>Energy generated (estimate)</dt><dd>${s.energyKWh.toFixed(0)} kWh</dd>
    <dt>Longest continuous darkness</dt><dd>${open(s.longestDarkOpenEnded && s.longestDarkH > 0)}${fmtHours(s.longestDarkH)}</dd>
    <dt>Battery to carry ${config.power.loadW} W (estimate)</dt><dd>${open(s.batteryOpenEnded)}${s.batteryKWh.toFixed(1)} kWh</dd>
    <dt>Sun elevation range</dt><dd>${deg(s.minSunEl, 1)} to ${deg(s.maxSunEl, 1)}</dd>
    <dt>Earth visible (any part of disk)</dt><dd>${pct(s.earthVisibleFraction, 1)}</dd>
    <dt>Direct-to-Earth link available</dt><dd>${pct(s.dteFraction, 1)}</dd>
    <dt>Longest communication blackout</dt><dd>${open(s.longestBlackoutOpenEnded && s.longestBlackoutH > 0)}${fmtHours(s.longestBlackoutH)}</dd>
    <dt>Earth elevation range</dt><dd>${deg(s.minEarthEl, 1)} to ${deg(s.maxEarthEl, 1)}</dd>`;
}
