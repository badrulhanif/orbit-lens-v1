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
  /** What happened, in a sentence or three (impacts, felt reports…). */
  description?: string | null
  source:
    | "Wikipedia"
    | "Wikidata"
    | "USGS"
    | "GDACS"
    | "NASA EONET"
    | "JKM"
    | "Community"
  url: string | null
  /** At sea (inside state waters but more than ~3 km from land). */
  offshore?: boolean
  /**
   * Records that have no point inside the area, so aren't on the map:
   *  - "state": a state-wide record (major floods from Wikipedia)
   *  - "reported": the source lists impacts here, but its point is elsewhere
   */
  scope?: "site" | "state" | "reported"
  /** Happening now (an open JKM relief centre). */
  live?: boolean
  /** Reported impacts by place (GDACS floods): displaced, deaths… */
  impacts?: Impact[]
  /** Only a rough, city-level location is known. */
  approximate?: boolean
  /** Affected area outline, when the source gives one (GDACS floods). */
  outline?: [number, number][] | null
}

export type Impact = { kind: string; value: number; region: string }

/** A MetMalaysia warning, cut down to the parts about this area. */
export type Warning = {
  id: string
  title: string
  issued: string
  validFrom: string | null
  validTo: string | null
  text: string
}

export type AreaHistory = {
  /** The chosen area. */
  bbox: Bbox
  /** Area plus margin that was searched. */
  searched: Bbox
  events: HistoryEvent[]
  /** Active MetMalaysia warnings mentioning the area. */
  warnings: Warning[]
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
    // "YYYY-MM": only the month is known.
    day: iso.length > 7 ? "numeric" : undefined,
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}

/** How precisely an event's location is known (shown as a badge). */
export function precisionOf(e: HistoryEvent): {
  label: string
  tone: "good" | "fair" | "rough"
  hint: string
} {
  if (e.scope === "state")
    return {
      label: "State-wide",
      tone: "rough",
      hint: "Affected the state; no single location",
    }
  if (e.scope === "reported")
    return {
      label: "Reported here",
      tone: "fair",
      hint: "The source lists impacts in this area; its map point is elsewhere",
    }
  if (e.source === "Community")
    return {
      label: "Public report",
      tone: "rough",
      hint: e.approximate
        ? "Reported by a member of the public for this area; checked by a moderator, not verified on the ground"
        : "Reported by a member of the public at this spot; checked by a moderator, not verified on the ground",
    }
  if (e.source === "JKM")
    return {
      label: "Relief centre",
      tone: "good",
      hint: "Exact location of an open evacuation centre (JKM); the affected area is nearby",
    }
  if (e.approximate)
    return {
      label: "Approximate",
      tone: "rough",
      hint: "Only a rough location is known",
    }
  if (e.source === "USGS")
    return {
      label: "Epicentre",
      tone: "good",
      hint: "Measured earthquake epicentre",
    }
  if (e.source === "GDACS" || e.source === "NASA EONET")
    return {
      label: "Reported area",
      tone: "fair",
      hint: "Where the flood was reported; not its full extent",
    }
  return {
    label: "Exact site",
    tone: "good",
    hint: "Named site with precise coordinates",
  }
}

/** Query string for an area (+ its boundary, so results stay inside it). */
export function areaQuery(bbox: Bbox, boundaryKey?: string | null) {
  const [w, s, e, n] = bbox.map((v) => v.toFixed(4))
  return (
    `w=${w}&s=${s}&e=${e}&n=${n}` +
    (boundaryKey ? `&boundary=${encodeURIComponent(boundaryKey)}` : "")
  )
}

/** How far back the list, stats and map look. */
export type Period = "all" | "7d" | "30d" | "1y" | "5y" | "10y"

export const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "1y", label: "Last 12 months" },
  { id: "5y", label: "Last 5 years" },
  { id: "10y", label: "Last 10 years" },
]

const SPAN: Record<
  Exclude<Period, "all">,
  { days?: number; years?: number }
> = {
  "7d": { days: 7 },
  "30d": { days: 30 },
  "1y": { years: 1 },
  "5y": { years: 5 },
  "10y": { years: 10 },
}

export function inPeriod(date: string | null, period: Period) {
  if (period === "all") return true
  if (!date) return false
  const cut = new Date()
  const { days, years } = SPAN[period]
  if (days) cut.setDate(cut.getDate() - days)
  if (years) cut.setFullYear(cut.getFullYear() - years)
  // ISO strings compare in date order ("2021-12" or "2021-12-16").
  return date >= cut.toISOString().slice(0, date.length >= 10 ? 10 : 7)
}
