import Flatbush from "flatbush"

import type { Bbox } from "@/lib/area"

/**
 * State and district outlines (data/boundaries.json, from OpenStreetMap via
 * scripts/fetch-boundaries.mjs). Each is a list of rings; inner rings are
 * holes (e.g. Kuala Lumpur inside Selangor), handled with the even-odd rule.
 */
export type Rings = [number, number][][]

let boundaries: Promise<Record<string, Rings | null>> | null = null

export function loadBoundaries() {
  boundaries ??= import("@/data/boundaries.json")
    .then((m) => (m.default ?? m) as unknown as Record<string, Rings | null>)
    .catch(() => ({}))
  return boundaries
}

export async function ringsFor(key: string | null | undefined) {
  if (!key || key.length > 200) return null
  return (await loadBoundaries())[key] ?? null
}

/** Even-odd point-in-polygon over all rings. */
export function inRings(
  p: { latitude: number; longitude: number },
  rings: Rings
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

/**
 * Raster mask (1 = inside) for an image covering `bbox` (north-up lat/lon
 * grid), filled row by row with the even-odd rule.
 */
export function rasterMask(
  rings: Rings,
  [w, s, e, n]: Bbox,
  width: number,
  height: number
) {
  const mask = new Uint8Array(width * height)
  for (let row = 0; row < height; row++) {
    const lat = n - ((row + 0.5) / height) * (n - s)
    const xs: number[] = []
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > lat !== yj > lat) {
          xs.push(((xj - xi) * (lat - yi)) / (yj - yi) + xi)
        }
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(((xs[k] - w) / (e - w)) * width - 0.5))
      const c1 = Math.min(
        width - 1,
        Math.floor(((xs[k + 1] - w) / (e - w)) * width - 0.5)
      )
      for (let c = c0; c <= c1; c++) mask[row * width + c] = 1
    }
  }
  return mask
}

/** Spatial index of the outlines' boxes, for "which area holds this point". */
let index: Promise<{ keys: string[]; tree: Flatbush } | null> | null = null

function loadIndex() {
  index ??= loadBoundaries().then((all) => {
    const keys = Object.keys(all).filter((k) => all[k]?.length)
    if (!keys.length) return null
    const tree = new Flatbush(keys.length)
    for (const k of keys) {
      let w = 180,
        s = 90,
        e = -180,
        n = -90
      for (const ring of all[k]!)
        for (const [x, y] of ring) {
          if (x < w) w = x
          if (x > e) e = x
          if (y < s) s = y
          if (y > n) n = y
        }
      tree.add(w, s, e, n)
    }
    tree.finish()
    return { keys, tree }
  })
  return index
}

/** Outline keys (states, districts) whose outline holds a point. */
export async function boundariesAt(p: { latitude: number; longitude: number }) {
  const [all, idx] = await Promise.all([loadBoundaries(), loadIndex()])
  if (!idx) return []
  return idx.tree
    .search(p.longitude, p.latitude, p.longitude, p.latitude)
    .map((i) => idx.keys[i])
    .filter((k) => inRings(p, all[k]!))
}
