// 2D south-pole map in the IAU south-polar stereographic frame: LROC WAC
// mosaic underneath, optional precomputed illumination / Earth-visibility
// overlays from LOLA, sites on top. Wheel to zoom, drag to pan, click to pick.

import { fromSouthPolar, toSouthPolar } from '../core/geo.js';
import { fitCanvas } from './format.js';

const IMAGE_HALF_M = 460000;

// Cividis: perceptually uniform and readable with colour-vision deficiency.
function ramp(t) {
  const stops = [
    [0, [0, 34, 78]],
    [0.25, [53, 69, 108]],
    [0.5, [124, 123, 120]],
    [0.75, [188, 175, 111]],
    [1, [254, 232, 56]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
    }
  }
  return stops.at(-1)[1];
}
export const RAMP_CSS = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => `rgb(${ramp(t).join(',')})`).join(', ')})`;

export function createPolarMap(canvas, { onPick }) {
  const image = new Image();
  image.src = `${import.meta.env.BASE_URL}data/sp_wac_450m.jpg`;
  image.onload = () => draw();
  let illum = null;
  const overlayCanvas = { illum: null, earth: null };
  let overlay = 'none';
  let sites = [];
  let selected = null;
  let view = { cx: 0, cy: 0, half: 110000 }; // metres
  let dragging = null;

  function buildOverlay(kind) {
    if (!illum) return null;
    const n = illum.size;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    const arr = illum[kind];
    for (let i = 0; i < n * n; i++) {
      const [r, gg, b] = ramp(arr[i] / illum.scale);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 205;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function toScreen(x, y, w, h) {
    const s = Math.min(w, h) / (2 * view.half);
    return [w / 2 + (x - view.cx) * s, h / 2 - (y - view.cy) * s, s];
  }
  function toWorld(px, py, w, h) {
    const s = Math.min(w, h) / (2 * view.half);
    return [view.cx + (px - w / 2) / s, view.cy - (py - h / 2) / s];
  }

  function draw() {
    if (canvas.offsetParent === null) return;
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const [ix, iy, s] = toScreen(-IMAGE_HALF_M, IMAGE_HALF_M, w, h);
    if (image.complete && image.naturalWidth) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(image, ix, iy, 2 * IMAGE_HALF_M * s, 2 * IMAGE_HALF_M * s);
    }
    if (overlay !== 'none' && illum) {
      overlayCanvas[overlay] ??= buildOverlay(overlay);
      const [ox, oy] = toScreen(-illum.halfExtent, illum.halfExtent, w, h);
      ctx.imageSmoothingEnabled = view.half > 30000;
      ctx.drawImage(overlayCanvas[overlay], ox, oy, 2 * illum.halfExtent * s, 2 * illum.halfExtent * s);
    }
    // Graticule
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.lineWidth = 1;
    for (const lat of [-89, -88, -87, -86, -85, -84, -82, -80, -78, -76]) {
      const r = Math.hypot(toSouthPolar(lat, 0).x, toSouthPolar(lat, 0).y) * s;
      const [cx, cy] = toScreen(0, 0, w, h);
      if (r < 20 || r > 4 * Math.max(w, h)) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${-lat}°S`, cx + 3, cy - r - 3);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const a = toSouthPolar(-75, lon);
      const [cx, cy] = toScreen(0, 0, w, h);
      const [ex, ey] = toScreen(a.x, a.y, w, h);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const b = toSouthPolar(-89.2 + 0 * lon, lon);
      const [lx, ly] = toScreen(b.x * (view.half / 30000), b.y * (view.half / 30000), w, h);
      if (Math.abs(lx - w / 2) < w / 2 - 10 && Math.abs(ly - h / 2) < h / 2 - 10) ctx.fillText(`${lon}°`, lx, ly);
    }
    // Sites (labels that would overlap an earlier label are skipped)
    ctx.font = '500 12px "IBM Plex Sans", sans-serif';
    const placed = [];
    for (const site of sites) {
      if (site.lat > -74) continue;
      const p = toSouthPolar(site.lat, site.lon);
      const [sx, sy] = toScreen(p.x, p.y, w, h);
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      const isSel = selected && Math.abs(selected.lat - site.lat) < 1e-6 && Math.abs(selected.lon - site.lon) < 1e-6;
      ctx.fillStyle = isSel ? '#f2b630' : '#ffffff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, isSel ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const label = site.short ?? site.name;
      const box = { x: sx + 8, y: sy - 8, w: ctx.measureText(label).width, h: 14 };
      const clash = placed.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);
      if (clash && !isSel) continue;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(label, sx + 8, sy + 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, sx + 8, sy + 4);
    }
    if (selected && !sites.some((s) => s.lat === selected.lat && s.lon === selected.lon)) {
      const p = toSouthPolar(selected.lat, selected.lon);
      const [sx, sy] = toScreen(p.x, p.y, w, h);
      ctx.strokeStyle = '#f2b630';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Scale bar
    const km = view.half > 150000 ? 100 : view.half > 50000 ? 20 : view.half > 15000 ? 5 : 1;
    const len = km * 1000 * s;
    ctx.fillStyle = '#fff';
    ctx.fillRect(w - 20 - len, h - 22, len, 3);
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${km} km`, w - 20, h - 28);
    ctx.textAlign = 'left';
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const f = Math.exp(e.deltaY * 0.0015);
    view.half = Math.min(500000, Math.max(3000, view.half * f));
    const [nx, ny] = toWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    view.cx += wx - nx;
    view.cy += wy - ny;
    draw();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const s = Math.min(rect.width, rect.height) / (2 * view.half);
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
    view.cx = dragging.cx - dx / s;
    view.cy = dragging.cy + dy / s;
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = dragging;
    dragging = null;
    if (!d || d.moved) return;
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    // Snap to a nearby site marker if one was clicked.
    const s = Math.min(rect.width, rect.height) / (2 * view.half);
    for (const site of sites) {
      if (site.lat > -74) continue;
      const p = toSouthPolar(site.lat, site.lon);
      if (Math.hypot((p.x - wx) * s, (p.y - wy) * s) < 9) return onPick({ site });
    }
    const { lat, lon } = fromSouthPolar(wx, wy);
    if (lat < -75) onPick({ lat, lon });
  });

  return {
    draw,
    /** Current view (metres, polar stereographic) and a lat/lon -> CSS-pixel mapper. */
    get view() {
      return { ...view };
    },
    project(lat, lon) {
      const p = toSouthPolar(lat, lon);
      const [x, y] = toScreen(p.x, p.y, canvas.clientWidth, canvas.clientHeight);
      return { x, y };
    },
    setIllumination(data) {
      illum = data;
      overlayCanvas.illum = overlayCanvas.earth = null;
      draw();
    },
    setOverlay(kind) {
      overlay = kind;
      draw();
    },
    setSites(list) {
      sites = list;
      draw();
    },
    setSelected(site) {
      selected = site;
      if (site && site.lat < -75) {
        const p = toSouthPolar(site.lat, site.lon);
        const s = Math.min(canvas.clientWidth || 1, canvas.clientHeight || 1) / (2 * view.half);
        const off = Math.hypot(p.x - view.cx, p.y - view.cy) * s;
        if (off > Math.min(canvas.clientWidth, canvas.clientHeight) * 0.42) {
          view.cx = p.x;
          view.cy = p.y;
        }
      }
      draw();
    },
  };
}
