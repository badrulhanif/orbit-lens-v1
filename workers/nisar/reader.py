"""
Measured ground movement from NISAR GUNW products (interferograms), read
straight from NASA's cloud archive: only the 512x512 tiles over an area are
fetched, in parallel, with HTTP range requests.

  - product metadata (projection, grid, where each tile sits in the file) is
    read once per product with h5py and kept in .cache/
  - tiles are shuffle + deflate compressed; decoded here with zlib/numpy
  - movement = unwrapped phase minus the ionosphere screen, turned into mm
    along the radar's line of sight, relative to the area's median
"""

from __future__ import annotations

import json
import math
import os
import re
import struct
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor

import fsspec
import h5py
import numpy as np
import requests
from pyproj import Transformer

TOKEN = os.environ.get("EARTHDATA_TOKEN", "")
CACHE_DIR = os.environ.get(
    "NISAR_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
)
# Only NASA's NISAR archive (no arbitrary URLs).
ALLOWED = re.compile(r"^https://nisar\.asf\.earthdatacloud\.nasa\.gov/NISAR/[\w./-]+\.h5$")

# What to read from each product type: grid group, layers, centre frequency.
PRODUCTS = {
    # Interferograms (ground movement), 80 m.
    "GUNW": (
        "science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram",
        {
            "phase": "HH/unwrappedPhase",
            "coherence": "HH/coherenceMagnitude",
            "components": "HH/connectedComponents",
            "iono": "HH/ionospherePhaseScreen",
        },
        "science/LSAR/GUNW/grids/frequencyA/centerFrequency",
    ),
    # Backscatter (land cover): the 80 m band, HH and HV power (gamma0).
    "GCOV": (
        "science/LSAR/GCOV/grids/frequencyB",
        {"hh": "HHHH", "hv": "HVHV"},
        None,
    ),
}


def product(url: str) -> str:
    return "GCOV" if "_GCOV_" in url else "GUNW"
# Read whole when the area in a frame is at most this (pixels, ~80 m each:
# about 80 km a side); bigger areas are sampled in patches.
MAX_WINDOW = 1024
# Pixels below this coherence are too noisy to measure.
RELIABLE = 0.4

pool = ThreadPoolExecutor(24)  # tile downloads
pairs_pool = ThreadPoolExecutor(8)  # whole pairs (each uses `pool`)
_local = threading.local()


def _session() -> requests.Session:
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
    return _local.s


def check_url(url: str) -> str:
    if not ALLOWED.match(url):
        raise ValueError("Not a NISAR product URL")
    return url


# --------------------------------------------------------------------------
# Access: a signed download link (reused ~45 min) and per-product metadata.

_signed: dict[str, tuple[str, float]] = {}


def signed_url(url: str) -> str:
    hit = _signed.get(url)
    if hit and hit[1] > time.time():
        return hit[0]
    r = _session().get(
        url,
        headers={"Authorization": f"Bearer {TOKEN}", "Range": "bytes=0-0"},
        allow_redirects=False,
        timeout=30,
    )
    if r.status_code not in (301, 302, 303, 307, 308):
        raise RuntimeError(f"NISAR archive answered {r.status_code}")
    _signed[url] = (r.headers["Location"], time.time() + 45 * 60)
    return _signed[url][0]


_meta: dict[str, dict] = {}
_meta_lock = threading.Lock()


def metadata(url: str) -> dict:
    with _meta_lock:
        if url in _meta:
            return _meta[url]
    path = os.path.join(CACHE_DIR, url.rsplit("/", 1)[-1] + ".json")
    if os.path.exists(path):
        with open(path) as fh:
            m = json.load(fh)
    else:
        f = fsspec.filesystem("https").open(
            signed_url(url), "rb", block_size=8 << 20, cache_type="blockcache"
        )
        grid, layers, freq = PRODUCTS[product(url)]
        with h5py.File(f, "r") as h:
            if grid not in h:
                raise RuntimeError("Product has no 80 m layer to read")
            g = h[grid]
            x = g["xCoordinates"]
            y = g["yCoordinates"]
            m = {
                "epsg": int(g["projection"].attrs["epsg_code"]),
                "x0": float(x[0]),
                "dx": float(x[1] - x[0]),
                "y0": float(y[0]),
                "dy": float(y[1] - y[0]),
                "shape": list(g[next(iter(layers.values()))].shape),
                "frequency": float(h[freq][()]) if freq else None,
                "layers": {},
            }
            for name, p in layers.items():
                # Some GCOV frames are single-polarization (HH only).
                if p not in g:
                    continue
                d = g[p]
                tiles = {}
                for i in range(d.id.get_num_chunks()):
                    info = d.id.get_chunk_info(i)
                    tiles[f"{info.chunk_offset[0]},{info.chunk_offset[1]}"] = [
                        int(info.byte_offset),
                        int(info.size),
                        int(info.filter_mask),
                    ]
                m["layers"][name] = {
                    "dtype": d.dtype.str,
                    "chunk": list(d.chunks),
                    "tiles": tiles,
                }
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "w") as fh:
            json.dump(m, fh)
    with _meta_lock:
        _meta[url] = m
    return m


# --------------------------------------------------------------------------
# Reading a window of tiles.


def _tile(url: str, layer: dict, key: str) -> np.ndarray | None:
    info = layer["tiles"].get(key)
    if not info:
        return None
    off, size, mask = info
    for attempt in range(3):
        try:
            r = _session().get(
                signed_url(url),
                headers={"Range": f"bytes={off}-{off + size - 1}"},
                timeout=60,
            )
            r.raise_for_status()
            raw = r.content
            break
        except requests.RequestException:
            if attempt == 2:
                raise
    dt = np.dtype(layer["dtype"])
    # Filters: 0 = shuffle, 1 = deflate (a set mask bit means "skipped").
    if not mask & 0b10:
        raw = zlib.decompress(raw)
    a = np.frombuffer(raw, np.uint8)
    if not mask & 0b01:
        a = a.reshape(dt.itemsize, -1).T
    return np.ascontiguousarray(a).view(dt).reshape(layer["chunk"])


def read_window(url: str, m: dict, rows: tuple[int, int], cols: tuple[int, int]):
    """All four layers over rows/cols, tiles fetched in parallel."""
    r0, r1 = rows
    c0, c1 = cols
    jobs = []
    for name, layer in m["layers"].items():
        ch, cw = layer["chunk"]
        for r in range(r0 // ch * ch, r1, ch):
            for c in range(c0 // cw * cw, c1, cw):
                jobs.append((name, r, c))
    tiles = pool.map(lambda j: (j, _tile(url, m["layers"][j[0]], f"{j[1]},{j[2]}")), jobs)
    out = {}
    for name, layer in m["layers"].items():
        dt = np.dtype(layer["dtype"])
        out[name] = np.full((r1 - r0, c1 - c0), np.nan if dt.kind == "f" else 0, dt)
    for (name, r, c), block in tiles:
        if block is None:
            continue
        ch, cw = m["layers"][name]["chunk"]
        rs, re_ = max(r, r0), min(r + ch, r1)
        cs, ce = max(c, c0), min(c + cw, c1)
        out[name][rs - r0 : re_ - r0, cs - c0 : ce - c0] = block[
            rs - r : re_ - r, cs - c : ce - c
        ]
    return out


# --------------------------------------------------------------------------
# Geometry.

_transformers: dict[tuple[int, bool], Transformer] = {}


def _tr(epsg: int, inverse=False) -> Transformer:
    key = (epsg, inverse)
    if key not in _transformers:
        _transformers[key] = (
            Transformer.from_crs(epsg, 4326, always_xy=True)
            if inverse
            else Transformer.from_crs(4326, epsg, always_xy=True)
        )
    return _transformers[key]


def window_for(m: dict, bbox: list[float]):
    """Pixel window over a lon/lat box, capped at MAX_WINDOW around its centre."""
    w, s, e, n = bbox
    lons = np.linspace(w, e, 9)
    lats = np.linspace(s, n, 9)
    gx, gy = np.meshgrid(lons, lats)
    x, y = _tr(m["epsg"]).transform(gx.ravel(), gy.ravel())
    cols = (np.asarray(x) - m["x0"]) / m["dx"]
    rows = (np.asarray(y) - m["y0"]) / m["dy"]
    r0, r1 = int(np.floor(rows.min())), int(np.ceil(rows.max()))
    c0, c1 = int(np.floor(cols.min())), int(np.ceil(cols.max()))
    # The part of the box this frame covers.
    H, W = m["shape"]
    r0, r1 = max(0, r0), min(H, r1)
    c0, c1 = max(0, c0), min(W, c1)
    if r1 - r0 < 4 or c1 - c0 < 4:
        return None
    return (r0, r1), (c0, c1)


# Big areas: up to this many tile-sized patches (~40 km) per frame.
PATCHES = 3


def windows_for(m: dict, bbox: list[float]):
    """What to read from one frame: the whole part over the box when it's
    small enough, else evenly spread single-tile patches across it (a
    representative sample of a big state). Returns (windows, sampled)."""
    win = window_for(m, bbox)
    if not win:
        return [], False
    (r0, r1), (c0, c1) = win
    if r1 - r0 <= MAX_WINDOW and c1 - c0 <= MAX_WINDOW:
        return [win], False
    ch, cw = next(iter(m["layers"].values()))["chunk"]

    def spread(a, b, size):
        first, last = a // size, (b - 1) // size
        picks = np.unique(np.linspace(first, last, min(PATCHES, last - first + 1)).round())
        return [(int(k) * size, int(k) * size + size) for k in picks]

    out = []
    for ra, rb in spread(r0, r1, ch):
        for ca, cb in spread(c0, c1, cw):
            rs, re_ = max(ra, r0), min(rb, r1)
            cs, ce = max(ca, c0), min(cb, c1)
            if re_ - rs >= 4 and ce - cs >= 4:
                out.append(((rs, re_), (cs, ce)))
    return out, True


def to_lonlat_grid(m, rows, cols, values, bbox, size=400):
    """Resample a window onto a regular lon/lat grid over bbox (nearest)."""
    w, s, e, n = bbox
    aspect = (e - w) * math.cos(math.radians((s + n) / 2)) / max(n - s, 1e-9)
    W = size if aspect >= 1 else max(8, int(size * aspect))
    H = size if aspect < 1 else max(8, int(size / aspect))
    lons = w + (np.arange(W) + 0.5) * (e - w) / W
    lats = n - (np.arange(H) + 0.5) * (n - s) / H
    gx, gy = np.meshgrid(lons, lats)
    x, y = _tr(m["epsg"]).transform(gx.ravel(), gy.ravel())
    c = np.round((np.asarray(x) - m["x0"]) / m["dx"]).astype(int) - cols[0]
    r = np.round((np.asarray(y) - m["y0"]) / m["dy"]).astype(int) - rows[0]
    inside = (r >= 0) & (r < values.shape[0]) & (c >= 0) & (c < values.shape[1])
    out = np.full(H * W, np.nan, np.float32)
    out[inside] = values[r[inside], c[inside]]
    return out.reshape(H, W)


# --------------------------------------------------------------------------
# Movement.


def pair_dates(url: str):
    """Reference and secondary acquisition dates from the product name."""
    d = re.findall(r"_(\d{8})T\d{6}", url.rsplit("/", 1)[-1])
    if len(d) < 3:
        return None, None
    ref, sec = d[0], d[2]
    return f"{ref[:4]}-{ref[4:6]}-{ref[6:]}", f"{sec[:4]}-{sec[4:6]}-{sec[6:]}"


def movement_mm(url: str, bbox: list[float]):
    """Line-of-sight movement (mm, toward the satellite positive) on the
    output lon/lat grid, plus coherence; NaN where unreliable. Big areas are
    read as sampled patches, each referenced on its own."""
    m = metadata(url)
    windows, sampled = windows_for(m, bbox)
    parts = [p for p in (_window_mm(url, m, rows, cols) for rows, cols in windows) if p]
    if not parts:
        return {"cut": sampled, "coverage": 0.0} if windows else None
    n = np.array([p["n"] for p in parts], float)
    grid = _mosaic([to_lonlat_grid(m, p["rows"], p["cols"], p["mm"], bbox) for p in parts])
    return {
        "cut": sampled,
        "coverage": float(np.average([p["coverage"] for p in parts], weights=n)),
        "coherence": float(np.average([p["coherence"] for p in parts], weights=n)),
        "reliable": float(np.average([p["reliable"] for p in parts], weights=n)),
        "grid": grid,
        "frequency": m["frequency"],
    }


def _window_mm(url, m, rows, cols):
    """Movement over one window (see movement_mm)."""
    d = read_window(url, m, rows, cols)
    phase, coh, cc, iono = d["phase"], d["coherence"], d["components"], d["iono"]
    # Connected components: 0 = not unwrapped, 65535 = no data.
    valid = (
        np.isfinite(phase) & (cc > 0) & (cc != 65535) & np.isfinite(coh) & (coh > 0)
    )
    if valid.sum() < 50:
        return None
    corr = phase - np.where(np.isfinite(iono), iono, 0)
    # Phase is only relative within one connected region: use the biggest.
    main = np.bincount(cc[valid].astype(np.int64)).argmax()
    good = valid & (cc == main) & (coh >= RELIABLE)
    # Too few reliable pixels (e.g. rainforest, where 12-day pairs lose
    # coherence): report its coherence, but no movement figures.
    if good.sum() < 50:
        good = np.zeros_like(valid)
    lam = 299_792_458.0 / m["frequency"]
    # Take out the broad tilt across the area (atmosphere and orbit errors
    # show up as a gentle ramp), then measure relative to the median.
    corr = corr - _ramp(corr, good)
    # Phase increase = range increase, so minus means toward the satellite
    # (ISCE convention).
    ref = np.median(corr[good]) if good.any() else 0.0
    mm = -(corr - ref) * lam / (4 * math.pi) * 1000
    mm = np.where(good, mm, np.nan).astype(np.float32)
    return {
        "n": int(valid.sum()),
        "coverage": float(valid.mean()),
        "coherence": float(np.nanmean(np.where(valid, coh, np.nan))),
        "reliable": float(good.sum() / max(1, valid.sum())),
        "mm": mm,
        "rows": rows,
        "cols": cols,
    }


def _ramp(values: np.ndarray, good: np.ndarray) -> np.ndarray:
    """Best-fit plane through the reliable pixels (fitted on a sample)."""
    r, c = np.nonzero(good)
    if r.size < 50:
        return np.zeros_like(values)
    step = max(1, r.size // 20000)
    r, c = r[::step], c[::step]
    A = np.column_stack([np.ones(r.size), r, c])
    coef, *_ = np.linalg.lstsq(A, values[r, c], rcond=None)
    rr, cc = np.mgrid[0 : values.shape[0], 0 : values.shape[1]]
    return coef[0] + coef[1] * rr + coef[2] * cc


# A yearly rate needs this much time, or seasonal and weather noise dominate.
MIN_RATE_DAYS = 180


def _stats(values: np.ndarray, threshold: float):
    v = values[np.isfinite(values)]
    if v.size < 50:
        return None
    p5, p50, p95 = np.percentile(v, [5, 50, 95])
    return {
        "p5": round(float(p5), 1),
        "median": round(float(p50), 1),
        "p95": round(float(p95), 1),
        "moving": round(float((np.abs(v) > threshold).mean()), 4),
        "threshold": threshold,
    }


# --------------------------------------------------------------------------
# Corrections and combining frames (the core of MintPy-style processing).

_dem: dict[str, np.ndarray] = {}


def dem_grid(bbox: list[float], shape: tuple[int, int]) -> np.ndarray | None:
    """Terrain height (m) on the output lon/lat grid, from the free AWS
    terrain tiles (Terrarium PNGs)."""
    from io import BytesIO

    from PIL import Image

    key = f"{bbox}|{shape}"
    if key in _dem:
        return _dem[key]
    w, s, e, n = bbox
    H, W = shape
    z = int(np.clip(math.ceil(math.log2(360 * W / (256 * (e - w)))), 3, 12))

    def tile_xy(lon, lat, z):
        k = 2**z
        x = (lon + 180) / 360 * k
        y = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * k
        return x, y

    while True:
        x0, y0 = tile_xy(w, n, z)
        x1, y1 = tile_xy(e, s, z)
        tx = range(int(x0), int(x1) + 1)
        ty = range(int(y0), int(y1) + 1)
        if len(tx) * len(ty) <= 36 or z <= 3:
            break
        z -= 1

    def fetch(t):
        x, y = t
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
        r = _session().get(url, timeout=30)
        r.raise_for_status()
        a = np.asarray(Image.open(BytesIO(r.content)).convert("RGB"), np.float32)
        return t, a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768

    try:
        tiles = dict(pool.map(fetch, [(x, y) for x in tx for y in ty]))
    except Exception:  # noqa: BLE001  (no terrain: skip the correction)
        return None
    mosaic = np.zeros((len(ty) * 256, len(tx) * 256), np.float32)
    for (x, y), a in tiles.items():
        mosaic[(y - ty[0]) * 256 : (y - ty[0] + 1) * 256, (x - tx[0]) * 256 : (x - tx[0] + 1) * 256] = a
    lons = w + (np.arange(W) + 0.5) * (e - w) / W
    lats = n - (np.arange(H) + 0.5) * (n - s) / H
    gx, gy = np.meshgrid(lons, lats)
    px, py = tile_xy(gx, gy, z)
    c = np.clip(((px - tx[0]) * 256).astype(int), 0, mosaic.shape[1] - 1)
    r = np.clip(((py - ty[0]) * 256).astype(int), 0, mosaic.shape[0] - 1)
    out = np.maximum(mosaic[r, c], 0)
    _dem[key] = out
    return out


def tropo_correct(grid: np.ndarray, dem: np.ndarray | None) -> np.ndarray:
    """Remove the part of a pair that rises or falls with terrain height:
    the delay from water vapour, which grows with the air column below.
    Skipped on flat ground, where it can't be told from real movement."""
    if dem is None:
        return grid
    ok = np.isfinite(grid) & np.isfinite(dem)
    if ok.sum() < 200 or np.std(dem[ok]) < 50:
        return grid
    h = dem[ok]
    A = np.column_stack([np.ones(h.size), h])
    (a, k), *_ = np.linalg.lstsq(A, grid[ok], rcond=None)
    return grid - k * (dem - np.median(h))


def frame_key(url: str) -> str:
    """Track, direction and frame from the product name."""
    m = re.search(r"_GUNW_\d{3}_(\d{3})_([AD])_(\d{3})_", url.rsplit("/", 1)[-1])
    return "-".join(m.groups()) if m else url


def _pair_grid(url: str, bbox: list[float]):
    """One frame of one pair on the output grid, corrected and re-referenced."""
    res = movement_mm(url, bbox)
    if not res or "grid" not in res:
        return None
    g = tropo_correct(res["grid"], dem_grid(bbox, res["grid"].shape))
    if np.isfinite(g).sum() < 50:
        return None
    g -= np.nanmedian(g)
    return {**res, "grid": g, "lam": 299_792_458.0 / res["frequency"]}


def _mosaic(grids: list[np.ndarray]) -> np.ndarray:
    """Frames combined: each pixel from the first frame that has it."""
    out = np.full_like(grids[0], np.nan)
    for g in grids:
        take = np.isnan(out) & np.isfinite(g)
        out[take] = g[take]
    return out


def measure(urls: list[str], bbox: list[float]):
    """One 12-day pair over the area (every frame that covers it): coherence
    and movement, with a map."""
    for u in urls:
        check_url(u)
    parts = [p for p in pairs_pool.map(lambda u: _pair_grid(u, bbox), urls) if p]
    if not parts:
        return {"available": False, "reason": "No usable radar data over this area."}
    weights = np.array([np.isfinite(p["grid"]).sum() for p in parts], float)
    avg = lambda k: float(np.average([p[k] for p in parts], weights=weights))  # noqa: E731
    grid = _mosaic([p["grid"] for p in parts])
    ref, sec = pair_dates(urls[0])
    return {
        "available": True,
        "from": ref,
        "to": sec,
        "frames": len(parts),
        "coverage": round(float(np.isfinite(grid).mean()), 3),
        "coherence": round(avg("coherence"), 3),
        "reliable": round(avg("reliable"), 3),
        "cut": any(p["cut"] for p in parts),
        "movement": _stats(grid, 10.0),
        "map": png_data_url(grid, 20.0),
        "bbox": bbox,
    }


def _frame_trend(urls: list[str], bbox: list[float]):
    """Movement over time for one frame, from its pairs (MintPy-style):
    stacked rate, temporal coherence and uncertainty per pixel."""
    pairs = []
    for u, p in zip(urls, pairs_pool.map(lambda u: _pair_grid(u, bbox), urls)):
        ref, sec = pair_dates(u)
        if p and ref:
            span = int((np.datetime64(sec) - np.datetime64(ref)).astype(int))
            pairs.append((ref, sec, span, p))
    if len(pairs) < 2:
        return None
    pairs.sort(key=lambda t: t[0])
    G = np.stack([p["grid"] for *_, p in pairs])
    dt = np.array([span for _, _, span, _ in pairs], float)[:, None, None]
    valid = np.isfinite(G)
    n = valid.sum(0)
    D = np.where(valid, G, 0)
    days = np.where(valid, dt, 0).sum(0)
    total = D.sum(0)
    v = total / np.maximum(days, 1) * 365.25  # mm/yr
    # Temporal coherence: how well each pair agrees with a steady rate.
    lam = pairs[0][3]["lam"]
    resid = np.where(valid, G - v[None] / 365.25 * dt, 0)
    phase = resid / 1000 * 4 * math.pi / lam
    tcoh = np.abs(np.where(valid, np.exp(1j * phase), 0).sum(0)) / np.maximum(n, 1)
    # Uncertainty of the rate: spread of the pair rates over sqrt(n).
    rates = np.where(valid, G / dt * 365.25, np.nan)
    with np.errstate(invalid="ignore"):
        sigma = np.nanstd(rates, 0) / np.sqrt(np.maximum(n, 1))
    ok = (n >= max(2, len(pairs) // 2)) & (tcoh >= 0.7)
    return {
        "from": pairs[0][0],
        "to": pairs[-1][1],
        "pairs": len(pairs),
        "total": np.where(ok, total, np.nan),
        "rate": np.where(ok, v, np.nan),
        "sigma": np.where(ok, sigma, np.nan),
        "tcoh_ok": float(ok.sum() / max(1, (n > 0).sum())),
    }


def rate(urls: list[str], bbox: list[float]):
    """Trend over several 12-day pairs, every frame over the area: total
    movement, and the yearly rate once there's 6 months of data."""
    for u in urls:
        check_url(u)
    frames: dict[str, list[str]] = {}
    for u in urls:
        frames.setdefault(frame_key(u), []).append(u)
    trends = [t for t in (_frame_trend(us, bbox) for us in frames.values()) if t]
    if not trends:
        return {"available": False, "reason": "No usable radar pairs over this area."}
    start = min(t["from"] for t in trends)
    end = max(t["to"] for t in trends)
    span = int((np.datetime64(end) - np.datetime64(start)).astype(int))
    total = _mosaic([t["total"] for t in trends])
    velocity = _mosaic([t["rate"] for t in trends])
    sigma = _mosaic([t["sigma"] for t in trends])
    yearly = span >= MIN_RATE_DAYS
    s = sigma[np.isfinite(sigma)]
    typical = float(np.median(s)) if s.size else None
    return {
        "available": True,
        "pairs": max(t["pairs"] for t in trends),
        "frames": len(trends),
        "from": start,
        "to": end,
        "days": span,
        "total": _stats(total, 20.0),
        "rate": _stats(velocity, 20.0) if yearly else None,
        # Typical ± of the rate (mm/yr), or of the total (mm).
        "uncertainty": None
        if typical is None
        else round(typical if yearly else typical * span / 365.25, 1),
        # Share of measured pixels that behave consistently over time.
        "consistent": round(float(np.mean([t["tcoh_ok"] for t in trends])), 3),
        "map": png_data_url(velocity if yearly else total, 50.0 if yearly else 30.0),
        "mapOf": "rate" if yearly else "total",
        "bbox": bbox,
    }


# --------------------------------------------------------------------------
# Land cover from backscatter (GCOV), measured.
#
# L-band gamma0 thresholds (dB), from the radar literature:
#   water       HH < -15 and HV < -20   smooth surfaces reflect the pulse away
#   built       HH > -3 with HV > -14 (or HH > -4.5 with HV > -9)
#                                      walls and ground bounce it back
# Checked on NISAR samples: KL (built), Ulu Gombak, North Selangor and
# Maludam peat swamp (97-98% vegetation), Matang and Kuala Selangor mangroves,
# Kedah and Sekinchan paddy.
#   vegetation  HV > -16                canopies scatter in all directions
#   open land   the rest                bare soil, short crops, grass

WATER, VEGETATION, OPEN, BUILT = 0, 1, 2, 3
CLASS_NAMES = ["water", "vegetation", "open", "built"]


def _data_file(name: str):
    """data/ files shipped with the app (Docker copies them next to us)."""
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, name), os.path.join(here, "../../data", name)):
        if os.path.exists(path):
            with open(path) as fh:
                return json.load(fh)
    return None


_masks: dict[str, object] = {}


def _rings(kind: str):
    if kind not in _masks:
        if kind == "land":
            d = _data_file("land.json")
            _masks[kind] = d["rings"] if d else None
        else:
            _masks[kind] = _data_file("boundaries.json")
    return _masks[kind]


def raster_mask(rings, bbox, shape) -> np.ndarray:
    """1 inside the rings (even-odd), on the output lon/lat grid."""
    w, s, e, n = bbox
    H, W = shape
    mask = np.zeros(shape, np.uint8)
    lats = n - (np.arange(H) + 0.5) * (n - s) / H
    for ring in rings:
        r = np.asarray(ring, float)
        if r[:, 0].max() < w or r[:, 0].min() > e or r[:, 1].max() < s or r[:, 1].min() > n:
            continue
        x1, y1 = r[:, 0], r[:, 1]
        x2, y2 = np.roll(x1, 1), np.roll(y1, 1)
        for row, lat in enumerate(lats):
            cross = (y1 > lat) != (y2 > lat)
            if not cross.any():
                continue
            xs = np.sort(x1[cross] + (lat - y1[cross]) * (x2[cross] - x1[cross]) / (y2[cross] - y1[cross]))
            for a, b in zip(xs[0::2], xs[1::2]):
                c0 = max(0, int(math.ceil((a - w) / (e - w) * W - 0.5)))
                c1 = min(W - 1, int(math.floor((b - w) / (e - w) * W - 0.5)))
                if c1 >= c0:
                    mask[row, c0 : c1 + 1] ^= 1
    return mask


def area_mask(bbox, shape, boundary: str | None) -> np.ndarray:
    """Land (no sea), inside the state or district outline when given."""
    land = _rings("land")
    out = np.ones(shape, bool)
    if land:
        on = np.zeros(shape, bool)
        for ring in land:  # each on its own: islands overlap the main land
            on |= raster_mask([ring], bbox, shape).astype(bool)
        out &= on
    outlines = _rings("boundaries")
    if boundary and outlines and outlines.get(boundary):
        out &= raster_mask(outlines[boundary], bbox, shape).astype(bool)
    return out


# Pixels (80 m) dropped along each swath edge: the outer ~2 km of a swath
# sits near the radar's noise floor and reads too dark.
SWATH_EDGE = 25


def _erode(valid: np.ndarray, k: int) -> np.ndarray:
    """Shrink the valid area by k pixels from its edges with no data. The
    window's own border isn't a swath edge, so it isn't shrunk."""
    out = valid.copy()
    for axis in (0, 1):
        for step in range(1, k + 1):
            for sign in (1, -1):
                shifted = np.roll(valid, sign * step, axis=axis)
                edge = slice(0, step) if sign > 0 else slice(-step, None)
                if axis == 0:
                    shifted[edge, :] = True
                else:
                    shifted[:, edge] = True
                out &= shifted
    return out


def _backscatter(url: str, bbox: list[float]):
    """HH and HV power over the box (sampled patches for big areas). None
    for frames without both (HH-only products can't be classified)."""
    m = metadata(url)
    if not all(k in m["layers"] for k in ("hh", "hv")):
        print(f"[nisar] skipping single-polarization frame {url.rsplit('/', 1)[-1]}", flush=True)
        return None
    windows, sampled = windows_for(m, bbox)
    if not windows:
        return None
    grids: dict[str, list[np.ndarray]] = {"hh": [], "hv": []}
    for rows, cols in windows:
        d = read_window(url, m, rows, cols)
        valid = np.ones(d["hh"].shape, bool)
        for k in grids:
            valid &= np.isfinite(d[k]) & (d[k] > 0)
        # Swath edges are noisy and dark (they'd read as a line of water
        # where two swaths meet); let the neighbouring swath fill in.
        valid = _erode(valid, SWATH_EDGE)
        for k in grids:
            v = np.where(valid, d[k], np.nan)
            grids[k].append(to_lonlat_grid(m, rows, cols, v, bbox))
    return {"cut": sampled, **{k: _mosaic(v) for k, v in grids.items()}}


def _date_of(url: str):
    d = re.search(r"_(\d{8})T\d{6}", url.rsplit("/", 1)[-1])
    return f"{d[1][:4]}-{d[1][4:6]}-{d[1][6:]}" if d else None


def _classes(hh: np.ndarray, hv: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        h = 10 * np.log10(hh)
        v = 10 * np.log10(hv)
    c = np.full(hh.shape, -1, np.int8)
    ok = np.isfinite(h) & np.isfinite(v)
    c[ok] = OPEN
    c[ok & (v > -16)] = VEGETATION
    # Calibrated on NISAR over KL: built-up HH median 0 dB (90% > -3.8),
    # forest -5 dB, oil palm -6 dB.
    # Young rice standing in water also bounces HH brightly but stays dim in
    # HV (-15 dB in Kedah), so built-up needs bright HV too.
    c[ok & (((h > -3) & (v > -14)) | ((h > -4.5) & (v > -9)))] = BUILT
    # Wind roughens open water a little (sea HH median -13 dB over KL's coast).
    c[ok & (h < -15) & (v < -20)] = WATER
    return c


def cover(a_urls: list[str], b_urls: list[str], bbox: list[float], boundary=None):
    """Land cover on two dates (each: every frame over the area) and what
    changed, measured from the full backscatter product."""
    for u in a_urls + b_urls:
        check_url(u)
    dates = []
    for urls in (a_urls, b_urls):
        parts = [p for p in pairs_pool.map(lambda u: _backscatter(u, bbox), urls) if p]
        if not parts:
            return {"available": False, "reason": "No usable radar data over this area."}
        dates.append(
            {
                "hh": _mosaic([p["hh"] for p in parts]),
                "hv": _mosaic([p["hv"] for p in parts]),
                "cut": any(p["cut"] for p in parts),
                "date": _date_of(urls[0]),
                "frames": len(parts),
            }
        )
    A, B = dates
    shape = A["hh"].shape
    inside = area_mask(bbox, shape, boundary)
    ca = np.where(inside, _classes(A["hh"], A["hv"]), -1)
    cb = np.where(inside, _classes(B["hh"], B["hv"]), -1)
    both = (ca >= 0) & (cb >= 0)
    if both.sum() < 100:
        return {"available": False, "reason": "The two dates barely overlap here."}
    # Area of one output pixel (km²).
    w, s, e, n = bbox
    H, W = shape
    km2 = ((e - w) / W * 111.32 * math.cos(math.radians((s + n) / 2))) * ((n - s) / H * 110.57)

    def summary(c, d):
        with np.errstate(invalid="ignore", divide="ignore"):
            rvi = 4 * d["hv"] / (d["hh"] + d["hv"])
        return {
            "date": d["date"],
            **{name: round(float((c[both] == i).sum() * km2), 1) for i, name in enumerate(CLASS_NAMES)},
            # Dual-pol Radar Vegetation Index (0 bare … 1 dense canopy).
            "rvi": round(float(np.nanmean(rvi[both])), 3),
        }

    # A change counts only with a clear jump in brightness (3 dB, i.e. half
    # or double), so pixels near a class boundary don't flicker.
    with np.errstate(divide="ignore", invalid="ignore"):
        d_hh = 10 * np.log10(B["hh"] / A["hh"])
        d_hv = 10 * np.log10(B["hv"] / A["hv"])
    new_water = both & (cb == WATER) & (ca != WATER) & (d_hh < -3)
    receded = both & (ca == WATER) & (cb != WATER) & (d_hh > 3)
    veg_lost = both & (ca == VEGETATION) & (cb == OPEN) & (d_hv < -3)
    veg_gain = both & (ca == OPEN) & (cb == VEGETATION) & (d_hv > 3)
    rgba = np.zeros(shape + (4,), np.uint8)
    for m_, colour in (
        (new_water, (37, 99, 235)),
        (receded, (125, 211, 252)),
        (veg_lost, (234, 88, 12)),
        (veg_gain, (22, 163, 74)),
    ):
        rgba[m_] = (*colour, 220)
    return {
        "pol": _polarizations(A, B, ca, cb, both, d_hh, d_hv),
        "images": _pol_images(A, B, both, d_hh, d_hv),
        "available": True,
        "a": summary(ca, A),
        "b": summary(cb, B),
        "newWater": round(float(new_water.sum() * km2), 1),
        "receded": round(float(receded.sum() * km2), 1),
        "vegLost": round(float(veg_lost.sum() * km2), 1),
        "vegGained": round(float(veg_gain.sum() * km2), 1),
        "measured": round(float(both.sum() * km2), 1),
        "cut": A["cut"] or B["cut"],
        "frames": max(A["frames"], B["frames"]),
        "map": _png(rgba),
        "bbox": bbox,
    }


def _median_db(values: np.ndarray, where: np.ndarray):
    v = values[where & np.isfinite(values)]
    return round(float(np.median(v)), 2) if v.size >= 50 else None


def _polarizations(A, B, ca, cb, both, d_hh, d_hv):
    """What each polarization shows, in dB (medians over measured land).

    HH (sent and received horizontally) is strongest from buildings and from
    flooded trees, where the wave bounces off the water and back off the
    trunks ("double bounce"). HV (received the other way) comes from the
    jumble of branches and leaves, so it follows how much vegetation there
    is. Water is dark in both.
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        db = {
            when: {k: 10 * np.log10(d[k]) for k in ("hh", "hv")}
            for when, d in (("a", A), ("b", B))
        }
    veg = both & (ca == VEGETATION) & (cb == VEGETATION)
    open_ = both & (ca == OPEN) & (cb == OPEN)
    return {
        **{
            when: {k: _median_db(v, both) for k, v in pols.items()}
            for when, pols in db.items()
        },
        # Change where the cover stayed the same: flooding under the canopy
        # (HH up, HV steady), canopy thinning (HV down), wetter soil (HH up
        # on open land: water raises the ground's dielectric constant).
        "vegHH": _median_db(d_hh, veg),
        "vegHV": _median_db(d_hv, veg),
        "openHH": _median_db(d_hh, open_),
        "openHV": _median_db(d_hv, open_),
        "vegPixels": int(veg.sum()),
        "openPixels": int(open_.sum()),
    }


def _grey(db: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.nan_to_num(np.clip((db - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)


def _pol_images(A, B, both, d_hh, d_hv):
    """Pictures of the later date in each polarization, a colour mix, and
    how each polarization changed (blue = brighter, red = darker)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        hh = 10 * np.log10(B["hh"])
        hv = 10 * np.log10(B["hv"])
    ok = both & np.isfinite(hh) & np.isfinite(hv)
    alpha = np.where(ok, 230, 0).astype(np.uint8)

    def grey(db, lo, hi):
        g = _grey(db, lo, hi)
        return _png(np.dstack([g, g, g, alpha]))

    # Dual-pol colour mix: red HH, green HV, blue HH/HV.
    rgb = np.dstack(
        [
            _grey(hh, -20, 2),
            _grey(hv, -26, -8),
            _grey(hh - hv, 2, 14),
            alpha,
        ]
    )

    def change(d):
        img = _colour(np.where(ok, d, np.nan), 6)
        return _png(img)

    return {
        "hh": grey(hh, -20, 2),
        "hv": grey(hv, -26, -8),
        "rgb": _png(rgb),
        # _colour: blue = positive (brighter), red = negative (darker).
        "dhh": change(d_hh),
        "dhv": change(d_hv),
    }


# --------------------------------------------------------------------------
# A small PNG encoder (no image libraries needed).


def _colour(values: np.ndarray, limit: float) -> np.ndarray:
    """Blue = toward the satellite (rising), red = away (sinking), white =
    no change; transparent = no data."""
    t = np.clip(values / limit, -1, 1)
    rgba = np.zeros(values.shape + (4,), np.uint8)
    toward = np.nan_to_num(np.clip(t, 0, 1))
    away = np.nan_to_num(np.clip(-t, 0, 1))
    rgba[..., 0] = (255 - toward * 205).astype(np.uint8)
    rgba[..., 1] = (255 - (toward + away) * 190).astype(np.uint8)
    rgba[..., 2] = (255 - away * 205).astype(np.uint8)
    rgba[..., 3] = np.where(np.isfinite(values), 210, 0).astype(np.uint8)
    return rgba


def png_data_url(values: np.ndarray, limit: float) -> str:
    return _png(_colour(values, limit))


def _png(rgba: np.ndarray) -> str:
    import base64

    h, w = rgba.shape[:2]
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode()
