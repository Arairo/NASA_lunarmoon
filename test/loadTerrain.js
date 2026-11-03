// Node-side loader for the shipped LOLA grids (the browser uses fetch).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGrid, createTerrain } from '../src/core/horizon.js';

const dataDir = fileURLToPath(new URL('../public/data/', import.meta.url));

export function loadTerrainSync(names = ['sp_fine', 'sp_coarse']) {
  return createTerrain(
    names.map((name) => {
      const meta = JSON.parse(readFileSync(`${dataDir}${name}.json`, 'utf8'));
      const buf = readFileSync(`${dataDir}${name}.bin`);
      return createGrid(meta, new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
    }),
  );
}
