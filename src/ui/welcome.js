// Start-up welcome: asks whether the visitor wants the video tutorial, offers
// the interactive tour instead, and points at the always-visible
// "Video tutorial" button so it is easy to find again later.

import shots from './tutorial/shots.json';

const OFF_KEY = 'lsp.welcomeOff';
const BASE = import.meta.env.BASE_URL;
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';

function isOff() {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}
function setOff(off) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* private mode: we simply ask again next time */
  }
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function createWelcome({ video, onTour }) {
  let dialog = null;
  let hint = null;

  function pointAtButton() {
    const btn = document.querySelector('#videoBtn');
    if (!btn) return;
    btn.classList.remove('pulse');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('pulse');
    hint?.remove();
    const r = btn.getBoundingClientRect();
    if (!r.width) return;
    hint = document.createElement('div');
    hint.className = 'video-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = 'The video tutorial is always here, whenever you need it.';
    document.body.append(hint);
    const w = hint.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    hint.style.left = `${left}px`;
    hint.style.top = `${r.bottom + 12}px`;
    hint.style.setProperty('--arrow', `${r.left + r.width / 2 - left}px`);
    const remove = () => {
      hint?.remove();
      hint = null;
      window.removeEventListener('pointerdown', remove, true);
    };
    setTimeout(remove, 6000);
    window.addEventListener('pointerdown', remove, true);
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'welcome';
    dialog.setAttribute('aria-labelledby', 'welcomeTitle');
    dialog.setAttribute('aria-describedby', 'welcomeText');
    const hero = shots.shots.overview ? `${BASE}${shots.shots.overview.src}` : '';
    dialog.innerHTML = `
      <div class="welcome-hero" style="background-image:url('${hero}')">
        <button data-act="watch" aria-label="Watch the video tutorial">${PLAY}</button>
        <span class="welcome-len" aria-hidden="true">${fmt(video.duration)}</span>
      </div>
      <div class="welcome-body">
        <h2 id="welcomeTitle">Welcome to Lunar Site Planner</h2>
        <p id="welcomeText">Find out where and when a Moon lander gets sunlight for power and can talk to Earth.
          New here? Watch a short video tutorial with voice-over. It walks you through everything, step by step.</p>
        <div class="welcome-actions">
          <button class="vt-btn primary" data-act="watch">${PLAY} Watch the video tutorial</button>
          <div class="row">
            <button class="vt-btn" data-act="tour">Interactive tour instead</button>
            <button class="vt-btn ghost" data-act="skip">Skip, I'll explore</button>
          </div>
        </div>
        <div class="welcome-foot">
          <label><input type="checkbox" data-act="off" /> Don't ask me at start-up</label>
          <span>Replay any time: <span class="vt-pill">${PLAY} Video tutorial</span></span>
        </div>
      </div>`;
    document.body.append(dialog);
    const off = dialog.querySelector('[data-act="off"]');
    off.addEventListener('change', () => setOff(off.checked));
    dialog.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'watch') {
        dialog.close('watch');
        video.open();
      } else if (act === 'tour') {
        dialog.close('tour');
        onTour?.();
      } else if (act === 'skip') dialog.close('skip');
    });
    dialog.addEventListener('close', () => {
      // Skipped (button or Esc): show where the tutorial lives.
      if (dialog.returnValue !== 'watch' && dialog.returnValue !== 'tour') pointAtButton();
    });
  }

  /** Ask at start-up unless the visitor opted out. */
  function offer() {
    if (isOff() || video.isOpen) return;
    show();
  }
  function show() {
    if (!dialog) build();
    dialog.returnValue = '';
    dialog.querySelector('[data-act="off"]').checked = isOff();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.welcome-actions [data-act="watch"]').focus();
  }

  return { offer, show, pointAtButton };
}
