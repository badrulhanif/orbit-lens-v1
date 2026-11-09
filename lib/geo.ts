export type LatLng = { latitude: number; longitude: number }

export type DeviceLocation = LatLng & {
  /** Accuracy radius in metres. */
  accuracy: number
  timestamp: number
}

export type PlaceName = {
  label: string
  detail: string | null
}

/** Icon group for a place, mapped to an icon on the client. */
export type PlaceIcon =
  | "pin"
  | "area"
  | "street"
  | "building"
  | "shop"
  | "food"
  | "cafe"
  | "fuel"
  | "ev"
  | "health"
  | "pharmacy"
  | "worship"
  | "money"
  | "education"
  | "lodging"
  | "park"
  | "transit"
  | "air"
  | "car"
  | "police"
  | "fitness"
  // Hazard events
  | "flood"
  | "landslide"
  | "quake"
  | "volcano"
  | "storm"
  | "fire"

/** Radar layers (kept here so this file has no other imports). */
export type SarLayerName = "movement" | "signal"

export type Place = LatLng & {
  id: string
  name: string
  /** Human label for what it is, e.g. "Shopping mall". */
  kind: string
  icon: PlaceIcon
  /** Short location line, e.g. "Bangsar, Kuala Lumpur". */
  area: string
  /** Full readable address. */
  address: string
  /** [west, south, east, north] for areas like cities; null for points. */
  bbox: [number, number, number, number] | null
  /** How close to zoom when picked, if there's no bbox. */
  zoom?: number
  /** Hazard events: when it happened (ISO). */
  date?: string
  /** Hazard events: the radar layer that shows it. */
  sarLayer?: SarLayerName
}

/** Areas (countries, states, cities) are framed on the map, not pinned. */
export function isArea(place: Place) {
  return place.icon === "area"
}

/** A hazard search ("flood", "banjir kelantan") recognised in the text. */
export type HazardIntent = {
  hazard: string
  /** "Flood" */
  label: string
  /** Radar layer that shows this hazard. */
  layer: SarLayerName
  /** Why that layer helps. */
  why: string
  /** The place named in the search, if any ("kelantan"). */
  near: (LatLng & { name: string; bbox: Place["bbox"] }) | null
}

export type SearchResponse = {
  intent: HazardIntent | null
  places: Place[]
}

const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** Great-circle distance between two points, in metres. */
export function distanceMeters(a: LatLng, b: LatLng) {
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** A closed polygon ring approximating a circle on the globe. */
export function circleRing(
  center: LatLng,
  radiusMeters: number,
  steps = 64
): [number, number][] {
  const lat = toRad(center.latitude)
  const lon = toRad(center.longitude)
  const d = radiusMeters / EARTH_RADIUS_M
  const ring: [number, number][] = []

  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI
    const lat2 = Math.asin(
      Math.sin(lat) * Math.cos(d) +
        Math.cos(lat) * Math.sin(d) * Math.cos(bearing)
    )
    const lon2 =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat),
        Math.cos(d) - Math.sin(lat) * Math.sin(lat2)
      )
    ring.push([toDeg(lon2), toDeg(lat2)])
  }

  return ring
}

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`
  if (meters < 100_000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters / 1000).toLocaleString()} km`
}
