// Builds data/land.json: land outlines (incl. small islands) around
// Malaysia, used to tell onshore from offshore events. State boundaries
// from OpenStreetMap include coastal waters, so they can't do this alone.
//
// Source: Natural Earth 1:10m land + minor islands (public domain).
// Run: node scripts/build-land.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
// lon/lat window: Malaysia, Singapore, Brunei and their neighbours.
const [W, S, E, N] = [92, -12, 128, 22]
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const round = (v) => Math.round(v * 1e4) / 1e4

/** Sutherland–Hodgman: clip a ring to the window rectangle. */
function clip(ring) {
  const edges = [
    [(p) => p[0] >= W, (a, b) => cross(a, b, 0, W)],
    [(p) => p[0] <= E, (a, b) => cross(a, b, 0, E)],
    [(p) => p[1] >= S, (a, b) => cross(a, b, 1, S)],
    [(p) => p[1] <= N, (a, b) => cross(a, b, 1, N)],
  ]
  let out = ring
  for (const [inside, at] of edges) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      if (inside(cur)) {
        if (!inside(prev)) out.push(at(prev, cur))
        out.push(cur)
      } else if (inside(prev)) {
        out.push(at(prev, cur))
      }
    }
    if (!out.length) return []
  }
  return out
}
function cross(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis])
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
}

const rings = []
for (const name of ["ne_10m_land", "ne_10m_minor_islands"]) {
  const res = await fetch(`${BASE}${name}.geojson`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const { features } = await res.json()
  for (const f of features) {
    const polys =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates
    for (const poly of polys) {
      for (const ring of poly) {
        const clipped = clip(ring)
        if (clipped.length >= 3) {
          rings.push(clipped.map(([x, y]) => [round(x), round(y)]))
        }
      }
    }
  }
  console.log("read", name)
}

mkdirSync(join(root, "data"), { recursive: true })
writeFileSync(
  join(root, "data", "land.json"),
  JSON.stringify({ source: "Natural Earth 1:10m (public domain)", rings })
)
console.log(`wrote data/land.json with ${rings.length} rings`)
