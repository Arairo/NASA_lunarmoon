#!/usr/bin/env python3
"""Cut the LROC WAC imagery Lunar Site Planner ships (public-domain NASA/LROC data).

1. moon_wac_global_4k.jpg : global equirectangular, lon -180..180, 4096x2048,
   used as the offline Moon texture when Cesium ion is unavailable.
2. sp_wac_450m.jpg : south-polar stereographic crop of +/-460 km at ~450 m/px,
   the same frame as sp_coarse.bin, for the 2D polar map.
3. sp_wac_geo.jpg : the polar mosaic resampled to geographic lat -90..-75,
   lon -180..180 (4096x1024), draped on the 3D globe at the south pole.

Source: s3://astrogeo-ard/moon/basemaps/lroc_wac_mosaic/ (USGS Astrogeology ARD).
Usage:  python build_imagery.py OUT_DIR      Needs: pip install rasterio pillow numpy
"""
import sys

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

BASE = "/vsicurl/https://astrogeo-ard.s3.us-west-2.amazonaws.com/moon/basemaps/lroc_wac_mosaic/"


def stretch(a):
    lo, hi = np.percentile(a[a > 0], [0.5, 99.7])
    return (np.clip((a.astype(float) - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)


def main(out):
    with rasterio.open(BASE + "lroc_wac_mosaic_global_303ppd_v3/lroc_wac_mosaic_global_303ppd_v3.tif") as d:
        a = d.read(1, out_shape=(2048, 4096), resampling=Resampling.average)
    # The mosaic's central meridian is 180, so column 0 is lon 0; roll to -180..180.
    a = np.roll(a, 2048, axis=1)
    Image.fromarray(stretch(a)).save(f"{out}/moon_wac_global_4k.jpg", quality=86, optimize=True)

    half = 460_000.0
    with rasterio.open(BASE + "lroc_wac_mosaic_spole60_100m_v2/lroc_wac_mosaic_spole60_100m_v2.tif") as d:
        w = from_bounds(-half, -half, half, half, d.transform)
        a = d.read(1, window=w, out_shape=(2048, 2048), resampling=Resampling.average)
    Image.fromarray(stretch(a)).save(f"{out}/sp_wac_450m.jpg", quality=86, optimize=True)

    # Geographic drape: read the stereographic mosaic at ~220 m, then sample it
    # at each output lat/lon with the IAU south-polar stereographic formula.
    from scipy.ndimage import map_coordinates

    R = 1737400.0
    half = 470_000.0
    src_n = 4272
    with rasterio.open(BASE + "lroc_wac_mosaic_spole60_100m_v2/lroc_wac_mosaic_spole60_100m_v2.tif") as d:
        w = from_bounds(-half, -half, half, half, d.transform)
        src = d.read(1, window=w, out_shape=(src_n, src_n), resampling=Resampling.average).astype(float)
    W, H = 4096, 1024
    lon = np.radians(-180 + (np.arange(W) + 0.5) * 360 / W)
    lat = np.radians(-75 - (np.arange(H) + 0.5) * 15 / H)
    LON, LAT = np.meshgrid(lon, lat)
    rho = 2 * R * np.tan(np.pi / 4 + LAT / 2)
    x = rho * np.sin(LON)
    y = rho * np.cos(LON)
    cell = 2 * half / src_n
    cols = (x + half) / cell - 0.5
    rows = (half - y) / cell - 0.5
    geo = map_coordinates(src, [rows, cols], order=1, mode="nearest")
    Image.fromarray(stretch(geo)).save(f"{out}/sp_wac_geo.jpg", quality=84, optimize=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
