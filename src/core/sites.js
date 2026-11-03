// Curated landing sites. Coordinates are selenographic (planetocentric) degrees,
// longitude east-positive in -180..180, in the Mean-Earth frame.
//
// `precision`: 'surveyed' = published post-landing LROC position (Apollo values
// from Wagner et al. 2017, Icarus 283), 'reported' = mission-reported landing
// or impact position, 'approx' = target or feature centre to roughly 0.1 deg.
// Always check `note` before quoting a number in a review.

export const SITE_GROUPS = {
  south: 'South pole: features & targets',
  clps: 'CLPS & commercial',
  apollo: 'Apollo',
  intl: 'Other national programs',
  computed: 'Points chosen from LOLA terrain',
};

export const SITES = [
  // --- South pole features -------------------------------------------------
  { id: 'shackleton', name: 'Shackleton crater floor', group: 'south', lat: -89.67, lon: 129.78, precision: 'approx', note: 'Permanently shadowed crater interior: classic cold trap. Useful contrast with its sunlit rim.' },
  { id: 'degerlache', name: 'de Gerlache crater', group: 'south', lat: -88.5, lon: -87.1, precision: 'approx', note: 'Crater centre; its rim hosts one of NASA’s Artemis candidate landing regions.' },
  { id: 'shoemaker', name: 'Shoemaker crater', group: 'south', lat: -88.14, lon: 44.9, precision: 'approx', note: 'Large permanently shadowed crater (ice science target).' },
  { id: 'haworth', name: 'Haworth crater', group: 'south', lat: -87.45, lon: -4.0, precision: 'approx', note: 'Crater centre. One of NASA’s Artemis candidate landing regions lies on its rim.' },
  { id: 'faustini', name: 'Faustini crater', group: 'south', lat: -87.18, lon: 84.31, precision: 'approx', note: 'Permanently shadowed crater.' },
  { id: 'nobile', name: 'Nobile crater', group: 'south', lat: -85.28, lon: 53.29, precision: 'approx', note: 'Crater centre; two Nobile Rim regions are among NASA’s Artemis candidate landing regions, and VIPER targeted this area.' },
  { id: 'lcross', name: 'LCROSS impact (Cabeus)', group: 'south', lat: -84.675, lon: -48.725, precision: 'reported', note: '2009 impact that confirmed water ice in a shadowed crater.' },

  // --- CLPS & commercial -----------------------------------------------------
  { id: 'im1', name: 'IM-1 Odysseus (Malapert A)', group: 'clps', lat: -80.13, lon: 1.44, precision: 'reported', note: 'Intuitive Machines, Feb 2024. First US soft landing since 1972; tipped over, which cut power and Earth link.' },
  { id: 'im2', name: 'IM-2 Athena (Mons Mouton)', group: 'clps', lat: -84.8, lon: 29.2, precision: 'approx', note: 'Intuitive Machines, Mar 2025, Mons Mouton plateau near the south pole. Position approximate.' },
  { id: 'bg1', name: 'Blue Ghost M1 (Mare Crisium)', group: 'clps', lat: 18.562, lon: 61.81, precision: 'reported', note: 'Firefly Aerospace, Mar 2025. Ran a full lunar day of operations.' },
  { id: 'im3', name: 'IM-3 target (Reiner Gamma)', group: 'clps', lat: 7.5, lon: -59.0, precision: 'approx', note: 'Intuitive Machines target: lunar swirl / magnetic anomaly.' },

  // --- Apollo (Wagner et al. 2017) ---------------------------------------------
  { id: 'a11', name: 'Apollo 11 (Tranquility Base)', group: 'apollo', lat: 0.67416, lon: 23.47315, precision: 'surveyed' },
  { id: 'a12', name: 'Apollo 12', group: 'apollo', lat: -3.01239, lon: -23.42157, precision: 'surveyed' },
  { id: 'a14', name: 'Apollo 14', group: 'apollo', lat: -3.64417, lon: -17.47865, precision: 'surveyed' },
  { id: 'a15', name: 'Apollo 15', group: 'apollo', lat: 26.13341, lon: 3.6285, precision: 'surveyed' },
  { id: 'a16', name: 'Apollo 16', group: 'apollo', lat: -8.97341, lon: 15.49859, precision: 'surveyed' },
  { id: 'a17', name: 'Apollo 17', group: 'apollo', lat: 20.18809, lon: 30.77475, precision: 'surveyed' },

  // --- Other national programs ---------------------------------------------------
  { id: 'ch3', name: 'Chandrayaan-3 Vikram (India)', group: 'intl', lat: -69.373, lon: 32.319, precision: 'reported', note: 'ISRO, Aug 2023: southernmost soft landing at the time ("Shiv Shakti point").' },
  { id: 'slim', name: 'SLIM (Japan)', group: 'intl', lat: -13.316, lon: 25.251, precision: 'reported', note: 'JAXA, Jan 2024. Landed nose-down: the solar array faced west and only produced power in the lunar afternoon, a real example of attitude affecting power.' },
  { id: 'ce4', name: 'Chang’e 4 (China, far side)', group: 'intl', lat: -45.4446, lon: 177.5991, precision: 'reported', note: 'First far-side landing (2019). Earth is never visible here, so it needs the Queqiao relay satellite.' },
  { id: 'ce6', name: 'Chang’e 6 (China, far side)', group: 'intl', lat: -41.6385, lon: -153.9852, precision: 'reported', note: 'Far-side sample return, 2024 (Apollo basin). Relay-dependent.' },
  { id: 'ce5', name: 'Chang’e 5 (China)', group: 'intl', lat: 43.0576, lon: -51.9161, precision: 'reported' },
  { id: 'ce3', name: 'Chang’e 3 (China)', group: 'intl', lat: 44.1214, lon: -19.5116, precision: 'reported' },
  { id: 'luna25', name: 'Luna 25 target (Russia)', group: 'intl', lat: -69.545, lon: 43.544, precision: 'approx', note: 'Planned landing near Boguslawsky crater; the spacecraft crashed in 2023.' },
  { id: 'luna9', name: 'Luna 9 (USSR)', group: 'intl', lat: 7.08, lon: -64.37, precision: 'reported', note: 'First soft landing on the Moon, 1966.' },
];

export function siteById(id) {
  return SITES.find((s) => s.id === id) ?? null;
}

/** Parse "lat, lon" in decimal degrees (S/W negative or with N/S/E/W suffixes). */
export function parseCoordinates(text) {
  const m = String(text)
    .trim()
    .match(/^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2] && m[2].toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() === 'W') lon = -Math.abs(lon);
  if (lon > 180) lon -= 360;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
