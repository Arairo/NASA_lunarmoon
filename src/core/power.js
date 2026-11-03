// Solar power model for a lander at a lunar site.
//
// Irradiance above the atmosphere-free surface is the solar constant scaled by
// the Sun's actual distance. At the poles the Sun skims the horizon, so the
// fraction of the solar disk that clears the local terrain matters as much as
// elevation: a ridge 0.2 deg high can cut power in half.

import { AU_M, DEG, RAD, clamp } from './geo.js';

export const SOLAR_CONSTANT_W_M2 = 1361; // TSI at 1 AU (Kopp & Lean 2011)
const SUN_RADIUS_M = 695700e3;

export const PANEL_MODES = {
  vertical_tracking: {
    label: 'Vertical, azimuth-tracking',
    hint: 'Mast-mounted array that turns to face the Sun. Standard choice at the poles, where the Sun stays low.',
  },
  horizontal: {
    label: 'Horizontal (top deck)',
    hint: 'Flat on the lander deck. Fine near the equator, nearly useless at the poles.',
  },
  fixed_vertical: {
    label: 'Vertical, fixed facing',
    hint: 'Body-mounted side panel that faces one azimuth.',
  },
  two_axis: {
    label: 'Two-axis tracking',
    hint: 'Always normal to the Sun (upper bound).',
  },
};

export const DEFAULT_POWER_CONFIG = {
  mode: 'vertical_tracking',
  areaM2: 2.0,
  efficiency: 0.29, // triple-junction GaAs at beginning of life
  fixedAzDeg: 0,
  loadW: 120, // continuous survival + ops load used to size the battery
};

export function sunAngularRadiusDeg(distM) {
  return Math.asin(SUN_RADIUS_M / distM) * RAD;
}

/**
 * Fraction (0..1) of a disk of angular radius `radiusDeg`, centred `centerElDeg`,
 * that lies above a locally flat horizon at `horizonElDeg` (circular segment).
 */
export function visibleDiskFraction(centerElDeg, horizonElDeg, radiusDeg) {
  const u = clamp((centerElDeg - horizonElDeg) / radiusDeg, -1, 1);
  if (u >= 1) return 1;
  if (u <= -1) return 0;
  return 1 - (Math.acos(u) - u * Math.sqrt(1 - u * u)) / Math.PI;
}

/** Cosine of the angle between the panel normal and the Sun. */
export function incidenceCos(mode, sunElDeg, sunAzDeg, fixedAzDeg = 0) {
  const el = sunElDeg * DEG;
  switch (mode) {
    case 'horizontal':
      return Math.max(0, Math.sin(el));
    case 'fixed_vertical':
      return Math.max(0, Math.cos(el) * Math.cos((sunAzDeg - fixedAzDeg) * DEG));
    case 'two_axis':
      return 1;
    case 'vertical_tracking':
    default:
      return Math.max(0, Math.cos(el));
  }
}

/** Instantaneous array output. */
export function solarPower({ sunElDeg, sunAzDeg, horizonElDeg, sunDistM }, config = DEFAULT_POWER_CONFIG) {
  const radius = sunAngularRadiusDeg(sunDistM);
  const fraction = visibleDiskFraction(sunElDeg, horizonElDeg, radius);
  const irradiance = SOLAR_CONSTANT_W_M2 * (AU_M / sunDistM) ** 2;
  const cosInc = incidenceCos(config.mode, sunElDeg, sunAzDeg, config.fixedAzDeg);
  const watts = irradiance * fraction * cosInc * config.areaM2 * config.efficiency;
  return { watts, fraction, irradiance, cosInc, sunRadiusDeg: radius };
}
