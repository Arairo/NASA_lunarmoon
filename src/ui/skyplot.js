// Sky plot: the horizon silhouette seen from the site with the Sun's and Earth's
// paths over the analysis window. Azimuth runs left to right centred on north
// (S, W, N, E, S); elevation is in degrees above the site's level plane.

import { AZ_COUNT, AZ_STEP_DEG } from '../core/horizon.js';
import { fitCanvas, token } from './format.js';

const toX = (az, w) => (((((az + 180) % 360) + 360) % 360) / 360) * w; // N in the middle

export function drawSkyPlot(canvas, { horizon, scan, now }) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!horizon) return;
  const c = {
    surface: token('surface'),
    ink: token('ink'),
    ink3: token('ink-3'),
    line: token('line'),
    lineStrong: token('line-strong'),
    sun: token('sun'),
    earth: token('earth'),
    terrain: token('terrain'),
    terrainSoft: token('terrain-soft'),
  };
  const pad = { l: 34, r: 6, t: 8, b: 18 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  let maxHz = -90;
  let minHz = 90;
  for (const v of horizon.elevations) {
    maxHz = Math.max(maxHz, v);
    minHz = Math.min(minHz, v);
  }
  let top = Math.max(maxHz + 2, 4);
  let bottom = Math.min(minHz - 1.5, -2);
  if (scan) {
    const s = scan.series;
    let m = -90;
    for (let i = 0; i < s.times.length; i++) m = Math.max(m, s.sunEl[i], s.earthEl[i]);
    // Polar sites stay zoomed on the few degrees that matter; elsewhere show
    // the whole arc up to the highest Sun or Earth elevation in the window.
    top = Math.max(top, m + (m > 20 ? 5 : 2));
    let lo = 90;
    for (let i = 0; i < s.times.length; i++) lo = Math.min(lo, s.earthEl[i]);
    if (lo > bottom - 6 && lo < bottom) bottom = lo - 1;
  }
  top = Math.min(top, 90);
  const y = (el) => pad.t + ((top - el) / (top - bottom)) * ph;
  const x = (az) => pad.l + toX(az, pw);

  ctx.fillStyle = c.surface;
  ctx.fillRect(pad.l, pad.t, pw, ph);

  // Grid
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = c.ink3;
  ctx.lineWidth = 1;
  const span = top - bottom;
  const stepEl = span > 60 ? 15 : span > 25 ? 5 : span > 10 ? 2 : 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let e = Math.ceil(bottom / stepEl) * stepEl; e <= top; e += stepEl) {
    ctx.beginPath();
    ctx.moveTo(pad.l, y(e));
    ctx.lineTo(pad.l + pw, y(e));
    ctx.strokeStyle = e === 0 ? c.lineStrong : c.line;
    ctx.stroke();
    ctx.fillText(`${e}°`, pad.l - 4, y(e));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const [az, name] of [[180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'], [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE']]) {
    const xx = x(az);
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    ctx.moveTo(xx, pad.t);
    ctx.lineTo(xx, pad.t + ph);
    ctx.stroke();
    ctx.fillText(name, xx, pad.t + ph + 3);
  }

  // Tracks (drawn before terrain so the terrain hides what is below the skyline)
  if (scan) {
    const s = scan.series;
    const track = (azArr, elArr, color) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < s.times.length; i++) {
        const yy = y(elArr[i]);
        if (yy < pad.t - 2 || yy > pad.t + ph + 2) continue;
        ctx.fillRect(x(azArr[i]) - 1, yy - 1, 2, 2);
      }
      ctx.globalAlpha = 1;
    };
    track(s.sunAz, s.sunEl, c.sun);
    track(s.earthAz, s.earthEl, c.earth);
  }

  // Current Sun and Earth disks (true angular size, at least 4 px for visibility)
  const pxPerDeg = ph / (top - bottom);
  const disk = (az, el, radiusDeg, fill) => {
    const r = Math.max(4, radiusDeg * pxPerDeg);
    ctx.beginPath();
    ctx.arc(x(az), y(el), r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.surface;
    ctx.stroke();
  };
  if (now) {
    disk(now.sun.az, now.sun.el, now.sun.sunRadiusDeg, c.sun);
    disk(now.earth.az, now.earth.el, now.earth.radiusDeg, c.earth);
  }

  // Terrain silhouette
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + ph);
  for (let k = 0; k <= AZ_COUNT; k++) {
    // iterate screen left to right: azimuth 180 -> 540
    const az = 180 + k * AZ_STEP_DEG;
    const idx = Math.round((az % 360) / AZ_STEP_DEG) % AZ_COUNT;
    ctx.lineTo(pad.l + (k / AZ_COUNT) * pw, Math.min(pad.t + ph, y(horizon.elevations[idx])));
  }
  ctx.lineTo(pad.l + pw, pad.t + ph);
  ctx.closePath();
  ctx.fillStyle = c.terrainSoft;
  ctx.fill();
  ctx.strokeStyle = c.terrain;
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Labels for the current disks
  if (now) {
    ctx.font = '600 11px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = c.ink;
    ctx.fillText('Sun', x(now.sun.az) + 7, y(now.sun.el) - 4);
    ctx.fillText('Earth', x(now.earth.az) + 7, y(now.earth.el) - 4);
  }
  ctx.strokeStyle = c.lineStrong;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw - 1, ph - 1);
}
