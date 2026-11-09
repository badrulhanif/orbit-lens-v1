import sharp from "sharp"

import { gibsHasDay } from "@/lib/server/gibs"

import type { SarCycle, SarLayer, SarPass, SarScene } from "@/lib/sar"

/**
 * NISAR products from the Alaska Satellite Facility (ASF DAAC).
 *
 * Searching and the browse images are public. The small KML files that give
 * a browse image's exact corners need a NASA Earthdata token; set
 * EARTHDATA_TOKEN to use them, otherwise the corners are worked out from the
 * product footprint (accurate to roughly one browse pixel, ~250 m).
 */

const ASF_SEARCH = "https://api.daac.asf.alaska.edu/services/search/param"
const PRODUCT_TYPE: Record<SarLayer, string> = {
  movement: "GUNW",
  signal: "GCOV",
}
const NAME_RE = /^NISAR_L2_[A-Z0-9_]{10,200}$/

type AsfResult = {
  granuleName: string
  collectionName: string
  startTime: string
  stopTime: string
  flightDirection: string | null
  path: number | null
  wkt: string
  browse: string[]
  nisar?: { additionalUrls?: string[] }
}

const searchCache = new Map<string, { at: number; data: AsfResult[] }>()
const SEARCH_TTL_MS = 30 * 60 * 1000

async function asfSearch(params: Record<string, string>): Promise<AsfResult[]> {
  const url = new URL(ASF_SEARCH)
  url.searchParams.set("dataset", "NISAR")
  url.searchParams.set("output", "jsonlite")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const key = url.toString()
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.data

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`ASF search responded ${res.status}`)
  const data = ((await res.json()) as { results: AsfResult[] }).results ?? []
  if (searchCache.size > 200)
    searchCache.delete(searchCache.keys().next().value!)
  searchCache.set(key, { at: Date.now(), data })
  return data
}

/** "POLYGON ((lon lat, lon lat, …))" → ring + bbox. */
function parseFootprint(wkt: string) {
  const ring = (wkt.match(/-?\d+(\.\d+)?\s+-?\d+(\.\d+)?/g) ?? []).map(
    (pair) => pair.trim().split(/\s+/).map(Number) as [number, number]
  )
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const bbox: [number, number, number, number] = [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ]
  return { ring, bbox }
}

function toPass(r: AsfResult, layer: SarLayer): SarPass {
  const { ring, bbox } = parseFootprint(r.wkt)
  const direction = r.flightDirection?.toUpperCase()
  return {
    id: r.granuleName,
    layer,
    start: r.startTime,
    end: layer === "movement" ? r.stopTime : r.startTime,
    direction:
      direction === "ASCENDING"
        ? "Ascending"
        : direction === "DESCENDING"
          ? "Descending"
          : null,
    track: r.path ?? null,
    provisional: r.collectionName.includes("PROVISIONAL"),
    footprint: ring,
    bbox,
  }
}

/**
 * Cycle / track / frame from a product name. NISAR repeats its orbit every
 * 12 days; one "cycle" is one complete pass over the whole planet.
 *   NISAR_L2_PR_GCOV_033_148_D_087_…      → cycle 33, track 148, frame 87
 *   NISAR_L2_PR_GUNW_032_112_A_003_033_…  → cycles 32→33, track 112, frame 3
 */
function parseName(name: string) {
  const gunw = name.match(/_GUNW_(\d{3})_(\d{3})_([AD])_(\d{3})_(\d{3})_/)
  if (gunw) {
    return { cycle: +gunw[5], track: +gunw[2], dir: gunw[3], frame: +gunw[4] }
  }
  const gcov = name.match(/_GCOV_(\d{3})_(\d{3})_([AD])_(\d{3})_/)
  if (gcov) {
    return { cycle: +gcov[1], track: +gcov[2], dir: gcov[3], frame: +gcov[4] }
  }
  return null
}

const boxCentre = ([w, s, e, n]: SarPass["bbox"]) => ({
  latitude: (s + n) / 2,
  longitude: (w + e) / 2,
})

const MAX_PASSES_PER_CYCLE = 14

/**
 * Every NISAR swath overlapping an area, grouped by 12-day cycle so they
 * can be stitched into one picture. Newest cycle first.
 */
export async function findCoverage(
  layer: SarLayer,
  [w, s, e, n]: SarPass["bbox"],
  centre: { latitude: number; longitude: number }
): Promise<SarCycle[]> {
  const since = new Date(Date.now() - 400 * 86400_000)
    .toISOString()
    .slice(0, 10)
  const results = await asfSearch({
    processingLevel: PRODUCT_TYPE[layer],
    intersectsWith: `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`,
    start: since,
    maxResults: "2000",
  })
  // Signal quality is drawn from NASA GIBS tiles, which lag the archive.
  const hasTiles = layer === "signal" ? await gibsHasDay() : () => true

  // cycle → "track/dir/frame" → pass (one per swath piece)
  const byCycle = new Map<number, Map<string, SarPass>>()
  for (const r of results) {
    if (!r.wkt || !NAME_RE.test(r.granuleName)) continue
    if (!hasTiles(r.startTime.slice(0, 10))) continue
    const info = parseName(r.granuleName)
    if (!info) continue
    const key = `${info.track}/${info.dir}/${info.frame}`
    const cycle = byCycle.get(info.cycle) ?? new Map<string, SarPass>()
    const existing = cycle.get(key)
    // Reprocessed products: keep the most recent processing.
    if (!existing || r.granuleName > existing.id) {
      cycle.set(key, {
        ...toPass(r, layer),
        cycle: info.cycle,
        frame: info.frame,
      })
    }
    byCycle.set(info.cycle, cycle)
  }

  const covers = (p: SarPass) =>
    centre.longitude >= p.bbox[0] &&
    centre.longitude <= p.bbox[2] &&
    centre.latitude >= p.bbox[1] &&
    centre.latitude <= p.bbox[3]

  const cycles: SarCycle[] = []
  for (const [cycle, pieces] of byCycle) {
    const all = [...pieces.values()]
    // Ascending and descending passes see the ground from opposite sides;
    // stitching them together would mix two different views. Use the one
    // that covers the middle of the screen (else the one with more swaths).
    const score = (dir: string) => {
      const list = all.filter((p) => p.direction === dir)
      return (list.some(covers) ? 1000 : 0) + list.length
    }
    const direction =
      score("Ascending") >= score("Descending") ? "Ascending" : "Descending"
    const passes = all
      .filter((p) => p.direction === direction)
      .map((p) => ({
        p,
        d: Math.hypot(
          boxCentre(p.bbox).latitude - centre.latitude,
          boxCentre(p.bbox).longitude - centre.longitude
        ),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_PASSES_PER_CYCLE)
      .map(({ p }) => p)
      // Older first, so newer swaths are drawn on top.
      .sort((a, b) => a.start.localeCompare(b.start))
    if (!passes.length) continue

    cycles.push({
      cycle,
      direction,
      start: passes.reduce(
        (m, p) => (p.start < m ? p.start : m),
        passes[0].start
      ),
      end: passes.reduce((m, p) => (p.end > m ? p.end : m), passes[0].end),
      provisional: passes.some((p) => p.provisional),
      passes,
    })
  }
  return cycles.sort((a, b) => b.cycle - a.cycle)
}

/* ------------------------------------------------------------------ */
/* Browse image + where it goes on the map                             */
/* ------------------------------------------------------------------ */

type LoadedScene = {
  png: Buffer
  /** Downsized copy for zoomed-out views, made on first request. */
  small?: Promise<Buffer>
  scene: Omit<SarScene, "imageUrl">
}
const sceneCache = new Map<string, Promise<LoadedScene>>()
// Browse images are ~2.6 MB; a stitched view holds up to 14 of them.
const SCENE_CACHE_MAX = 40

export function isGranuleName(name: string) {
  return NAME_RE.test(name)
}

export function loadScene(granule: string): Promise<LoadedScene> {
  let pending = sceneCache.get(granule)
  if (!pending) {
    pending = buildScene(granule)
    // Don't keep failures around.
    pending.catch(() => sceneCache.delete(granule))
    if (sceneCache.size >= SCENE_CACHE_MAX) {
      sceneCache.delete(sceneCache.keys().next().value!)
    }
    sceneCache.set(granule, pending)
  }
  return pending
}

async function buildScene(granule: string): Promise<LoadedScene> {
  const [result] = await asfSearch({ granule_list: granule })
  if (!result) throw new Error("Unknown granule")
  const browseUrl = result.browse.find((u) => u.endsWith("_LATLON.png"))
  if (!browseUrl) throw new Error("No browse image")

  const res = await fetch(browseUrl, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Browse image responded ${res.status}`)
  const original = Buffer.from(await res.arrayBuffer())

  const kmlUrl = result.nisar?.additionalUrls?.find((u) =>
    u.endsWith("_LATLON.kml")
  )
  const fromKml = kmlUrl ? await cornersFromKml(kmlUrl) : null
  // Corners first (the footprint method needs the original image).
  const scene: LoadedScene["scene"] = fromKml
    ? { coordinates: fromKml, georeference: "kml" }
    : {
        coordinates: await cornersFromFootprint(
          original,
          parseFootprint(result.wkt).bbox
        ),
        georeference: "footprint",
      }

  return { png: await clearBorder(original), scene }
}

/**
 * NISAR's previews have a solid dark-purple strip along the edge of each
 * swath (no data). Side by side in a mosaic those strips look like seams,
 * so make that exact colour see-through.
 */
const BORDER = [47, 19, 55]

async function clearBorder(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let changed = 0
  for (let i = 0; i < data.length; i += 4) {
    if (
      data[i] === BORDER[0] &&
      data[i + 1] === BORDER[1] &&
      data[i + 2] === BORDER[2]
    ) {
      data[i + 3] = 0
      changed++
    }
  }
  if (!changed) return png
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Exact corners from the product's KML (needs an Earthdata token). */
async function cornersFromKml(url: string) {
  const token = process.env.EARTHDATA_TOKEN?.trim()
  if (!token) return null
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const kml = await res.text()
    const read = (tag: string) => {
      const m = kml.match(new RegExp(`<${tag}>\\s*(-?[\\d.]+)\\s*</${tag}>`))
      return m ? Number(m[1]) : NaN
    }
    const [n, s, e, w] = ["north", "south", "east", "west"].map(read)
    if ([n, s, e, w].every(Number.isFinite)) return corners(w, s, e, n)

    // NISAR's KMLs use a quad: "lon,lat lon,lat lon,lat lon,lat",
    // counter-clockwise from the bottom-left. The tag's namespace prefix
    // varies (gx:, ns0:), so match any.
    const quad = kml.match(/<(?:\w+:)?LatLonQuad>[\s\S]*?<coordinates>([^<]+)</)
    if (quad) {
      const pts = quad[1]
        .trim()
        .split(/\s+/)
        .map((p) => p.split(",").slice(0, 2).map(Number) as [number, number])
      if (pts.length === 4 && pts.flat().every(Number.isFinite)) {
        const [bl, br, tr, tl] = pts
        return [tl, tr, br, bl] as SarScene["coordinates"]
      }
    }
  } catch {
    // Fall back to the footprint method.
  }
  return null
}

/**
 * The browse image is a plain lat/lon grid whose opaque area is exactly the
 * product footprint's bounding box. Find that area's pixel edges and scale
 * out to the full image.
 */
async function cornersFromFootprint(
  png: Buffer,
  [west, south, east, north]: [number, number, number, number]
) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info

  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return corners(west, south, east, north)

  const degPerPxX = (east - west) / (maxX + 1 - minX)
  const degPerPxY = (north - south) / (maxY + 1 - minY)
  return corners(
    west - minX * degPerPxX,
    north - (H - minY) * degPerPxY,
    west + (W - minX) * degPerPxX,
    north + minY * degPerPxY
  )
}

function corners(w: number, s: number, e: number, n: number) {
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ] as SarScene["coordinates"]
}

/** The browse image, optionally downsized (zoomed-out views don't need 1400 px). */
export async function sceneImage(granule: string, size: "small" | "full") {
  const loaded = await loadScene(granule)
  if (size === "full") return loaded.png
  loaded.small ??= sharp(loaded.png)
    .resize({ width: 560, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer()
  return loaded.small
}
