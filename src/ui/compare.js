// Scenario comparison table: each row is a site + landing date + window.
// Columns are the trade-offs planners argue about. The best and worst value in a
// column are marked only when they differ by more than the column's tolerance,
// so differences inside the model's resolution are not presented as real.

import { escapeHtml, fmtHours, fmtLatLon, pct } from './format.js';
import { drawStrip } from './timeline.js';

const COLUMNS = [
  { key: 'litFraction', label: 'Sunlit', fmt: (v) => pct(v, 1), better: 'high', tol: 0.03 },
  { key: 'avgPowerW', label: 'Avg power', fmt: (v) => `${v.toFixed(0)} W`, better: 'high', tolRel: 0.05 },
  { key: 'longestDarkH', label: 'Longest dark', fmt: fmtHours, better: 'low', tol: 12 },
  { key: 'batteryKWh', label: 'Battery', fmt: (v) => `${v.toFixed(1)} kWh`, better: 'low', tolRel: 0.1, tol: 0.2 },
  { key: 'earthVisibleFraction', label: 'Earth visible', fmt: (v) => pct(v, 1), better: 'high', tol: 0.03 },
  { key: 'dteFraction', label: 'DTE link', fmt: (v) => pct(v, 1), better: 'high', tol: 0.03 },
  { key: 'longestBlackoutH', label: 'Longest blackout', fmt: fmtHours, better: 'low', tol: 12 },
];

// Illustrative screening thresholds, shown to the user under the table.
export const CRITERIA = {
  minLit: 0.5,
  maxDarkH: 120,
  minDte: 0.4,
  maxBlackoutH: 168,
};

export function verdictFor(stats) {
  const powerOk = stats.litFraction >= CRITERIA.minLit && stats.longestDarkH <= CRITERIA.maxDarkH;
  const commsOk = stats.dteFraction >= CRITERIA.minDte && stats.longestBlackoutH <= CRITERIA.maxBlackoutH;
  if (powerOk && commsOk) return { status: 'go', text: 'Meets both' };
  if (stats.dteFraction === 0) return { status: 'no-go', text: 'No DTE link' };
  if (stats.litFraction < 0.2) return { status: 'no-go', text: 'Too dark' };
  if (powerOk) return { status: 'marginal', text: 'Comms-limited' };
  if (commsOk) return { status: 'marginal', text: 'Power-limited' };
  return { status: 'no-go', text: 'Neither' };
}

function spreadIsMeaningful(col, best, worst) {
  const diff = Math.abs(best - worst);
  const tol = Math.max(col.tol ?? 0, (col.tolRel ?? 0) * Math.max(Math.abs(best), Math.abs(worst)));
  return diff > tol;
}

export function renderCompare(root, scenarios, { activeId, onSelect, onRemove }) {
  if (!scenarios.length) {
    root.innerHTML = `<p class="hint" style="padding:10px 0 0">Add the current site and date, slip the landing by whole lunar months, or search the terrain within 5 km for better-lit points. Every row uses the same spacecraft assumptions.</p>`;
    return;
  }
  const marks = {};
  for (const col of COLUMNS) {
    const vals = scenarios.map((s) => s.scan.stats[col.key]);
    const best = col.better === 'high' ? Math.max(...vals) : Math.min(...vals);
    const worst = col.better === 'high' ? Math.min(...vals) : Math.max(...vals);
    marks[col.key] = scenarios.length > 1 && spreadIsMeaningful(col, best, worst) ? { best, worst } : null;
  }
  root.innerHTML = `
    <table class="cmp">
      <caption class="visually-hidden">Scenario comparison</caption>
      <thead><tr>
        <th scope="col">Scenario</th><th scope="col">Sun · Earth · DTE over the window</th>
        ${COLUMNS.map((c) => `<th scope="col">${c.label}</th>`).join('')}
        <th scope="col">Screening</th><th scope="col"><span class="visually-hidden">Remove</span></th>
      </tr></thead>
      <tbody>
        ${scenarios
          .map((s) => {
            const v = verdictFor(s.scan.stats);
            return `<tr data-id="${s.id}" class="${s.id === activeId ? 'active' : ''}">
              <td class="scenario"><button class="open" data-open="${s.id}" title="Open this scenario">${escapeHtml(s.label)}</button><br><span class="meta">${fmtLatLon(s.site.lat, s.site.lon, 2)} · ${new Date(s.startMs).toISOString().slice(0, 10)} · ${s.windowDays} d</span></td>
              <td><canvas class="strip" data-strip="${s.id}" role="img" aria-label="Sun, Earth and link availability over the window"></canvas></td>
              ${COLUMNS.map((c) => {
                const val = s.scan.stats[c.key];
                const m = marks[c.key];
                const cls = m ? (val === m.best ? 'best' : val === m.worst ? 'worst' : '') : '';
                const sr = cls === 'best' ? '<span class="visually-hidden"> (best)</span>' : cls === 'worst' ? '<span class="visually-hidden"> (worst)</span>' : '';
                return `<td class="${cls}">${c.fmt(val)}${sr}</td>`;
              }).join('')}
              <td><span class="status ${v.status}">${v.text}</span></td>
              <td><button class="x ghost small" data-remove="${s.id}" aria-label="Remove ${escapeHtml(s.label)}">Remove</button></td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <p class="fine">Highlights mark the best and worst value only where they differ by more than about 3 percentage points, 12 hours or 5–10%. Screening uses illustrative thresholds: sunlit ≥ ${CRITERIA.minLit * 100}% with longest darkness ≤ ${CRITERIA.maxDarkH} h for power, and DTE ≥ ${CRITERIA.minDte * 100}% with longest blackout ≤ ${CRITERIA.maxBlackoutH} h for communications. Adjust them to your mission.</p>`;
  for (const s of scenarios) {
    const c = root.querySelector(`[data-strip="${s.id}"]`);
    if (c) drawStrip(c, s.scan);
  }
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => onSelect(b.dataset.open)));
  root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => onRemove(b.dataset.remove)));
}

export function scenariosToCsv(scenarios) {
  const head = ['label', 'lat', 'lon', 'window_start_utc', 'window_days', ...COLUMNS.map((c) => c.key), 'screening'];
  const rows = scenarios.map((s) => [
    `"${s.label.replace(/"/g, '""')}"`,
    s.site.lat.toFixed(5),
    s.site.lon.toFixed(5),
    new Date(s.startMs).toISOString(),
    s.windowDays,
    ...COLUMNS.map((c) => (+s.scan.stats[c.key]).toFixed(4)),
    verdictFor(s.scan.stats).text,
  ]);
  return [head.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
