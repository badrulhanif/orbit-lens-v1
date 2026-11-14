"""
RCM (Canadian Space Agency) C-band radar over Masamba, Indonesia, 18 Jul 2020:
five days after the 13 Jul 2020 flash flood and mudflow in North Luwu, South
Sulawesi (International Charter call 763). Open data, from
https://donnees-data.asc-csa.gc.ca/users/OpenData_DonneesOuvertes/pub/RCM/RCM/763/

Makes:
  public/rcm/masamba-2020-07-18-hh.webp   map overlay (HH, grey), corners in lib/rcm.ts
  public/findings/masamba-rcm-hh.png      findings crop, RCM C-band HH

Steps: calibrate DN to sigma0 with the product's LUT (sigma0 = DN² / gain),
3x3 average to calm speckle, then place each output pixel by the product's
tie points. The tie points sit on a fixed 1,138 m surface; real ground is
lower, so (side-looking radar) it appears further out in range. That shift,
(1138 m − terrain height) / tan(incidence), is taken off using the AWS
terrain tiles (the same DEM the NISAR service uses).

Run (needs GDAL's command-line tools and the NISAR service's Python env):
  curl -k -O <the RCM1_…_SC30MHVC_20200718_214402_HH_VV_GRD.zip above>
  unzip RCM1_…zip -d /tmp/rcm
  workers/nisar/.venv/bin/python scripts/rcm/masamba.py /tmp/rcm/RCM1_…_GRD
"""

import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "workers", "nisar"))
from reader import dem_grid  # noqa: E402

# Map overlay: North Luwu, Masamba to the Bone Gulf coast (west, south, east, north).
OVERLAY_BBOX = [119.95, -2.95, 120.5, -2.3]
OVERLAY_RES = 0.00025  # ° (~28 m, about the product's 30 m resolution)
# Findings crop: Masamba and the Masamba / Radda river fans.
CROP_BBOX = [120.12, -2.7, 120.4, -2.42]
LO_DB, HI_DB = -22.0, 2.0


def floats(xml: str, tag: str) -> np.ndarray:
    return np.array([float(v) for v in re.findall(rf"<{tag}[^>]*>([^<]+)<", xml)])


def lut(path: str, tag: str):
    x = open(path).read()
    first = int(re.search(r"<pixelFirst\w*>(-?\d+)<", x)[1])
    step = int(re.search(r"<stepSize>(-?\d+)<", x)[1])
    if tag == "gains":
        vals = np.array(re.search(r"<gains>([^<]+)<", x)[1].split(), float)
    else:
        vals = floats(x, tag)
    px = first + step * np.arange(vals.size)
    order = np.argsort(px)
    return px[order], vals[order]


def read_band(product: str, pol: str, tmp: str) -> np.ndarray:
    tif = os.path.join(product, "imagery", next(f for f in os.listdir(os.path.join(product, "imagery")) if f.endswith(f"_{pol}.tif")))
    raw = os.path.join(tmp, f"{pol}.raw")
    subprocess.run(["gdal_translate", "-q", "-of", "ENVI", tif, raw], check=True)
    hdr = open(raw.rsplit(".", 1)[0] + ".hdr" if os.path.exists(raw.rsplit(".", 1)[0] + ".hdr") else raw + ".hdr").read()
    w = int(re.search(r"samples\s*=\s*(\d+)", hdr)[1])
    h = int(re.search(r"lines\s*=\s*(\d+)", hdr)[1])
    return np.fromfile(raw, np.uint16).reshape(h, w)


def poly_terms(x, y, order=3):
    return np.column_stack([x**i * y**j for i in range(order + 1) for j in range(order + 1 - i)])


def box3(a: np.ndarray) -> np.ndarray:
    p = np.pad(a, 1, mode="edge")
    out = np.zeros_like(a)
    for dy in range(3):
        for dx in range(3):
            out += p[dy : dy + a.shape[0], dx : dx + a.shape[1]]
    return out / 9


def main(product: str):
    meta = open(os.path.join(product, "metadata", "product.xml")).read()
    tp = re.findall(
        r"<imageTiePoint>.*?<line>([^<]+)</line>.*?<pixel>([^<]+)</pixel>.*?<latitude[^>]*>([^<]+)<.*?<longitude[^>]*>([^<]+)<.*?<height[^>]*>([^<]+)<",
        meta,
        re.S,
    )
    tp = np.array(tp, float)
    line, pixel, lat, lon, h0 = tp.T
    ref_h = float(np.median(h0))
    # Ground position → image position (cubic fit over the tie points).
    A = poly_terms(lon - 120, lat + 2)
    c_line, *_ = np.linalg.lstsq(A, line, rcond=None)
    c_pix, *_ = np.linalg.lstsq(A, pixel, rcond=None)
    fit_err = np.hypot(A @ c_line - line, A @ c_pix - pixel).max()
    print(f"tie points {len(tp)}, reference height {ref_h:.0f} m, fit error {fit_err:.2f} px")

    cal = os.path.join(product, "metadata", "calibration")
    inc_px, inc = lut(os.path.join(cal, "incidenceAngles.xml"), "angles")
    spacing = float(re.search(r"<sampledPixelSpacing[^>]*>([^<]+)<", meta)[1])

    with tempfile.TemporaryDirectory() as tmp:
        bands = {}
        for pol in ("HH",):
            dn = read_band(product, pol, tmp)
            g_px, gains = lut(os.path.join(cal, f"lutSigma_{pol}.xml"), "gains")
            gain = np.interp(np.arange(dn.shape[1]), g_px, gains)
            bands[pol] = (dn, gain)

        def render(bbox, res, pols=("HH",)):
            w, s, e, n = bbox
            W, H = int(round((e - w) / res)), int(round((n - s) / res))
            lons = w + (np.arange(W) + 0.5) * res
            lats = n - (np.arange(H) + 0.5) * res
            gx, gy = np.meshgrid(lons, lats)
            T = poly_terms(gx.ravel() - 120, gy.ravel() + 2)
            li = (T @ c_line).reshape(H, W)
            pi = (T @ c_pix).reshape(H, W)
            dem = dem_grid(bbox, (H, W))
            if dem is None:
                raise SystemExit("terrain tiles unreachable")
            theta = np.radians(np.interp(pi, inc_px, inc))
            # Lower ground appears further out in range: far range is lower
            # pixel numbers here (pixel time ordering "Decreasing").
            far = -1 if "<pixelTimeOrdering>Decreasing" in meta else 1
            pi = pi + far * (ref_h - dem) / np.tan(theta) / spacing
            out = {}
            for pol in pols:
                dn, gain = bands[pol]
                r0, r1 = int(max(li.min() - 3, 0)), int(min(li.max() + 4, dn.shape[0]))
                c0, c1 = int(max(pi.min() - 3, 0)), int(min(pi.max() + 4, dn.shape[1]))
                win = dn[r0:r1, c0:c1].astype(np.float64)
                sigma = box3(win**2 / gain[c0:c1])
                sigma[win == 0] = np.nan
                r = np.round(li - r0).astype(int)
                c = np.round(pi - c0).astype(int)
                ok = (r >= 0) & (r < sigma.shape[0]) & (c >= 0) & (c < sigma.shape[1])
                v = np.full((H, W), np.nan)
                v[ok] = sigma[r[ok], c[ok]]
                with np.errstate(divide="ignore", invalid="ignore"):
                    out[pol] = 10 * np.log10(v)
            return out

        def grey(db):
            g = np.nan_to_num(np.clip((db - LO_DB) / (HI_DB - LO_DB), 0, 1) * 255).astype(np.uint8)
            a = np.where(np.isfinite(db), 255, 0).astype(np.uint8)
            return Image.fromarray(np.dstack([g, g, g, a]), "RGBA")

        os.makedirs(os.path.join(ROOT, "public", "rcm"), exist_ok=True)
        big = render(OVERLAY_BBOX, OVERLAY_RES, ("HH",))
        grey(big["HH"]).save(os.path.join(ROOT, "public", "rcm", "masamba-2020-07-18-hh.webp"), quality=80, method=6)
        crop = render(CROP_BBOX, (CROP_BBOX[2] - CROP_BBOX[0]) / 400, ("HH",))
        for pol, db in crop.items():
            grey(db).save(os.path.join(ROOT, "public", "findings", f"masamba-rcm-{pol.lower()}.png"), optimize=True)
            # dB values, for checking the alignment against NISAR.
            np.save(os.path.join(tempfile.gettempdir(), f"masamba-rcm-{pol.lower()}.npy"), db)
            v = db[np.isfinite(db)]
            print(f"{pol}: median {np.median(v):.1f} dB, {np.isfinite(db).mean():.0%} of crop covered")


if __name__ == "__main__":
    main(sys.argv[1])
