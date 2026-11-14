// Builds data/gazetteer.json: an offline place index for instant, ranked
// search (country → state → district → town → kampung).
//
// Source: GeoNames (https://www.geonames.org), CC BY 4.0.
//   - Malaysia, Singapore, Brunei: every state, district, town and village
//   - World: cities over 15,000 people, and every country (with its extent)
//
// Run: node scripts/build-gazetteer.mjs   (needs `unzip` on the PATH)
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = "https://download.geonames.org/export/dump/"
const LOCAL_COUNTRIES = ["MY", "SG", "BN"]
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const work = mkdtempSync(join(tmpdir(), "geonames-"))

async function download(name) {
  const res = await fetch(BASE + name)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const path = join(work, name)
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  if (name.endsWith(".zip"))
    execFileSync("unzip", ["-o", "-q", path, "-d", work])
  console.log("downloaded", name)
  return path
}

const rows = (file) =>
  readFileSync(join(work, file), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"))

await Promise.all([
  ...LOCAL_COUNTRIES.map((c) => download(`${c}.zip`)),
  download("cities15000.zip"),
  download("shapes_simplified_low.json.zip"),
  download("countryInfo.txt"),
  download("admin1CodesASCII.txt"),
  download("admin2Codes.txt"),
])

// Lookup tables ---------------------------------------------------------
const countries = new Map() // ISO → { name, geonameId }
const countryById = new Map()
for (const r of rows("countryInfo.txt")) {
  const info = { iso: r[0], name: r[4], geonameId: r[16] }
  countries.set(r[0], info)
  countryById.set(r[16], info)
}
const admin1 = new Map(rows("admin1CodesASCII.txt").map((r) => [r[0], r[1]]))
const admin2 = new Map(rows("admin2Codes.txt").map((r) => [r[0], r[1]]))

const area = (cc, a1, a2, skip) =>
  [
    admin2.get(`${cc}.${a1}.${a2}`),
    admin1.get(`${cc}.${a1}`),
    countries.get(cc)?.name,
  ]
    .filter((v) => v && v !== skip)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(", ")

// Kinds, biggest first. The app ranks by this order.
// country, state, district, city, town, village, place, nature, spot
const out = []
const round = (n) => Math.round(n * 1e4) / 1e4

// Countries, with an extent from their outline ----------------------------
const shapes = JSON.parse(
  readFileSync(join(work, "shapes_simplified_low.json"), "utf8")
)
for (const f of shapes.features) {
  const info = countryById.get(String(f.properties.geoNameId))
  if (!info) continue
  const pts = f.geometry.coordinates.flat(f.geometry.type === "Polygon" ? 1 : 2)
  let w = 180,
    s = 90,
    e = -180,
    n = -90
  for (const [x, y] of pts) {
    w = Math.min(w, x)
    e = Math.max(e, x)
    s = Math.min(s, y)
    n = Math.max(n, y)
  }
  // Countries across the antimeridian (Russia, Fiji…) would span the globe;
  // leave those without an extent.
  const bbox = e - w > 180 ? null : [w, s, e, n].map(round)
  out.push([
    info.name,
    round((s + n) / 2),
    round((w + e) / 2),
    "country",
    "",
    0,
    bbox,
    [],
  ])
}

// Local countries: everything named ---------------------------------------
const NATURE = new Set([
  "MT",
  "MTS",
  "HLL",
  "ISL",
  "ISLS",
  "PEN",
  "LK",
  "RSV",
  "BCH",
  "CAPE",
])
const SPOTS = new Set([
  "AIRP",
  "HSP",
  "UNIV",
  "STDM",
  "MUS",
  "PRT",
  "MSQE",
  "TMPL",
  "CH",
])
const PARKS = new Set(["PRK", "RESV", "RESF", "RESN"])

for (const cc of LOCAL_COUNTRIES) {
  for (const r of rows(`${cc}.txt`)) {
    const [, name, , alt, lat, lon, cls, code, , , a1, a2] = r
    const pop = Number(r[14]) || 0
    let kind = null
    if (cls === "A") {
      if (code === "ADM1") kind = "state"
      else if (code === "ADM2") kind = "district"
      else if (code === "ADM3") kind = "place"
    } else if (cls === "P") {
      if (code === "PPLX") kind = "place"
      else if (code === "PPLC" || code === "PPLA" || pop >= 100000)
        kind = "city"
      else if (code === "PPLA2" || pop >= 5000) kind = "town"
      else kind = "village"
    } else if (cls === "T" && NATURE.has(code)) kind = "nature"
    else if (cls === "H" && NATURE.has(code)) kind = "nature"
    else if (cls === "L" && PARKS.has(code)) kind = "nature"
    else if (cls === "S" && SPOTS.has(code)) kind = "spot"
    if (!kind) continue

    // A few alternate spellings for bigger places ("Pulau Pinang" → Penang).
    const alts =
      kind === "state" || kind === "district" || pop >= 20000
        ? alt
            .split(",")
            .filter((a) => /^[A-Za-z][A-Za-z .'-]{2,39}$/.test(a) && a !== name)
            .slice(0, 6)
        : []
    out.push([
      name,
      round(+lat),
      round(+lon),
      kind,
      area(cc, a1, a2, name),
      pop,
      null,
      alts,
    ])
  }
}

// World cities --------------------------------------------------------------
for (const r of rows("cities15000.txt")) {
  const [, name, , , lat, lon, , code, cc, , a1] = r
  if (LOCAL_COUNTRIES.includes(cc)) continue
  const pop = Number(r[14]) || 0
  const kind = code === "PPLC" || pop >= 100000 ? "city" : "town"
  out.push([
    name,
    round(+lat),
    round(+lon),
    kind,
    area(cc, a1, "", name),
    pop,
    null,
    [],
  ])
}

mkdirSync(join(root, "data"), { recursive: true })
writeFileSync(
  join(root, "data", "gazetteer.json"),
  JSON.stringify({
    source: "GeoNames (geonames.org), CC BY 4.0",
    built: new Date().toISOString().slice(0, 10),
    // [name, lat, lon, kind, area, population, bbox|null, alternateNames]
    rows: out,
  })
)
rmSync(work, { recursive: true, force: true }) // the GeoNames downloads
console.log(`wrote data/gazetteer.json with ${out.length} places`)
