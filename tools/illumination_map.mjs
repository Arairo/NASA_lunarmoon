#!/usr/bin/env node
// Precompute a south-pole illumination and Earth-visibility map from the shipped
// LOLA grids, using exactly the same horizon/ephemeris code the app runs.
//
//   node tools/illumination_map.mjs [halfExtentKm=60] [cellKm=1] [year=2027]
//
// Writes public/data/sp_illum_<year>.json: per-cell average fraction of the
// solar disk above the local horizon (the "average illumination" metric used in
// lunar polar lighting studies), percent of time Earth's centre is above the
// terrain, and the longest continuous darkness. It also lists the best-lit
// local maxima, which the app offers as computed candidate sites.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const here = fileURLToPath(import.meta.url);

async function work({ rows, half, cell, n, startMs, endMs, stepMs }) {
  const { loadTerrainSync } = await import('../test/loadTerrain.js');
  const { computeHorizon, horizonAt } = await import('../src/core/horizon.js');
  const { moonFixedState, topocentric } = await import('../src/core/ephemeris.js');
  const { enuBasis, fromSouthPolar } = await import('../src/core/geo.js');
  const { sunAngularRadiusDeg, visibleDiskFraction } = await import('../src/core/power.js');
  const terrain = loadTerrainSync();
  const states = [];
  for (let t = startMs; t < endMs; t += stepMs) states.push(moonFixedState(t));
  const out = [];
  for (const row of rows) {
    for (let col = 0; col < n; col++) {
      const x = -half + (col + 0.5) * cell;
      const y = half - (row + 0.5) * cell;
      const { lat, lon } = fromSouthPolar(x, y);
      const hz = computeHorizon(terrain, lat, lon, { mastHeight: 2 });
      const site = { lat, lon, height: hz.groundHeight + 2, basis: enuBasis(lat, lon) };
      let lit = 0;
      let earth = 0;
      let dark = 0;
      let longestDark = 0;
      for (const s of states) {
        const topo = topocentric(s, site);
        const f = visibleDiskFraction(topo.sun.el, horizonAt(hz, topo.sun.az), sunAngularRadiusDeg(topo.sun.distM));
        lit += f;
        if (f > 0) dark = 0;
        else longestDark = Math.max(longestDark, ++dark);
        if (topo.earth.el > horizonAt(hz, topo.earth.az)) earth++;
      }
      out.push({
        i: row * n + col,
        illum: lit / states.length,
        earth: earth / states.length,
        darkH: (longestDark * stepMs) / 3600000,
        lat,
        lon,
        h: hz.groundHeight,
      });
    }
  }
  return out;
}

if (!isMainThread) {
  parentPort.postMessage(await work(workerData));
} else {
  const halfKm = Number(process.argv[2] ?? 60);
  const cellKm = Number(process.argv[3] ?? 1);
  const year = Number(process.argv[4] ?? 2027);
  const half = halfKm * 1000;
  const cell = cellKm * 1000;
  const n = Math.round((2 * half) / cell);
  const startMs = Date.UTC(year, 0, 1);
  const endMs = Date.UTC(year + 1, 0, 1);
  const stepMs = 3 * 3600000;
  const threads = Math.max(1, availableParallelism());
  const t0 = Date.now();
  const jobs = Array.from({ length: threads }, (_, k) => {
    const rows = [];
    for (let r = k; r < n; r += threads) rows.push(r);
    return new Promise((resolve, reject) => {
      const w = new Worker(here, { workerData: { rows, half, cell, n, startMs, endMs, stepMs } });
      w.once('message', resolve);
      w.once('error', reject);
    });
  });
  const cells = (await Promise.all(jobs)).flat().sort((a, b) => a.i - b.i);
  const illum = cells.map((c) => Math.round(c.illum * 1000));
  const earth = cells.map((c) => Math.round(c.earth * 1000));
  const darkH = cells.map((c) => Math.round(c.darkH));

  // Best-lit local maxima, at least 4 km apart.
  const ranked = [...cells].sort((a, b) => b.illum - a.illum);
  const picks = [];
  const sep = Math.ceil(4000 / cell);
  for (const c of ranked) {
    const r = Math.floor(c.i / n);
    const k = c.i % n;
    if (picks.every((p) => Math.max(Math.abs(p.r - r), Math.abs(p.k - k)) > sep)) picks.push({ ...c, r, k });
    if (picks.length >= 6) break;
  }
  const result = {
    description: `Average solar-disk visibility and Earth visibility from LOLA terrain, ${year}, 3-hour sampling, 2 m mast`,
    projection: 'south-polar-stereographic',
    halfExtent: half,
    cellSize: cell,
    size: n,
    startMs,
    endMs,
    stepMs,
    scale: 1000,
    illum,
    earth,
    darkH,
    best: picks.map((p) => ({
      lat: +p.lat.toFixed(4),
      lon: +p.lon.toFixed(4),
      illum: +p.illum.toFixed(3),
      earth: +p.earth.toFixed(3),
      longestDarkH: Math.round(p.darkH),
      heightM: Math.round(p.h),
    })),
  };
  const outFile = fileURLToPath(new URL(`../public/data/sp_illum_${year}.json`, import.meta.url));
  writeFileSync(outFile, JSON.stringify(result));
  console.log(`wrote ${outFile} (${n}x${n}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(result.best);
}
