// MapLibre v6 finds its web worker relative to its own module URL, which
// breaks once the library is bundled. Copy the worker into public/ so the
// map can load it from a stable path (see components/map-canvas.tsx).
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"))
const src = join(pkgDir, "dist", "maplibre-gl-worker.mjs")
const dest = join(root, "public", "maplibre-gl-worker.mjs")

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log("Copied MapLibre worker to public/maplibre-gl-worker.mjs")
