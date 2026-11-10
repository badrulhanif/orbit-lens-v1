// Snapshot of GDACS flood event data (position, dates, alert, impacts by
// district) for Southeast Asia, written to data/gdacs.json.
//
// GDACS answers slowly (2–40 s per event), so the app reads finished events
// from this file and only asks GDACS about new ones. Re-run to refresh:
//   npm run data:gdacs
// Existing entries are kept; events that ended in the last 30 days (whose
// impact figures may still grow) are fetched again.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../data/gdacs.json")
const UA = { "User-Agent": "OrbitLens/0.1 (data snapshot)" }
// Same window as data/land.json.
const BBOX = "92,22,128,-12"

const today = new Date().toISOString().slice(0, 10)
const list = await fetch(
  `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&limit=2000&category=floods&start=2000-01-01&end=${today}&bbox=${BBOX}`,
  { headers: UA }
).then((r) => r.json())

const ids = [
  ...new Set(
    list.events
      .map((e) => e.sources?.[0]?.url?.match(/eventid=(\d+)/)?.[1])
      .filter(Boolean)
  ),
]

const kept = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {}
const recent = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
const todo = ids.filter(
  (id) =>
    !(id in kept) ||
    (kept[id] && (kept[id].properties?.todate ?? "") >= recent)
)
console.log(`${ids.length} events, ${todo.length} to fetch`)

async function get(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=FL&eventid=${id}`,
        { headers: UA, signal: AbortSignal.timeout(60_000) }
      )
      // Removed from GDACS: remember that, so the app doesn't ask again.
      if (res.status === 404) return "missing"
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      const p = d.properties ?? {}
      // Only what the app reads.
      return {
        geometry: d.geometry,
        properties: {
          affectedcountries: (p.affectedcountries ?? []).map((c) => ({
            countryname: c.countryname,
          })),
          fromdate: p.fromdate,
          todate: p.todate,
          alertlevel: p.alertlevel,
          sendai: (p.sendai ?? []).map((s) => ({
            sendainame: s.sendainame,
            sendaivalue: s.sendaivalue,
            region: s.region,
          })),
        },
      }
    } catch (error) {
      console.warn(`  ${id}: ${error.message}${attempt < 2 ? ", retrying" : ""}`)
    }
  }
  return null
}

let done = 0
const queue = [...todo]
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const id = queue.shift()
      const data = await get(id)
      if (data) kept[id] = data === "missing" ? null : data
      if (++done % 10 === 0) console.log(`  ${done}/${todo.length}`)
    }
  })
)

writeFileSync(OUT, JSON.stringify(kept))
console.log(`Wrote ${Object.keys(kept).length} events to data/gdacs.json`)
