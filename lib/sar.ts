import type { SarLayerName } from "@/lib/geo"

/**
 * NISAR (NASA-ISRO SAR) radar layers.
 *
 * - "movement": GUNW interferograms. Two passes over the same ground, 12 days
 *   apart; the colour shows how far the ground moved toward/away from the
 *   satellite in between.
 * - "signal": GCOV backscatter. How strong the radar echo is from each patch
 *   of ground (forest, buildings, water all echo differently).
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
  /** Footprint polygon ring, [lon, lat]. */
  footprint: [number, number][]
  /** [west, south, east, north] */
  bbox: [number, number, number, number]
}

export type SarPassesResponse = {
  layer: SarLayer
  passes: SarPass[]
}

/** Where to put the GUNW browse image on the map. */
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

/** What the map needs to draw the radar overlay. */
export type SarOverlay = {
  layer: SarLayer
  pass: SarPass
  /** Only for "movement" (image overlay). */
  scene: SarScene | null
  opacity: number
}

/** NISAR backscatter tiles from NASA GIBS, one day of passes per date. */
export function gibsSignalTiles(date: string) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/${date}/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

export function formatPassDates(pass: SarPass) {
  const start = new Date(pass.start)
  const end = new Date(pass.end)
  if (pass.layer === "signal") return DAY.format(start)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const from = sameYear
    ? DAY.format(start).replace(/ \d{4}$/, "")
    : DAY.format(start)
  return `${from} → ${DAY.format(end)}`
}

/** UTC calendar day, as GIBS dates its daily layers. */
export function passDay(pass: SarPass) {
  return pass.start.slice(0, 10)
}
