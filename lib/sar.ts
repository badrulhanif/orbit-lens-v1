import type { SarLayerName } from "@/lib/geo"

/**
 * NISAR (NASA-ISRO SAR) radar layers.
 *
 * - "movement": GUNW interferograms. Two passes over the same ground, 12 days
 *   apart; the colour shows how far the ground moved toward/away from the
 *   satellite in between.
 * - "signal": GCOV backscatter. How strong the radar echo is from each patch
 *   of ground (forest, buildings, water all echo differently).
 *
 * The map shows a "cycle" at a time: NISAR repeats its orbit every 12 days,
 * so one cycle's swaths stitch together into one picture of an area.
 */
export type SarLayer = SarLayerName

export type SarPass = {
  /** ASF granule name. */
  id: string
  layer: SarLayer
  /** For "movement": first pass. For "signal": the pass. ISO date-time. */
  start: string
  /** For "movement": second pass. For "signal": same as start. */
  end: string
  direction: "Ascending" | "Descending" | null
  track: number | null
  provisional: boolean
  /** 12-day orbit cycle number (for "movement": the later pass's). */
  cycle?: number
  frame?: number
  /** Footprint polygon ring, [lon, lat]. */
  footprint: [number, number][]
  /** [west, south, east, north] */
  bbox: [number, number, number, number]
}

/** All the swaths over an area from one 12-day cycle. */
export type SarCycle = {
  cycle: number
  direction: "Ascending" | "Descending"
  /** Earliest / latest dates among its passes (ISO). */
  start: string
  end: string
  provisional: boolean
  /** Oldest first, so newer swaths draw on top. */
  passes: SarPass[]
}

export type SarCoverageResponse = {
  layer: SarLayer
  /** The area that was searched: [west, south, east, north]. */
  bbox: [number, number, number, number]
  /** Newest first. */
  cycles: SarCycle[]
}

/** Where to put a GUNW browse image on the map. */
export type SarScene = {
  imageUrl: string
  /** Corners, [lon, lat]: top-left, top-right, bottom-right, bottom-left. */
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ]
  /** How the corners were found. */
  georeference: "kml" | "footprint"
}

/** One drawable piece of the radar mosaic. */
export type SarTile =
  | {
      id: string
      kind: "tiles"
      /** NASA GIBS tile URL template for one day. */
      tiles: string
      /** Only request tiles inside here. */
      bounds: [number, number, number, number]
      /** Deepest zoom GIBS has (NISAR 13, Sentinel-1 12). */
      maxzoom?: number
      attribution?: string
    }
  | {
      id: string
      kind: "image"
      url: string
      coordinates: SarScene["coordinates"]
    }

/** What the map needs to draw the radar overlay. */
export type SarOverlay = {
  layer: SarLayer
  /** Drawn in order: later ones on top. */
  pieces: SarTile[]
  opacity: number
}

/**
 * NISAR backscatter tiles (NASA GIBS, via our caching proxy) for one day.
 * MapLibre needs an absolute URL.
 */
export function gibsSignalTiles(date: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}/api/sar/tiles/${date}/{z}/{x}/{y}`
}

/**
 * Sentinel-1 C-band backscatter (NASA OPERA RTC-S1, false colour) for one
 * day, straight from NASA GIBS (no proxy needed: these tiles are clean).
 */
export function sentinel1Tiles(date: string) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1/default/${date}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

/** "7 – 19 Oct 2026", "28 Sept – 10 Oct 2026", "22 Oct 2026". */
export function formatRange(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const a = DAY.format(start)
  const b = DAY.format(end)
  if (a === b) return a
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return `${a} – ${b}`
  const sameMonth = start.getUTCMonth() === end.getUTCMonth()
  return sameMonth
    ? `${start.getUTCDate()} – ${b}`
    : `${a.replace(/ \d{4}$/, "")} – ${b}`
}

/** UTC calendar day, as GIBS dates its daily layers. */
export function passDay(pass: SarPass) {
  return pass.start.slice(0, 10)
}
