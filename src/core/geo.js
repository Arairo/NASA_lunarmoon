// Small vector and lunar-geodesy helpers shared by every core module.
// Everything here is plain math so it runs in the browser, a worker or Node.

export const MOON_RADIUS_M = 1737400; // IAU 2015 mean radius = Cesium Ellipsoid.MOON = LOLA reference sphere
export const AU_M = 149597870700;
export const C_M_S = 299792458;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => scale(a, 1 / norm(a));
export const wrap360 = (deg) => ((deg % 360) + 360) % 360;
export const wrap180 = (deg) => wrap360(deg + 180) - 180;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Moon-fixed Cartesian (metres) of a selenographic latitude/longitude (degrees). */
export function siteVector(latDeg, lonDeg, heightM = 0) {
  const r = MOON_RADIUS_M + heightM;
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
}

/** Local east/north/up unit vectors at a site on the lunar sphere. */
export function enuBasis(latDeg, lonDeg) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const sla = Math.sin(la);
  const cla = Math.cos(la);
  const slo = Math.sin(lo);
  const clo = Math.cos(lo);
  return {
    east: [-slo, clo, 0],
    north: [-sla * clo, -sla * slo, cla],
    up: [cla * clo, cla * slo, sla],
  };
}

/** Azimuth (deg from north through east) and elevation (deg) of a direction in ENU. */
export function azEl(direction, basis) {
  const d = unit(direction);
  const e = dot(d, basis.east);
  const n = dot(d, basis.north);
  const u = dot(d, basis.up);
  return { az: wrap360(Math.atan2(e, n) * RAD), el: Math.asin(clamp(u, -1, 1)) * RAD };
}

/** Selenographic lat/lon (deg) of a Moon-fixed vector. */
export function latLonOf(v) {
  const r = norm(v);
  return { lat: Math.asin(v[2] / r) * RAD, lon: wrap180(Math.atan2(v[1], v[0]) * RAD) };
}

/** Destination on the sphere after travelling `distM` from a point along an azimuth. */
export function destination(latDeg, lonDeg, azDeg, distM) {
  const d = distM / MOON_RADIUS_M;
  const la = latDeg * DEG;
  const az = azDeg * DEG;
  const sla = Math.sin(la);
  const cla = Math.cos(la);
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  const lat2 = Math.asin(sla * cd + cla * sd * Math.cos(az));
  const lon2 = lonDeg * DEG + Math.atan2(Math.sin(az) * sd * cla, cd - sla * Math.sin(lat2));
  return { lat: lat2 * RAD, lon: wrap180(lon2 * RAD) };
}

/** Great-circle distance in metres between two selenographic points. */
export function surfaceDistance(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * South polar stereographic on the lunar sphere (IAU_2015:30100, as used by the
 * LROC WAC polar mosaic and this app's LOLA grids). Verified against PROJ.
 */
export function toSouthPolar(latDeg, lonDeg) {
  const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + (latDeg * DEG) / 2);
  return { x: rho * Math.sin(lonDeg * DEG), y: rho * Math.cos(lonDeg * DEG) };
}

export function fromSouthPolar(x, y) {
  const rho = Math.hypot(x, y);
  const lat = 2 * Math.atan(rho / (2 * MOON_RADIUS_M)) - Math.PI / 2;
  const lon = Math.atan2(x, y);
  return { lat: lat * RAD, lon: wrap180(lon * RAD) };
}

/** Geometric horizon dip (deg, negative) for an eye `heightM` above a bare sphere. */
export function sphereHorizonDip(heightM) {
  return -Math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + Math.max(0, heightM))) * RAD;
}
