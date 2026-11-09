export type DeviceLocation = {
  latitude: number
  longitude: number
  /** Accuracy radius in metres. */
  accuracy: number
  timestamp: number
}

export type PlaceName = {
  label: string
  detail: string | null
}

export type SearchResult = {
  id: string
  label: string
  detail: string
  latitude: number
  longitude: number
  /** [west, south, east, north] */
  bbox: [number, number, number, number] | null
}

const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** A closed polygon ring approximating a circle on the globe. */
export function circleRing(
  center: { latitude: number; longitude: number },
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
