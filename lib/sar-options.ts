import type { Bbox } from "@/lib/area"
import { formatRange, type SarCycle, type SarPass } from "@/lib/sar"

/** One selectable date: the swath from one cycle that covers the area. */
export type PassOption = { key: number; pass: SarPass; label: string }

/** The swath covering the area's middle (else the most overlapping one). */
function passFor(passes: SarPass[], [w, s, e, n]: Bbox) {
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const covering = passes.filter(
    (p) =>
      cx >= p.bbox[0] && cx <= p.bbox[2] && cy >= p.bbox[1] && cy <= p.bbox[3]
  )
  const overlap = (p: SarPass) =>
    Math.max(0, Math.min(e, p.bbox[2]) - Math.max(w, p.bbox[0])) *
    Math.max(0, Math.min(n, p.bbox[3]) - Math.max(s, p.bbox[1]))
  const pool = covering.length ? covering : passes
  return [...pool].sort((a, b) => overlap(b) - overlap(a))[0]
}

/**
 * One option per cycle, newest first. Every date uses the same orbit track
 * and frame where it can, so comparisons show the same ground from the same
 * angle.
 */
export function passOptions(cycles: SarCycle[], bbox: Bbox): PassOption[] {
  const ref = cycles[0] ? passFor(cycles[0].passes, bbox) : null
  return cycles.map((c) => {
    const same = ref
      ? c.passes.find((p) => p.track === ref.track && p.frame === ref.frame)
      : undefined
    const pass = same ?? passFor(c.passes, bbox)
    return { key: c.cycle, pass, label: formatRange(pass.start, pass.end) }
  })
}
