import {
  distanceMeters,
  type LatLng,
  type Place,
  type PlaceIcon,
} from "@/lib/geo"
import type { SarLayer } from "@/lib/sar"

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

export type HazardMatch = { hazard: Hazard; near: string | null }

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

const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 30 * 60 * 1000

async function cachedJson<T>(url: string): Promise<T> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`)
  const data = (await res.json()) as T
  if (cache.size > 50) cache.delete(cache.keys().next().value!)
  cache.set(url, { at: Date.now(), data })
  return data
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

type EonetGeometry = {
  date: string
  type: "Point" | "Polygon"
  coordinates: [number, number] | [number, number][][]
}
type EonetEvent = { id: string; title: string; geometry: EonetGeometry[] }

/** A polygon's average vertex: good enough to point at an event. */
function centreOf(g: EonetGeometry): [number, number] {
  if (g.type === "Point") return g.coordinates as [number, number]
  const ring = (g.coordinates as [number, number][][])[0]
  return [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ]
}

async function eonetEvents(hazard: Hazard, category: string): Promise<Place[]> {
  const data = await cachedJson<{ events: EonetEvent[] }>(
    `https://eonet.gsfc.nasa.gov/api/v3/events?category=${category}&status=all&days=365&limit=500`
  )
  return data.events
    .filter((e) => e.geometry.length > 0)
    .map((e) => {
      const latest = e.geometry[e.geometry.length - 1]
      const [longitude, latitude] = centreOf(latest)
      // "Flood in Malaysia 1104239" → "Flood in Malaysia"
      const name = e.title.replace(/\s+\d{5,}$/, "")
      return {
        id: `eonet-${e.id}`,
        name,
        kind: `${hazard.label} · ${DAY.format(new Date(latest.date))}`,
        icon: hazard.icon,
        area: "",
        address: name,
        latitude,
        longitude,
        bbox: null,
        date: latest.date,
        sarLayer: hazard.layer,
      }
    })
}

type UsgsFeature = {
  id: string
  properties: { mag: number; place: string | null; time: number }
  geometry: { coordinates: [number, number, number] }
}

async function usgsQuakes(hazard: Hazard, centre: LatLng): Promise<Place[]> {
  const start = new Date(Date.now() - 365 * 86400_000)
    .toISOString()
    .slice(0, 10)
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${centre.latitude.toFixed(2)}&longitude=${centre.longitude.toFixed(2)}` +
    `&maxradiuskm=3000&minmagnitude=4.5&starttime=${start}&orderby=magnitude&limit=50`
  const data = await cachedJson<{ features: UsgsFeature[] }>(url)
  return data.features.map((f) => {
    const [longitude, latitude] = f.geometry.coordinates
    const date = new Date(f.properties.time).toISOString()
    return {
      id: `usgs-${f.id}`,
      name: `M${f.properties.mag.toFixed(1)} earthquake`,
      kind: `${hazard.label} · ${DAY.format(new Date(date))}`,
      icon: hazard.icon,
      area: f.properties.place ?? "",
      address: f.properties.place ?? "",
      latitude,
      longitude,
      bbox: null,
      date,
      sarLayer: hazard.layer,
    }
  })
}

/** Recent real events for a hazard, closest to `centre` first. */
export async function hazardEvents(
  hazard: Hazard,
  centre: LatLng | null,
  limit = 6
): Promise<Place[]> {
  const source = hazard.source
  if (!source) return []
  let events: Place[] = []
  try {
    if (source.kind === "eonet")
      events = await eonetEvents(hazard, source.category)
    else if (centre) events = await usgsQuakes(hazard, centre)
  } catch {
    return []
  }
  if (!centre) {
    return events
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, limit)
  }
  return events
    .map((e) => ({ e, d: distanceMeters(centre, e) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ e }) => e)
}
