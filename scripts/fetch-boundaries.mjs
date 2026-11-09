// Downloads simplified outlines for every state and district in
// data/gazetteer.json, so "events in Selangor" means inside Selangor's real
// boundary (with holes for Kuala Lumpur and Putrajaya), not a rectangle.
//
// Source: OpenStreetMap via Nominatim (1 request per second). Writes
// data/boundaries.json: { "<kind>|<name>|<area>": [[[lon,lat],…], …] }
// (a list of rings; inner rings are holes, tested with the even-odd rule).
//
// Run: node scripts/fetch-boundaries.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const gaz = JSON.parse(
  readFileSync(join(root, "data", "gazetteer.json"), "utf8")
)
const outPath = join(root, "data", "boundaries.json")
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {}
const CC = { Malaysia: "my", Singapore: "sg", Brunei: "bn" }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round = (n) => Math.round(n * 1e4) / 1e4

async function outline(name, area, kind) {
  const cc = CC[area.split(", ").pop()] ?? CC[area]
  if (!cc) return null
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("q", name.replace(/^Daerah /, ""))
  url.searchParams.set("countrycodes", cc)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "8")
  url.searchParams.set("polygon_geojson", "1")
  url.searchParams.set("polygon_threshold", "0.003")
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
      (r) =>
        r.category === "boundary" &&
        wanted.includes(r.addresstype) &&
        r.geojson?.type?.includes("Polygon")
    ) ??
    results.find(
      (r) => r.category === "boundary" && r.geojson?.type?.includes("Polygon")
    )
  if (!hit) return null
  const g = hit.geojson
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates
  return polys.flat().map((ring) => ring.map(([x, y]) => [round(x), round(y)]))
}

let n = 0
for (const [name, , , kind, area] of gaz.rows) {
  if (kind !== "state" && kind !== "district") continue
  const key = `${kind}|${name}|${area}`
  if (key in out) continue
  try {
    out[key] = await outline(name, area, kind)
  } catch (err) {
    console.warn("skip", key, err.message)
    continue
  }
  if (++n % 20 === 0) {
    console.log(`fetched ${n}…`)
    writeFileSync(outPath, JSON.stringify(out))
  }
  await sleep(1100)
}
writeFileSync(outPath, JSON.stringify(out))
const have = Object.values(out).filter(Boolean).length
console.log(`done: ${n} new, ${have} outlines`)
