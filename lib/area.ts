import type { LatLng, Place } from "@/lib/geo"

export type Bbox = [number, number, number, number]

export type HazardType =
  | "flood"
  | "landslide"
  | "earthquake"
  | "tsunami"
  | "storm"
  | "wildfire"
  | "volcano"
  | "disaster"

export const HAZARD_LABEL: Record<HazardType, string> = {
  flood: "Flood",
  landslide: "Landslide",
  earthquake: "Earthquake",
  tsunami: "Tsunami",
  storm: "Storm",
  wildfire: "Wildfire",
  volcano: "Volcano",
  disaster: "Disaster",
}

/** Marker / dot colour per hazard. */
export const HAZARD_COLOR: Record<HazardType, string> = {
  flood: "#2563eb", // blue-600
  landslide: "#b45309", // amber-700
  earthquake: "#dc2626", // red-600
  tsunami: "#0891b2", // cyan-600
  storm: "#7c3aed", // violet-600
  wildfire: "#ea580c", // orange-600
  volcano: "#be123c", // rose-700
  disaster: "#525252", // neutral-600
}

export type HistoryEvent = LatLng & {
  id: string
  type: HazardType
  title: string
  /** ISO date (day precision is enough), when known. */
  date: string | null
  /** Short detail, e.g. "M5.9 · 12 km deep" or a USGS place line. */
  detail: string | null
  source: "Wikipedia" | "Wikidata" | "USGS" | "GDACS" | "NASA EONET"
  url: string | null
  /** Inside the chosen area (else it's in the surrounding margin). */
  inside: boolean
  /** Only a rough, city-level location is known. */
  approximate?: boolean
  /** Affected area outline, when the source gives one (GDACS floods). */
  outline?: [number, number][] | null
}

export type AreaHistory = {
  /** The chosen area. */
  bbox: Bbox
  /** Area plus margin that was searched for "nearby". */
  searched: Bbox
  events: HistoryEvent[]
  /** Which sources answered (some may be down). */
  sources: { name: string; ok: boolean }[]
}

/** Rough half-size (degrees) for places without a known extent. */
function radiusFor(zoom: number | undefined) {
  if (!zoom) return 0.05
  if (zoom <= 5) return 4
  if (zoom <= 8) return 0.8
  if (zoom <= 10) return 0.3
  if (zoom <= 11) return 0.18
  if (zoom <= 13) return 0.07
  return 0.035
}

/** The area a picked place stands for. */
export function areaBoxFor(place: Place): Bbox {
  if (place.bbox) return place.bbox
  const r = radiusFor(place.zoom)
  const rx = r / Math.max(0.2, Math.cos((place.latitude * Math.PI) / 180))
  return [
    place.longitude - rx,
    place.latitude - r,
    place.longitude + rx,
    place.latitude + r,
  ]
}

export const inBox = (p: LatLng, [w, s, e, n]: Bbox) =>
  p.longitude >= w && p.longitude <= e && p.latitude >= s && p.latitude <= n

export const boxCentre = ([w, s, e, n]: Bbox): LatLng => ({
  latitude: (s + n) / 2,
  longitude: (w + e) / 2,
})

/** "2008", "Dec 2008", "6 Dec 2008" depending on what's known. */
export function formatEventDate(iso: string | null) {
  if (!iso) return "Date unknown"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Date unknown"
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}
