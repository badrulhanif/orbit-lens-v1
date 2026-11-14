import type { RadarState } from "@/lib/alerts"
import { areaBoxFor, type Bbox } from "@/lib/area"
import type { CoverResult } from "@/lib/drivers"
import {
  analysisBox,
  coverGranules,
  measureBox,
  movementGranules,
} from "@/lib/measure-plan"
import type { RadarLatest, TrendResult } from "@/lib/radar-notices"
import { fromSearch } from "@/lib/share"
import { firesBetween } from "@/lib/server/fires"
import {
  measureCover,
  measuredEnabled,
  measureTrend,
} from "@/lib/server/measured"
import { coverageForArea } from "@/lib/server/nisar"
import { within } from "@/lib/server/util"

/** As the page sends it: 4 decimals. */
const round = (b: Bbox) => b.map((v) => Number(v.toFixed(4))) as Bbox

/** Null on failure, or once `ms` has passed (the service keeps working and
 * caches the answer for the next check). */
const settle = <T>(p: Promise<T>, ms: number) =>
  within(
    p.catch(() => null),
    Math.max(1000, ms),
    null
  )

/**
 * The newest NISAR measurements for a watched place (its share link), for
 * the parts that have a cycle newer than `prev`. Asks the measurement
 * service the same questions the page does, so they share its cache.
 */
export async function radarLatest(
  link: string,
  prev: RadarState | undefined,
  timeoutMs: number
): Promise<{ latest: RadarLatest; bbox: Bbox } | null> {
  const view = fromSearch(link)
  if (!view || !measuredEnabled()) return null
  const started = Date.now()
  const left = () => timeoutMs - (Date.now() - started)
  const bbox = round(areaBoxFor(view.place))
  const area = analysisBox(bbox)
  const box = round(measureBox(area))
  const boundary = view.place.boundaryKey ?? null
  const ids = (ps: { id: string }[]) => ps.map((p) => p.id)
  const latest: RadarLatest = {}

  const [signal, movement] = await Promise.all([
    coverageForArea("signal", bbox).catch(() => null),
    coverageForArea("movement", bbox).catch(() => null),
  ])

  if (signal?.cycles.length) {
    const { before, after } = coverGranules(signal.cycles, area, "previous")
    const cycle = after[0]?.cycle
    if (cycle != null) {
      const due = prev?.cover != null && cycle > prev.cover
      let result: CoverResult | "none" | null = "none"
      let fires = null
      if (due && before.length) {
        const r = (await settle(
          measureCover(ids(before), ids(after), box, boundary),
          left()
        )) as (CoverResult & { available?: boolean }) | null
        result = r ? (r.available ? r : "none") : null
        if (r?.available)
          fires = await settle(
            firesBetween(box, r.a.date, r.b.date, boundary),
            Math.min(30_000, left())
          )
      }
      latest.cover = { cycle, result, fires }
    }
  }

  if (movement?.cycles.length) {
    const { trend } = movementGranules(movement.cycles, area)
    const cycles = trend.map((p) => p.cycle ?? 0)
    const cycle = cycles.length ? Math.max(...cycles) : null
    if (cycle != null) {
      const due = prev?.trend != null && cycle > prev.trend
      let result: TrendResult | "none" | null = "none"
      if (due && new Set(cycles).size > 1 && left() > 5000) {
        const r = (await settle(
          measureTrend(ids(trend), box),
          left()
        )) as TrendResult | null
        result = r ? (r.available ? r : "none") : null
      } else if (due) result = left() > 5000 ? "none" : null
      latest.trend = { cycle, result }
    }
  }
  return { latest, bbox }
}
