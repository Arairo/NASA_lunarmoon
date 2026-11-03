// Terrain horizon from LOLA elevation grids.
//
// The Moon has no atmosphere, so there is no refraction: the horizon at a site
// is purely geometric, the highest elevation angle at which terrain (or the
// curve of the sphere itself) cuts the sky in each direction. We march rays
// outward along great circles over the LOLA grids and keep the steepest angle.

import { MOON_RADIUS_M, RAD, destination, sphereHorizonDip, toSouthPolar } from './geo.js';

export const AZ_STEP_DEG = 0.5;
export const AZ_COUNT = Math.round(360 / AZ_STEP_DEG);

/** Wrap one south-polar stereographic int16 grid (see tools/build_polar_dem.py). */
export function createGrid(meta, heights) {
  const { halfExtent: half, cellSize: cell, size: n } = meta;
  const data = heights instanceof Int16Array ? heights : new Int16Array(heights);
  if (data.length !== n * n) throw new Error(`${meta.name}: expected ${n * n} cells, got ${data.length}`);
  const margin = half - 1.5 * cell;
  const noData = meta.noData ?? -32768;
  return {
    meta,
    covers(x, y) {
      return Math.abs(x) < margin && Math.abs(y) < margin;
    },
    /** Bilinear height (m) at projected x/y, NaN on no-data; caller checks covers() first. */
    sample(x, y) {
      const fc = (x + half) / cell - 0.5;
      const fr = (half - y) / cell - 0.5;
      const c0 = Math.floor(fc);
      const r0 = Math.floor(fr);
      const tc = fc - c0;
      const tr = fr - r0;
      const i = r0 * n + c0;
      const h00 = data[i];
      const h01 = data[i + 1];
      const h10 = data[i + n];
      const h11 = data[i + n + 1];
      if (h00 === noData || h01 === noData || h10 === noData || h11 === noData) return NaN;
      return (h00 * (1 - tc) + h01 * tc) * (1 - tr) + (h10 * (1 - tc) + h11 * tc) * tr;
    },
  };
}

/** Combine grids finest-first into one terrain sampler. */
export function createTerrain(grids) {
  const ordered = [...grids].sort((a, b) => a.meta.cellSize - b.meta.cellSize);
  return {
    grids: ordered,
    /** { height, cell } at lat/lon, or null where no grid has data. */
    heightAt(lat, lon) {
      if (lat > -60) return null;
      const { x, y } = toSouthPolar(lat, lon);
      for (const g of ordered) {
        if (!g.covers(x, y)) continue;
        const height = g.sample(x, y);
        if (!Number.isNaN(height)) return { height, cell: g.meta.cellSize };
      }
      return null;
    },
    coverageLabel(lat, lon) {
      const h = this.heightAt(lat, lon);
      return h ? `LOLA ${h.cell >= 1000 ? `${h.cell / 1000} km` : `${h.cell} m`} grid` : null;
    },
  };
}

/** Load the shipped grids in a browser (or any fetch-capable runtime). */
export async function loadTerrain(baseUrl, names = ['sp_fine', 'sp_coarse']) {
  const grids = await Promise.all(
    names.map(async (name) => {
      const [meta, buf] = await Promise.all([
        fetch(`${baseUrl}/${name}.json`).then((r) => {
          if (!r.ok) throw new Error(`${name}.json ${r.status}`);
          return r.json();
        }),
        fetch(`${baseUrl}/${name}.bin`).then((r) => {
          if (!r.ok) throw new Error(`${name}.bin ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      return createGrid(meta, new Int16Array(buf));
    }),
  );
  return createTerrain(grids);
}

/**
 * Horizon elevation profile at a site.
 * Returns { elevations: Float32Array(AZ_COUNT) in deg, distances (m to the
 * horizon-forming terrain), groundHeight, mastHeight, source }.
 * Without terrain data the profile is the bare-sphere dip for the mast height.
 */
export function computeHorizon(terrain, lat, lon, { mastHeight = 2, maxDistM = 300000 } = {}) {
  const elevations = new Float32Array(AZ_COUNT);
  const distances = new Float32Array(AZ_COUNT);
  const ground = terrain?.heightAt(lat, lon) ?? null;
  const dip = sphereHorizonDip(mastHeight);
  if (!ground) {
    elevations.fill(dip);
    distances.fill(Math.sqrt(2 * MOON_RADIUS_M * mastHeight));
    return { elevations, distances, groundHeight: 0, mastHeight, source: 'smooth sphere (no terrain data)', terrain: false };
  }
  const r0 = MOON_RADIUS_M + ground.height + mastHeight;
  const minStep = ground.cell / 2;
  for (let i = 0; i < AZ_COUNT; i++) {
    const az = i * AZ_STEP_DEG;
    // Start from "no terrain seen" rather than the bare-sphere dip: a site on a
    // high ridge looks *down* on its horizon (often 1-2 deg below level), and
    // that negative horizon is exactly what keeps polar ridges in sunlight.
    let best = -90;
    let bestDist = 0;
    let s = Math.max(60, ground.cell * 0.75);
    while (s < maxDistM) {
      const p = destination(lat, lon, az, s);
      const h = terrain.heightAt(p.lat, p.lon);
      if (h) {
        const theta = s / MOON_RADIUS_M;
        const r1 = MOON_RADIUS_M + h.height;
        const el = Math.atan2(r1 * Math.cos(theta) - r0, r1 * Math.sin(theta)) * RAD;
        if (el > best) {
          best = el;
          bestDist = s;
        }
      } else if (s > 20000) break; // walked off the grids
      s += Math.max(minStep, s * 0.015);
    }
    elevations[i] = best > -90 ? best : dip;
    distances[i] = bestDist;
  }
  return {
    elevations,
    distances,
    groundHeight: ground.height,
    mastHeight,
    source: terrain.coverageLabel(lat, lon),
    terrain: true,
  };
}

/** Horizon elevation (deg) at any azimuth, linearly interpolated. */
export function horizonAt(horizon, azDeg) {
  const f = (((azDeg % 360) + 360) % 360) / AZ_STEP_DEG;
  const i0 = Math.floor(f) % AZ_COUNT;
  const i1 = (i0 + 1) % AZ_COUNT;
  const t = f - Math.floor(f);
  return horizon.elevations[i0] * (1 - t) + horizon.elevations[i1] * t;
}
