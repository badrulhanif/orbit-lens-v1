import type { Alert, RadarState } from "@/lib/alerts"
import { formatEventDate, type Bbox } from "@/lib/area"
import {
  km2,
  movementDrivers,
  signed,
  type CoverResult,
  type FireInfo,
} from "@/lib/drivers"

/**
 * Radar change notices for watched places. NISAR passes every 12 days, too
 * slow to warn of a flood, but right for slow changes: clearing and logging,
 * new water (ponds, mining, standing floods), ground that keeps moving.
 * Every notice says it's unconfirmed: it's a reason to look, not proof.
 */

export type TrendResult = {
  available: boolean
  from?: string
  to?: string
  pairs?: number
  uncertainty?: number | null
  total?: { p5: number; p95: number; moving: number; threshold: number } | null
  rate?: { p5: number; p95: number; moving: number; threshold: number } | null
}

/** The newest measurements, for whichever parts were due. `result`:
 * the measurement; "none" when there was nothing to measure; null when it
 * failed or ran out of time (it's retried next check). */
export type RadarLatest = {
  cover?: {
    cycle: number
    result: CoverResult | "none" | null
    fires?: FireInfo | null
  }
  trend?: { cycle: number; result: TrendResult | "none" | null }
}

const UNCONFIRMED =
  "Unconfirmed: check on the ground before reporting it to anyone."

/** Big enough to tell someone: ≥ 1 km² and ≥ 0.5% of the land measured
 * (a large state changes a few km² every pass from harvests alone). */
const worthTelling = (v: number, measured: number) =>
  v >= 1 && v >= measured * 0.005

function coverNotices(c: CoverResult, fires?: FireInfo | null): Alert[] {
  const span = `NISAR, ${formatEventDate(c.a.date)} → ${formatEventDate(c.b.date)}`
  const out: Alert[] = []
  if (worthTelling(c.vegLost, c.measured)) {
    const burnt = !!fires && fires.count > 0
    out.push({
      id: `radar-veg-${c.b.date}`,
      kind: "radar",
      title: burnt
        ? `Possible burn scar: ${km2(c.vegLost)} of vegetation lost`
        : `Vegetation cleared: ${km2(c.vegLost)}`,
      detail: burnt
        ? `${span}. Fire was seen here between the passes (${fires!.source === "FIRMS" ? `${fires!.count} hotspots, NASA FIRMS` : "NASA EONET"}). ${UNCONFIRMED}`
        : `${span}. Could be logging, land clearing, replanting or harvest. ${UNCONFIRMED}`,
    })
  }
  if (worthTelling(c.newWater, c.measured)) {
    out.push({
      id: `radar-water-${c.b.date}`,
      kind: "radar",
      title: `New water: ${km2(c.newWater)}`,
      detail: `${span}. Could be flooding, rice fields flooded for planting, or new ponds (mining, aquaculture). ${UNCONFIRMED}`,
    })
  }
  return out
}

function trendNotices(t: TrendResult, bbox: Bbox): Alert[] {
  const s = t.rate ?? t.total
  if (!t.available || !s || !t.to) return []
  const unit = t.rate ? "mm/yr" : "mm"
  const moving = movementDrivers(s, unit, bbox, t.uncertainty).filter(
    (d) => d.id === "subsidence" || d.id === "uplift"
  )
  if (!moving.length) return []
  return [
    {
      id: `radar-move-${t.to}`,
      kind: "radar",
      title: `Ground moving: ${Math.round(s.moving * 100)}% of the area beyond ${s.threshold} ${unit}`,
      detail: `NISAR, ${t.pairs} pairs to ${formatEventDate(t.to)}: ${signed(s.p5, 0)} to ${signed(s.p95, 0)} ${unit}${t.uncertainty != null ? ` (±${t.uncertainty})` : ""}. On a slope this can be creep before a landslide; on flat ground, sinking. ${UNCONFIRMED}`,
    },
  ]
}

/**
 * What's new since `prev`, and the state to keep. The first check is the
 * baseline (no notices); a failed measurement leaves the state alone so
 * it's tried again.
 */
export function radarUpdate(
  prev: RadarState | undefined,
  latest: RadarLatest,
  bbox: Bbox
): { state: RadarState; alerts: Alert[] } {
  const state: RadarState = { ...prev }
  const alerts: Alert[] = []
  const { cover, trend } = latest
  if (cover) {
    if (prev?.cover == null) state.cover = cover.cycle
    else if (cover.cycle > prev.cover && cover.result !== null) {
      state.cover = cover.cycle
      if (cover.result !== "none")
        alerts.push(...coverNotices(cover.result, cover.fires))
    }
  }
  if (trend) {
    if (prev?.trend == null) state.trend = trend.cycle
    else if (trend.cycle > prev.trend && trend.result !== null) {
      state.trend = trend.cycle
      if (trend.result !== "none")
        alerts.push(...trendNotices(trend.result, bbox))
    }
  }
  return { state, alerts }
}
