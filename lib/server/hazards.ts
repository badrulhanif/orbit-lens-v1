import {
  distanceMeters,
  type LatLng,
  type Place,
  type PlaceIcon,
} from "@/lib/geo"
import type { SarLayer } from "@/lib/sar"
import { eonetRecords, refine } from "@/lib/server/eonet"
import { fetchJson, TtlCache } from "@/lib/server/util"

/**
 * Hazard searches ("flood", "banjir kelantan", "landslide near Cameron
 * Highlands"…). Each hazard maps to the NISAR layer that shows it, plus a
 * real event feed where one exists:
 *  - NASA EONET (floods via GDACS, volcanoes, storms, wildfires, landslides)
 *  - USGS (earthquakes)
 */

type Source = { kind: "eonet"; category: string } | { kind: "usgs" } | null

type Hazard = {
  key: string
  /** "Flood" */
  label: string
  layer: SarLayer
  /** Why this radar layer helps, shown under the suggestion. */
  why: string
  icon: PlaceIcon
  source: Source
  /** What people type, English and Malay. */
  words: string[]
}

const HAZARDS: Hazard[] = [
  {
    key: "flood",
    label: "Flood",
    layer: "signal",
    why: "Flood water is smooth, so it shows up dark on radar",
    icon: "flood",
    source: { kind: "eonet", category: "floods" },
    words: [
      "flood",
      "floods",
      "flooding",
      "flash flood",
      "banjir",
      "banjir kilat",
    ],
  },
  {
    key: "landslide",
    label: "Landslide",
    layer: "movement",
    why: "Radar picks up slopes shifting by centimetres",
    icon: "landslide",
    source: { kind: "eonet", category: "landslides" },
    words: [
      "landslide",
      "landslides",
      "mudslide",
      "tanah runtuh",
      "cerun runtuh",
    ],
  },
  {
    key: "subsidence",
    label: "Sinking ground",
    layer: "movement",
    why: "Radar picks up ground sinking by centimetres",
    icon: "landslide",
    source: null,
    words: [
      "subsidence",
      "sinking",
      "sinkhole",
      "sinkholes",
      "ground movement",
      "ground deformation",
      "mendap",
      "tanah mendap",
      "lubang benam",
    ],
  },
  {
    key: "earthquake",
    label: "Earthquake",
    layer: "movement",
    why: "Radar measures how far the ground shifted",
    icon: "quake",
    source: { kind: "usgs" },
    words: ["earthquake", "earthquakes", "quake", "gempa", "gempa bumi"],
  },
  {
    key: "volcano",
    label: "Volcano",
    layer: "movement",
    why: "Radar shows a volcano swelling or sinking",
    icon: "volcano",
    source: { kind: "eonet", category: "volcanoes" },
    words: ["volcano", "volcanoes", "eruption", "gunung berapi"],
  },
  {
    key: "storm",
    label: "Storm",
    layer: "signal",
    why: "Radar sees through cloud to the flooding and damage below",
    icon: "storm",
    source: { kind: "eonet", category: "severeStorms" },
    words: ["storm", "storms", "cyclone", "typhoon", "ribut", "taufan"],
  },
  {
    key: "fire",
    label: "Wildfire",
    layer: "signal",
    why: "Burnt land echoes differently from living forest",
    icon: "fire",
    source: { kind: "eonet", category: "wildfires" },
    words: [
      "wildfire",
      "wildfires",
      "forest fire",
      "bush fire",
      "kebakaran hutan",
      "haze",
      "jerebu",
    ],
  },
  {
    key: "deforestation",
    label: "Deforestation",
    layer: "signal",
    why: "Cleared land echoes much weaker than forest",
    icon: "park",
    source: null,
    words: [
      "deforestation",
      "logging",
      "land clearing",
      "penebangan hutan",
      "pembalakan",
    ],
  },
  {
    key: "oil",
    label: "Oil spill",
    layer: "signal",
    why: "Oil calms the sea surface, which shows up dark on radar",
    icon: "flood",
    source: null,
    words: ["oil spill", "oil spills", "tumpahan minyak"],
  },
  {
    key: "mining",
    label: "Mining & reclamation",
    layer: "movement",
    why: "Radar shows ground moving around mines and new land",
    icon: "landslide",
    source: null,
    words: [
      "mining",
      "quarry",
      "lombong",
      "kuari",
      "reclamation",
      "tambak laut",
    ],
  },
]

const NEAR_ME =
  /\b(near ?me|nearby|nearest|around (?:me|here)|dekat ?sini|terdekat|berdekatan|berhampiran)\b/g
const FILLER = /\b(find|cari|show|the|a|an|recent|latest|terkini)\b/g

function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(NEAR_ME, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function matchHazard(text: string) {
  return HAZARDS.find((h) => h.words.includes(text)) ?? null
}

type HazardMatch = { hazard: Hazard; near: string | null }

/**
 * "flood", "banjir kelantan", "landslide near Cameron Highlands",
 * "kelantan flood". Returns null for anything else.
 */
export function detectHazard(query: string): HazardMatch | null {
  const text = normalise(query)
  if (!text) return null

  const whole = matchHazard(text)
  if (whole) return { hazard: whole, near: null }

  // "<hazard> in/near/di/dekat <place>"
  const split = text.match(
    /^(.+?)\s+(?:in|at|near|around|di|dekat|kat)\s+(.+)$/
  )
  if (split) {
    const hazard = matchHazard(split[1])
    if (hazard) return { hazard, near: split[2] }
  }

  // "<hazard> <place>" or "<place> <hazard>", e.g. "banjir kelantan"
  for (const hazard of HAZARDS) {
    for (const word of hazard.words) {
      if (text.startsWith(`${word} `)) {
        return { hazard, near: text.slice(word.length + 1) }
      }
      if (text.endsWith(` ${word}`)) {
        return { hazard, near: text.slice(0, -word.length - 1) }
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Event feeds                                                         */
/* ------------------------------------------------------------------ */

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

const usgsCache = new TtlCache<UsgsFeature[]>(50, 30 * 60_000)

function toPlace(
  hazard: Hazard,
  e: { id: string; latitude: number; longitude: number; date: string }
) {
  return {
    id: e.id,
    kind: `${hazard.label} · ${DAY.format(new Date(e.date))}`,
    icon: hazard.icon,
    latitude: e.latitude,
    longitude: e.longitude,
    bbox: null,
    date: e.date,
    sarLayer: hazard.layer,
  }
}

/** The ~1 year of EONET events around the user, closest first, refined. */
async function eonetEvents(
  hazard: Hazard,
  category: string,
  centre: LatLng | null,
  limit: number
): Promise<Place[]> {
  // Only the user's region: the whole-world feed is ~9 MB and slow. Snapped
  // to a 10° grid so nearby users share the cached answer.
  const lon = Math.round((centre?.longitude ?? 0) / 10) * 10
  const lat = Math.round((centre?.latitude ?? 0) / 10) * 10
  const box: [number, number, number, number] = centre
    ? [lon - 30, Math.max(lat - 25, -90), lon + 30, Math.min(lat + 25, 90)]
    : [-180, -90, 180, 90]
  const since = new Date(Date.now() - 365 * 86400_000)
    .toISOString()
    .slice(0, 10)
  const records = await eonetRecords([category], box, since)
  // Correcting means a GDACS lookup per event, so only for likely results.
  const order = (list: typeof records) =>
    centre
      ? [...list].sort(
          (a, b) => distanceMeters(centre, a) - distanceMeters(centre, b)
        )
      : [...list].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
  const refined = order(await refine(order(records).slice(0, limit * 3)))
  return refined.slice(0, limit).map((e) => ({
    ...toPlace(hazard, { ...e, date: e.date ?? "" }),
    name: e.title,
    area: "",
    address: e.title,
  }))
}

type UsgsFeature = {
  id: string
  properties: { mag: number; place: string | null; time: number }
  geometry: { coordinates: [number, number, number] }
}

/** The year's M4.5+ earthquakes within 3,000 km, closest first. */
async function usgsQuakes(
  hazard: Hazard,
  centre: LatLng,
  limit: number
): Promise<Place[]> {
  const start = new Date(Date.now() - 365 * 86400_000)
    .toISOString()
    .slice(0, 10)
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${centre.latitude.toFixed(1)}&longitude=${centre.longitude.toFixed(1)}` +
    `&maxradiuskm=3000&minmagnitude=4.5&starttime=${start}&orderby=magnitude&limit=50`
  const features = await usgsCache.get(
    url,
    async () =>
      (await fetchJson<{ features: UsgsFeature[] }>(url, { revalidate: 3600 }))
        .features
  )
  return features
    .map((f) => {
      const [longitude, latitude] = f.geometry.coordinates
      const place = f.properties.place ?? ""
      return {
        ...toPlace(hazard, {
          id: `usgs-${f.id}`,
          latitude,
          longitude,
          date: new Date(f.properties.time).toISOString(),
        }),
        name: `M${f.properties.mag.toFixed(1)} earthquake`,
        area: place,
        address: place,
      }
    })
    .sort((a, b) => distanceMeters(centre, a) - distanceMeters(centre, b))
    .slice(0, limit)
}

/** Recent real events for a hazard, closest to `centre` first. */
export async function hazardEvents(
  hazard: Hazard,
  centre: LatLng | null,
  limit = 6
): Promise<Place[]> {
  const source = hazard.source
  try {
    if (source?.kind === "eonet") {
      return await eonetEvents(hazard, source.category, centre, limit)
    }
    if (source?.kind === "usgs" && centre) {
      return await usgsQuakes(hazard, centre, limit)
    }
  } catch {
    // Feed down: no events rather than an error.
  }
  return []
}

export function hazardByKey(key: string) {
  return HAZARDS.find((h) => h.key === key) ?? null
}
