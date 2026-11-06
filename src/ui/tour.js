// Guided first-run tour. Each step points at a real control; steps with a task
// advance only when the app's state shows the user did it (or pressed "Do it for
// me"). No fake data: every number the user sees comes from the live app.

const SEEN_KEY = 'lsp.tourSeen';

function storage(get, value) {
  try {
    if (get) return localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, value);
  } catch {
    /* private mode: the tour is simply offered again next time */
  }
  return null;
}

const clickSite = (id) => document.querySelector(`.site-item[data-site="${id}"]`)?.click();

function buildSteps({ app, actions }) {
  return [
    {
      target: '.brand',
      pane: 'view',
      title: 'What this tool answers',
      body: 'For any landing site and date, it shows whether a lander would have sunlight for power and a direct radio link to Earth. Near the lunar south pole both depend on a few degrees of terrain.',
    },
    {
      target: '#siteList',
      pane: 'site',
      title: 'Choose a site',
      body: 'Sites can come from this list, a click on the Moon or map, or typed coordinates.',
      task: 'Select “Shackleton crater floor” in the list.',
      done: () => app.site?.id === 'shackleton',
      doIt: () => clickSite('shackleton'),
    },
    {
      target: '#siteList',
      pane: 'site',
      title: 'Compare with the crater rim',
      body: 'The crater floor never sees the Sun: it is a permanently shadowed region. The ridge on its rim is about 4.7 km higher.',
      task: 'Select “Shackleton connecting ridge”.',
      done: () => app.site?.id === 'ridge',
      doIt: () => clickSite('ridge'),
    },
    {
      target: '.timebar',
      pane: 'view',
      title: 'Choose a date',
      body: 'All times are UTC. Results cover an analysis window that starts at the chosen date; its length is set above the timeline.',
      task: 'Step forward one day with “+1 d”.',
      start: () => ({ t: app.timeMs }),
      done: (s) => Math.abs(app.timeMs - s.t) >= 3600000,
      doIt: () => document.querySelector('#stepFwdDay')?.click(),
    },
    {
      target: '#skyBlock',
      pane: 'results',
      title: 'Sun and the horizon',
      body: 'The grey shape is the skyline computed from NASA LOLA terrain. The Moon’s axis is tilted only 1.54°, so at the pole the Sun circles just above it; power depends on how much of its disk clears the ridges.',
    },
    {
      target: '#vComms',
      pane: 'results',
      title: 'Earth and the radio link',
      body: 'Earth stays almost fixed in the lunar sky but wobbles a few degrees each month (libration). A direct link needs Earth’s centre above the terrain and a Deep Space Network antenna that can see the Moon.',
    },
    {
      target: '.timeline-dock',
      pane: 'view',
      title: 'Read the timeline',
      body: 'Each row shows when the Sun, power, Earth, a ground station and the full link are available. Click or drag it, or focus it and use the arrow keys.',
      task: 'Move the time cursor on the timeline.',
      start: () => ({ t: app.timeMs }),
      done: (s) => app.timeMs !== s.t,
      doIt: () => actions.setTime?.(app.timeMs + 6 * 3600000),
    },
    {
      target: '#slipScenarios',
      pane: 'compare',
      before: () => actions.openCompare(true),
      title: 'Compare dates',
      body: 'Launches slip. This adds the same site with the landing moved one, two and three lunar months later.',
      task: 'Press “Schedule slip ×3”.',
      start: () => ({ n: app.scenarios.length }),
      done: (s) => app.scenarios.length >= s.n + 3,
      doIt: () => document.querySelector('#slipScenarios')?.click(),
    },
    {
      target: '#compareBody',
      pane: 'compare',
      title: 'Interpret the results',
      body: 'Highlights mark clear best and worst values only. Power, battery and link values are first-order estimates, and ridge-crest results depend on the 240 m terrain grid. Use the “?” buttons for definitions, and reopen this tour from the Tour button.',
    },
  ];
}

export function createTour({ app, actions }) {
  let steps = [];
  let index = -1;
  let state = null;
  let poll = 0;
  let ring = null;
  let panel = null;
  let lastFocus = null;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function place() {
    const step = steps[index];
    if (!step || !panel) return;
    const target = document.querySelector(step.target);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const pad = 4;
    Object.assign(ring.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    if (actions.isNarrow()) return; // CSS docks the panel at the bottom
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.right + 14;
    if (left + pw > vw - 12) left = r.left - pw - 14;
    if (left < 12) left = Math.min(Math.max(12, r.left), vw - pw - 12);
    let top = left === r.right + 14 || left === r.left - pw - 14 ? r.top : r.bottom + 14;
    if (top + ph > vh - 12) top = Math.max(12, vh - ph - 12);
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(12, top)}px`;
  }

  function render() {
    const step = steps[index];
    const n = steps.length;
    const finished = step.done ? step.done(state) : true;
    panel.innerHTML = `
      <p class="tour-step">Step ${index + 1} of ${n}</p>
      <div class="tour-progress" aria-hidden="true"><i style="width:${((index + 1) / n) * 100}%"></i></div>
      <h2 id="tourTitle" tabindex="-1">${step.title}</h2>
      <p>${step.body}</p>
      ${step.task ? `<p class="tour-task ${finished ? 'done' : ''}">${finished ? 'Done. ' : ''}${step.task}</p>` : ''}
      <div class="tour-actions">
        <button class="ghost small" data-act="skip">${index === n - 1 ? 'Close' : 'Skip tour'}</button>
        <div class="right">
          ${index > 0 ? '<button class="small" data-act="back">Back</button>' : ''}
          ${step.task && !finished ? '<button class="small" data-act="do">Do it for me</button>' : ''}
          <button class="primary small" data-act="next" ${step.task && !finished ? 'disabled' : ''}>${index === n - 1 ? 'Finish' : 'Next'}</button>
        </div>
      </div>`;
    panel.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'skip') stop();
        else if (act === 'back') go(index - 1);
        else if (act === 'do') step.doIt?.();
        else if (act === 'next') (index === n - 1 ? stop() : go(index + 1));
      }),
    );
    place();
  }

  function go(i) {
    index = i;
    const step = steps[index];
    step.before?.();
    if (actions.isNarrow()) actions.showPane(step.pane);
    state = step.start ? step.start() : null;
    const target = document.querySelector(step.target);
    target?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    let wasDone = step.done ? step.done(state) : true;
    render();
    requestAnimationFrame(() => {
      if (!panel) return; // closed before this frame
      place();
      panel.querySelector('#tourTitle')?.focus();
    });
    clearInterval(poll);
    poll = setInterval(() => {
      if (!panel) return;
      place();
      if (!step.done) return;
      const now = step.done(state);
      if (now !== wasDone) {
        wasDone = now;
        render();
        panel?.querySelector('[data-act="next"]')?.focus();
      }
    }, 300);
  }

  function onKey(e) {
    if (e.key === 'Escape' && panel) {
      e.preventDefault();
      stop();
    }
  }

  function start() {
    stop();
    const fromOffer = offerEl?.contains(document.activeElement);
    lastFocus = fromOffer ? document.querySelector('#tourBtn') : document.activeElement;
    dismissOffer();
    storage(false, '1');
    steps = buildSteps({ app, actions });
    ring = el('div', 'tour-ring');
    panel = el('div', 'tour-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'tourTitle');
    panel.setAttribute('aria-live', 'polite');
    document.body.append(ring, panel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    go(0);
  }

  function stop() {
    clearInterval(poll);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    ring?.remove();
    panel?.remove();
    ring = panel = null;
    index = -1;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  let offerEl = null;
  function dismissOffer() {
    offerEl?.remove();
    offerEl = null;
  }

  /** Offer the tour once on a first visit; never start it unasked. */
  function offer() {
    if (storage(true) || offerEl) return;
    offerEl = el(
      'div',
      'tour-prompt',
      `<p><strong>New to lunar site planning?</strong> A short tour shows how to read sunlight, Earth visibility and the comparison table using the real controls.</p>
       <div><button class="ghost small" data-act="no">No thanks</button><button class="primary small" data-act="yes">Take the tour</button></div>`,
    );
    offerEl.setAttribute('role', 'region');
    offerEl.setAttribute('aria-label', 'Tour invitation');
    offerEl.querySelector('[data-act="no"]').addEventListener('click', () => {
      storage(false, '1');
      dismissOffer();
    });
    offerEl.querySelector('[data-act="yes"]').addEventListener('click', start);
    document.body.append(offerEl);
  }

  return { start, stop, offer, get active() {
    return index >= 0;
  } };
}
