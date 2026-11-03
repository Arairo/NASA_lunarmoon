// Direct-to-Earth (DTE) link assessment.
//
// Three things decide whether a lander can talk to Earth without a relay:
//  1. Line of sight: Earth must clear the local terrain horizon (with margin,
//     because grazing paths suffer diffraction and multipath off the regolith).
//  2. A ground station must see the Moon: DSN complexes at Goldstone, Madrid and
//     Canberra are ~120 deg apart in longitude so at least one usually does.
//  3. Link budget: free-space loss over ~360,000-405,000 km and the radio's
//     power and antennas set the achievable data rate.
// Latency is just the light time, ~1.2-1.35 s each way.

import * as Astronomy from 'astronomy-engine';
import { C_M_S, clamp } from './geo.js';

export const EARTH_RADIUS_M = 6371000;
const BOLTZMANN_DBW = -228.6;

export const DSN_STATIONS = [
  { id: 'GDSCC', name: 'Goldstone', country: 'USA', lat: 35.4267, lon: -116.89, heightM: 1000 },
  { id: 'MDSCC', name: 'Madrid', country: 'Spain', lat: 40.4314, lon: -4.2481, heightM: 830 },
  { id: 'CDSCC', name: 'Canberra', country: 'Australia', lat: -35.4014, lon: 148.9817, heightM: 690 },
].map((s) => ({ ...s, observer: new Astronomy.Observer(s.lat, s.lon, s.heightM) }));

// First-order radio presets. Ground side assumes a DSN 34 m beam-waveguide dish.
// radioMaxBps is an assumed upper limit for the radio itself (modulation and
// bandwidth), so a strong link is not reported as an unrealistically high rate.
export const RADIO_PRESETS = {
  s_lga: {
    label: 'S-band, low-gain antenna',
    band: 'S',
    freqHz: 2.25e9,
    txPowerW: 10,
    txGainDbi: 5,
    radioMaxBps: 2e6,
    ground: { gainDbi: 56.1, tsysK: 40 },
  },
  s_mga: {
    label: 'S-band, medium-gain antenna',
    band: 'S',
    freqHz: 2.25e9,
    txPowerW: 10,
    txGainDbi: 15,
    radioMaxBps: 2e6,
    ground: { gainDbi: 56.1, tsysK: 40 },
  },
  x_hga: {
    label: 'X-band, high-gain antenna',
    band: 'X',
    freqHz: 8.45e9,
    txPowerW: 15,
    txGainDbi: 25,
    radioMaxBps: 10e6,
    ground: { gainDbi: 68.2, tsysK: 30 },
  },
};

export const DEFAULT_COMMS_CONFIG = {
  preset: 's_mga',
  minClearanceDeg: 2, // Earth centre must clear terrain by this much for a clean link
  dsnMinElDeg: 10,
  requiredEbN0Db: 2.5, // coded BPSK (turbo/LDPC) at ~1e-6 BER
  targetMarginDb: 3,
  dataRateBps: 256000,
  miscLossDb: 2, // pointing, polarisation, cable losses
};

export function earthAngularRadiusDeg(distM) {
  return (Math.asin(EARTH_RADIUS_M / distM) * 180) / Math.PI;
}

export function lightTimeS(distM) {
  return distM / C_M_S;
}

export function freeSpaceLossDb(distM, freqHz) {
  return 20 * Math.log10((4 * Math.PI * distM * freqHz) / C_M_S);
}

/**
 * Extra loss (dB) for a low-clearance path. Zero once Earth clears terrain by
 * the configured margin, rising to 6 dB at grazing (Fresnel-zone obstruction and
 * surface multipath); the link is treated as blocked below the horizon.
 */
export function grazingLossDb(clearanceDeg, minClearanceDeg) {
  if (clearanceDeg >= minClearanceDeg) return 0;
  return 6 * clamp(1 - clearanceDeg / minClearanceDeg, 0, 1);
}

export function linkBudget(distM, clearanceDeg, config = DEFAULT_COMMS_CONFIG) {
  const radio = RADIO_PRESETS[config.preset] ?? RADIO_PRESETS.s_mga;
  const eirpDbw = 10 * Math.log10(radio.txPowerW) + radio.txGainDbi;
  const fspl = freeSpaceLossDb(distM, radio.freqHz);
  const grazing = grazingLossDb(clearanceDeg, config.minClearanceDeg);
  const gOverT = radio.ground.gainDbi - 10 * Math.log10(radio.ground.tsysK);
  const cn0 = eirpDbw - fspl - config.miscLossDb - grazing + gOverT - BOLTZMANN_DBW; // dB-Hz
  const ebn0 = cn0 - 10 * Math.log10(config.dataRateBps);
  const margin = ebn0 - config.requiredEbN0Db;
  const budgetRateBps = 10 ** ((cn0 - config.requiredEbN0Db - config.targetMarginDb) / 10);
  const maxRateBps = Math.min(budgetRateBps, radio.radioMaxBps);
  const rateLimitedBy = budgetRateBps > radio.radioMaxBps ? 'radio' : 'link';
  return { eirpDbw, fspl, grazing, cn0, ebn0, margin, maxRateBps, budgetRateBps, rateLimitedBy, radio };
}

const dsnCache = new Map();
/** Moon elevation at each DSN complex. Cached per millisecond timestamp. */
export function dsnVisibility(ms, minElDeg = DEFAULT_COMMS_CONFIG.dsnMinElDeg) {
  let els = dsnCache.get(ms);
  if (!els) {
    const time = Astronomy.MakeTime(new Date(ms));
    els = DSN_STATIONS.map((s) => {
      const eq = Astronomy.Equator(Astronomy.Body.Moon, time, s.observer, true, true);
      return Astronomy.Horizon(time, s.observer, eq.ra, eq.dec, null).altitude;
    });
    if (dsnCache.size > 20000) dsnCache.clear();
    dsnCache.set(ms, els);
  }
  return DSN_STATIONS.map((s, i) => ({ id: s.id, name: s.name, el: els[i], visible: els[i] >= minElDeg }));
}
