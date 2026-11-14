import type { Bbox } from "@/lib/area"
import { inRings, ringsFor, type Rings } from "@/lib/server/boundaries"
import { TtlCache } from "@/lib/server/util"

/**
 * How many people live in an area (WorldPop 2020 estimate, 100 m grid), to
 * put a change in context: 3 km² of new water means more in a town than in
 * a forest reserve.
 */

const API = "https://api.worldpop.org/v1/services/stats"
const cache = new TtlCache<number | null>(
  500,
  7 * 24 * 60 * 60_000,
  (v) => v !== null
)

type Ring = [number, number][]

/** Every nth point, so the request stays short (and the ring closed). */
function thin(ring: Ring, max: number): Ring {
  if (ring.length <= max) return ring
  const step = Math.ceil(ring.length / max)
  const out = ring.filter((_, i) => i % step === 0)
  out.push(out[0])
  return out
}

/** |area| of a ring in square degrees (only used to find the largest). */
const ringArea = (r: Ring) =>
  Math.abs(
    r.reduce(
      (s, [x, y], i) =>
        s + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y,
      0
    ) / 2
  )

/** The outline as one GeoJSON polygon: the largest ring, with the rings
 * inside it as holes (e.g. Kuala Lumpur cut out of Selangor). Small
 * islands elsewhere are left out. */
function polygonOf(rings: Rings): Ring[] {
  const sorted = [...rings].sort((a, b) => ringArea(b) - ringArea(a))
  const outer = sorted[0]
  const holes = sorted
    .slice(1)
    .filter(
      (r) =>
        r.length >= 4 &&
        inRings({ longitude: r[0][0], latitude: r[0][1] }, [outer])
    )
  return [thin(outer, 160), ...holes.map((h) => thin(h, 60))]
}

const boxPolygon = ([w, s, e, n]: Bbox): Ring[] => [
  [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ],
]

export async function populationOf(box: Bbox, boundary: string | null) {
  const rings = await ringsFor(boundary)
  // By outline when there is one; an unknown key falls back to the box.
  const key = rings?.length ? boundary! : box.join(",")
  return cache.get(key, async () => {
    const coordinates = rings?.length ? polygonOf(rings) : boxPolygon(box)
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: coordinates.map((r) =>
              r.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])
            ),
          },
        },
      ],
    }
    const url = new URL(API)
    url.searchParams.set("dataset", "wpgppop")
    url.searchParams.set("year", "2020")
    url.searchParams.set("geojson", JSON.stringify(geojson))
    url.searchParams.set("runasync", "false")
    const res = await fetch(url, {
      signal: AbortSignal.timeout(25_000),
      next: { revalidate: 7 * 24 * 3600 },
    })
    if (!res.ok) return null
    // The service prints PHP notices around its JSON.
    const text = await res.text()
    const start = text.search(/\{\s*"status"/)
    const end = text.lastIndexOf("}")
    if (start < 0 || end < start) return null
    const body = JSON.parse(text.slice(start, end + 1)) as {
      error?: boolean
      data?: { total_population?: number }
    }
    const total = body.data?.total_population
    return !body.error && typeof total === "number" && total >= 0
      ? Math.round(total)
      : null
  })
}
