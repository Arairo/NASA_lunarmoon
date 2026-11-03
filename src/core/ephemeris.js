// Sun and Earth geometry in the Moon's body-fixed frame.
//
// Positions come from astronomy-engine (VSOP87 Sun/Earth + full ELP/MPP02-style
// Moon series, ~arcminute accuracy). The Moon's orientation is the IAU/WGCCRE
// rotation model (pole RA/Dec and prime-meridian angle W with the E1..E13
// libration terms), which approximates the Mean-Earth/polar-axis frame that
// LOLA terrain and Cesium's Moon tiles use. Physical and optical libration, the
// Moon's elliptical orbit and the ~1.5 deg lunar obliquity therefore all fall
// out of the geometry; nothing is approximated with a "mean" Earth position.

import * as Astronomy from 'astronomy-engine';
import { AU_M, DEG, azEl, enuBasis, latLonOf, norm, siteVector, sub, unit } from './geo.js';

function rotZ(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}
function rotX(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]];
}

/** J2000 equatorial (EQJ) -> Moon body-fixed, via IAU  M = Rz(W) Rx(90-dec) Rz(90+ra). */
export function eqjToMoonFixed(v, axis) {
  const ra = axis.ra * 15 * DEG; // astronomy-engine returns RA in sidereal hours
  const dec = axis.dec * DEG;
  const w = axis.spin * DEG;
  return rotZ(rotX(rotZ(v, Math.PI / 2 + ra), Math.PI / 2 - dec), w);
}

const cache = new Map();
const CACHE_LIMIT = 20000;

/**
 * Moon-centred, Moon-fixed positions (metres) of the Sun and Earth at `date`.
 * Results are cached by millisecond so a time scan shared by many sites costs
 * one ephemeris evaluation per sample.
 */
export function moonFixedState(date) {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  const hit = cache.get(ms);
  if (hit) return hit;
  const time = Astronomy.MakeTime(new Date(ms));
  const moon = Astronomy.GeoMoon(time);
  const sun = Astronomy.GeoVector(Astronomy.Body.Sun, time, false);
  const axis = Astronomy.RotationAxis(Astronomy.Body.Moon, time);
  const earthEqj = [-moon.x * AU_M, -moon.y * AU_M, -moon.z * AU_M];
  const sunEqj = [(sun.x - moon.x) * AU_M, (sun.y - moon.y) * AU_M, (sun.z - moon.z) * AU_M];
  const earth = eqjToMoonFixed(earthEqj, axis);
  const sunV = eqjToMoonFixed(sunEqj, axis);
  const state = {
    ms,
    sun: sunV,
    earth,
    sunDistM: norm(sunV),
    earthDistM: norm(earth),
    subSolar: latLonOf(sunV),
    subEarth: latLonOf(earth),
  };
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(ms, state);
  return state;
}

/**
 * Topocentric azimuth/elevation/range of the Sun and Earth from a site.
 * `site` = { lat, lon, height } with height in metres above the 1737.4 km sphere
 * (terrain + mast). Topocentric parallax matters for Earth: the site sits up to
 * 1737 km off the Moon's centre, which moves Earth by up to ~0.26 deg.
 */
export function topocentric(state, site) {
  const p = siteVector(site.lat, site.lon, site.height ?? 0);
  const basis = site.basis ?? enuBasis(site.lat, site.lon);
  const toSun = sub(state.sun, p);
  const toEarth = sub(state.earth, p);
  return {
    sun: { ...azEl(toSun, basis), distM: norm(toSun) },
    earth: { ...azEl(toEarth, basis), distM: norm(toEarth) },
  };
}

/** Unit vector from the Moon toward the Sun (for scene lighting). */
export function sunDirection(state) {
  return unit(state.sun);
}

/** Lunar phase as seen from Earth: 0 = new, 0.5 = full (illuminated-fraction proxy). */
export function earthPhaseFromMoon(state) {
  // Earth's phase seen from the Moon is the complement of the Moon's phase.
  const s = unit(state.sun);
  const e = unit(state.earth);
  const cosAngle = s[0] * e[0] + s[1] * e[1] + s[2] * e[2];
  return (1 + cosAngle) / 2; // 1 = "full Earth" (Sun behind the observer's Moon)
}

export const SYNODIC_MONTH_DAYS = 29.530588;
