// Operations timeline: one row per question a planner asks of a window.
//   Sun     – how much of the solar disk clears the terrain
//   Power   – array output against the continuous load
//   Earth   – any part of Earth above the terrain (darker = centre clears by the target margin)
//   DSN     – a Deep Space Network complex has the Moon in view
//   DTE     – all of the above and the link budget closes
// Click or drag to move the clock; with focus, arrow keys step it (it is a slider).

import { fitCanvas, fmtUtc, token } from './format.js';

const ROWS = [
  { key: 'sun', label: 'Sun' },
  { key: 'power', label: 'Power' },
  { key: 'earth', label: 'Earth' },
  { key: 'dsn', label: 'DSN' },
  { key: 'dte', label: 'DTE link' },
];
const HOUR = 3600000;
const DAY = 86400000;

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function createTimeline(canvas, { onScrub }) {
  let model = null;
  let dragging = false;
  const pad = { l: 64, r: 10, t: 4, b: 18 };

  function msAt(clientX) {
    const rect = canvas.getBoundingClientRect();
    const f = (clientX - rect.left - pad.l) / (rect.width - pad.l - pad.r);
    if (!model) return null;
    const { startMs, endMs } = model.scan;
    return Math.round(startMs + Math.min(1, Math.max(0, f)) * (endMs - startMs));
  }
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    const ms = msAt(e.clientX);
    if (ms != null) onScrub(ms);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const ms = msAt(e.clientX);
    if (ms != null) onScrub(ms);
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('pointercancel', () => (dragging = false));
  canvas.addEventListener('keydown', (e) => {
    if (!model) return;
    const { startMs, endMs } = model.scan;
    const now = model.now;
    const big = e.shiftKey ? DAY : HOUR;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = now + big;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = now - big;
    else if (e.key === 'PageUp') next = now + DAY;
    else if (e.key === 'PageDown') next = now - DAY;
    else if (e.key === 'Home') next = startMs;
    else if (e.key === 'End') next = endMs - HOUR;
    if (next == null) return;
    e.preventDefault();
    onScrub(Math.min(endMs - 1, Math.max(startMs, next)));
  });

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!model) return;
    const { scan, now, loadW, minClearanceDeg, targetMarginDb } = model;
    const c = {
      sun: token('sun'),
      earth: token('earth'),
      power: token('power'),
      warn: token('warn'),
      ink: token('ink'),
      ink3: token('ink-3'),
      line: token('line'),
      row: token('surface-2'),
      terrain: token('terrain'),
    };
    const s = scan.series;
    const n = s.times.length;
    const pw = w - pad.l - pad.r;
    const rowH = (h - pad.t - pad.b) / ROWS.length;
    const x = (ms) => pad.l + ((ms - scan.startMs) / (scan.endMs - scan.startMs)) * pw;
    const colW = Math.max(1, pw / n + 0.5);

    ctx.font = '12px "IBM Plex Sans", sans-serif';
    ctx.textBaseline = 'middle';
    ROWS.forEach((row, r) => {
      const y0 = pad.t + r * rowH;
      ctx.fillStyle = c.row;
      ctx.fillRect(pad.l, y0 + 2, pw, rowH - 4);
      ctx.fillStyle = c.ink;
      ctx.textAlign = 'right';
      ctx.fillText(row.label, pad.l - 8, y0 + rowH / 2);
    });

    let maxW = loadW * 1.2;
    for (let i = 0; i < n; i++) maxW = Math.max(maxW, s.watts[i]);
    for (let i = 0; i < n; i++) {
      const xx = x(s.times[i]);
      const f = s.sunFrac[i];
      if (f > 0) {
        ctx.fillStyle = alpha(c.sun, 0.3 + 0.7 * f);
        ctx.fillRect(xx, pad.t + 2, colW, rowH - 4);
      }
      const y1 = pad.t + rowH;
      const bh = ((rowH - 4) * s.watts[i]) / maxW;
      if (bh > 0) {
        ctx.fillStyle = s.watts[i] >= loadW ? c.power : c.warn;
        ctx.fillRect(xx, y1 + rowH - 2 - bh, colW, bh);
      }
      if (s.visible[i]) {
        const good = s.los[i] && s.earthClear[i] >= minClearanceDeg;
        ctx.fillStyle = good ? c.earth : alpha(c.earth, 0.35);
        ctx.fillRect(xx, pad.t + 2 * rowH + 2, colW, rowH - 4);
      }
      if (s.dsnAny[i]) {
        ctx.fillStyle = alpha(c.terrain, 0.45);
        ctx.fillRect(xx, pad.t + 3 * rowH + 2, colW, rowH - 4);
      }
      if (s.dte[i]) {
        ctx.fillStyle = s.margin[i] >= targetMarginDb ? c.power : c.warn;
        ctx.fillRect(xx, pad.t + 4 * rowH + 2, colW, rowH - 4);
      }
    }
    // Load line on the power row
    const yLoad = pad.t + 2 * rowH - 2 - ((rowH - 4) * loadW) / maxW;
    ctx.strokeStyle = c.ink;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, yLoad);
    ctx.lineTo(pad.l + pw, yLoad);
    ctx.stroke();
    ctx.setLineDash([]);

    // Date ticks, spaced so labels never overlap at the current width
    const days = (scan.endMs - scan.startMs) / DAY;
    const pxPerDay = pw / days;
    const monthly = days > 200;
    const tickDays = monthly ? 30 : [1, 2, 4, 7, 14, 30].find((d) => d * pxPerDay >= 44) ?? 30;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillStyle = c.ink3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const first = Math.ceil(scan.startMs / DAY) * DAY;
    let lastX = -Infinity;
    for (let t = first, k = 0; t <= scan.endMs; t += DAY, k++) {
      const d = new Date(t);
      if (monthly ? d.getUTCDate() !== 1 : k % tickDays !== 0) continue;
      const xx = x(t);
      if (xx - lastX < 40) continue;
      lastX = xx;
      ctx.strokeStyle = c.line;
      ctx.beginPath();
      ctx.moveTo(xx, pad.t);
      ctx.lineTo(xx, h - pad.b);
      ctx.stroke();
      ctx.fillText(monthly ? d.toISOString().slice(0, 7) : d.toISOString().slice(5, 10), xx, h - pad.b + 3);
    }

    // Cursor
    if (now >= scan.startMs && now <= scan.endMs) {
      const xx = x(now);
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xx, pad.t);
      ctx.lineTo(xx, h - pad.b);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.moveTo(xx - 5, pad.t);
      ctx.lineTo(xx + 5, pad.t);
      ctx.lineTo(xx, pad.t + 6);
      ctx.fill();
    }

    canvas.setAttribute('aria-valuemin', String(scan.startMs));
    canvas.setAttribute('aria-valuemax', String(scan.endMs));
    canvas.setAttribute('aria-valuenow', String(Math.round(now)));
    canvas.setAttribute('aria-valuetext', fmtUtc(now));
  }

  return {
    update(next) {
      model = { ...model, ...next };
      draw();
    },
    draw,
  };
}

/** Compact one-row strip (Sun / Earth / DTE) for the comparison table. */
export function drawStrip(canvas, scan) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const sun = token('sun');
  const earth = token('earth');
  const power = token('power');
  const s = scan.series;
  const n = s.times.length;
  const third = h / 3;
  const colW = Math.max(1, w / n + 0.5);
  ctx.fillStyle = token('surface-2');
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const xx = (i / n) * w;
    if (s.sunFrac[i] > 0) {
      ctx.fillStyle = alpha(sun, 0.35 + 0.65 * s.sunFrac[i]);
      ctx.fillRect(xx, 0, colW, third - 1);
    }
    if (s.visible[i]) {
      ctx.fillStyle = earth;
      ctx.fillRect(xx, third, colW, third - 1);
    }
    if (s.dte[i]) {
      ctx.fillStyle = power;
      ctx.fillRect(xx, 2 * third, colW, third - 1);
    }
  }
}
