export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? '−' : '';
  let s = Math.abs(ms) / 1000;
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${sign}${d} d ${h} h`;
  if (h > 0) return `${sign}${h} h ${m} min`;
  return `${sign}${m} min`;
}

export function fmtHours(h) {
  if (!Number.isFinite(h)) return '—';
  if (h >= 48) return `${(h / 24).toFixed(1)} d`;
  return `${h.toFixed(h < 10 ? 1 : 0)} h`;
}

export const pct = (f, digits = 0) => `${(f * 100).toFixed(digits)}%`;
export const deg = (v, digits = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}°`;

export function fmtLatLon(lat, lon, digits = 3) {
  return `${Math.abs(lat).toFixed(digits)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(digits)}°${lon < 0 ? 'W' : 'E'}`;
}

export function fmtUtc(ms, { seconds = false } = {}) {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, seconds ? 19 : 16)} UTC`;
}

export function fmtRate(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(bps >= 1e4 ? 0 : 1)} kbps`;
  return `${bps.toFixed(0)} bps`;
}

export function toLocalInputValue(ms) {
  // datetime-local has no zone; the app treats it as UTC throughout.
  return new Date(ms).toISOString().slice(0, 16);
}
export function fromLocalInputValue(v) {
  const ms = Date.parse(`${v}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function compass(az) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(az / 22.5) % 16];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Read a colour token from the stylesheet so canvas drawings follow the design system. */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

/** Size a canvas backing store to its CSS box for crisp drawing. */
export function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: canvas.clientWidth, h: canvas.clientHeight };
}
