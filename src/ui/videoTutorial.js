// Video tutorial: a narrated walkthrough played like a video. The screenshots
// are of the real app (tools/tutorial/capture-shots.cjs), the voice-over is a
// pre-recorded audio track (tools/tutorial/build_narration.py), and the audio
// is the clock: zooms, spotlights, the cursor and captions are all computed
// from the current playback time, so seeking and speed changes stay in sync.
// Without audio (blocked, offline, muted) an internal clock takes over and the
// captions carry the narration.

import script from './tutorial/script.json';
import timing from './tutorial/timing.json';
import shots from './tutorial/shots.json';
import './tutorial/tutorial.css';

const BASE = import.meta.env.BASE_URL;
const IMG_W = shots.width;
const IMG_H = shots.height;
const ASPECT = IMG_H / IMG_W;
const RATES = [0.75, 1, 1.25, 1.5];
const PREFS_KEY = 'lsp.tutorialPrefs';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ------------------------------------------------------------------ timeline
const LINES = [];
script.chapters.forEach((ch, ci) =>
  ch.lines.forEach((line, li) => LINES.push({ ...line, chapter: ci, first: li === 0 })),
);
LINES.forEach((line, i) => {
  [line.start, line.end] = timing.lines[i] ?? [i * 5, i * 5 + 4];
});
const DURATION = timing.duration ?? LINES.at(-1).end + 2;
LINES.forEach((line, i) => {
  line.segStart = i === 0 ? 0 : line.start;
  line.segEnd = i + 1 < LINES.length ? LINES[i + 1].start : DURATION;
});
const CHAPTERS = script.chapters.map((ch, ci) => {
  const lines = LINES.filter((l) => l.chapter === ci);
  return { ...ch, start: lines[0].segStart, end: lines.at(-1).segEnd };
});

function lineIndexAt(t) {
  let i = 0;
  while (i + 1 < LINES.length && LINES[i + 1].segStart <= t) i++;
  return i;
}
const chapterAt = (t) => LINES[lineIndexAt(t)].chapter;

// ------------------------------------------------------------------ geometry
function unionRect(shot, names) {
  const rs = (names ?? []).map((n) => shots.shots[shot]?.rects[n]).filter(Boolean);
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r[0]));
  const y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

const FULL = { cx: IMG_W / 2, cy: IMG_H / 2, w: IMG_W };
const SAFE = 0.8;

/** Camera (centre and visible width, in screenshot pixels) that frames a line's zoom target. */
function targetCamera(line) {
  const r = line.zoom ? unionRect(line.shot, line.zoom) : null;
  if (!r) return FULL;
  // Frame the target in the top 80% of the picture; captions use the rest.
  let w = Math.max(r[2] * 1.2 + 90, (r[3] * 1.2 + 70) / SAFE / ASPECT, 560);
  w = Math.min(w, IMG_W);
  const h = w * ASPECT;
  return {
    cx: clamp(r[0] + r[2] / 2, w / 2, IMG_W - w / 2),
    cy: clamp(r[1] + r[3] / 2 + h * (0.5 - SAFE / 2), h / 2, IMG_H - h / 2),
    w,
  };
}

/** Captions move to the top when the line's spotlight ends up low in the frame. */
function captionOnTop(line) {
  if (line.capTop != null) return line.capTop;
  const c = targetCamera(line);
  const h = c.w * ASPECT;
  const top = c.cy - h / 2;
  line.capTop = [...(line.spot ?? []), ...(line.zoom ?? [])].some((n) => {
    const r = shots.shots[line.shot]?.rects[n];
    return r && (r[1] + r[3] - top) / h > 0.78 && (r[1] - top) / h > 0.25;
  });
  return line.capTop;
}

function cameraAt(i, u) {
  const line = LINES[i];
  const target = targetCamera(line);
  const dur = line.segEnd - line.segStart;
  const drift = reduceMotion() ? 0 : 0.035 * clamp(u / Math.max(dur, 1));
  const zoomed = (c) => {
    const w = c.w * (1 - drift);
    const h = w * ASPECT;
    return { cx: clamp(c.cx, w / 2, IMG_W - w / 2), cy: clamp(c.cy, h / 2, IMG_H - h / 2), w };
  };
  const prev = LINES[i - 1];
  if (!prev || prev.shot !== line.shot) return zoomed(target);
  const from = endCamera(i - 1);
  const k = ease(clamp(u / (reduceMotion() ? 0.3 : 1.1)));
  return zoomed({ cx: lerp(from.cx, target.cx, k), cy: lerp(from.cy, target.cy, k), w: lerp(from.w, target.w, k) });
}
const endCamera = (i) => cameraAt(i, LINES[i].segEnd - LINES[i].segStart);

// ------------------------------------------------------------------ icons
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.2v14H6zM19 5.5v13L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 5H18v14h-2.2zM5 5.5v13L14.5 12z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  cc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 10.3a2.3 2.3 0 1 0 0 3.4M17 10.3a2.3 2.3 0 1 0 0 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  cursor: '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 3l16.5 12.2-7.3 1.1 4.3 8.2-3.4 1.7-4.2-8.3-5.9 4.9z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  sun: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="currentColor"/><g stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/></g></svg>',
  earth: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M15 13c4 2 3 6 7 7s2 6 6 7M30 9c-1 4 3 5 6 7M11 30c4-1 6 2 8 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3 18h26" stroke="currentColor" stroke-width="2.2"/><circle cx="22" cy="9" r="2.6" fill="#ffb020"/></svg>',
};

function cardHtml(type) {
  if (type === 'title') {
    return `<div class="vt-card-title">
      <div class="vt-logo">${ICON.logo}</div>
      <h3>${esc(script.chapters[0].lines[0].card.title ?? 'Lunar Site Planner')}</h3>
      <p>Video tutorial · ${fmtTime(DURATION)}</p>
    </div>`;
  }
  if (type === 'questions') {
    return `<div class="vt-card-questions">
      <div class="vt-q sun"><div class="vt-q-icon">${ICON.sun}</div><h4>Power</h4><p>Enough sunlight for the solar panels?</p></div>
      <div class="vt-q earth"><div class="vt-q-icon">${ICON.earth}</div><h4>Earth link</h4><p>A clear radio line to Earth?</p></div>
    </div>`;
  }
  if (type === 'end') {
    return `<div class="vt-card-end">
      <h3>You're ready to explore!</h3>
      <p>Replay any time with <span class="vt-pill">${ICON.play} Video tutorial</span> at the top of the screen.</p>
    </div>`;
  }
  return '';
}

// ------------------------------------------------------------------ player
export function createVideoTutorial({ onTour } = {}) {
  let dialog = null;
  let els = {};
  let audio = null;
  let audioOk = false;
  let playing = false;
  let rate = 1;
  let manualBase = 0; // internal clock when audio is unavailable
  let manualT0 = 0;
  let raf = 0;
  let captions = true;
  let muted = false;
  let size = { w: 960, h: 540 };
  let renderMode = false;
  let ended = false;
  let lastChapter = -1;
  let lastCardKey = '';
  let lastCaption = null;
  let dragging = false;
  let lastFocus = null;

  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    captions = p.captions ?? true;
    muted = p.muted ?? false;
    rate = RATES.includes(p.rate) ? p.rate : 1;
  } catch {
    /* defaults */
  }
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ captions, muted, rate }));
    } catch {
      /* private mode */
    }
  };

  // ---------------------------------------------------------------- clock
  function now() {
    if (audioOk) return audio.currentTime;
    return playing ? manualBase + ((performance.now() - manualT0) / 1000) * rate : manualBase;
  }
  function seek(t) {
    t = clamp(t, 0, DURATION);
    ended = false;
    if (audioOk) audio.currentTime = t;
    manualBase = t;
    manualT0 = performance.now();
    draw();
  }
  function play() {
    if (now() >= DURATION - 0.05) seek(0);
    ended = false;
    playing = true;
    manualT0 = performance.now();
    if (audioOk) {
      audio.playbackRate = rate;
      audio.play().catch(() => {
        // Autoplay refused or decode failed: keep going on captions.
        switchToManual('Voice-over could not start. Captions are on.');
      });
    }
    syncButtons();
    loop();
  }
  function pause() {
    if (!playing) return;
    manualBase = now();
    playing = false;
    if (audioOk) audio.pause();
    syncButtons();
    draw();
  }
  const toggle = () => (playing ? pause() : play());
  function switchToManual(msg) {
    if (!audioOk && audio) return;
    const t = audio && audioOk ? audio.currentTime : manualBase;
    audioOk = false;
    manualBase = t;
    manualT0 = performance.now();
    if (!captions) {
      captions = true;
      syncButtons();
    }
    if (msg) notice(msg);
  }
  function setupAudio() {
    audio = new Audio(`${BASE}tutorial/narration.mp3`);
    audio.preload = 'auto';
    audio.muted = muted;
    audio.playbackRate = rate;
    audioOk = true;
    audio.addEventListener('error', () => switchToManual('Voice-over unavailable. Captions are on.'));
    audio.addEventListener('ended', () => {
      playing = false;
      finish();
    });
  }

  // ---------------------------------------------------------------- DOM
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'vt';
    dialog.setAttribute('aria-labelledby', 'vtTitle');
    dialog.innerHTML = `
      <div class="vt-shell">
        <header class="vt-head">
          <div class="vt-head-title">
            <span class="vt-badge">${ICON.play} Video tutorial</span>
            <h2 id="vtTitle">${esc(script.title)}</h2>
          </div>
          <button class="vt-icon vt-close" data-act="close" aria-label="Close video tutorial" title="Close (Esc)">${ICON.close}</button>
        </header>
        <div class="vt-body">
          <div class="vt-main">
            <div class="vt-screen">
              <div class="vt-stage" aria-hidden="true">
                <div class="vt-shots">${Object.entries(shots.shots)
                  .map(([name, s]) => `<img data-shot="${name}" src="${BASE}${s.src}" alt="" decoding="async" draggable="false" />`)
                  .join('')}</div>
                <svg class="vt-spot" preserveAspectRatio="none"><defs><mask id="vtMask"><rect class="vt-mask-bg" x="0" y="0" width="100%" height="100%" fill="#fff"/><g class="vt-holes"></g></mask></defs>
                  <rect class="vt-dim" x="0" y="0" width="100%" height="100%" mask="url(#vtMask)"/><g class="vt-rings"></g></svg>
                <div class="vt-label"></div>
                <div class="vt-ripple"></div>
                <div class="vt-cursor">${ICON.cursor}</div>
                <div class="vt-chip"></div>
                <div class="vt-card"></div>
              </div>
              <div class="vt-caption" aria-hidden="true"><span></span></div>
              <button class="vt-bigplay" data-act="toggle" aria-label="Play">${ICON.play}</button>
              <div class="vt-end" hidden>
                <h3>Nice work!</h3>
                <p>What would you like to do next?</p>
                <div class="vt-end-actions">
                  <button class="vt-btn primary" data-act="explore">Start exploring</button>
                  <button class="vt-btn" data-act="tour">Try the interactive tour</button>
                  <button class="vt-btn ghost" data-act="replay">${ICON.replay} Watch again</button>
                </div>
              </div>
              <div class="vt-notice" role="status" aria-live="polite"></div>
            </div>
            <div class="vt-controls">
              <div class="vt-scrub" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="${Math.round(DURATION)}">
                ${CHAPTERS.map((c, i) => `<div class="vt-seg" style="flex:${(c.end - c.start).toFixed(2)}" data-i="${i}" title="${esc(c.title)}"><i></i></div>`).join('')}
                <div class="vt-knob"></div>
                <div class="vt-hover" hidden></div>
              </div>
              <div class="vt-bar">
                <div class="vt-bar-left">
                  <button class="vt-icon vt-play" data-act="toggle" aria-label="Play" title="Play or pause (Space)">${ICON.play}</button>
                  <button class="vt-icon" data-act="prev" aria-label="Previous chapter" title="Previous chapter">${ICON.prev}</button>
                  <button class="vt-icon" data-act="next" aria-label="Next chapter" title="Next chapter">${ICON.next}</button>
                  <span class="vt-time"><span class="vt-cur">0:00</span> / ${fmtTime(DURATION)}</span>
                  <span class="vt-chapter-name"></span>
                </div>
                <div class="vt-bar-right">
                  <button class="vt-icon" data-act="mute" aria-label="Mute voice-over" title="Voice-over on/off (M)">${ICON.vol}</button>
                  <button class="vt-icon vt-cc" data-act="cc" aria-label="Captions" aria-pressed="true" title="Captions on/off (C)">${ICON.cc}</button>
                  <button class="vt-icon vt-rate" data-act="rate" aria-label="Playback speed" title="Playback speed">1×</button>
                  <a class="vt-icon" href="${BASE}tutorial/lunar-site-planner-tutorial.mp4" download aria-label="Download the video (MP4)" title="Download the video (MP4)">${ICON.download}</a>
                  <button class="vt-icon" data-act="fullscreen" aria-label="Full screen" title="Full screen (F)">${ICON.full}</button>
                </div>
              </div>
            </div>
          </div>
          <aside class="vt-chapters" aria-label="Chapters">
            <h3>Chapters</h3>
            <ol>${CHAPTERS.map(
              (c, i) => `<li><button data-chapter="${i}"><span class="vt-ch-num">${i + 1}</span><span class="vt-ch-title">${esc(c.title)}</span><span class="vt-ch-time">${fmtTime(c.start)}</span></button></li>`,
            ).join('')}</ol>
          </aside>
        </div>
      </div>`;
    document.body.append(dialog);
    const q = (s) => dialog.querySelector(s);
    els = {
      screen: q('.vt-screen'),
      stage: q('.vt-stage'),
      imgs: Object.fromEntries([...dialog.querySelectorAll('[data-shot]')].map((i) => [i.dataset.shot, i])),
      spot: q('.vt-spot'),
      holes: q('.vt-holes'),
      rings: q('.vt-rings'),
      dim: q('.vt-dim'),
      label: q('.vt-label'),
      cursor: q('.vt-cursor'),
      ripple: q('.vt-ripple'),
      chip: q('.vt-chip'),
      card: q('.vt-card'),
      caption: q('.vt-caption'),
      captionText: q('.vt-caption span'),
      bigplay: q('.vt-bigplay'),
      end: q('.vt-end'),
      notice: q('.vt-notice'),
      scrub: q('.vt-scrub'),
      segs: [...dialog.querySelectorAll('.vt-seg i')],
      knob: q('.vt-knob'),
      hover: q('.vt-hover'),
      cur: q('.vt-cur'),
      chapterName: q('.vt-chapter-name'),
      chapterBtns: [...dialog.querySelectorAll('[data-chapter]')],
    };

    dialog.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act], [data-chapter]');
      if (!b) {
        if (e.target === dialog) close(); // backdrop
        return;
      }
      if (b.dataset.chapter != null) {
        seek(CHAPTERS[Number(b.dataset.chapter)].start);
        play();
        return;
      }
      const act = b.dataset.act;
      if (act === 'close' || act === 'explore') close();
      else if (act === 'toggle') toggle();
      else if (act === 'prev') jumpChapter(-1);
      else if (act === 'next') jumpChapter(1);
      else if (act === 'replay') {
        seek(0);
        play();
      } else if (act === 'tour') {
        close();
        onTour?.();
      } else if (act === 'mute') setMuted(!muted);
      else if (act === 'cc') setCaptions(!captions);
      else if (act === 'rate') setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]);
      else if (act === 'fullscreen') fullscreen();
    });
    els.stage.addEventListener('click', toggle);
    dialog.addEventListener('close', onClosed);
    dialog.addEventListener('keydown', onKey);

    // Scrubbing
    const tAt = (e) => {
      const r = els.scrub.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width) * DURATION;
    };
    els.scrub.addEventListener('pointerdown', (e) => {
      dragging = true;
      els.scrub.setPointerCapture(e.pointerId);
      seek(tAt(e));
    });
    els.scrub.addEventListener('pointermove', (e) => {
      const t = tAt(e);
      const r = els.scrub.getBoundingClientRect();
      els.hover.hidden = false;
      els.hover.textContent = `${fmtTime(t)} · ${CHAPTERS[chapterAt(t)].title}`;
      els.hover.style.left = `${clamp(e.clientX - r.left, 60, r.width - 60)}px`;
      if (dragging) seek(t);
    });
    els.scrub.addEventListener('pointerleave', () => (els.hover.hidden = true));
    const endDrag = () => (dragging = false);
    els.scrub.addEventListener('pointerup', endDrag);
    els.scrub.addEventListener('pointercancel', endDrag);
    els.scrub.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 5, ArrowLeft: -5, PageUp: 30, PageDown: -30 }[e.key];
      if (d) {
        e.preventDefault();
        e.stopPropagation();
        seek(now() + d);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        seek(e.key === 'Home' ? 0 : DURATION);
      }
    });

    new ResizeObserver(() => {
      size = { w: els.stage.clientWidth, h: els.stage.clientHeight };
      draw();
    }).observe(els.stage);
  }

  function onKey(e) {
    if (e.target.closest('.vt-scrub') && /Arrow|Page|Home|End/.test(e.key)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space' || k === 'k') {
      if (e.target.closest('button, a') && e.code === 'Space') return; // let buttons click
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) jumpChapter(e.key === 'ArrowRight' ? 1 : -1);
      else seek(now() + (e.key === 'ArrowRight' ? 5 : -5));
    } else if (k === 'm') setMuted(!muted);
    else if (k === 'c') setCaptions(!captions);
    else if (k === 'f') fullscreen();
  }

  function jumpChapter(d) {
    const t = now();
    let c = chapterAt(t);
    // "Previous" restarts the current chapter unless we are at its very start.
    if (d < 0 && t - CHAPTERS[c].start > 2) d = 0;
    c = clamp(c + d, 0, CHAPTERS.length - 1);
    seek(CHAPTERS[c].start);
    if (!playing) play();
  }

  function setMuted(m) {
    muted = m;
    if (audio) audio.muted = m;
    savePrefs();
    syncButtons();
  }
  function setCaptions(c) {
    captions = c;
    savePrefs();
    syncButtons();
    draw();
  }
  function setRate(r) {
    manualBase = now();
    manualT0 = performance.now();
    rate = r;
    if (audio) audio.playbackRate = r;
    savePrefs();
    syncButtons();
  }
  function fullscreen() {
    const el = els.screen;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  }

  let noticeT = 0;
  function notice(msg) {
    if (!els.notice) return;
    els.notice.textContent = msg;
    els.notice.classList.add('on');
    clearTimeout(noticeT);
    noticeT = setTimeout(() => els.notice.classList.remove('on'), 4000);
  }

  function syncButtons() {
    if (!dialog) return;
    dialog.querySelectorAll('[data-act="toggle"]').forEach((b) => {
      b.innerHTML = playing ? ICON.pause : ICON.play;
      b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    });
    els.bigplay.hidden = playing || ended;
    const m = dialog.querySelector('[data-act="mute"]');
    m.innerHTML = muted ? ICON.mute : ICON.vol;
    m.setAttribute('aria-label', muted ? 'Turn voice-over on' : 'Mute voice-over');
    m.classList.toggle('off', muted);
    const cc = dialog.querySelector('[data-act="cc"]');
    cc.setAttribute('aria-pressed', String(captions));
    cc.classList.toggle('on', captions);
    dialog.querySelector('[data-act="rate"]').textContent = `${rate}×`;
  }

  function finish() {
    ended = true;
    playing = false;
    manualBase = DURATION;
    syncButtons();
    draw();
    if (!renderMode) {
      els.end.hidden = false;
      els.end.querySelector('[data-act="explore"]')?.focus();
    }
  }

  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      if (!dialog?.open || !playing) return;
      if (!audioOk && now() >= DURATION) {
        finish();
        return;
      }
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- frame
  function draw(t = now()) {
    if (!dialog) return;
    t = clamp(t, 0, DURATION);
    if (!ended) els.end.hidden = true;
    const W = size.w || 960;
    const H = size.h || W * ASPECT;
    const i = lineIndexAt(t);
    const line = LINES[i];
    const prev = LINES[i - 1];
    const u = t - line.segStart;

    // Shots and camera (cross-fade when the screenshot changes)
    const cam = cameraAt(i, u);
    const fadeK = prev && prev.shot !== line.shot ? clamp(u / 0.6) : 1;
    const prevCam = fadeK < 1 ? endCamera(i - 1) : null;
    for (const [name, img] of Object.entries(els.imgs)) {
      let c = null;
      let op = 0;
      if (name === line.shot) {
        c = cam;
        op = ease(fadeK);
      } else if (prevCam && name === prev.shot) {
        c = prevCam;
        op = 1;
      }
      if (!c) {
        if (img.style.opacity !== '0') img.style.opacity = '0';
        continue;
      }
      const S = W / c.w;
      img.style.width = `${IMG_W * S}px`;
      img.style.transform = `translate3d(${(-(c.cx - c.w / 2) * S).toFixed(2)}px, ${(-(c.cy - (c.w * ASPECT) / 2) * S).toFixed(2)}px, 0)`;
      img.style.opacity = String(op);
      img.style.zIndex = name === line.shot ? '2' : '1';
    }
    const S = W / cam.w;
    const toStage = (r) => [(r[0] - (cam.cx - cam.w / 2)) * S, (r[1] - (cam.cy - (cam.w * ASPECT) / 2)) * S, r[2] * S, r[3] * S];

    // Spotlight
    const rectsFor = (l) => (l?.spot ?? []).map((n) => shots.shots[l.shot]?.rects[n]).filter(Boolean);
    const cur = rectsFor(line);
    const before = prev && prev.shot === line.shot ? rectsFor(prev) : [];
    const k = ease(clamp((u - 0.1) / 0.75));
    let holes = [];
    let dim = 0;
    if (cur.length && before.length === cur.length) {
      holes = cur.map((r, j) => r.map((v, m) => lerp(before[j][m], v, k)));
      dim = 1;
    } else if (cur.length) {
      holes = cur;
      dim = fadeK < 1 ? ease(fadeK) : k;
    } else if (before.length) {
      holes = before;
      dim = 1 - k;
    }
    els.spot.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pad = 6;
    const shapes = holes.map((r) => {
      const [x, y, w, h] = toStage([r[0] - pad, r[1] - pad, r[2] + 2 * pad, r[3] + 2 * pad]);
      return `x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(12, h / 2).toFixed(1)}"`;
    });
    els.holes.innerHTML = shapes.map((a) => `<rect ${a} fill="#000"/>`).join('');
    els.rings.innerHTML = shapes.map((a) => `<rect ${a} class="vt-ring"/>`).join('');
    els.spot.style.opacity = String(dim);

    // Label pill inside the first spotlight
    if (line.label && cur.length) {
      const [x, y, w] = toStage(cur[0]);
      els.label.textContent = line.label;
      els.label.style.transform = `translate(-50%, 0) translate(${(x + w / 2).toFixed(1)}px, ${(y + 14).toFixed(1)}px) scale(${lerp(0.9, 1, ease(clamp((u - 0.3) / 0.4))).toFixed(3)})`;
      els.label.style.opacity = String(ease(clamp((u - 0.3) / 0.4)));
    } else els.label.style.opacity = '0';

    // Cursor
    drawCursor(i, u, toStage);

    // Chapter chip
    const ch = line.chapter;
    const chipOn = !line.label && !(line.card && line.card.type !== 'end') && !(line.card?.type === 'end' && t > line.end);
    els.chip.textContent = `${ch + 1}/${CHAPTERS.length} · ${CHAPTERS[ch].title}`;
    els.chip.classList.toggle('on', chipOn);

    // Cards (title, the two questions, the closing card)
    drawCard(i, t);

    // Captions
    let text = '';
    if (captions && t >= line.start - 0.15 && !(i === LINES.length - 1 && t > line.end + 0.6)) text = line.text;
    if (text !== lastCaption) {
      lastCaption = text;
      els.captionText.textContent = text;
      els.caption.classList.toggle('on', !!text);
    }
    els.caption.classList.toggle('top', captionOnTop(line));

    // Controls
    const frac = t / DURATION;
    CHAPTERS.forEach((c, j) => {
      els.segs[j].style.transform = `scaleX(${clamp((t - c.start) / (c.end - c.start)).toFixed(4)})`;
    });
    els.knob.style.left = `${(frac * 100).toFixed(3)}%`;
    els.scrub.setAttribute('aria-valuenow', String(Math.round(t)));
    els.scrub.setAttribute('aria-valuetext', `${fmtTime(t)} of ${fmtTime(DURATION)}, ${CHAPTERS[ch].title}`);
    els.cur.textContent = fmtTime(t);
    if (ch !== lastChapter) {
      lastChapter = ch;
      els.chapterName.textContent = CHAPTERS[ch].title;
      els.chapterBtns.forEach((b, j) => {
        b.classList.toggle('current', j === ch);
        b.classList.toggle('done', j < ch);
        if (j === ch) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      });
    }
  }

  function cursorTarget(l) {
    const r = l?.cursor && shots.shots[l.shot]?.rects[l.cursor];
    return r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : null;
  }

  function drawCursor(i, u, toStage) {
    const line = LINES[i];
    const target = cursorTarget(line);
    if (!target) {
      els.cursor.style.opacity = '0';
      els.ripple.style.opacity = '0';
      return;
    }
    const prev = LINES[i - 1];
    const from = prev && prev.shot === line.shot && cursorTarget(prev);
    const toPt = (p) => {
      const [x, y] = toStage([p[0], p[1], 0, 0]);
      return [x, y];
    };
    const end = toPt(target);
    const start = from ? toPt(from) : [size.w * 0.82, size.h * 0.9];
    const m = ease(clamp((u - 0.35) / 1.0));
    const x = lerp(start[0], end[0], m);
    const y = lerp(start[1], end[1], m);
    const next = LINES[i + 1];
    const remaining = line.segEnd - line.segStart - u;
    let op = from ? 1 : ease(clamp((u - 0.1) / 0.35));
    if (!cursorTarget(next) || next?.shot !== line.shot) op *= clamp(remaining / 0.3);
    const clickAt = 1.5;
    const press = line.click && u > clickAt && u < clickAt + 0.18 ? 0.85 : 1;
    els.cursor.style.opacity = String(op);
    els.cursor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${press})`;
    if (line.click && u > clickAt && u < clickAt + 0.7) {
      const p = (u - clickAt) / 0.7;
      els.ripple.style.opacity = String(0.9 * (1 - p));
      els.ripple.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${lerp(0.2, 1.6, ease(p)).toFixed(3)})`;
    } else els.ripple.style.opacity = '0';
  }

  function drawCard(i, t) {
    const line = LINES[i];
    let type = line.card?.type ?? '';
    // The closing card appears once the last sentence has been said.
    if (type === 'end' && t < line.end + 0.3) type = '';
    // Animate from the first consecutive line that shows this card.
    let j = i;
    while (j > 0 && LINES[j - 1].card?.type === type && type) j--;
    const since = type === 'end' ? t - (line.end + 0.3) : t - LINES[j].segStart;
    const key = type;
    if (key !== lastCardKey) {
      lastCardKey = key;
      els.card.className = `vt-card ${type ? `vt-card--${type}` : ''}`;
      els.card.innerHTML = cardHtml(type);
    }
    if (!type) {
      els.card.style.opacity = '0';
      return;
    }
    const lastOfRun = LINES[i + 1]?.card?.type !== type;
    const out = lastOfRun && type !== 'end' ? clamp((line.segEnd - t) / 0.4) : 1;
    els.card.style.opacity = String(ease(clamp(since / 0.5)) * out);
    els.card.style.setProperty('--rise', `${(1 - ease(clamp(since / 0.7))) * 18}px`);
    els.card.querySelectorAll('.vt-q').forEach((q, n) => {
      const a = ease(clamp((since - 0.6 - n * 0.9) / 0.5));
      q.style.opacity = String(a);
      q.style.transform = `translateY(${((1 - a) * 16).toFixed(1)}px)`;
    });
  }

  // ---------------------------------------------------------------- open/close
  function open({ from = null } = {}) {
    if (!dialog) {
      build();
      setupAudio();
    }
    lastFocus = document.activeElement;
    els.end.hidden = true;
    if (!dialog.open) dialog.showModal();
    size = { w: els.stage.clientWidth, h: els.stage.clientHeight };
    if (from != null) seek(from);
    else if (ended || now() >= DURATION - 0.5) seek(0);
    syncButtons();
    draw();
    play();
    dialog.querySelector('.vt-play')?.focus();
  }
  function close() {
    dialog?.close();
  }
  function onClosed() {
    pause();
    if (document.fullscreenElement) document.exitFullscreen?.();
    cancelAnimationFrame(raf);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  /** Frame-exact rendering for tools/tutorial/render-video.cjs. */
  function enableRenderMode() {
    if (!dialog) build();
    renderMode = true;
    captions = true;
    dialog.classList.add('vt-render');
    if (!dialog.open) dialog.showModal();
    size = { w: els.stage.clientWidth, h: els.stage.clientHeight };
    syncButtons();
    return {
      duration: DURATION,
      frame(t) {
        manualBase = t;
        ended = false;
        draw(t);
      },
      ready: () => Promise.all(Object.values(els.imgs).map((img) => img.decode().catch(() => {}))),
    };
  }

  return {
    open,
    close,
    enableRenderMode,
    get isOpen() {
      return !!dialog?.open;
    },
    duration: DURATION,
    chapters: CHAPTERS.map((c) => ({ title: c.title, start: c.start })),
  };
}
