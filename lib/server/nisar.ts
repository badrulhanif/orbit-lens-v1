import sharp from "sharp"

import type { SarLayer, SarPass, SarScene } from "@/lib/sar"

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

/** NISAR passes covering a point, newest first. */
export async function findPasses(
  layer: SarLayer,
  latitude: number,
  longitude: number
): Promise<SarPass[]> {
  const results = await asfSearch({
    processingLevel: PRODUCT_TYPE[layer],
    intersectsWith: `POINT(${longitude.toFixed(4)} ${latitude.toFixed(4)})`,
    maxResults: "30",
  })
  return results
    .filter((r) => r.wkt && NAME_RE.test(r.granuleName))
    .map((r) => toPass(r, layer))
    .sort((a, b) => b.start.localeCompare(a.start))
}

/* ------------------------------------------------------------------ */
/* Browse image + where it goes on the map                             */
/* ------------------------------------------------------------------ */

type LoadedScene = { png: Buffer; scene: Omit<SarScene, "imageUrl"> }
const sceneCache = new Map<string, Promise<LoadedScene>>()
const SCENE_CACHE_MAX = 12

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
  const png = Buffer.from(await res.arrayBuffer())

  const kmlUrl = result.nisar?.additionalUrls?.find((u) =>
    u.endsWith("_LATLON.kml")
  )
  const fromKml = kmlUrl ? await cornersFromKml(kmlUrl) : null
  if (fromKml) {
    return { png, scene: { coordinates: fromKml, georeference: "kml" } }
  }

  const { bbox } = parseFootprint(result.wkt)
  return {
    png,
    scene: {
      coordinates: await cornersFromFootprint(png, bbox),
      georeference: "footprint",
    },
  }
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

    // Some KMLs use a quad instead: "lon,lat lon,lat lon,lat lon,lat"
    // counter-clockwise from the bottom-left.
    const quad = kml.match(/<gx:LatLonQuad>[\s\S]*?<coordinates>([^<]+)</)
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
