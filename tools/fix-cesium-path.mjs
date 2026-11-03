#!/usr/bin/env node
// vite-plugin-cesium copies CesiumJS into <outDir>/<base>/cesium when a base
// path is set (for example /NASA_lunarmoon/ on GitHub Pages),
// but the page loads it from <base>/cesium, which is <outDir>/cesium on the
// server. Move the folder to where the page expects it. No-op without a base.
//
//   node tools/fix-cesium-path.mjs [outDir=dist]

import { existsSync, renameSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const outDir = process.argv[2] ?? 'dist';
const base = (process.env.BASE_PATH || '/').replace(/^\/+|\/+$/g, '');
if (!base) process.exit(0);

const misplaced = join(outDir, base, 'cesium');
const target = join(outDir, 'cesium');
if (existsSync(misplaced)) {
  rmSync(target, { recursive: true, force: true });
  renameSync(misplaced, target);
  // Remove the now-empty base folders only (rmdir refuses non-empty folders).
  for (let dir = join(outDir, base); dir !== outDir && dir !== '.'; dir = dirname(dir)) {
    try {
      rmdirSync(dir);
    } catch {
      break;
    }
  }
  console.log(`moved ${misplaced} -> ${target}`);
} else if (!existsSync(target)) {
  console.error(`CesiumJS not found in ${misplaced} or ${target}`);
  process.exit(1);
}
