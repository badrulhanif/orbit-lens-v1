import {
  inBox,
  type AreaHistory,
  type Bbox,
  type HazardType,
  type HistoryEvent,
} from "@/lib/area"

/**
 * Recorded natural hazards in and around an area, from three open sources:
 *  - Wikidata: named historic disasters with coordinates (e.g. "2008 Bukit
 *    Antarabangsa landslide"), linked to Wikipedia where there's an article
 *  - USGS: earthquakes, M3.5+ since 1970
 *  - NASA EONET: floods (from GDACS), storms, volcanoes, wildfires, landslides
 * Each source is optional: if one is down the others still answer.
 */

const USER_AGENT = "OrbitLens/0.1 (location demo)"

const cache = new Map<string, { at: number; data: AreaHistory }>()
const TTL_MS = 6 * 60 * 60 * 1000

/* ------------------------------------------------------------------ */
/* Wikidata                                                            */
/* ------------------------------------------------------------------ */

const WIKIDATA_TYPES: Record<string, HazardType> = {
  Q167903: "landslide",
  Q8068: "flood",
  Q7944: "earthquake",
  Q8070: "tsunami",
  Q81054: "storm",
  Q169950: "wildfire",
  Q8072: "volcano",
  // Generic "natural disaster" / "disaster": typed from the name below.
  Q8065: "disaster",
  Q3839081: "disaster",
}

function typeFromName(name: string, fallback: HazardType): HazardType {
  const n = name.toLowerCase()
  if (/landslide|tanah runtuh|mudslide/.test(n)) return "landslide"
  if (/flood|banjir/.test(n)) return "flood"
  if (/earthquake|gempa|quake/.test(n)) return "earthquake"
  if (/tsunami/.test(n)) return "tsunami"
  if (/storm|cyclone|typhoon|ribut/.test(n)) return "storm"
  if (/fire|kebakaran/.test(n)) return "wildfire"
  if (/volcan|eruption/.test(n)) return "volcano"
  return fallback
}

type SparqlRow = Record<string, { value: string } | undefined>

async function fromWikidata([w, s, e, n]: Bbox): Promise<HistoryEvent[]> {
  const query = `
SELECT ?item ?itemLabel ?type ?date ?start ?coord ?article ?locCoord WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral .
  }
  ?item wdt:P31 ?type .
  VALUES ?type { ${Object.keys(WIKIDATA_TYPES)
    .map((q) => `wd:${q}`)
    .join(" ")} }
  OPTIONAL { ?item wdt:P585 ?date }
  OPTIONAL { ?item wdt:P580 ?start }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?item wdt:P276 ?loc . ?loc wdt:P625 ?locCoord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ms". }
} LIMIT 300`
  const url = new URL("https://query.wikidata.org/sparql")
  url.searchParams.set("query", query)
  const res = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Wikidata responded ${res.status}`)
  const rows = ((await res.json()) as { results: { bindings: SparqlRow[] } })
    .results.bindings

  const byItem = new Map<string, HistoryEvent>()
  for (const r of rows) {
    const item = r.item?.value
    const coord = r.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/)
    if (!item || !coord) continue
    const qid = item.split("/").pop()!
    const typeQid = r.type?.value.split("/").pop() ?? ""
    const label = r.itemLabel?.value ?? qid
    const date = r.date?.value ?? r.start?.value ?? null
    const baseType = WIKIDATA_TYPES[typeQid] ?? "disaster"
    const type = typeFromName(label, baseType)
    // Items without an English/Malay name come back as their Q-id.
    const hasName = !/^Q\d+$/.test(label)
    const title = hasName
      ? label
      : `${type[0].toUpperCase()}${type.slice(1)}${date ? ` (${date.slice(0, 4)})` : ""}`
    const existing = byItem.get(qid)
    // An item can be typed several ways; keep the most specific.
    if (existing && existing.type !== "disaster") continue
    let latitude = Number(coord[2])
    let longitude = Number(coord[1])
    let approximate = isRough(latitude, longitude)
    // A rough point (e.g. "3.13, 101.68" = central KL) but a linked place
    // with real coordinates ("Bukit Antarabangsa"): use the place.
    const loc = r.locCoord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/)
    if (approximate && loc && !isRough(Number(loc[2]), Number(loc[1]))) {
      latitude = Number(loc[2])
      longitude = Number(loc[1])
      approximate = false
    }
    byItem.set(qid, {
      id: `wd-${qid}`,
      type,
      title,
      date: date?.slice(0, 10) ?? null,
      detail: null,
      source: r.article ? "Wikipedia" : "Wikidata",
      url: r.article?.value ?? item,
      latitude,
      longitude,
      inside: false,
      approximate,
    })
  }
  const events = [...byItem.values()]
  await refineFromWikipedia(events)
  return events
}

/** Coordinates given to 2 decimals or fewer (~1 km+) are city-level guesses. */
function isRough(lat: number, lon: number) {
  const decimals = (v: number) => (String(v).split(".")[1] ?? "").length
  return decimals(lat) <= 2 && decimals(lon) <= 2
}

/**
 * Wikipedia articles sometimes carry a precise secondary coordinate (the
 * actual site) next to a rough primary one. Use it for still-rough events.
 */
async function refineFromWikipedia(events: HistoryEvent[]) {
  const rough = events.filter(
    (e) => e.approximate && e.url?.startsWith("https://en.wikipedia.org/wiki/")
  )
  if (!rough.length) return
  const titles = rough.map((e) =>
    decodeURIComponent(e.url!.split("/wiki/")[1]).replace(/_/g, " ")
  )
  const url = new URL("https://en.wikipedia.org/w/api.php")
  url.search = new URLSearchParams({
    action: "query",
    prop: "coordinates",
    coprimary: "all",
    colimit: "max",
    titles: titles.slice(0, 50).join("|"),
    format: "json",
    redirects: "1",
  }).toString()
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          { title: string; coordinates?: { lat: number; lon: number }[] }
        >
      }
    }
    for (const page of Object.values(data.query?.pages ?? {})) {
      const precise = page.coordinates?.find((c) => !isRough(c.lat, c.lon))
      if (!precise) continue
      const event = rough[titles.indexOf(page.title)]
      if (!event) continue
      event.latitude = precise.lat
      event.longitude = precise.lon
      event.approximate = false
    }
  } catch {
    // Keep the rough points.
  }
}

/* ------------------------------------------------------------------ */
/* USGS earthquakes                                                    */
/* ------------------------------------------------------------------ */

type UsgsFeature = {
  id: string
  properties: { mag: number; place: string | null; time: number; url: string }
  geometry: { coordinates: [number, number, number] }
}

async function fromUsgs([w, s, e, n]: Bbox): Promise<HistoryEvent[]> {
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    `&minlongitude=${w}&maxlongitude=${e}&minlatitude=${s}&maxlatitude=${n}` +
    "&starttime=1970-01-01&minmagnitude=3.5&orderby=magnitude&limit=100"
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`USGS responded ${res.status}`)
  const { features } = (await res.json()) as { features: UsgsFeature[] }
  return features.map((f) => {
    const [longitude, latitude, depth] = f.geometry.coordinates
    return {
      id: `usgs-${f.id}`,
      type: "earthquake",
      title: `M${f.properties.mag.toFixed(1)} earthquake`,
      date: new Date(f.properties.time).toISOString().slice(0, 10),
      detail: [
        f.properties.place,
        depth != null && `${Math.round(depth)} km deep`,
      ]
        .filter(Boolean)
        .join(" · "),
      source: "USGS",
      url: f.properties.url,
      latitude,
      longitude,
      inside: false,
    }
  })
}

/* ------------------------------------------------------------------ */
/* NASA EONET (floods from GDACS, storms, volcanoes, fires…)           */
/* ------------------------------------------------------------------ */

const EONET_TYPES: Record<string, HazardType> = {
  floods: "flood",
  landslides: "landslide",
  severeStorms: "storm",
  volcanoes: "volcano",
  wildfires: "wildfire",
}

type EonetEvent = {
  id: string
  title: string
  categories: { id: string }[]
  sources: { id: string; url: string }[]
  geometry: {
    date: string
    type: "Point" | "Polygon"
    coordinates: [number, number] | [number, number][][]
  }[]
}

async function fromEonet([w, s, e, n]: Bbox): Promise<HistoryEvent[]> {
  const url =
    "https://eonet.gsfc.nasa.gov/api/v3/events?status=all&limit=200" +
    `&category=${Object.keys(EONET_TYPES).join(",")}` +
    `&start=2000-01-01&end=${new Date().toISOString().slice(0, 10)}` +
    `&bbox=${w},${n},${e},${s}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`EONET responded ${res.status}`)
  const { events } = (await res.json()) as { events: EonetEvent[] }
  const out: HistoryEvent[] = []
  for (const ev of events) {
    const g = ev.geometry.at(-1)
    if (!g) continue
    let longitude: number
    let latitude: number
    let outline: [number, number][] | null = null
    if (g.type === "Point") {
      ;[longitude, latitude] = g.coordinates as [number, number]
    } else {
      let ring = (g.coordinates as [number, number][][])[0]
      // Some GDACS rings are [lat, lon]; flip them back.
      if (ring.some(([x, y]) => Math.abs(y) > 90 && Math.abs(x) <= 90)) {
        ring = ring.map(([x, y]) => [y, x])
      }
      outline = ring
      ;[longitude, latitude] = polygonCentre(ring)
    }
    const type = EONET_TYPES[ev.categories[0]?.id] ?? "disaster"
    const source = ev.sources[0]
    out.push({
      id: `eonet-${ev.id}`,
      type,
      // "Flood in Malaysia 1104239" → "Flood in Malaysia"
      title: ev.title.replace(/\s+\d{5,}$/, ""),
      date: g.date.slice(0, 10),
      detail: null,
      source: source?.id === "GDACS" ? "GDACS" : "NASA EONET",
      url: source?.url ?? null,
      latitude,
      longitude,
      inside: false,
      outline,
    })
  }
  return out
}

/** Area-weighted centre of a polygon ring (falls back to the vertex mean). */
function polygonCentre(ring: [number, number][]): [number, number] {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]
    const [x1, y1] = ring[i]
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-12) {
    return [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/* ------------------------------------------------------------------ */

/** Area plus a margin so nearby events can be shown too. */
export function withMargin([w, s, e, n]: Bbox): Bbox {
  const m = Math.max(0.15, Math.max(e - w, n - s) * 0.25)
  return [
    Math.max(-180, w - m),
    Math.max(-85, s - m),
    Math.min(180, e + m),
    Math.min(85, n + m),
  ]
}

/**
 * Some feed records have latitude and longitude swapped (seen in GDACS flood
 * polygons). Swap those back; drop anything that still isn't a real place.
 */
function fixCoordinates(e: HistoryEvent): HistoryEvent | null {
  const ok = (lat: number, lon: number) =>
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  if (ok(e.latitude, e.longitude)) return e
  if (ok(e.longitude, e.latitude)) {
    return { ...e, latitude: e.longitude, longitude: e.latitude }
  }
  return null
}

const snap = (b: Bbox) => b.map((v) => Math.round(v * 20) / 20) as Bbox

/** Even-odd point-in-polygon over all rings (inner rings are holes). */
function inRings(
  p: { latitude: number; longitude: number },
  rings: [number, number][][]
) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (
        yi > p.latitude !== yj > p.latitude &&
        p.longitude < ((xj - xi) * (p.latitude - yi)) / (yj - yi) + xi
      ) {
        inside = !inside
      }
    }
  }
  return inside
}

let boundaries: Promise<Record<string, [number, number][][] | null>> | null =
  null
function loadBoundaries() {
  boundaries ??= import("@/data/boundaries.json")
    .then(
      (m) =>
        (m.default ?? m) as unknown as Record<
          string,
          [number, number][][] | null
        >
    )
    .catch(() => ({}))
  return boundaries
}

/**
 * Hazard records inside an area. `boundaryKey` (a state or district) tests
 * against its real outline as well as its land extent, so offshore events
 * and events in enclaves (KL inside Selangor) are left out.
 */
export async function areaHistory(
  area: Bbox,
  boundaryKey?: string | null
): Promise<AreaHistory> {
  const bbox = snap(area)
  const rings = boundaryKey
    ? ((await loadBoundaries())[boundaryKey] ?? null)
    : null
  const isInside = (e: HistoryEvent) =>
    inBox(e, bbox) && (!rings || inRings(e, rings))
  // Search a little wider: some records sit on rough coordinates that get
  // corrected to a point inside the area.
  const searched = withMargin(bbox)
  const key = searched.join(",")
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return {
      ...hit.data,
      bbox,
      events: hit.data.events
        .map((e) => ({ ...e, inside: isInside(e) }))
        .filter((e) => e.inside),
    }
  }

  const runs = await Promise.allSettled([
    fromWikidata(searched),
    fromUsgs(searched),
    fromEonet(searched),
  ])
  const names = ["Wikipedia / Wikidata", "USGS", "NASA EONET"]
  const events = runs
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .map(fixCoordinates)
    .filter((e): e is HistoryEvent => e !== null)
    // Newest first; undated last.
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))

  // Cached: everything found in the search box (the inside test runs per
  // request, since nearby areas share a search box).
  const data: AreaHistory = {
    bbox,
    searched,
    events,
    sources: runs.map((r, i) => ({
      name: names[i],
      ok: r.status === "fulfilled",
    })),
  }
  const result: AreaHistory = {
    ...data,
    events: events
      .map((e) => ({ ...e, inside: isInside(e) }))
      .filter((e) => e.inside),
  }
  // Only cache complete answers, so a source that was down gets retried.
  if (runs.every((r) => r.status === "fulfilled")) {
    if (cache.size > 200) cache.delete(cache.keys().next().value!)
    cache.set(key, { at: Date.now(), data })
  }
  return result
}
