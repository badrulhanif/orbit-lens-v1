// Adds real extents (bounding boxes) to the states and districts in
// data/gazetteer.json, so picking "Putrajaya" frames Putrajaya and its
// hazard history covers exactly that area.
//
// Source: OpenStreetMap via Nominatim (1 request per second, per their
// usage policy). Results are cached in data/bbox-cache.json, so re-runs only
// look up new places.
//
// Run after build-gazetteer: node scripts/enrich-bboxes.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const gazPath = join(root, "data", "gazetteer.json")
const cachePath = join(root, "data", "bbox-cache.json")

const gaz = JSON.parse(readFileSync(gazPath, "utf8"))
const cache = existsSync(cachePath)
  ? JSON.parse(readFileSync(cachePath, "utf8"))
  : {}
const COUNTRY_CODES = { Malaysia: "my", Singapore: "sg", Brunei: "bn" }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function lookup(name, area, kind) {
  const country = area.split(", ").pop()
  const cc = COUNTRY_CODES[country] ?? COUNTRY_CODES[area]
  if (!cc) return null
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("q", name.replace(/^Daerah /, ""))
  url.searchParams.set("countrycodes", cc)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "8")
  const res = await fetch(url, {
    headers: { "User-Agent": "OrbitLens/0.1 (gazetteer build)" },
  })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const results = await res.json()
  const wanted =
    kind === "state"
      ? ["state"]
      : ["county", "district", "city", "state_district", "municipality"]
  const hit =
    results.find(
      (r) => r.category === "boundary" && wanted.includes(r.addresstype)
    ) ?? results.find((r) => r.category === "boundary")
  if (!hit?.boundingbox) return null
  const [s, n, w, e] = hit.boundingbox.map(Number)
  return [w, s, e, n].map((v) => Math.round(v * 1e4) / 1e4)
}

let looked = 0
for (const row of gaz.rows) {
  const [name, , , kind, area] = row
  if (kind !== "state" && kind !== "district") continue
  const key = `${kind}|${name}|${area}`
  if (!(key in cache)) {
    try {
      cache[key] = await lookup(name, area, kind)
    } catch (err) {
      console.warn("skip", key, err.message)
      continue
    }
    looked++
    if (looked % 20 === 0) {
      console.log(`looked up ${looked}…`)
      writeFileSync(cachePath, JSON.stringify(cache))
    }
    await sleep(1100)
  }
  if (cache[key]) row[6] = cache[key]
}

// OSM boundaries for coastal states/districts include their sea area, which
// makes "frame Selangor" show mostly water. Tighten each extent to where its
// towns and villages actually are (1st–99th percentile), inside the boundary.
const SETTLED = new Set(["city", "town", "village", "place"])
const settled = gaz.rows.filter((r) => SETTLED.has(r[3]))
const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
let tightened = 0
for (const row of gaz.rows) {
  const [name, , , kind, area] = row
  if (kind !== "state" && kind !== "district") continue
  // Places name their state/district in their `area` ("Hulu Langat,
  // Selangor, Malaysia"). A state row's own area can hold its admin name
  // when that differs from the row name ("Pulau Pinang" → "Penang").
  const parts = area.split(", ")
  const prefix = kind === "district" ? `${name}, ${parts[0]}` : null
  const stateNames =
    kind === "state" ? [name, parts.length > 1 ? parts[0] : null] : []
  const mine = settled.filter((r) =>
    prefix
      ? r[4].startsWith(prefix)
      : r[4].split(", ").some((p) => stateNames.includes(p))
  )
  if (mine.length < 8) continue
  const lats = mine.map((r) => r[1]).sort((a, b) => a - b)
  const lons = mine.map((r) => r[2]).sort((a, b) => a - b)
  const pad = 0.03
  let box = [
    pct(lons, 0.01) - pad,
    pct(lats, 0.01) - pad,
    pct(lons, 0.99) + pad,
    pct(lats, 0.99) + pad,
  ]
  const osm = row[6]
  if (osm) {
    box = [
      Math.max(box[0], osm[0]),
      Math.max(box[1], osm[1]),
      Math.min(box[2], osm[2]),
      Math.min(box[3], osm[3]),
    ]
    if (box[0] >= box[2] || box[1] >= box[3]) continue
  }
  row[6] = box.map((v) => Math.round(v * 1e4) / 1e4)
  tightened++
}
console.log(`tightened ${tightened} extents to their settled land`)

writeFileSync(cachePath, JSON.stringify(cache))
writeFileSync(gazPath, JSON.stringify(gaz))
const withBox = gaz.rows.filter(
  (r) => (r[3] === "state" || r[3] === "district") && r[6]
).length
console.log(
  `done: ${looked} new lookups, ${withBox} states/districts have extents`
)
