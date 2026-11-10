import type { Bbox } from "@/lib/area"
import { rasterMask, type Rings } from "@/lib/server/boundaries"
import { landRingsIn } from "@/lib/server/land"
import { cropMovementNative, cropSignal } from "@/lib/server/sar-crop"
import { loadSharp, TtlCache } from "@/lib/server/util"

/**
 * Pixels to count: inside the area's outline (when given) and on land.
 * State outlines include coastal waters; without the land mask, sea and
 * tides would count as "water extent" and "new water".
 */
async function areaMask(
  rings: Rings | null,
  bbox: Bbox,
  width: number,
  height: number
) {
  const land = await landRingsIn(bbox)
  // Each outline filled on its own (islands can overlap the main land).
  let onLand: Uint8Array | null = null
  for (const ring of land ?? []) {
    const m = rasterMask([ring], bbox, width, height)
    if (!onLand) onLand = m
    else for (let p = 0; p < m.length; p++) onLand[p] |= m[p]
  }
  const inArea = rings ? rasterMask(rings, bbox, width, height) : null
  if (!inArea) return onLand
  if (onLand) for (let p = 0; p < inArea.length; p++) inArea[p] &= onLand[p]
  return inArea
}

/**
 * Analysis of NISAR preview images for one area. These are estimates from
 * NASA's 8-bit preview renders (GIBS backscatter, ASF interferogram browse
 * images), not calibrated measurements.
 *
 * Backscatter (GCOV false colour: red ≈ HH, green ≈ HV):
 *   water      very dark (smooth surface bounces the radar away)
 *   vegetation green dominant (strong HV volume scattering from canopies)
 *   built-up   bright red/orange (strong HH, double bounce off buildings)
 *   open land  the rest (bare soil, crops, plantations)
 *
 * Interferograms: where the wrapped phase is smooth the two passes are
 * coherent; where it's speckled pixel to pixel, coherence is lost (water,
 * dense canopy, or ground that changed between passes).
 */

type LandClass = "water" | "vegetation" | "open" | "built"
const CLASSES: LandClass[] = ["water", "vegetation", "open", "built"]

function classify(r: number, g: number): number {
  if (Math.max(r, g) < 60) return 0
  if (g >= 1.25 * r && g >= 90) return 1
  if (r >= 175 && r > g * 1.05) return 3
  return 2
}

/**
 * Class per pixel (-1 = no data), smoothed with a 3×3 majority vote so
 * single speckled pixels don't count as change.
 */
function classGrid(img: { data: Buffer; width: number; height: number }) {
  const { data, width: W, height: H } = img
  const raw = new Int8Array(W * H).fill(-1)
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (data[i + 3] >= 200) raw[p] = classify(data[i], data[i + 1])
  }
  const out = new Int8Array(W * H).fill(-1)
  const votes = [0, 0, 0, 0]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (raw[p] < 0) continue
      votes.fill(0)
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= W) continue
          const c = raw[yy * W + xx]
          if (c >= 0) votes[c]++
        }
      }
      let best = raw[p]
      for (let c = 0; c < 4; c++) if (votes[c] > votes[best]) best = c
      out[p] = best
    }
  }
  return out
}

/** Area of a lon/lat box in km². */
function areaKm2([w, s, e, n]: Bbox) {
  const lat = (((s + n) / 2) * Math.PI) / 180
  return (e - w) * 111.32 * Math.cos(lat) * ((n - s) * 110.57)
}

async function raw(png: Buffer) {
  const sharp = await loadSharp()
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/* ------------------------------------------------------------------ */
/* Backscatter: land cover and change                                  */
/* ------------------------------------------------------------------ */

type CoverStats = Record<LandClass, number> & {
  /** Share of the area with data on this date. */
  coverage: number
}

type SignalChange = {
  /** km² per class on each date, over pixels both dates cover. */
  a: Record<LandClass, number>
  b: Record<LandClass, number>
  /** km² that changed class. */
  newWater: number
  waterLoss: number
  vegetationLoss: number
  vegetationGain: number
  /** Mean brightness change on land that's open/crop on both dates, %. */
  openBrightening: number | null
  /** Share of the area both dates cover. */
  coverage: number
  /** Area of the box, km². */
  areaKm2: number
}

async function signalChange(
  dateA: string,
  dateB: string,
  bbox: Bbox,
  rings: Rings | null = null
): Promise<{ stats: SignalChange; map: Buffer }> {
  const sharp = await loadSharp()
  const [A, B] = await Promise.all([
    cropSignal(dateA, bbox).then(raw),
    cropSignal(dateB, bbox).then(raw),
  ])
  const total = A.width * A.height
  const pxKm2 = areaKm2(bbox) / total
  const mask = await areaMask(rings, bbox, A.width, A.height)
  const a = [0, 0, 0, 0]
  const b = [0, 0, 0, 0]
  let common = 0
  let newWater = 0
  let waterLoss = 0
  let vegLoss = 0
  let vegGain = 0
  let lumA = 0
  let lumB = 0
  let openBoth = 0
  const map = Buffer.alloc(total * 4)

  const inside = mask ? mask.reduce((t, v) => t + v, 0) : total
  const ga = classGrid(A)
  const gb = classGrid(B)
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    if (mask && !mask[p]) continue
    const ca = ga[p]
    const cb = gb[p]
    if (ca < 0 || cb < 0) continue
    common++
    a[ca]++
    b[cb]++
    let colour: number[] | null = null
    if (cb === 0 && ca !== 0) {
      newWater++
      colour = [37, 99, 235, 230] // new water: blue
    } else if (ca === 0 && cb !== 0) {
      waterLoss++
      colour = [125, 211, 252, 200] // water receded: light blue
    } else if (ca === 1 && cb !== 1 && cb !== 0) {
      vegLoss++
      colour = [234, 88, 12, 230] // vegetation lost: orange
    } else if (cb === 1 && ca !== 1 && ca !== 0) {
      vegGain++
      colour = [22, 163, 74, 200] // vegetation gained: green
    }
    if (ca === 2 && cb === 2) {
      openBoth++
      lumA += A.data[i] + A.data[i + 1]
      lumB += B.data[i] + B.data[i + 1]
    }
    if (colour) map.set(colour, i)
  }

  const km = (n: number) => Math.round(n * pxKm2 * 10) / 10
  const toRecord = (counts: number[]) =>
    Object.fromEntries(CLASSES.map((c, k) => [c, km(counts[k])])) as Record<
      LandClass,
      number
    >

  return {
    stats: {
      a: toRecord(a),
      b: toRecord(b),
      newWater: km(newWater),
      waterLoss: km(waterLoss),
      vegetationLoss: km(vegLoss),
      vegetationGain: km(vegGain),
      openBrightening:
        openBoth > 50 && lumA > 0 ? ((lumB - lumA) / lumA) * 100 : null,
      coverage: inside ? common / inside : 0,
      areaKm2: Math.round(inside * pxKm2),
    },
    map: await sharp(map, {
      raw: { width: A.width, height: A.height, channels: 4 },
    })
      .png()
      .toBuffer(),
  }
}

/** Land cover shares (0–1 of the covered area) on one date. */
export async function signalCover(
  date: string,
  bbox: Bbox,
  rings: Rings | null = null
): Promise<CoverStats> {
  const img = await raw(await cropSignal(date, bbox))
  const mask = await areaMask(rings, bbox, img.width, img.height)
  const inside = mask ? mask.reduce((t, v) => t + v, 0) : img.width * img.height
  const n = [0, 0, 0, 0]
  let valid = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (mask && !mask[i / 4]) continue
    if (img.data[i + 3] < 200) continue
    valid++
    n[classify(img.data[i], img.data[i + 1])]++
  }
  const share = (k: number) => (valid ? n[k] / valid : 0)
  return {
    water: share(0),
    vegetation: share(1),
    open: share(2),
    built: share(3),
    coverage: inside ? valid / inside : 0,
  }
}

/* ------------------------------------------------------------------ */
/* Interferograms: coherence                                           */
/* ------------------------------------------------------------------ */

/** true where the interferogram is speckled (coherence lost). */
function decorrelated(img: { data: Buffer; width: number; height: number }) {
  const { data, width: W, height: H } = img
  const out = new Int8Array(W * H).fill(-1) // -1 no data, 0 coherent, 1 lost
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = (y * W + x) * 4
      if (data[i + 3] < 200) continue
      let d = 0
      let m = 0
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue
          const j = ((y + dy) * W + x + dx) * 4
          if (data[j + 3] < 200) continue
          m++
          d +=
            Math.abs(data[i] - data[j]) +
            Math.abs(data[i + 1] - data[j + 1]) +
            Math.abs(data[i + 2] - data[j + 2])
        }
      }
      if (m) out[y * W + x] = d / m > 110 ? 1 : 0
    }
  }
  return out
}

type CoherenceChange = {
  /** Share of covered ground that's coherent (measurable) in each pair. */
  coherentA: number
  coherentB: number
  /** km² coherent in pair A but lost in pair B: newly disturbed ground. */
  newlyLost: number
  /** km² that regained coherence. */
  regained: number
  coverage: number
  areaKm2: number
}

/** Second-pass date of an interferogram ("…_20261007T…_20261019T…"). */
function secondaryDay(granule: string) {
  const t = granule.match(/_(\d{8})T\d{6}_\d{8}T\d{6}_(\d{8})T/)
  const d = t?.[2]
  return d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null
}

/**
 * Water mask (1 = water) from the backscatter on a pass date: water never
 * holds coherence, and OSM state boundaries include the sea.
 */
async function waterMask(
  granule: string,
  bbox: Bbox,
  width: number,
  height: number
) {
  const size = width * height
  const day = secondaryDay(granule)
  if (!day) return null
  try {
    const img = await raw(await cropSignal(day, bbox, { width, height }))
    if (img.width * img.height !== size) return null
    const mask = new Uint8Array(size)
    for (let p = 0, i = 0; p < size; p++, i += 4) {
      if (
        img.data[i + 3] >= 200 &&
        classify(img.data[i], img.data[i + 1]) === 0
      ) {
        mask[p] = 1
      }
    }
    return mask
  } catch {
    return null
  }
}

async function movementChange(
  granuleA: string,
  granuleB: string,
  bbox: Bbox,
  rings: Rings | null = null
): Promise<{ stats: CoherenceChange; map: Buffer }> {
  const sharp = await loadSharp()
  const [A, B] = await Promise.all([
    cropMovementNative(granuleA, bbox).then(raw),
    cropMovementNative(granuleB, bbox).then(raw),
  ])
  // Pairs from the same track/frame line up pixel for pixel; otherwise skip.
  if (A.width !== B.width || A.height !== B.height) {
    throw new Error("Interferograms don't line up")
  }
  const water = await waterMask(granuleB, bbox, A.width, A.height)
  const da = decorrelated(A)
  const db = decorrelated(B)
  const total = A.width * A.height
  const pxKm2 = areaKm2(bbox) / total
  const mask = await areaMask(rings, bbox, A.width, A.height)
  if (water) {
    // Count land only.
    for (let p = 0; p < total; p++) if (water[p] && mask) mask[p] = 0
  }
  const land = mask ?? (water ? water.map((v) => (v ? 0 : 1)) : null)
  const inside = land ? land.reduce((t, v) => t + v, 0) : total
  let common = 0
  let cohA = 0
  let cohB = 0
  let lost = 0
  let regained = 0
  const map = Buffer.alloc(total * 4)
  for (let p = 0; p < total; p++) {
    if (land && !land[p]) continue
    if (da[p] < 0 || db[p] < 0) continue
    common++
    if (da[p] === 0) cohA++
    if (db[p] === 0) cohB++
    if (da[p] === 0 && db[p] === 1) {
      lost++
      map.set([220, 38, 38, 235], p * 4) // newly lost: red
    } else if (da[p] === 1 && db[p] === 0) {
      regained++
      map.set([20, 184, 166, 160], p * 4) // regained: teal
    } else if (da[p] === 1 && db[p] === 1) {
      map.set([82, 82, 91, 70], p * 4) // never measurable: faint grey
    }
  }
  const km = (n: number) => Math.round(n * pxKm2 * 10) / 10
  return {
    stats: {
      coherentA: common ? cohA / common : 0,
      coherentB: common ? cohB / common : 0,
      newlyLost: km(lost),
      regained: km(regained),
      coverage: inside ? common / inside : 0,
      areaKm2: Math.round(inside * pxKm2),
    },
    map: await sharp(map, {
      raw: { width: A.width, height: A.height, channels: 4 },
    })
      .png()
      .toBuffer(),
  }
}

/** Share of covered ground that's coherent in one interferogram. */
export async function movementCoherence(
  granule: string,
  bbox: Bbox,
  rings: Rings | null = null
) {
  const img = await raw(await cropMovementNative(granule, bbox))
  const d = decorrelated(img)
  const mask = await areaMask(rings, bbox, img.width, img.height)
  const inside = mask ? mask.reduce((t, v) => t + v, 0) : d.length
  let valid = 0
  let coherent = 0
  for (let p = 0; p < d.length; p++) {
    const v = d[p]
    if (mask && !mask[p]) continue
    if (v < 0) continue
    valid++
    if (v === 0) coherent++
  }
  return {
    coherent: valid ? coherent / valid : 0,
    coverage: inside ? valid / inside : 0,
  }
}

/* ------------------------------------------------------------------ */

const changes = new TtlCache<{ stats: unknown; map: Buffer }>(60)

/** Change between two dates, cached so the stats and map share one run. */
export function cachedChange(
  layer: "signal" | "movement",
  a: string,
  b: string,
  bbox: Bbox,
  rings: Rings | null = null,
  ringsKey = ""
) {
  const key = `${layer}|${a}|${b}|${bbox.join(",")}|${ringsKey}`
  return changes.get(key, () =>
    layer === "signal"
      ? signalChange(a, b, bbox, rings)
      : movementChange(a, b, bbox, rings)
  )
}
