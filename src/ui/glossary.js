// Short definitions for technical terms, shown in native popovers next to the
// term ("?" buttons). One popover element per term is created on first use.

export const GLOSSARY = {
  horizon: {
    title: 'Terrain horizon',
    text: 'The skyline seen from the site: in each direction, the highest angle at which terrain blocks the sky. It is computed from NASA LOLA laser-altimeter heights, including the curvature of the Moon. The Moon has no atmosphere, so nothing bends light over it.',
  },
  disk: {
    title: 'Solar disk above terrain',
    text: 'The Sun is a disk about 0.53° wide. Near the pole it skims the skyline, so often only part of it is visible. Power scales with the visible part.',
  },
  libration: {
    title: 'Libration',
    text: 'A monthly wobble in how the Moon faces Earth, caused by its tilted, elliptical orbit. Seen from the Moon, Earth stays almost fixed in the sky but moves up to about 7° to 8°. Near the limb that is enough to make Earth rise and set behind ridges.',
  },
  dte: {
    title: 'Direct-to-Earth (DTE) link',
    text: 'Radio contact straight from the lander to a ground antenna on Earth, without a relay satellite. It needs Earth above the local terrain, a ground station that can see the Moon, and enough signal strength.',
  },
  dsn: {
    title: 'Deep Space Network (DSN)',
    text: 'NASA’s three large antenna complexes at Goldstone (USA), Madrid (Spain) and Canberra (Australia), about 120° apart in longitude. Here a complex counts as available when the Moon is at least 10° above its horizon.',
  },
  margin: {
    title: 'Link margin',
    text: 'How much stronger the received signal is than the minimum needed for the chosen data rate, in decibels (dB). Above about 3 dB the link is comfortable; below 0 dB it does not close.',
  },
  cn0: {
    title: 'C/N₀',
    text: 'Received carrier power relative to noise per hertz of bandwidth, in dB-Hz. It summarises how strong the signal is after travelling about 380,000 km.',
  },
  lightTime: {
    title: 'Light time',
    text: 'The time a radio signal takes to travel between the Moon and Earth: about 1.3 s each way.',
  },
  lola: {
    title: 'LOLA',
    text: 'The Lunar Orbiter Laser Altimeter on NASA’s Lunar Reconnaissance Orbiter. Its laser measurements are the source of the terrain heights used here, gridded at 240 m near the pole and 1 km out to 75°S.',
  },
  psr: {
    title: 'Permanently shadowed region',
    text: 'A crater floor so deep and so close to the pole that sunlight never reaches it. Such areas are among the coldest places known and can trap water ice.',
  },
};

const made = new Set();

function ensurePopover(key) {
  const id = `gloss-${key}`;
  if (made.has(key) || document.getElementById(id)) return id;
  const g = GLOSSARY[key];
  const el = document.createElement('div');
  el.id = id;
  el.className = 'gloss-pop';
  el.setAttribute('popover', '');
  el.setAttribute('role', 'note');
  el.innerHTML = `<h4>${g.title}</h4><p>${g.text}</p>`;
  document.body.append(el);
  made.add(key);
  return id;
}

/** HTML for a "?" button that opens the definition of `key`. */
export function term(key) {
  const g = GLOSSARY[key];
  if (!g) return '';
  const id = ensurePopover(key);
  return `<button type="button" class="gloss" popovertarget="${id}" aria-label="What is ${g.title.replace(/"/g, '&quot;')}?">?</button>`;
}
