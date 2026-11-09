import type { Bbox, HazardType, HistoryEvent } from "@/lib/area"
import { nearestTown } from "@/lib/server/gazetteer"
import { gdacsEventId, gdacsEvent } from "@/lib/server/gdacs"
import { describeFlood } from "@/lib/server/describe"
import { fetchJson, mapLimit, TtlCache, validLatLng } from "@/lib/server/util"

/**
 * NASA EONET events (floods via GDACS, storms, volcanoes, wildfires,
 * landslides), parsed into history records. Positions are then corrected
 * from GDACS itself and named after the nearest town (`refine`).
 */

const CATEGORY_TYPE: Record<string, HazardType> = {
  floods: "flood",
  landslides: "landslide",
  severeStorms: "storm",
  volcanoes: "volcano",
  wildfires: "wildfire",
}
export const EONET_CATEGORIES = Object.keys(CATEGORY_TYPE)

const TITLE: Partial<Record<HazardType, string>> = {
  flood: "Flood",
  storm: "Storm",
  wildfire: "Wildfire",
  volcano: "Volcanic activity",
  landslide: "Landslide",
}

type EonetEvent = {
  id: string
  title: string
  categories: { id: string }[]
  sources: { id: string; url: string }[]
  geometry: {
    date: string
    type: "Point" | "Polygon"
    coordinates: [number, number] | [number, number][][]
  }[]
}

const feed = new TtlCache<HistoryEvent[]>(100, 30 * 60_000)

/** Records in a box (EONET wants west,north,east,south), since a date. */
export function eonetRecords(
  categories: string[],
  [w, s, e, n]: Bbox,
  since: string
): Promise<HistoryEvent[]> {
  const url =
    "https://eonet.gsfc.nasa.gov/api/v3/events?status=all&limit=300" +
    `&category=${categories.join(",")}` +
    `&start=${since}&end=${new Date().toISOString().slice(0, 10)}` +
    `&bbox=${w},${n},${e},${s}`
  return feed.get(url, async () => {
    const { events } = await fetchJson<{ events: EonetEvent[] }>(url, {
      timeoutMs: 15_000,
    })
    return events.flatMap((ev) => {
      const record = parse(ev)
      return record ? [record] : []
    })
  })
}

function parse(ev: EonetEvent): HistoryEvent | null {
  const g = ev.geometry.at(-1)
  if (!g) return null
  let outline: [number, number][] | null = null
  let [longitude, latitude] =
    g.type === "Point" ? (g.coordinates as [number, number]) : [NaN, NaN]
  if (g.type === "Polygon") {
    let ring = (g.coordinates as [number, number][][])[0]
    // Some GDACS rings are [lat, lon]; flip them back.
    if (ring.some(([x, y]) => Math.abs(y) > 90 && Math.abs(x) <= 90)) {
      ring = ring.map(([x, y]) => [y, x])
    }
    outline = ring
    ;[longitude, latitude] = polygonCentre(ring)
  }
  // Swapped points too.
  if (!validLatLng(latitude, longitude)) {
    ;[latitude, longitude] = [longitude, latitude]
    if (!validLatLng(latitude, longitude)) return null
  }
  const source = ev.sources[0]
  return {
    id: `eonet-${ev.id}`,
    type: CATEGORY_TYPE[ev.categories[0]?.id] ?? "disaster",
    // "Flood in Malaysia 1104239" → "Flood in Malaysia"
    title: ev.title.replace(/\s+\d{5,}$/, ""),
    date: g.date.slice(0, 10),
    detail: null,
    source: source?.id === "GDACS" ? "GDACS" : "NASA EONET",
    url: source?.url ?? null,
    latitude,
    longitude,
    outline,
  }
}

/** Area-weighted centre of a polygon ring (falls back to the vertex mean). */
function polygonCentre(ring: [number, number][]): [number, number] {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]
    const [x1, y1] = ring[i]
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-12) {
    return [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/**
 * Corrected copies of records: GDACS's own position (EONET sometimes reuses
 * or misplaces points, see lib/server/gdacs.ts) and reported impacts,
 * country-level placeholders marked approximate, and a name from the
 * nearest town.
 */
export async function refine(records: HistoryEvent[]): Promise<HistoryEvent[]> {
  const out = await mapLimit(records, 6, async (r) => {
    const e = { ...r }
    const id = e.source === "GDACS" ? gdacsEventId(e.url) : null
    const loc = id ? await gdacsEvent(id) : null
    if (loc) {
      // An outline far from the true point belongs to the wrong event.
      if (
        Math.hypot(loc.latitude - e.latitude, loc.longitude - e.longitude) > 0.5
      ) {
        e.outline = null
      }
      e.latitude = loc.latitude
      e.longitude = loc.longitude
      if (loc.approximate) e.approximate = true
      if (loc.countries.length > 1)
        e.detail = `Affected: ${loc.countries.join(", ")}`
      if (loc.impacts.length) e.impacts = loc.impacts
      e.description = describeFlood(loc)
    }
    const label = TITLE[e.type] ?? "Event"
    if (e.approximate) {
      e.title = `${label} (location approximate)`
    } else {
      const town = await nearestTown(e.latitude, e.longitude)
      if (town) e.title = `${label} near ${town}`
    }
    return e
  })
  return out.map((e, i) => e ?? records[i])
}
