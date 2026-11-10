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

/** Ground movement: the latest pair's frames, and the same frames over up
 * to 8 cycles for the trend (newest first). */
export function movementGranules(cycles: SarCycle[], bbox: Bbox) {
  const box = measureBox(bbox)
  const latest = (cycles[0]?.passes ?? [])
    .filter((p) => overlaps(p, box))
    .slice(0, MAX_FRAMES)
  const frames = new Set(latest.map(frameOf))
  const trend = cycles
    .slice(0, 8)
    .flatMap((c) => c.passes.filter((p) => frames.has(frameOf(p))))
    .slice(0, 40)
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
  const after = (cycles[0]?.passes ?? [])
    .filter((p) => overlaps(p, box))
    .slice(0, MAX_FRAMES)
  const frames = new Set(after.map(frameOf))
  const earlier = cycles
    .slice(1)
    .map((c) => c.passes.filter((p) => frames.has(frameOf(p))))
    .filter((ps) => ps.length)
  const before = (baseline === "earliest" ? earlier.at(-1) : earlier[0]) ?? []
  return { before, after }
}

export const granuleIds = (passes: SarPass[]) =>
  passes.map((p) => encodeURIComponent(p.id)).join(",")
