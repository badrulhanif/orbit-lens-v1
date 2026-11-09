import type { NextRequest } from "next/server"
import sharp from "sharp"

/**
 * NISAR backscatter map tiles from NASA GIBS, through our server:
 *  - cached, and retried once (GIBS sometimes fails tiles under load)
 *  - GIBS occasionally serves a corrupted tile (a pink/white hatch pattern
 *    cut off at the tile edges, e.g. over Kuala Lumpur). Those, and tiles
 *    that fail outright, are rebuilt from the healthy zoomed-out tile.
 *   /api/sar/tiles/2026-10-07/8/200/124   (date / z / x / y)
 */

const GIBS =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default"
const EMPTY = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
)
const cache = new Map<string, Promise<Buffer | null>>()
const CACHE_MAX = 3000

async function download(date: string, z: number, x: number, y: number) {
  const url = `${GIBS}/${date}/GoogleMapsCompatible_Level13/${z}/${y}/${x}.png`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (res.ok && res.headers.get("content-type")?.includes("png")) {
        return Buffer.from(await res.arrayBuffer())
      }
    } catch {
      // Retry once.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

/**
 * Two kinds of broken GIBS tile, both seen over Kuala Lumpur:
 *  - a hatch pattern: pixels alternate between see-through and solid (or
 *    light and dark) one to the next, over part or all of the tile. Real
 *    radar texture and swath edges almost never do (~0–5% vs ~50%+).
 *  - a large file that's entirely see-through. Genuine "no data" tiles are a
 *    tiny 288-byte image.
 *  - half-transparent pixels: healthy tiles only use fully solid or fully
 *    see-through pixels; the broken ones are full of in-between values.
 * Checked in 32×32 patches; one bad patch flags the tile.
 */
async function looksCorrupt(png: Buffer) {
  if (png.length < 1000) return false // the genuine blank tile
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  let opaque = 0
  let partial = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) opaque++
    if (data[i] > 0 && data[i] < 255) partial++
  }
  if (opaque === 0) return png.length > 5000
  if (partial / (data.length / 4) > 0.02) return true

  const P = 32
  for (let by = 0; by + P <= info.height; by += P) {
    for (let bx = 0; bx + P <= W; bx += P) {
      let pairs = 0
      let flips = 0
      let solid = 0
      for (let y = by; y < by + P; y += 2) {
        for (let x = bx + 1; x < bx + P; x++) {
          const i = (y * W + x) * 4
          const j = i - 4
          const ai = data[i + 3] > 127
          const aj = data[j + 3] > 127
          if (!ai && !aj) continue
          pairs++
          if (ai) solid++
          if (ai !== aj) {
            flips++
          } else {
            const a = data[i] + data[i + 1] + data[i + 2]
            const b = data[j] + data[j + 1] + data[j + 2]
            if (Math.abs(a - b) > 250) flips++
          }
        }
      }
      if (pairs > 100 && solid > 30 && flips / pairs > 0.35) return true
    }
  }
  return false
}

/** The matching quarter of the parent tile, scaled up. */
async function fromParent(date: string, z: number, x: number, y: number) {
  if (z <= 1) return null
  const parent = await tile(date, z - 1, x >> 1, y >> 1, true)
  if (!parent || parent.length < 1000) return parent
  const meta = await sharp(parent).metadata()
  const half = Math.floor((meta.width ?? 256) / 2)
  return sharp(parent)
    .extract({
      left: (x & 1) * half,
      top: (y & 1) * half,
      width: half,
      height: half,
    })
    .resize(256, 256, { kernel: "cubic" })
    .png()
    .toBuffer()
}

function tile(
  date: string,
  z: number,
  x: number,
  y: number,
  isParent = false
): Promise<Buffer | null> {
  const key = `${date}/${z}/${x}/${y}`
  let pending = cache.get(key)
  if (!pending) {
    pending = (async () => {
      const png = await download(date, z, x, y)
      if (png && !(await looksCorrupt(png))) return png
      // Broken or missing: rebuild from up to three zoom levels up.
      return z > 1 && (isParent ? z > 4 : true)
        ? fromParent(date, z, x, y)
        : null
    })()
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
    cache.set(key, pending)
  }
  return pending
}

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/sar/tiles/[date]/[z]/[x]/[y]">
) {
  const { date, z, x, y } = await ctx.params
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    ![z, x, y].every((v) => /^\d{1,6}$/.test(v)) ||
    Number(z) > 13
  ) {
    return new Response("Invalid tile", { status: 400 })
  }
  const png = await tile(date, Number(z), Number(x), Number(y)).catch(
    () => null
  )
  return new Response(new Uint8Array(png ?? EMPTY), {
    headers: {
      "Content-Type": "image/png",
      // Don't let browsers keep a stand-in tile for long.
      "Cache-Control": png ? "public, max-age=604800" : "public, max-age=60",
    },
  })
}
