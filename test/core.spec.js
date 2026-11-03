// Unit tests for the lunar geometry, terrain and assessment core.
// Run with: npm test   (node --test, no extra dependencies)
// Named *.spec.js so the parent God's Eye View test runner ignores this folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { moonFixedState, topocentric } from '../src/core/ephemeris.js';
import { fromSouthPolar, sphereHorizonDip, toSouthPolar, surfaceDistance, destination } from '../src/core/geo.js';
import { computeHorizon } from '../src/core/horizon.js';
import { visibleDiskFraction, incidenceCos, solarPower, SOLAR_CONSTANT_W_M2 } from '../src/core/power.js';
import { freeSpaceLossDb, linkBudget, lightTimeS, dsnVisibility, grazingLossDb } from '../src/core/comms.js';
import { DEFAULT_CONFIG, prepareSite, scan, evaluate, nextTransition, isSunUp } from '../src/core/analysis.js';
import { parseCoordinates, SITES } from '../src/core/sites.js';
import { loadTerrainSync } from './loadTerrain.js';

const terrain = loadTerrainSync();
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('sub-Earth point matches astronomy-engine optical libration', () => {
  for (const iso of ['2024-04-23T23:49Z', '2025-03-01T00:00Z', '2026-10-31T00:00Z', '2027-03-15T12:00Z', '2028-07-04T06:00Z']) {
    const s = moonFixedState(new Date(iso));
    const lib = Astronomy.Libration(new Date(iso));
    // Libration() is optical libration only; physical libration adds < 0.1 deg.
    close(s.subEarth.lat, lib.elat, 0.1, `lat ${iso}`);
    close(s.subEarth.lon, lib.elon, 0.1, `lon ${iso}`);
    close(s.earthDistM / 1000, lib.dist_km, 1, `distance ${iso}`);
  }
});

test('full moon puts the sub-solar point next to the sub-Earth point; new moon opposite', () => {
  const full = moonFixedState(new Date('2024-04-23T23:49Z'));
  close(full.subSolar.lon, full.subEarth.lon, 1.5, 'full moon');
  const fresh = moonFixedState(new Date('2024-05-08T03:22Z'));
  const d = Math.abs(((fresh.subSolar.lon - fresh.subEarth.lon + 540) % 360) - 180);
  close(d, 180, 1.5, 'new moon');
});

test('sub-solar latitude never exceeds the 1.54 deg lunar obliquity (plus libration slack)', () => {
  let max = 0;
  for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2028, 0, 1); t += 86400000) max = Math.max(max, Math.abs(moonFixedState(t).subSolar.lat));
  assert.ok(max > 1.4 && max < 1.65, `max |subsolar lat| = ${max}`);
});

test('at the exact pole the Sun elevation equals minus the sub-solar latitude', () => {
  const s = moonFixedState(new Date('2027-05-01T00:00Z'));
  const topo = topocentric(s, { lat: -90, lon: 0, height: 0 });
  close(topo.sun.el, -s.subSolar.lat, 0.01);
});

test('Earth range and light time stay within the lunar orbit bounds', () => {
  for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2027, 2, 1); t += 6 * 3600000) {
    const s = moonFixedState(t);
    assert.ok(s.earthDistM > 356000e3 && s.earthDistM < 407000e3);
    const lt = lightTimeS(s.earthDistM);
    assert.ok(lt > 1.18 && lt < 1.36);
  }
});

test('south polar stereographic round-trips and matches PROJ reference values', () => {
  const p = toSouthPolar(-85, 45);
  close(p.x, 107277, 1);
  close(p.y, 107277, 1);
  const q = fromSouthPolar(-26261, -15162);
  close(q.lat, -89, 1e-3);
  close(q.lon, -120, 1e-3);
});

test('great-circle helpers are consistent', () => {
  const d = destination(-89, 30, 77, 12000);
  close(surfaceDistance(-89, 30, d.lat, d.lon), 12000, 0.5);
});

test('visible solar disk fraction is a proper circular segment', () => {
  close(visibleDiskFraction(1, 0, 0.27), 1, 1e-12);
  close(visibleDiskFraction(-1, 0, 0.27), 0, 1e-12);
  close(visibleDiskFraction(0, 0, 0.27), 0.5, 1e-12);
  const a = visibleDiskFraction(0.1, 0, 0.27);
  const b = visibleDiskFraction(-0.1, 0, 0.27);
  close(a + b, 1, 1e-12, 'symmetry');
});

test('panel incidence models', () => {
  close(incidenceCos('vertical_tracking', 0, 123), 1, 1e-12);
  close(incidenceCos('horizontal', 30, 0), 0.5, 1e-12);
  close(incidenceCos('fixed_vertical', 0, 180, 0), 0, 1e-12);
  const p = solarPower({ sunElDeg: 5, sunAzDeg: 0, horizonElDeg: 0, sunDistM: 149597870700 }, { mode: 'two_axis', areaM2: 1, efficiency: 1 });
  close(p.watts, SOLAR_CONSTANT_W_M2, 1e-6);
});

test('link budget: free-space loss and grazing penalty', () => {
  close(freeSpaceLossDb(384400e3, 2.25e9), 211.2, 0.1);
  assert.equal(grazingLossDb(5, 2), 0);
  close(grazingLossDb(0, 2), 6, 1e-12);
  const near = linkBudget(360000e3, 10, DEFAULT_CONFIG.comms);
  const far = linkBudget(405000e3, 10, DEFAULT_CONFIG.comms);
  close(near.margin - far.margin, 20 * Math.log10(405 / 360), 1e-6, 'margin tracks range');
});

test('DSN: at least one complex sees the Moon most of the time', () => {
  let any = 0;
  let n = 0;
  for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2027, 0, 29); t += 3600000, n++) if (dsnVisibility(t).some((d) => d.visible)) any++;
  assert.ok(any / n > 0.9, `DSN coverage ${any / n}`);
});

test('bare-sphere horizon dip for a 2 m mast', () => {
  close(sphereHorizonDip(2), -0.0870, 0.0005);
  const h = computeHorizon(terrain, 0.67, 23.47, { mastHeight: 2 });
  assert.equal(h.terrain, false);
  close(h.elevations[0], sphereHorizonDip(2), 1e-6);
});

test('Shackleton crater floor is permanently shadowed and never sees Earth', () => {
  const ctx = prepareSite({ lat: -89.67, lon: 129.78 }, terrain);
  assert.ok(ctx.horizon.terrain);
  assert.ok(Math.min(...ctx.horizon.elevations) > 10, 'crater walls rise >10 deg all round');
  const r = scan(ctx, { startMs: Date.UTC(2027, 0, 1), endMs: Date.UTC(2028, 0, 1), stepMs: 6 * 3600000 }, DEFAULT_CONFIG, { withDsn: false });
  assert.equal(r.stats.litFraction, 0);
  assert.equal(r.stats.earthVisibleFraction, 0);
});

test('connecting-ridge high point is among the best-lit places at the pole', () => {
  const ctx = prepareSite({ lat: -89.45, lon: -137.31 }, terrain);
  // A ridge ~2 km above its surroundings looks down on its horizon.
  assert.ok(Math.min(...ctx.horizon.elevations) < -1.5);
  const r = scan(ctx, { startMs: Date.UTC(2027, 0, 1), endMs: Date.UTC(2028, 0, 1), stepMs: 3 * 3600000 }, DEFAULT_CONFIG, { withDsn: false });
  assert.ok(r.stats.litFraction > 0.75 && r.stats.litFraction < 0.95, `lit ${r.stats.litFraction}`);
  assert.ok(r.stats.longestDarkH < 400, `longest dark ${r.stats.longestDarkH} h`);
  assert.ok(r.stats.earthVisibleFraction > 0.3 && r.stats.earthVisibleFraction < 0.7);
});

test('Apollo 11: half-month days, Earth always high in the sky', () => {
  const ctx = prepareSite(SITES.find((s) => s.id === 'a11'), terrain);
  const r = scan(ctx, { startMs: Date.UTC(2027, 0, 1), endMs: Date.UTC(2027, 1, 28), stepMs: 30 * 60000 }, DEFAULT_CONFIG, { withDsn: false });
  close(r.stats.litFraction, 0.5, 0.03);
  assert.equal(r.stats.earthVisibleFraction, 1);
  assert.ok(r.stats.minEarthEl > 55 && r.stats.maxEarthEl < 80);
  assert.ok(r.stats.longestDarkH > 300 && r.stats.longestDarkH < 370, `night ${r.stats.longestDarkH}`);
});

test('Chang’e 4 on the far side never sees Earth', () => {
  const ctx = prepareSite(SITES.find((s) => s.id === 'ce4'), terrain);
  const r = scan(ctx, { startMs: Date.UTC(2027, 0, 1), endMs: Date.UTC(2027, 1, 1), stepMs: 60 * 60000 }, DEFAULT_CONFIG, { withDsn: false });
  assert.equal(r.stats.earthVisibleFraction, 0);
  assert.equal(r.stats.dteFraction, 0);
});

test('next sunset/sunrise search agrees with the instantaneous evaluation', () => {
  const ctx = prepareSite(SITES.find((s) => s.id === 'a11'), terrain);
  const t0 = Date.UTC(2027, 0, 1);
  const ev = nextTransition(ctx, t0, isSunUp);
  assert.ok(ev, 'transition found within 40 days');
  assert.notEqual(isSunUp(evaluate(ev.ms - 60000, ctx, DEFAULT_CONFIG, { withDsn: false })), isSunUp(evaluate(ev.ms + 60000, ctx, DEFAULT_CONFIG, { withDsn: false })));
});

test('coordinate parser', () => {
  assert.deepEqual(parseCoordinates('-89.45, -137.3'), { lat: -89.45, lon: -137.3 });
  assert.deepEqual(parseCoordinates('89.45S 137.3W'), { lat: -89.45, lon: -137.3 });
  assert.deepEqual(parseCoordinates('0.674 N, 23.47 E'), { lat: 0.674, lon: 23.47 });
  assert.deepEqual(parseCoordinates('10, 350'), { lat: 10, lon: -10 });
  assert.equal(parseCoordinates('hello'), null);
  assert.equal(parseCoordinates('95, 10'), null);
});

test('Earth "visible" counts any part of the disk; the link needs the centre', () => {
  const ctx = prepareSite({ lat: -89.45, lon: -137.31 }, terrain);
  const r = scan(ctx, { startMs: Date.UTC(2027, 0, 1), endMs: Date.UTC(2027, 3, 1), stepMs: 3 * 3600000 }, DEFAULT_CONFIG, { withDsn: false });
  // Any-part visibility can only be equal to or larger than centre visibility.
  assert.ok(r.stats.earthVisibleFraction >= r.stats.earthCentreFraction);
  assert.ok(r.stats.earthVisibleFraction - r.stats.earthCentreFraction < 0.15);
  for (let i = 0; i < r.series.los.length; i++) if (r.series.los[i]) assert.equal(r.series.visible[i], 1);
});

test('reported data rate never exceeds the radio preset limit', () => {
  const strong = linkBudget(360000e3, 30, { ...DEFAULT_CONFIG.comms, preset: 's_mga' });
  assert.ok(strong.budgetRateBps > strong.radio.radioMaxBps, 'test assumes a strong link');
  assert.equal(strong.maxRateBps, strong.radio.radioMaxBps);
  assert.equal(strong.rateLimitedBy, 'radio');
  const weak = linkBudget(405000e3, 0.5, { ...DEFAULT_CONFIG.comms, preset: 's_lga', targetMarginDb: 3 });
  assert.ok(weak.maxRateBps <= weak.radio.radioMaxBps);
});

test('comparison screening labels', async () => {
  const { verdictFor } = await import('../src/ui/compare.js');
  assert.equal(verdictFor({ litFraction: 0.9, longestDarkH: 50, dteFraction: 0.6, longestBlackoutH: 100 }).text, 'Meets both');
  assert.equal(verdictFor({ litFraction: 0.9, longestDarkH: 50, dteFraction: 0, longestBlackoutH: 999 }).text, 'No DTE link');
  assert.equal(verdictFor({ litFraction: 0.9, longestDarkH: 50, dteFraction: 0.2, longestBlackoutH: 300 }).text, 'Comms-limited');
  assert.equal(verdictFor({ litFraction: 0.3, longestDarkH: 300, dteFraction: 0.6, longestBlackoutH: 100 }).text, 'Power-limited');
});
