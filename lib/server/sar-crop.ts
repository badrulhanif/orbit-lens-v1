import type { Bbox } from "@/lib/area"
import { loadScene } from "@/lib/server/nisar"
import { loadSharp, parseBbox, TtlCache } from "@/lib/server/util"

/**
 * Cut NISAR images down to one area, for side-by-side date comparison.
 *  - Ground movement: crop of a GUNW browse image (ASF), placed by its corners
 *  - Brightness: NASA GIBS WMS render of the GCOV backscatter for one day
 * Every crop of the same area comes out the same size and covers the same
 * box, so two dates line up exactly.
 */

const MAX_SIDE = 560

/** Output size for an area, keeping its real-world proportions. */
function cropSize([w, s, e, n]: Bbox) {
  const midLat = ((s + n) / 2) * (Math.PI / 180)
  const aspect = ((e - w) * Math.cos(midLat)) / (n - s)
  return aspect >= 1
    ? { width: MAX_SIDE, height: Math.max(120, Math.round(MAX_SIDE / aspect)) }
    : { width: Math.max(120, Math.round(MAX_SIDE * aspect)), height: MAX_SIDE }
}

const crops = new TtlCache<Buffer>(80)
const cached = (key: string, make: () => Promise<Buffer>) =>
  crops.get(key, make)

/** A GUNW browse image cut to the area (transparent where it has no data). */
export function cropMovement(granule: string, bbox: Bbox) {
  return cached(`m|${granule}|${bbox.join(",")}`, async () => {
    const sharp = await loadSharp()
    const { png, scene } = await loadScene(granule)
    const [[L, T], , [R, B]] = scene.coordinates
    const meta = await sharp(png).metadata()
    const W = meta.width!
    const H = meta.height!
    const [w, s, e, n] = bbox
    const out = cropSize(bbox)

    // The area in source pixels (the browse image is a plain lat/lon grid).
    const px = (lon: number) => ((lon - L) / (R - L)) * W
    const py = (lat: number) => ((T - lat) / (T - B)) * H
    const x0 = Math.max(0, Math.floor(px(w)))
    const x1 = Math.min(W, Math.ceil(px(e)))
    const y0 = Math.max(0, Math.floor(py(n)))
    const y1 = Math.min(H, Math.ceil(py(s)))
    const canvas = sharp({
      create: {
        width: out.width,
        height: out.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
    if (x1 - x0 < 1 || y1 - y0 < 1) return canvas.png().toBuffer()

    // Where the overlapping part lands in the output (clamped, since
    // rounding can otherwise make it a pixel or two bigger than the canvas).
    const sx = out.width / (px(e) - px(w))
    const sy = out.height / (py(s) - py(n))
    const left = Math.min(
      out.width - 1,
      Math.max(0, Math.round((x0 - px(w)) * sx))
    )
    const top = Math.min(
      out.height - 1,
      Math.max(0, Math.round((y0 - py(n)) * sy))
    )
    const width = Math.max(
      1,
      Math.min(out.width - left, Math.round((x1 - x0) * sx))
    )
    const height = Math.max(
      1,
      Math.min(out.height - top, Math.round((y1 - y0) * sy))
    )
    const part = await sharp(png)
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .resize({ width, height, fit: "fill", kernel: "nearest" })
      .png()
      .toBuffer()
    return canvas
      .composite([{ input: part, left, top }])
      .png()
      .toBuffer()
  })
}

/**
 * A GUNW browse image cut to the area at its own pixel size (no resizing).
 * Coherence is judged from pixel-to-pixel speckle, which enlarging would
 * fake away (copied pixels look perfectly smooth) and shrinking would blur.
 */
export function cropMovementNative(granule: string, bbox: Bbox) {
  return cached(`mn|${granule}|${bbox.join(",")}`, async () => {
    const sharp = await loadSharp()
    const { png, scene } = await loadScene(granule)
    const [[L, T], , [R, B]] = scene.coordinates
    const meta = await sharp(png).metadata()
    const W = meta.width!
    const H = meta.height!
    const [w, s, e, n] = bbox
    const px = (lon: number) => ((lon - L) / (R - L)) * W
    const py = (lat: number) => ((T - lat) / (T - B)) * H
    const width = Math.max(8, Math.round(px(e) - px(w)))
    const height = Math.max(8, Math.round(py(s) - py(n)))
    const canvas = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
    const x0 = Math.max(0, Math.round(px(w)))
    const y0 = Math.max(0, Math.round(py(n)))
    const x1 = Math.min(W, Math.round(px(w)) + width)
    const y1 = Math.min(H, Math.round(py(n)) + height)
    if (x1 - x0 < 1 || y1 - y0 < 1) return canvas.png().toBuffer()
    const part = await sharp(png)
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .png()
      .toBuffer()
    return canvas
      .composite([
        {
          input: part,
          left: x0 - Math.round(px(w)),
          top: y0 - Math.round(py(n)),
        },
      ])
      .png()
      .toBuffer()
  })
}

/** NISAR backscatter for one day, rendered by NASA GIBS for the area. */
export function cropSignal(
  date: string,
  bbox: Bbox,
  size?: { width: number; height: number }
) {
  const key = `s|${date}|${bbox.join(",")}|${size ? `${size.width}x${size.height}` : ""}`
  return cached(key, async () => {
    const [w, s, e, n] = bbox
    const { width, height } = size ?? cropSize(bbox)
    const url = new URL(
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
    )
    url.search = new URLSearchParams({
      SERVICE: "WMS",
      REQUEST: "GetMap",
      VERSION: "1.3.0",
      LAYERS: "NISAR_L2_Geocoded_Polarimetric_Covariance",
      STYLES: "",
      CRS: "EPSG:4326",
      // WMS 1.3.0 + EPSG:4326 takes latitude first.
      BBOX: [s, w, n, e].join(","),
      WIDTH: String(width),
      HEIGHT: String(height),
      FORMAT: "image/png",
      TRANSPARENT: "TRUE",
      TIME: date,
    }).toString()
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok || !res.headers.get("content-type")?.includes("png")) {
      throw new Error(`GIBS responded ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
  })
}

/**
 * How much of the area looks dark (water or other smooth surfaces) on each
 * date, counted only where both dates have data so the numbers compare.
 * Dark = low brightness in NASA's false-colour backscatter render.
 */
export async function darkSurfaceChange(a: Buffer, b: Buffer) {
  const sharp = await loadSharp()
  const [ra, rb] = await Promise.all(
    [a, b].map((img) =>
      sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    )
  )
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) {
    throw new Error("Crops differ in size")
  }
  const lum = (d: Buffer, i: number) =>
    0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
  const DARK = 45
  let common = 0
  let darkA = 0
  let darkB = 0
  for (let i = 0; i < ra.data.length; i += 4) {
    if (ra.data[i + 3] < 200 || rb.data[i + 3] < 200) continue
    common++
    if (lum(ra.data, i) < DARK) darkA++
    if (lum(rb.data, i) < DARK) darkB++
  }
  const total = ra.info.width * ra.info.height
  return {
    /** Share of the area both dates cover. */
    coverage: total ? common / total : 0,
    darkA: common ? darkA / common : null,
    darkB: common ? darkB / common : null,
  }
}

/** A small-enough area from ?w=&s=&e=&n= (max 6° a side), else null. */
export function readBbox(params: URLSearchParams): Bbox | null {
  const box = parseBbox(params)
  return box && box[2] - box[0] <= 6 && box[3] - box[1] <= 6 ? box : null
}
