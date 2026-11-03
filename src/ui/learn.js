// Plain-language explanations shown in Learn mode, tailored to the site.

export function learnForSite(site, ctx) {
  const lat = site.lat;
  const absLat = Math.abs(lat);
  const colat = 90 - absLat;
  const maxSun = colat + 1.54;
  // Angular distance from the mean sub-Earth point (0, 0). Libration moves
  // Earth up to ~8 deg, so 82-98 deg is the limb where Earth comes and goes.
  const fromSubEarth = (Math.acos(Math.cos(lat * Math.PI / 180) * Math.cos(site.lon * Math.PI / 180)) * 180) / Math.PI;
  const farSide = fromSubEarth > 98;
  const limb = !farSide && fromSubEarth > 82;
  const polar = absLat > 80;

  let top;
  if (farSide) {
    top = `<strong>Why there’s no Earth here:</strong> the Moon always keeps the same face toward Earth (it is tidally locked). This site is on the far side, so Earth never rises. Missions here, like Chang’e 4, talk to Earth through a relay satellite.`;
  } else if (polar) {
    top = `${limb ? '<strong>Earth on the horizon:</strong> from here Earth sits near the edge of the visible face, so it rises and sets a few degrees with each monthly libration wobble instead of staying put. ' : ''}<strong>Why the pole is so extreme:</strong> the Moon’s axis is tilted only 1.54° to the Sun, so at ${absLat.toFixed(1)}° latitude the Sun can never climb above about <b>${maxSun.toFixed(1)}°</b>. It circles the horizon once every 29.5 days. A hill a few hundred metres high, or a crater wall, can block it for days, while a high ridge nearby may stay lit for months.`;
  } else {
    top = `<strong>A lunar day is long:</strong> the Moon turns once every 29.5 Earth days, so a site near ${absLat.toFixed(0)}° latitude gets about two weeks of continuous sunlight followed by about two weeks of night at roughly −170 °C. Batteries and heaters, not just solar panels, decide whether a lander survives the night.`;
  }

  const sky = polar
    ? `The grey silhouette is the real skyline computed from NASA’s LOLA laser-altimeter data: ${ctx.horizon.terrain ? `the steepest terrain angle in every direction, out to 300 km` : 'no terrain data here'}. Yellow dots trace the Sun over the window and blue dots trace Earth. Earth barely moves in the lunar sky: it only wobbles a few degrees (libration), so if a ridge blocks the Earth direction, you can lose contact for many days.`
    : `The grey band is the horizon and the dots trace the Sun (yellow) and Earth (blue) over the window. From the near side, Earth hangs almost fixed in the sky and only wobbles a few degrees (libration) each month.`;

  const window = `Mission planners care about the <b>longest dark period</b> (it sets battery size and whether the lander can stay warm) and the <b>longest blackout</b> (time without contact with Earth). Change the date or move the site a few hundred metres and watch these numbers jump.`;

  const link = `With no relay, the lander needs (1) Earth above the local terrain, (2) a Deep Space Network dish in California, Spain or Australia that can see the Moon, and (3) enough signal strength. Signals travel at the speed of light, so each one-way trip takes about 1.3 seconds: fine for commands, too slow to drive a rover by joystick.`;

  return { top, sky, window, link };
}
