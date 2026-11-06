// Site/date evaluation: one instant, a whole time window, and event search.
// This is the single source of numbers for the UI, the tests and the offline
// illumination-map tool, so every view agrees.

import { enuBasis } from './geo.js';
import { moonFixedState, topocentric } from './ephemeris.js';
import { computeHorizon, horizonAt } from './horizon.js';
import { DEFAULT_POWER_CONFIG, solarPower } from './power.js';
import {
  DEFAULT_COMMS_CONFIG,
  dsnVisibility,
  earthAngularRadiusDeg,
  lightTimeS,
  linkBudget,
} from './comms.js';

export const DEFAULT_CONFIG = {
  mastHeightM: 2,
  power: DEFAULT_POWER_CONFIG,
  comms: DEFAULT_COMMS_CONFIG,
};

/** Resolve terrain and horizon once per site so time scans stay cheap. */
export function prepareSite(site, terrain, config = DEFAULT_CONFIG) {
  // At exactly ±90° azimuth and longitude are undefined; 1e-4° (about 3 m) away they are not.
  const lat = Math.max(-POLE_LIMIT_DEG, Math.min(POLE_LIMIT_DEG, site.lat));
  const horizon = computeHorizon(terrain, lat, site.lon, { mastHeight: config.mastHeightM });
  return {
    ...site,
    lat,
    groundHeight: horizon.groundHeight,
    height: horizon.groundHeight + config.mastHeightM,
    basis: enuBasis(lat, site.lon),
    horizon,
  };
}

export const POLE_LIMIT_DEG = 89.9999;

/** Everything about one site at one instant. */
export function evaluate(ms, ctx, config = DEFAULT_CONFIG, { withDsn = true } = {}) {
  const state = moonFixedState(ms);
  const topo = topocentric(state, ctx);
  const sunHorizon = horizonAt(ctx.horizon, topo.sun.az);
  const power = solarPower(
    { sunElDeg: topo.sun.el, sunAzDeg: topo.sun.az, horizonElDeg: sunHorizon, sunDistM: topo.sun.distM },
    config.power,
  );
  const earthHorizon = horizonAt(ctx.horizon, topo.earth.az);
  const clearance = topo.earth.el - earthHorizon;
  const earthRadius = earthAngularRadiusDeg(topo.earth.distM);
  // Two definitions, used for different questions:
  //  visible: any part of Earth's disk above the terrain (NASA PGDA's definition,
  //           used for "Earth visible" statistics);
  //  los:     Earth's centre above the terrain, required for a direct link.
  const visible = clearance > -earthRadius;
  const los = clearance > 0;
  const link = linkBudget(topo.earth.distM, clearance, config.comms);
  const dsn = withDsn ? dsnVisibility(ms, config.comms.dsnMinElDeg) : null;
  const dsnAny = dsn ? dsn.some((d) => d.visible) : true;

  let commsStatus = 'go';
  const commsReasons = [];
  if (!los) {
    commsStatus = 'no-go';
    commsReasons.push(clearance < -earthRadius ? 'Earth is below the local horizon' : 'Earth is partly hidden by terrain');
  } else {
    if (clearance < config.comms.minClearanceDeg) {
      commsStatus = 'marginal';
      commsReasons.push(`Earth only ${clearance.toFixed(1)}° above terrain (want ≥ ${config.comms.minClearanceDeg}°)`);
    }
    if (!dsnAny) {
      commsStatus = 'no-go';
      commsReasons.push('No DSN complex has the Moon above 10°');
    }
    if (link.margin < 0) {
      commsStatus = 'no-go';
      commsReasons.push(`Link does not close at ${(config.comms.dataRateBps / 1000).toFixed(0)} kbps`);
    } else if (link.margin < config.comms.targetMarginDb && commsStatus === 'go') {
      commsStatus = 'marginal';
      commsReasons.push(`Link margin ${link.margin.toFixed(1)} dB (< ${config.comms.targetMarginDb} dB)`);
    }
  }
  const powerStatus = power.watts >= config.power.loadW ? 'go' : power.watts > 0 ? 'marginal' : 'no-go';

  return {
    ms,
    state,
    sun: { ...topo.sun, horizon: sunHorizon, clearance: topo.sun.el - sunHorizon, ...power },
    earth: {
      ...topo.earth,
      horizon: earthHorizon,
      clearance,
      radiusDeg: earthRadius,
      visible,
      los,
      lightTimeS: lightTimeS(topo.earth.distM),
    },
    link,
    dsn,
    dsnAny,
    commsStatus,
    commsReasons,
    powerStatus,
  };
}

function runs(times, flags, stepMs) {
  const out = [];
  let start = null;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start === null) start = times[i];
    if (!flags[i] && start !== null) {
      out.push([start, times[i]]);
      start = null;
    }
  }
  if (start !== null) out.push([start, times[times.length - 1] + stepMs]);
  return out;
}

function longestGap(times, flags, stepMs) {
  let best = 0;
  let run = 0;
  let touchesEdge = false;
  let bestTouchesEdge = false;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) {
      if (run === 0) touchesEdge = i === 0;
      run++;
      const edge = touchesEdge || i === flags.length - 1;
      if (run > best) {
        best = run;
        bestTouchesEdge = edge;
      }
    } else run = 0;
  }
  return { hours: (best * stepMs) / 3600000, openEnded: bestTouchesEdge };
}

/**
 * Sample a site across [startMs, endMs). Returns typed-array series for charts,
 * operational intervals and summary statistics.
 */
export function scan(ctx, { startMs, endMs, stepMs = 20 * 60000 }, config = DEFAULT_CONFIG, { withDsn = true } = {}) {
  const n = Math.max(2, Math.ceil((endMs - startMs) / stepMs));
  const times = new Float64Array(n);
  const sunEl = new Float32Array(n);
  const sunAz = new Float32Array(n);
  const sunHorizon = new Float32Array(n);
  const sunFrac = new Float32Array(n);
  const watts = new Float32Array(n);
  const earthEl = new Float32Array(n);
  const earthAz = new Float32Array(n);
  const earthClear = new Float32Array(n);
  const margin = new Float32Array(n);
  const lit = new Uint8Array(n);
  const los = new Uint8Array(n);
  const visible = new Uint8Array(n);
  const dsnAny = new Uint8Array(n);
  const dte = new Uint8Array(n);
  let energyWh = 0;
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownWh = 0;
  const stepH = stepMs / 3600000;
  for (let i = 0; i < n; i++) {
    const ms = startMs + i * stepMs;
    const r = evaluate(ms, ctx, config, { withDsn });
    times[i] = ms;
    sunEl[i] = r.sun.el;
    sunAz[i] = r.sun.az;
    sunHorizon[i] = r.sun.horizon;
    sunFrac[i] = r.sun.fraction;
    watts[i] = r.sun.watts;
    earthEl[i] = r.earth.el;
    earthAz[i] = r.earth.az;
    earthClear[i] = r.earth.clearance;
    margin[i] = r.earth.los ? r.link.margin : -99;
    lit[i] = r.sun.fraction > 0 ? 1 : 0;
    los[i] = r.earth.los ? 1 : 0;
    visible[i] = r.earth.visible ? 1 : 0;
    dsnAny[i] = r.dsnAny ? 1 : 0;
    dte[i] = r.earth.los && r.dsnAny && r.link.margin >= 0 ? 1 : 0;
    energyWh += r.sun.watts * stepH;
    // Battery sizing: deepest cumulative energy deficit against the load.
    cumulative += (r.sun.watts - config.power.loadW) * stepH;
    if (cumulative > peak) peak = cumulative;
    maxDrawdownWh = Math.max(maxDrawdownWh, peak - cumulative);
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const dark = longestGap(times, lit, stepMs);
  const blackout = longestGap(times, dte, stepMs);
  const hidden = longestGap(times, los, stepMs);
  const stats = {
    days: (endMs - startMs) / 86400000,
    litFraction: mean(lit),
    fullSunFraction: mean(Array.from(sunFrac, (f) => (f >= 0.99 ? 1 : 0))),
    avgPowerW: energyWh / (n * stepH),
    energyKWh: energyWh / 1000,
    maxSunEl: Math.max(...sunEl),
    minSunEl: Math.min(...sunEl),
    longestDarkH: dark.hours,
    longestDarkOpenEnded: dark.openEnded,
    batteryKWh: maxDrawdownWh / 1000,
    // The deficit is cut off by the window edge: the true battery need may be larger.
    batteryOpenEnded: maxDrawdownWh > 0 && (watts[0] < config.power.loadW || watts[n - 1] < config.power.loadW),
    earthVisibleFraction: mean(visible),
    earthCentreFraction: mean(los),
    dsnFraction: mean(dsnAny),
    dteFraction: mean(dte),
    longestEarthHiddenH: hidden.hours,
    longestBlackoutH: blackout.hours,
    longestBlackoutOpenEnded: blackout.openEnded,
    minEarthEl: Math.min(...earthEl),
    maxEarthEl: Math.max(...earthEl),
  };
  return {
    startMs,
    endMs,
    stepMs,
    series: { times, sunEl, sunAz, sunHorizon, sunFrac, watts, earthEl, earthAz, earthClear, margin, lit, los, visible, dsnAny, dte },
    intervals: { lit: runs(times, lit, stepMs), los: runs(times, los, stepMs), dte: runs(times, dte, stepMs) },
    stats,
  };
}

/**
 * Next time `predicate(evaluation)` changes value after `ms`, refined by
 * bisection to ~30 s. Returns { ms, from, to } or null within `maxDays`.
 */
export function nextTransition(ctx, ms, predicate, config = DEFAULT_CONFIG, { maxDays = 40, stepMin = 15 } = {}) {
  const test = (t) => predicate(evaluate(t, ctx, config, { withDsn: false }));
  const from = test(ms);
  const step = stepMin * 60000;
  const limit = ms + maxDays * 86400000;
  let a = ms;
  for (let t = ms + step; t <= limit; t += step) {
    if (test(t) !== from) {
      let lo = a;
      let hi = t;
      while (hi - lo > 30000) {
        const mid = Math.round((lo + hi) / 2);
        if (test(mid) === from) lo = mid;
        else hi = mid;
      }
      return { ms: hi, from, to: !from };
    }
    a = t;
  }
  return null;
}

export const isSunUp = (e) => e.sun.fraction > 0;
export const isEarthUp = (e) => e.earth.los;
