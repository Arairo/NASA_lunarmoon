#!/usr/bin/env python3
"""Build the lunar south-pole elevation grids that Lunar Site Planner ships.

Source: LRO LOLA RDR laser-altimeter shots (Moon-centred, Moon-fixed XYZ in
metres), streamed as Cloud-Optimized Point Clouds from the USGS Astrogeology
Analysis Ready Data bucket (s3://astrogeo-ard/moon/lro/lola/). Only the upper
octree levels are read, so the whole build pulls a few hundred MB, not 4 GB.

Output grids are south polar stereographic on the 1737.4 km lunar sphere
(IAU_2015:30100, the same projection as the LROC WAC polar mosaic):

    rho = 2 R tan(pi/4 + lat/2);  x = rho sin(lon);  y = rho cos(lon)

Each grid is little-endian int16 heights in metres above 1737.4 km, row 0 at
+y (lon 0 at the top), column 0 at -x. A JSON sidecar records the geometry.

Usage:  python build_polar_dem.py OUT_DIR
Needs:  pip install "laspy[lazrs]" requests numpy scipy
"""
import json
import math
import sys
import time

import laspy
import numpy as np
from scipy import ndimage

R = 1737400.0
BASE = "https://astrogeo-ard.s3.us-west-2.amazonaws.com/moon/lro/lola/"
NODATA = -32768
RHO_LIMIT = 2 * R * math.tan(math.pi / 4 + math.radians(-75.0) / 2)  # 75 S in projected metres
FILES = [f"LolaRDR_-90N-75N_{lo}E{lo + 15}E.copc.laz" for lo in range(0, 360, 15)]

# name, half-extent (m), cell size (m), deepest COPC level read inside it
GRIDS = [
    ("sp_fine", 180_000.0, 240.0, 7),
    ("sp_coarse", 460_000.0, 1000.0, 5),
]


def project(x, y, z):
    r = np.sqrt(x * x + y * y + z * z)
    lat = np.arcsin(z / r)
    lon = np.arctan2(y, x)
    rho = 2 * R * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon), r - R


class Accumulator:
    def __init__(self, name, half, cell, level):
        self.name, self.half, self.cell, self.level = name, half, cell, level
        self.n = int(round(2 * half / cell))
        self.sum = np.zeros(self.n * self.n)
        self.cnt = np.zeros(self.n * self.n)

    def add(self, px, py, h):
        col = np.floor((px + self.half) / self.cell).astype(np.int64)
        row = np.floor((self.half - py) / self.cell).astype(np.int64)
        ok = (col >= 0) & (col < self.n) & (row >= 0) & (row < self.n)
        idx = row[ok] * self.n + col[ok]
        self.sum += np.bincount(idx, weights=h[ok], minlength=self.n * self.n)
        self.cnt += np.bincount(idx, minlength=self.n * self.n)

    def finish(self, out_dir):
        grid = np.full(self.n * self.n, np.nan)
        has = self.cnt > 0
        grid[has] = self.sum[has] / self.cnt[has]
        grid = grid.reshape(self.n, self.n)
        filled = ~np.isnan(grid)
        coverage = filled.mean()
        # Nearest-neighbour fill of the gaps between LOLA ground tracks, then a
        # light 3x3 mean over only the filled cells to soften the seams.
        _, (ri, ci) = ndimage.distance_transform_edt(~filled, return_indices=True)
        nn = grid[ri, ci]
        smooth = ndimage.uniform_filter(nn, size=3)
        out = np.where(filled, grid, smooth)
        # Cells beyond the source band (LOLA files stop at 75 S) get the no-data
        # sentinel instead of extrapolated heights.
        half_c = (np.arange(self.n) + 0.5) * self.cell - self.half
        gx, gy = np.meshgrid(half_c, -half_c)
        outside = np.hypot(gx, gy) > RHO_LIMIT
        out = np.where(outside, np.nan, out)
        heights = np.clip(np.round(np.nan_to_num(out, nan=NODATA)), -32768, 32767).astype("<i2")
        heights.tofile(f"{out_dir}/{self.name}.bin")
        meta = {
            "name": self.name,
            "projection": "south-polar-stereographic",
            "radius": R,
            "halfExtent": self.half,
            "cellSize": self.cell,
            "size": self.n,
            "dtype": "int16-le",
            "noData": NODATA,
            "units": "metres above 1737.4 km sphere",
            "rowOrder": "row 0 at +y (lon 0 up), column 0 at -x",
            "minHeight": float(np.nanmin(out)),
            "maxHeight": float(np.nanmax(out)),
            "directCoverage": round(float(coverage), 4),
            "source": "LRO LOLA RDR via USGS Astrogeology ARD (s3://astrogeo-ard/moon/lro/lola/)",
        }
        with open(f"{out_dir}/{self.name}.json", "w") as fh:
            json.dump(meta, fh, indent=2)
        print(self.name, meta, flush=True)


def main(out_dir):
    accs = [Accumulator(*g) for g in GRIDS]
    max_level = max(a.level for a in accs)
    t0 = time.time()
    for name in FILES:
        with laspy.CopcReader.open(BASE + name) as reader:
            for level in range(0, max_level + 1):
                targets = [a for a in accs if a.level >= level]
                half = max(a.half for a in targets)
                if level <= 5:
                    pts = reader.query(level=level)
                else:
                    # Deep levels only inside the fine grid's footprint. Near the
                    # pole Moon-fixed x/y track the projected coordinates closely,
                    # so a slightly padded x/y box is a safe superset.
                    pad = half * 1.08
                    bounds = laspy.copc.Bounds(
                        mins=np.array([-pad, -pad, -R - 20000]),
                        maxs=np.array([pad, pad, -R + 20000]),
                    )
                    pts = reader.query(bounds=bounds, level=level)
                if len(pts) == 0:
                    continue
                px, py, h = project(
                    np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)
                )
                for a in targets:
                    a.add(px, py, h)
                print(f"{name} L{level}: {len(pts):>9} pts  {time.time() - t0:6.0f}s", flush=True)
    for a in accs:
        a.finish(out_dir)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
