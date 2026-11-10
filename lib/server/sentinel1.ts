import type { Bbox } from "@/lib/area"
import { fetchJson } from "@/lib/server/util"

/**
 * Sentinel-1 (ESA's C-band radar) passes over an area, from NASA's OPERA
 * terrain-corrected backscatter (RTC-S1). Used to set C-band beside NISAR's
 * L-band on a similar date: the shorter C-band wave bounces off leaves,
 * while L-band reaches branches, trunks and the ground below.
 */

const CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"

export type S1Day = {
  /** "YYYY-MM-DD" (UTC), as GIBS dates its daily layer. */
  day: string
  /** Union of that day's bursts over the area. */
  bbox: Bbox
  /** Days from the requested date. */
  offset: number
}

type CmrGranule = { time_start: string; polygons?: string[][] }

/** "lat lon lat lon …" rings → bbox. */
function ringBbox(rings: string[][] = []): Bbox | null {
  const nums = rings.flat().join(" ").trim().split(/\s+/).map(Number)
  if (nums.length < 6 || nums.some((v) => !Number.isFinite(v))) return null
  const lats = nums.filter((_, i) => i % 2 === 0)
  const lons = nums.filter((_, i) => i % 2 === 1)
  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ]
}

const DAY_MS = 86_400_000

/** Days with Sentinel-1 data over `box`, nearest to `near` first (±8 days). */
export async function sentinel1Days(box: Bbox, near: string): Promise<S1Day[]> {
  const t = Date.parse(`${near}T00:00:00Z`)
  if (!Number.isFinite(t)) return []
  const from = new Date(t - 8 * DAY_MS).toISOString()
  const to = new Date(t + 9 * DAY_MS).toISOString()
  const url = new URL(CMR)
  url.searchParams.set("short_name", "OPERA_L2_RTC-S1_V1")
  url.searchParams.set("bounding_box", box.join(","))
  url.searchParams.set("temporal", `${from},${to}`)
  url.searchParams.set("page_size", "500")
  const body = await fetchJson<{ feed: { entry: CmrGranule[] } }>(url, {
    timeoutMs: 15_000,
    revalidate: 3600,
  })
  const days = new Map<string, Bbox>()
  for (const g of body.feed.entry ?? []) {
    const day = g.time_start?.slice(0, 10)
    const b = ringBbox(g.polygons)
    if (!day || !b) continue
    const prev = days.get(day)
    days.set(
      day,
      prev
        ? [
            Math.min(prev[0], b[0]),
            Math.min(prev[1], b[1]),
            Math.max(prev[2], b[2]),
            Math.max(prev[3], b[3]),
          ]
        : b
    )
  }
  // Share of the area each day covers: a nearby day that only clips the
  // edge is less use than one a few days further that covers it all.
  const [w, s, e, n] = box
  const share = ([bw, bs, be, bn]: Bbox) =>
    (Math.max(0, Math.min(e, be) - Math.max(w, bw)) *
      Math.max(0, Math.min(n, bn) - Math.max(s, bs))) /
    ((e - w) * (n - s) || 1)
  const list = [...days].map(([day, bbox]) => ({
    day,
    bbox,
    offset: Math.round((Date.parse(`${day}T00:00:00Z`) - t) / DAY_MS),
    share: share(bbox),
  }))
  const best = Math.max(0, ...list.map((d) => d.share))
  const good = (d: (typeof list)[number]) => (d.share >= best * 0.8 ? 0 : 1)
  return list
    .sort(
      (a, b) =>
        good(a) - good(b) ||
        Math.abs(a.offset) - Math.abs(b.offset) ||
        a.offset - b.offset
    )
    .map(({ day, bbox, offset }) => ({ day, bbox, offset }))
}
