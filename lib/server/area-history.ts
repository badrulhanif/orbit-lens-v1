import { inRings, ringsFor } from "@/lib/server/boundaries"
import {
  describeQuake,
  impactSentence,
  quakeTitle,
} from "@/lib/server/describe"
import { EONET_CATEGORIES, eonetRecords, refine } from "@/lib/server/eonet"
import { isOffshore } from "@/lib/server/land"
import { reliefCentres, warningsFor } from "@/lib/server/local-reports"
import { communityEvents } from "@/lib/server/reports"
import { majorFloodsFor } from "@/lib/server/major-floods"
import { normaliseRegion, regionMatcher } from "@/lib/server/regions"
import { fetchJson, TtlCache, validLatLng } from "@/lib/server/util"
import { wikipediaSummaries, wikiTitle } from "@/lib/server/wikipedia"
import {
  inBox,
  type AreaHistory,
  type Bbox,
  type HazardType,
  type HistoryEvent,
} from "@/lib/area"

/**
 * Recorded natural hazards in an area, from open sources:
 *  - Wikidata: named historic disasters with coordinates (e.g. "2008 Bukit
 *    Antarabangsa landslide"), linked to Wikipedia where there's an article
 *  - USGS: earthquakes, M3.5+ since 1970
 *  - NASA EONET: floods (from GDACS, with GDACS's impact reports), storms,
 *    volcanoes, wildfires, landslides
 *  - Major Malaysian floods (lib/server/major-floods.ts), state-wide records
 *  - Live: JKM relief centres and MetMalaysia warnings (local-reports.ts)
 * Each source is optional: if one is down the others still answer.
 */

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
  // Eruptions (not "volcano", which lists the mountains themselves).
  Q7692360: "volcano",
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
SELECT ?item ?itemLabel ?itemDescription ?type ?date ?start ?coord ?article ?locCoord ?deaths WHERE {
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
  OPTIONAL { ?item wdt:P1120 ?deaths }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ms". }
} LIMIT 300`
  const url = new URL("https://query.wikidata.org/sparql")
  url.searchParams.set("query", query)
  const rows = (
    await fetchJson<{ results: { bindings: SparqlRow[] } }>(url, {
      timeoutMs: 20_000,
      revalidate: 86400,
      headers: { Accept: "application/sparql-results+json" },
    })
  ).results.bindings

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
    const about = r.itemDescription?.value
    const deaths = Number(r.deaths?.value)
    const description = [
      about && `${about[0].toUpperCase()}${about.slice(1)}.`,
      deaths > 0 && `Deaths: ${deaths.toLocaleString("en-GB")}.`,
    ]
      .filter(Boolean)
      .join(" ")
    byItem.set(qid, {
      id: `wd-${qid}`,
      type,
      title,
      date: date?.slice(0, 10) ?? null,
      detail: null,
      description: description || null,
      source: r.article ? "Wikipedia" : "Wikidata",
      url: r.article?.value ?? item,
      latitude,
      longitude,
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
    const data = await fetchJson<{
      query?: {
        pages?: Record<
          string,
          { title: string; coordinates?: { lat: number; lon: number }[] }
        >
      }
    }>(url, { timeoutMs: 8000, revalidate: 86400 })
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
  properties: {
    mag: number
    magType: string | null
    place: string | null
    time: number
    url: string
    felt: number | null
    cdi: number | null
    alert: string | null
    tsunami: number | null
  }
  geometry: { coordinates: [number, number, number] }
}

async function fromUsgs([w, s, e, n]: Bbox): Promise<HistoryEvent[]> {
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    `&minlongitude=${w}&maxlongitude=${e}&minlatitude=${s}&maxlatitude=${n}` +
    "&starttime=1970-01-01&minmagnitude=3.5&orderby=magnitude&limit=100"
  const { features } = await fetchJson<{ features: UsgsFeature[] }>(url, {
    timeoutMs: 15_000,
    revalidate: 10800,
  })
  return features.map((f) => {
    const [longitude, latitude, depth] = f.geometry.coordinates
    return {
      id: `usgs-${f.id}`,
      type: "earthquake",
      title: quakeTitle(f.properties.mag, f.properties.place),
      date: new Date(f.properties.time).toISOString().slice(0, 10),
      detail: [
        f.properties.place,
        depth != null && `${Math.round(depth)} km deep`,
      ]
        .filter(Boolean)
        .join(" · "),
      description: describeQuake({ ...f.properties, depth }),
      source: "USGS",
      url: f.properties.url,
      latitude,
      longitude,
    }
  })
}

/* ------------------------------------------------------------------ */

/** Area plus a margin: state outlines (with their waters) reach past the land box. */
function withMargin([w, s, e, n]: Bbox): Bbox {
  const m = Math.max(0.15, Math.max(e - w, n - s) * 0.25)
  return [
    Math.max(-180, w - m),
    Math.max(-85, s - m),
    Math.min(180, e + m),
    Math.min(85, n + m),
  ]
}

const snap = (b: Bbox) => b.map((v) => Math.round(v * 20) / 20) as Bbox

/** The state's major floods (state-wide, no map point). */
function stateRecords(
  boundaryKey: string | null | undefined,
  bbox: Bbox
): HistoryEvent[] {
  const [kind, name] = boundaryKey?.split("|") ?? []
  if (kind !== "state" || !name) return []
  const centre = {
    latitude: (bbox[1] + bbox[3]) / 2,
    longitude: (bbox[0] + bbox[2]) / 2,
  }
  return majorFloodsFor(name).map((f) => ({
    id: `major-${f.url.split("/wiki/")[1]}`,
    type: "flood",
    title: f.title,
    date: f.date,
    detail: f.detail,
    source: "Wikipedia",
    url: f.url,
    ...centre,
    scope: "state",
  }))
}

type Found = Pick<AreaHistory, "events" | "sources">

// Everything found in a search box. Only complete answers are kept, so a
// source that was down gets retried next time.
const found = new TtlCache<Found>(200, 6 * 60 * 60_000, (f) =>
  f.sources.every((s) => s.ok)
)

async function search(searched: Bbox): Promise<Found> {
  const runs = await Promise.allSettled([
    fromWikidata(searched),
    fromUsgs(searched),
    eonetRecords(EONET_CATEGORIES, searched, "2000-01-01").then(refine),
  ])
  const names = ["Wikipedia / Wikidata", "USGS", "NASA EONET"]
  runs.forEach((r, i) => {
    if (r.status === "rejected")
      console.warn(`[area-history] ${names[i]} failed:`, String(r.reason))
  })
  return {
    events: runs
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((e) => validLatLng(e.latitude, e.longitude)),
    sources: runs.map((r, i) => ({
      name: names[i],
      ok: r.status === "fulfilled",
    })),
  }
}

// Every flood GDACS has for Malaysia: their impact reports name districts,
// which places a flood more precisely than its single map point.
const MALAYSIA: Bbox = [99.5, 0.8, 119.5, 7.5]
const national = new TtlCache<HistoryEvent[]>(1, 30 * 60_000)
const nationalFloods = () =>
  national.get("floods", () =>
    eonetRecords(["floods"], MALAYSIA, "2000-01-01").then(refine)
  )

const settle = <T>(p: Promise<T>, fallback: T) =>
  p.then(
    (value) => ({ value, ok: true }),
    () => ({ value: fallback, ok: false })
  )

/**
 * Hazard records for an area, newest first. With `boundaryKey` (a state or
 * district) "inside" means inside its real outline, plus floods whose
 * impact reports name places in it; events at sea within it (state waters)
 * are flagged `offshore`. Relief centres open now come first.
 */
export async function areaHistory(
  area: Bbox,
  boundaryKey?: string | null
): Promise<AreaHistory> {
  const bbox = snap(area)
  const rings = await ringsFor(boundaryKey)
  const searched = withMargin(bbox)
  const match = await regionMatcher(boundaryKey)

  const [{ events, sources }, floods, centres, warnings] = await Promise.all([
    found.get(searched.join(","), () => search(searched)),
    match ? nationalFloods().catch(() => []) : Promise.resolve([]),
    settle(reliefCentres(), []),
    boundaryKey && match
      ? settle(warningsFor(boundaryKey), [])
      : Promise.resolve(null),
  ])

  const isInside = (e: HistoryEvent) =>
    // Country-level placeholder points don't belong to any one state.
    !(e.source === "GDACS" && e.approximate) &&
    // The real boundary when we have one (the box only frames the map and
    // can clip edge towns like Tawau); otherwise the box.
    (rings ? inRings(e, rings) : inBox(e, bbox))
  const inside = events.filter(isInside)
  const offshore = await Promise.all(inside.map((e) => isOffshore(e)))
  const out = inside.map((e, i) => (offshore[i] ? { ...e, offshore: true } : e))

  const [kind, name] = boundaryKey?.split("|") ?? []

  // Floods with impacts reported here by the agencies: say what, and add
  // those whose GDACS point is elsewhere.
  const ids = new Map(out.map((e, i) => [e.id, i]))
  if (match) {
    for (const f of floods) {
      if (!f.impacts?.length) continue
      const here = []
      const places = new Set<string>()
      for (const i of f.impacts) {
        const inside = await match.parts(i.region, { near: f })
        if (!inside.length) continue
        here.push(i)
        inside.forEach((p) => places.add(p))
      }
      if (!here.length) continue
      const at = ids.get(f.id)
      if (at !== undefined) {
        out[at] = {
          ...out[at],
          detail: `Reported here: ${impactSentence(here, 3)}`,
        }
        continue
      }
      // Named after the places inside this area that reported it (the most
      // specific ones); its map point and original title belong elsewhere.
      const named = [...places]
      const specific = named.filter(
        (p) => normaliseRegion(p) !== normaliseRegion(name ?? "")
      )
      const shown = specific.length ? specific : named
      out.push({
        ...f,
        title: `Flood in ${shown.slice(0, 2).join(" and ")}${shown.length > 2 ? ` +${shown.length - 2}` : ""}`,
        scope: "reported",
        outline: null,
        detail: `Reported here: ${impactSentence(here, 3)} · part of a wider flood`,
      })
    }
  }

  // Relief centres open now, by the state and district JKM gives.
  for (const { event, state, district } of centres.value) {
    const here = match
      ? kind === "state"
        ? normaliseRegion(state) === normaliseRegion(name)
        : await match(district, { state })
      : !event.scope && inBox(event, bbox)
    if (here) out.push(event)
  }

  // Public reports approved by a moderator, inside the area.
  const community = await communityEvents(searched).catch(() => [])
  for (const e of community)
    if (rings ? inRings(e, rings) : inBox(e, bbox)) out.push(e)

  out.push(...stateRecords(boundaryKey, bbox))
  await addSummaries(out)
  out.sort(
    (a, b) =>
      Number(!!b.live) - Number(!!a.live) ||
      (b.date ?? "").localeCompare(a.date ?? "")
  )

  return {
    bbox,
    searched,
    sources: [
      ...sources,
      { name: "JKM relief centres", ok: centres.ok },
      ...(warnings ? [{ name: "MetMalaysia warnings", ok: warnings.ok }] : []),
    ],
    warnings: warnings?.value ?? [],
    events: out,
  }
}

/** Wikipedia's opening sentences for events linked to an article. */
async function addSummaries(events: HistoryEvent[]) {
  const linked = events.filter((e) => wikiTitle(e.url))
  if (!linked.length) return
  const summaries = await wikipediaSummaries(linked.map((e) => e.url)).catch(
    () => new Map<string, string>()
  )
  for (const e of linked) {
    const text = summaries.get(wikiTitle(e.url)!)
    if (text) e.description = text
  }
}
