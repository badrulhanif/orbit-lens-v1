import type { LatLng } from "@/lib/geo"
import { inRings } from "@/lib/server/boundaries"

/**
 * Onshore / offshore test against Natural Earth land outlines
 * (data/land.json, built by scripts/build-land.mjs). State boundaries
 * include coastal waters, so they can't tell a quake at sea from one on land.
 */

type Ring = [number, number][]
type Indexed = { ring: Ring; box: [number, number, number, number] }

/** Points this close to the coast count as onshore (coastal towns). */
const COAST_TOLERANCE_KM = 3

let land: Promise<Indexed[]> | null = null

function load() {
  land ??= import("@/data/land.json")
    .then((m) => {
      const rings = ((m.default ?? m) as unknown as { rings: Ring[] }).rings
      return rings.map((ring) => {
        let w = 180,
          s = 90,
          e = -180,
          n = -90
        for (const [x, y] of ring) {
          if (x < w) w = x
          if (x > e) e = x
          if (y < s) s = y
          if (y > n) n = y
        }
        return { ring, box: [w, s, e, n] as Indexed["box"] }
      })
    })
    .catch(() => [])
  return land
}

/** Distance in km from a point to a ring's edges (flat-earth, fine nearby). */
function distanceToRingKm(p: LatLng, ring: Ring) {
  const k = Math.cos((p.latitude * Math.PI) / 180)
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - p.longitude) * k
    const ay = ring[j][1] - p.latitude
    const bx = (ring[i][0] - p.longitude) * k
    const by = ring[i][1] - p.latitude
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best * 111
}

/**
 * true when a point is at sea, more than ~3 km from any coast. Unknown
 * (outside the data window or data missing) counts as onshore.
 */
export async function isOffshore(p: LatLng) {
  const rings = await load()
  if (!rings.length) return false
  const pad = COAST_TOLERANCE_KM / 111 / Math.cos((p.latitude * Math.PI) / 180)
  for (const { ring, box } of rings) {
    if (
      p.longitude < box[0] - pad ||
      p.longitude > box[2] + pad ||
      p.latitude < box[1] - pad ||
      p.latitude > box[3] + pad
    ) {
      continue
    }
    if (inRings(p, [ring])) return false
    if (distanceToRingKm(p, ring) <= COAST_TOLERANCE_KM) return false
  }
  // Not on or near any land. The data only covers this window (see
  // scripts/build-land.mjs); outside it we can't tell, so say onshore.
  return (
    p.longitude > 92 && p.longitude < 128 && p.latitude > -12 && p.latitude < 22
  )
}
