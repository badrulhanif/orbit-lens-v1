import { distanceMeters, type LatLng, type Place } from "@/lib/geo"

/**
 * Instant offline place search over data/gazetteer.json (GeoNames, built by
 * scripts/build-gazetteer.mjs). Bigger places win when a name is ambiguous:
 * country → state → district → city → town → village, then nearest first.
 */

type Kind =
  | "country"
  | "state"
  | "district"
  | "city"
  | "town"
  | "village"
  | "place"
  | "nature"
  | "spot"

type Row = [
  name: string,
  lat: number,
  lon: number,
  kind: Kind,
  area: string,
  population: number,
  bbox: [number, number, number, number] | null,
  alternates: string[],
]

type Entry = { row: Row; keys: string[] }

const RANK: Record<Kind, number> = {
  country: 0,
  state: 1,
  district: 2,
  city: 3,
  town: 4,
  village: 5,
  place: 6,
  nature: 6,
  spot: 7,
}

const LABEL: Record<Kind, string> = {
  country: "Country",
  state: "State",
  district: "District",
  city: "City",
  town: "Town",
  village: "Village",
  place: "Area",
  nature: "Place",
  spot: "Place",
}

/** How close to zoom when one is picked (no outline data for these). */
const ZOOM: Record<Kind, number> = {
  country: 5,
  state: 8,
  district: 10,
  city: 11,
  town: 13,
  village: 14,
  place: 14,
  nature: 12,
  spot: 15,
}

// Malay/English short forms people type → the words used in place names.
const SHORT: Record<string, string> = {
  kg: "kampung",
  kpg: "kampung",
  kampong: "kampung",
  sg: "sungai",
  sgai: "sungai",
  tmn: "taman",
  jln: "jalan",
  bdr: "bandar",
  bt: "batu",
  pdg: "padang",
  bkt: "bukit",
  seri: "sri",
  pulau: "pulau",
  pp: "pulau pinang",
  kl: "kuala lumpur",
  jb: "johor bahru",
  wp: "wilayah persekutuan",
}

export function normaliseName(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SHORT[w] ?? w)
    .join(" ")
}

let index: Promise<Entry[]> | null = null

function load() {
  index ??= import("@/data/gazetteer.json").then((mod) => {
    const rows = (mod.default ?? mod).rows as Row[]
    return rows.map((row) => ({
      row,
      keys: [row[0], ...row[7]].map(normaliseName),
    }))
  })
  return index
}

/** 0 = exact, 1 = starts with, 2 = a later word starts with; -1 = no match. */
function matchQuality(keys: string[], q: string) {
  let best = -1
  for (const key of keys) {
    if (key === q) return 0
    if (key.startsWith(q)) best = best === -1 ? 1 : Math.min(best, 1)
    else if (best === -1 && key.includes(` ${q}`)) best = 2
  }
  return best
}

export type GazetteerHit = Place & { match: 0 | 1 | 2; rank: number }

export async function searchGazetteer(
  query: string,
  centre: LatLng | null,
  limit = 8
): Promise<GazetteerHit[]> {
  const q = normaliseName(query)
  if (q.length < 2) return []
  const entries = await load()

  const hits: { e: Entry; m: number; d: number }[] = []
  for (const e of entries) {
    const m = matchQuality(e.keys, q)
    if (m < 0) continue
    const [, lat, lon] = e.row
    const d = centre
      ? distanceMeters(centre, { latitude: lat, longitude: lon })
      : 0
    hits.push({ e, m, d })
  }

  hits.sort((a, b) => {
    // 1. How well the name matches.
    if (a.m !== b.m) return a.m - b.m
    const ka = a.e.row[3]
    const kb = b.e.row[3]
    // 2. Bigger kinds of place first (country → state → … → village).
    if (RANK[ka] !== RANK[kb]) return RANK[ka] - RANK[kb]
    // 3. Among same-size places: nearby first, then more people.
    if (Math.abs(a.d - b.d) > 50_000) return a.d - b.d
    return b.e.row[5] - a.e.row[5]
  })

  const out: GazetteerHit[] = []
  const seen = new Set<string>()
  for (const { e, m } of hits) {
    const [name, latitude, longitude, kind, area, , bbox] = e.row
    // Same name, same kind, same area = the same place listed twice.
    const key = `${name}|${kind}|${area}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `g${latitude},${longitude}`,
      name,
      kind: LABEL[kind],
      icon: kind === "spot" || kind === "nature" ? "pin" : "area",
      area,
      address: [name, area].filter(Boolean).join(", "),
      latitude,
      longitude,
      bbox,
      zoom: ZOOM[kind],
      boundaryKey:
        kind === "state" || kind === "district"
          ? `${kind}|${name}|${area}`
          : undefined,
      match: m as 0 | 1 | 2,
      rank: RANK[kind],
    })
    if (out.length >= limit) break
  }
  return out
}
