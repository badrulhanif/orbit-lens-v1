import type { Bbox } from "@/lib/area"
import type { SarCycle, SarPass } from "@/lib/sar"

/**
 * Which area and which NISAR products a measurement reads. Shared by the
 * page and the nightly pre-warm job, so both ask the measurement service
 * exactly the same questions (and share its cache).
 */

/** Keep areas within what the radar image service accepts (6° a side). */
export function analysisBox([w, s, e, n]: Bbox): Bbox {
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const hx = Math.min(2.95, (e - w) / 2)
  const hy = Math.min(2.95, (n - s) / 2)
  return [cx - hx, cy - hy, cx + hx, cy + hy]
}

/** What the measurement service reads: at most 6° a side (Sarawak fits). */
export function measureBox([w, s, e, n]: Bbox): Bbox {
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const hx = Math.min(3, (e - w) / 2)
  const hy = Math.min(3, (n - s) / 2)
  return [cx - hx, cy - hy, cx + hx, cy + hy]
}

/** Radar frames over one area per date (big states span several). */
export const MAX_FRAMES = 8

const overlaps = (p: SarPass, [w, s, e, n]: Bbox) =>
  p.bbox[0] < e && p.bbox[2] > w && p.bbox[1] < n && p.bbox[3] > s
const frameOf = (p: SarPass) => `${p.track}-${p.direction}-${p.frame}`

/** Share of `box` the cycle's swaths cover (roughly; capped at 1). */
function coverage(c: SarCycle, [w, s, e, n]: Bbox) {
  const area = (e - w) * (n - s) || 1
  let covered = 0
  for (const p of c.passes) {
    const dx = Math.min(e, p.bbox[2]) - Math.max(w, p.bbox[0])
    const dy = Math.min(n, p.bbox[3]) - Math.max(s, p.bbox[1])
    if (dx > 0 && dy > 0) covered += dx * dy
  }
  return Math.min(1, covered / area)
}

/**
 * The newest cycle that covers most of the area. The newest cycle is often
 * still arriving (one swath of several), and may only clip the area's edge;
 * measuring that would compare a sliver.
 */
export function latestUsable(cycles: SarCycle[], box: Bbox) {
  const recent = cycles.slice(0, 4)
  const best = Math.max(0, ...recent.map((c) => coverage(c, box)))
  const i = recent.findIndex((c) => coverage(c, box) >= best * 0.6)
  return Math.max(0, i)
}

/** Ground movement: the latest usable pair's frames, and the same frames
 * over up to 8 cycles for the trend (newest first). */
export function movementGranules(cycles: SarCycle[], bbox: Bbox) {
  const box = measureBox(bbox)
  const framesAt = (i: number) =>
    (cycles[i]?.passes ?? [])
      .filter((p) => overlaps(p, box))
      .slice(0, MAX_FRAMES)
  const start = latestUsable(cycles, box)
  const latest = framesAt(start)
  // The trend needs the same frames cycle after cycle. The newest cycle may
  // be from another track (e.g. one ascending pass after months of
  // descending ones), so use whichever recent start gives the most pairs.
  const stackFrom = (i: number) => {
    const frames = new Set(framesAt(i).map(frameOf))
    return cycles
      .slice(i, i + 8)
      .flatMap((c) => c.passes.filter((p) => frames.has(frameOf(p))))
      .slice(0, 40)
  }
  const best = Math.max(0, ...cycles.slice(0, 4).map((c) => coverage(c, box)))
  let trend = stackFrom(start)
  for (let i = 0; i < Math.min(4, cycles.length); i++) {
    if (coverage(cycles[i], box) < best * 0.6) continue
    const stack = stackFrom(i)
    if (
      new Set(stack.map((p) => p.cycle)).size >
      new Set(trend.map((p) => p.cycle)).size
    )
      trend = stack
  }
  return { latest, trend }
}

/** Land cover: the latest cycle's frames, and the same frames on the
 * previous (or earliest) cycle that has them. */
export function coverGranules(
  cycles: SarCycle[],
  bbox: Bbox,
  baseline: "previous" | "earliest"
) {
  const box = measureBox(bbox)
  // For each recent cycle: its frames over the area, the same frames on an
  // earlier cycle, and how much of the area that matched pair covers.
  const options = cycles.slice(0, 4).map((c, i) => {
    const latest = c.passes.filter((p) => overlaps(p, box)).slice(0, MAX_FRAMES)
    const frames = new Set(latest.map(frameOf))
    const earlier = cycles
      .slice(i + 1)
      .map((e) => e.passes.filter((p) => frames.has(frameOf(p))))
      .filter((ps) => ps.length)
    const before = (baseline === "earliest" ? earlier.at(-1) : earlier[0]) ?? []
    const matched = new Set(before.map(frameOf))
    const after = latest.filter((p) => matched.has(frameOf(p)))
    return { before, after, score: coverage({ ...c, passes: after }, box) }
  })
  // The newest pair that covers most of what the best pair covers.
  const best = Math.max(0, ...options.map((o) => o.score))
  return (
    options.find((o) => o.score > 0 && o.score >= best * 0.6) ?? {
      before: [],
      after: [],
    }
  )
}

export const granuleIds = (passes: SarPass[]) =>
  passes.map((p) => encodeURIComponent(p.id)).join(",")
