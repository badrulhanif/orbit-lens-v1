import type { Bbox } from "@/lib/area"

/**
 * "Likely why": the physical drivers that best explain a measured change,
 * from what each radar polarization did. These are hypotheses to check on
 * the ground or in other data, not conclusions; each says what radar
 * evidence it rests on.
 */

export type Driver = {
  id: string
  /** The likely cause, in plain words. */
  cause: string
  /** The radar evidence behind it. */
  evidence: string
}

type CoverDate = {
  date: string
  water: number
  vegetation: number
  open: number
  built: number
  rvi: number
}

export type PolStats = {
  a: { hh: number | null; hv: number | null }
  b: { hh: number | null; hv: number | null }
  /** Median dB change where land stayed vegetated / open. */
  vegHH: number | null
  vegHV: number | null
  openHH: number | null
  openHV: number | null
  vegPixels: number
  openPixels: number
}

export type CoverResult = {
  a: CoverDate
  b: CoverDate
  newWater: number
  receded: number
  vegLost: number
  vegGained: number
  measured: number
  pol?: PolStats
}

/** "+3.2", "-1.0", "0.0": a plus sign on positive values. */
export const signed = (v: number, digits = 1) =>
  `${v > 0 ? "+" : ""}${v.toFixed(digits)}`
const db = (v: number) => `${signed(v)} dB`
export const km2 = (v: number) =>
  `${v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(1)} km²`

/** Malaysia, Singapore, Brunei, southern Thailand, Sumatra's north. */
const inMalaysiaRegion = (b: Bbox) => {
  const lon = (b[0] + b[2]) / 2
  const lat = (b[1] + b[3]) / 2
  return lon >= 95 && lon <= 120 && lat >= -2 && lat <= 8
}

/** Month (1–12) of "YYYY-MM-DD". */
const month = (d: string) => Number(d.slice(5, 7))

/** A change is worth explaining: ≥ 1 km² or ≥ 0.5% of the land. */
const notable = (v: number, measured: number) =>
  v >= 1 || (measured > 0 && v / measured >= 0.005)

/** Fires seen between the two passes (from heat-sensing satellites). */
export type FireInfo = {
  count: number
  /** FIRMS: hotspots from NASA's VIIRS sensor; EONET: recorded wildfires. */
  source: "FIRMS" | "EONET"
}

const fireWords = (f: FireInfo) =>
  f.source === "FIRMS"
    ? `${f.count.toLocaleString("en-GB")} fire hotspot${f.count === 1 ? "" : "s"} (NASA FIRMS)`
    : `${f.count} recorded wildfire${f.count === 1 ? "" : "s"} (NASA EONET)`

export function coverDrivers(
  c: CoverResult,
  bbox: Bbox,
  fires?: FireInfo | null
): Driver[] {
  const out: Driver[] = []
  const p = c.pol
  const local = inMalaysiaRegion(bbox)
  const m = month(c.b.date)

  if (notable(c.newWater, c.measured)) {
    const monsoon = local && (m >= 11 || m <= 3)
    out.push({
      id: "flood",
      cause: monsoon
        ? "Monsoon flooding: the north-east monsoon (November to March) brings days of heavy rain, and river plains fill first."
        : "Flooding after heavy rain, a river breaking its banks, or new ponds (sand or tin mining, aquaculture).",
      evidence: `${km2(c.newWater)} turned to water. Calm water reflects the radar away like a mirror, so HH and HV both went dark.`,
    })
    if (c.b.open + c.a.open > c.b.vegetation * 0.3) {
      out.push({
        id: "paddy",
        cause: local
          ? "Rice fields flooded on purpose before planting (Kedah, Perlis, Sekinchan and Kelantan plant around April and again from September to November)."
          : "Farm fields flooded on purpose for planting (e.g. rice).",
        evidence:
          "Flat fields under a few cm of water look exactly like flood water to radar; check whether the new water sits in a field grid.",
      })
    }
  }

  if (notable(c.receded, c.measured)) {
    out.push({
      id: "receded",
      cause:
        "Water draining away: a flood going down, or rice fields drained before harvest.",
      evidence: `${km2(c.receded)} of water turned back to land; HH brightened as rough ground or crops replaced the smooth water.`,
    })
  }

  if (
    p?.vegHH != null &&
    p.vegHV != null &&
    p.vegPixels >= 200 &&
    p.vegHH >= 2 &&
    Math.abs(p.vegHV) < 1.5
  ) {
    out.push({
      id: "under-canopy",
      cause:
        "Water under the trees: flooded forest, peat swamp or mangrove. NISAR's long L-band wave passes through the leaves; the water underneath bounces it off the trunks and straight back.",
      evidence: `In forest that stayed forest, HH rose ${db(p.vegHH)} while HV barely moved (${db(p.vegHV)}). That "double bounce" is the classic sign; optical satellites and C-band radar can't see it.`,
    })
  }

  if (notable(c.vegLost, c.measured)) {
    // Radar can't tell a fire from a chainsaw; heat-sensing satellites can.
    if (fires && fires.count > 0)
      out.push({
        id: "fire",
        cause:
          "Burn scar: fire most likely cleared some of it (in Malaysia often peat or land-clearing fires in the dry months).",
        evidence: `${fireWords(fires)} between the two passes, and HV, the echo from branches and leaves, fell where the vegetation was lost.`,
      })
    out.push({
      id: "clearing",
      cause: local
        ? "Vegetation removed: land clearing, logging, oil-palm or rubber replanting (every 20–25 years), or crops harvested."
        : "Vegetation removed: land clearing, logging, fire, or crops harvested.",
      evidence:
        `${km2(c.vegLost)} went from vegetation to open land and HV, which comes from branches and leaves, fell by more than half (3 dB).` +
        (fires?.source === "FIRMS" && fires.count === 0
          ? " No fire hotspots were seen between the passes, so it wasn't fire."
          : ""),
    })
  }

  if (notable(c.vegGained, c.measured)) {
    out.push({
      id: "growth",
      cause:
        "Plants growing: crops coming up, or young plantations and cleared land growing back.",
      evidence: `${km2(c.vegGained)} went from open land to vegetation as HV doubled (+3 dB) with more leaf and branch volume.`,
    })
  }

  if (
    p?.openHH != null &&
    p.openPixels >= 200 &&
    !notable(c.newWater, c.measured)
  ) {
    if (p.openHH >= 1.5)
      out.push({
        id: "wetter",
        cause: "Wetter soil, most likely from rain between the two passes.",
        evidence: `On open land that stayed open, HH rose ${db(p.openHH)}. Water raises the soil's dielectric constant, so damp ground echoes more strongly.`,
      })
    else if (p.openHH <= -1.5)
      out.push({
        id: "drier",
        cause: "Drier soil, or fields ploughed smooth or harvested.",
        evidence: `On open land that stayed open, HH fell ${db(p.openHH)}.`,
      })
  }

  // Building takes months; over shorter spans a "built" gain is mostly wet
  // ground or young crops briefly echoing brightly.
  const builtGain = c.b.built - c.a.built
  const days = (Date.parse(c.b.date) - Date.parse(c.a.date)) / 86_400_000
  if (
    days >= 180 &&
    builtGain >= 1 &&
    builtGain / Math.max(c.a.built, 1) >= 0.05
  ) {
    out.push({
      id: "built",
      cause:
        "Possibly new construction: buildings and walls bounce the radar straight back.",
      evidence: `Built-up area grew by ${km2(builtGain)} (HH and HV both brighter). Wet ground can look the same; confirm with a later pass or imagery.`,
    })
  }

  return out
}

type Stats = { p5: number; p95: number; moving: number; threshold: number }

/** Drivers for a ground-movement trend (relative to the area's median). */
export function movementDrivers(
  s: Stats,
  unit: "mm/yr" | "mm",
  bbox: Bbox,
  /** Typical ± of the values, when known. */
  uncertainty?: number | null
): Driver[] {
  const out: Driver[] = []
  const local = inMalaysiaRegion(bbox)
  const t = s.threshold
  if (s.p5 <= -t && s.moving >= 0.03) {
    out.push({
      id: "subsidence",
      cause: local
        ? "Ground sinking: soft ground settling (peat in Selangor, Johor and Sarawak, river clay, reclaimed coast), new buildings loading soft soil, groundwater pumping, or mining and quarries."
        : "Ground sinking: soft or reclaimed ground settling, new buildings loading soft soil, groundwater pumping, or mining.",
      evidence: `Parts of the area moved away from the satellite (${s.p5.toFixed(1)} ${unit} at the 5th percentile) compared with the rest. On a slope, sliding downhill can read the same way.`,
    })
  }
  if (s.p95 >= t && s.moving >= 0.03) {
    out.push({
      id: "uplift",
      cause:
        "Ground moving toward the satellite: soil swelling after wet weather, slopes creeping toward the radar's look direction, or ground recovering after pumping stops.",
      evidence: `Parts moved toward the satellite (+${s.p95.toFixed(1)} ${unit} at the 95th percentile).`,
    })
  }
  // Movement within twice its own uncertainty isn't a finding yet (wet
  // paddy and weather easily reach one ±).
  const biggest = Math.max(Math.abs(s.p5), Math.abs(s.p95))
  if (uncertainty != null && biggest < 2 * uncertainty) {
    return [
      {
        id: "unclear",
        cause:
          "Not clear yet: the movement is within twice its uncertainty, so it may be weather delay or wet fields rather than the ground.",
        evidence: `5–95% of the area: ${signed(s.p5)} to ${signed(s.p95)} ${unit}, uncertainty ±${uncertainty} ${unit}. More passes will tighten this.`,
      },
    ]
  }
  if (!out.length) {
    out.push({
      id: "stable",
      cause: "Stable ground: nothing moving beyond the measurement noise.",
      evidence: `Under ${Math.round(s.moving * 100)}% of the area moved more than ${t} ${unit}.`,
    })
  }
  return out
}
