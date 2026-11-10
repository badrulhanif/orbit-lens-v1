"use client"

import * as React from "react"
import {
  DownloadIcon,
  LayersIcon,
  RulerIcon,
  TrendingUpIcon,
} from "lucide-react"

import type { AnalysisOverlay } from "@/components/analysis-card"
import { Loading } from "@/components/area/ui"
import { Drivers } from "@/components/drivers"
import { Button } from "@/components/ui/button"
import { useJson } from "@/hooks/use-json"
import { areaQuery, formatEventDate, type Bbox } from "@/lib/area"
import { movementDrivers } from "@/lib/drivers"
import { granuleIds, measureBox, movementGranules } from "@/lib/measure-plan"
import type { SarCycle } from "@/lib/sar"

/**
 * Measured ground movement from the full NISAR products (via the Python
 * service in workers/nisar): real coherence and millimetres, instead of the
 * preview-image estimates. Renders nothing when the service isn't set up.
 */

type Stats = {
  p5: number
  median: number
  p95: number
  moving: number
  threshold: number
}

type Pair = {
  available: boolean
  reason?: string
  from?: string
  to?: string
  coherence?: number
  reliable?: number
  cut?: boolean
  frames?: number
  movement?: Stats | null
  map?: string
  bbox?: Bbox
}

type Trend = {
  available: boolean
  reason?: string
  pairs?: number
  from?: string
  to?: string
  days?: number
  frames?: number
  /** Typical ± of the rate (mm/yr) or total (mm). */
  uncertainty?: number | null
  /** Share of pixels that behave consistently over time. */
  consistent?: number
  total?: Stats | null
  rate?: Stats | null
  map?: string
  mapOf?: "rate" | "total"
  bbox?: Bbox
}

export const pct = (v: number) => `${Math.round(v * 100)}%`
const mm = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`

/** The request for the latest pair (also used to fetch it ahead of time). */
export function measuredPairUrl(cycles: SarCycle[], bbox: Bbox) {
  const { latest } = movementGranules(cycles, bbox)
  return latest.length
    ? `/api/analysis/measured?kind=pair&granules=${granuleIds(latest)}&${areaQuery(measureBox(bbox))}`
    : null
}

export function Measured({
  cycles,
  bbox,
  overlay,
  onOverlay,
  onAvailable,
  onLines,
}: {
  /** Ground-movement cycles over the area, newest first. */
  cycles: SarCycle[]
  bbox: Bbox
  overlay: AnalysisOverlay | null
  onOverlay: (overlay: AnalysisOverlay | null) => void
  /** Whether measured values are showing (the card hides its caveat). */
  onAvailable?: (ok: boolean) => void
  /** Plain-text results, for the report. */
  onLines?: (lines: string[]) => void
}) {
  const box = measureBox(bbox)
  const where = areaQuery(box)
  const { latest, trend: stack } = movementGranules(cycles, bbox)
  const pairs = new Set(stack.map((p) => p.cycle)).size

  const pair = useJson<Pair>(measuredPairUrl(cycles, bbox))
  const [wantTrend, setWantTrend] = React.useState(false)
  const trend = useJson<Trend>(
    wantTrend && pairs > 1
      ? `/api/analysis/measured?kind=trend&granules=${granuleIds(stack)}&${where}`
      : null
  )

  const ok = !!pair.data?.available
  React.useEffect(() => {
    onAvailable?.(ok)
  }, [ok, onAvailable])

  const lines = reportLines(pair.data, trend.data, bbox)
  const linesKey = lines.join("\n")
  React.useEffect(() => {
    onLines?.(lines)
    // Only when the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey])

  // Not set up on this server: say nothing (the estimates still show).
  if (!latest.length || pair.status === 501) return null

  const p = pair.data
  const showMap = (
    map: string | undefined,
    bboxOf: Bbox | undefined,
    label: string,
    range: number,
    unit: string
  ) =>
    map && bboxOf
      ? overlay?.url === map
        ? onOverlay(null)
        : onOverlay({
            url: map,
            bbox: bboxOf,
            kind: "measured",
            label,
            range,
            unit,
          })
      : undefined

  return (
    <div className="grid gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
      <p className="flex items-center gap-1.5 font-semibold">
        <RulerIcon className="size-3.5 text-emerald-600" />
        Measured from full NISAR data
      </p>
      {pair.loading ? (
        <Loading small>
          Reading the radar product… (up to 20 s the first time)
        </Loading>
      ) : !p ? (
        <p className="text-muted-foreground">
          Couldn&apos;t measure this area right now.
        </p>
      ) : !p.available ? (
        <p className="text-muted-foreground">{p.reason}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {formatEventDate(p.from!)} → {formatEventDate(p.to!)} · 12-day pair
            {(p.frames ?? 1) > 1 && ` · ${p.frames} radar frames`}
            {p.cut && " · sampled across the area"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Figure
              label="Coherence"
              value={pct(p.coherence!)}
              sub={`${pct(p.reliable!)} reliable`}
            />
            {p.movement && (
              <>
                <Figure
                  label="Movement"
                  value={`${mm(p.movement.p5)} to ${mm(p.movement.p95)}`}
                  sub="mm, 5–95% of area"
                />
                <Figure
                  label={`Moved >${p.movement.threshold} mm`}
                  value={pct(p.movement.moving)}
                  sub="of the area"
                />
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={overlay?.url === p.map ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() =>
                showMap(
                  p.map,
                  p.bbox,
                  `Measured movement, ${formatEventDate(p.from!)} → ${formatEventDate(p.to!)}`,
                  20,
                  "mm"
                )
              }
            >
              <LayersIcon data-icon="inline-start" />
              {overlay?.url === p.map ? "Hide map" : "Measured map"}
            </Button>
            {p.map && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                nativeButton={false}
                render={
                  <a
                    href={p.map}
                    download={`nisar-movement-${p.from}-${p.to}.png`}
                  />
                }
              >
                <DownloadIcon data-icon="inline-start" />
                PNG
              </Button>
            )}
            {pairs > 1 && !wantTrend && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setWantTrend(true)}
              >
                <TrendingUpIcon data-icon="inline-start" />
                Trend · {pairs} pairs
              </Button>
            )}
          </div>
          {wantTrend && (
            <TrendResult
              trend={trend}
              bbox={bbox}
              overlay={overlay}
              showMap={showMap}
            />
          )}
          {p.coherence! < 0.5 && (
            <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
              Low coherence (forest or mountains): one 12-day pair here is
              mostly weather delay, often a few cm. The trend averages it out;
              rely on that instead.
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Movement toward (+) or away from (−) the satellite, relative to the
            area&apos;s median, with the ionosphere and broad tilt removed. Each
            pass still carries a few mm of weather noise.
          </p>
        </>
      )}
    </div>
  )
}

function TrendResult({
  trend,
  bbox,
  overlay,
  showMap,
}: {
  trend: { data: Trend | null; loading: boolean }
  bbox: Bbox
  overlay: AnalysisOverlay | null
  showMap: (
    map: string | undefined,
    bbox: Bbox | undefined,
    label: string,
    range: number,
    unit: string
  ) => void
}) {
  const t = trend.data
  if (trend.loading)
    return (
      <Loading small>
        Measuring several passes… (1–3 minutes the first time for a large area)
      </Loading>
    )
  if (!t)
    return (
      <p className="text-muted-foreground">Couldn&apos;t measure the trend.</p>
    )
  if (!t.available) return <p className="text-muted-foreground">{t.reason}</p>
  const s = t.rate ?? t.total
  const unit = t.rate ? "mm/yr" : "mm"
  return (
    <div className="grid gap-1.5 border-t pt-2">
      <p className="text-[11px] text-muted-foreground">
        {formatEventDate(t.from!)} → {formatEventDate(t.to!)} · {t.days} days,{" "}
        {t.pairs} pairs
        {(t.frames ?? 1) > 1 && ` · ${t.frames} frames`}
      </p>
      {s && (
        <div className="grid grid-cols-3 gap-2">
          <Figure
            label={t.rate ? "Yearly rate" : "Total movement"}
            value={`${mm(s.p5)} to ${mm(s.p95)}`}
            sub={`${unit}, 5–95% of area${t.uncertainty != null ? ` · ±${t.uncertainty}` : ""}`}
          />
          <Figure
            label={`Moved >${s.threshold} ${unit}`}
            value={pct(s.moving)}
            sub="of the area"
          />
          {t.consistent != null && (
            <Figure
              label="Consistent"
              value={pct(t.consistent)}
              sub="steady over time"
            />
          )}
        </div>
      )}
      {s && <Drivers drivers={movementDrivers(s, unit, bbox, t.uncertainty)} />}
      <p className="text-[11px] text-muted-foreground">
        Terrain-linked weather delay removed from each pair; ground that
        doesn&apos;t move steadily across the pairs is left out.
      </p>
      {!t.rate && (
        <p className="text-[11px] text-muted-foreground">
          A yearly rate (mm/yr) needs at least 6 months of passes; NISAR has{" "}
          {Math.round((t.days ?? 0) / 30)} months here so far.
        </p>
      )}
      <Button
        variant={overlay?.url === t.map ? "default" : "outline"}
        size="sm"
        className="h-8 justify-self-start"
        onClick={() =>
          showMap(
            t.map,
            t.bbox,
            `${t.rate ? "Yearly rate" : "Total movement"}, ${formatEventDate(t.from!)} → ${formatEventDate(t.to!)}`,
            t.rate ? 50 : 30,
            unit
          )
        }
      >
        <LayersIcon data-icon="inline-start" />
        {overlay?.url === t.map ? "Hide map" : "Trend map"}
      </Button>
    </div>
  )
}

export function Figure({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}

function reportLines(p: Pair | null, t: Trend | null, bbox: Bbox) {
  if (!p?.available) return []
  const lines = [
    `Measured from the full NISAR product (${formatEventDate(p.from!)} to ${formatEventDate(p.to!)}): coherence ${pct(p.coherence!)} (${pct(p.reliable!)} of pixels reliable).`,
  ]
  if (p.movement)
    lines.push(
      `Line-of-sight movement over 12 days: ${mm(p.movement.p5)} to ${mm(p.movement.p95)} mm across 5–95% of the area; ${pct(p.movement.moving)} moved more than ${p.movement.threshold} mm.`
    )
  const s = t?.available ? (t.rate ?? t.total) : null
  if (t?.available && s)
    lines.push(
      `${t.rate ? "Yearly rate" : "Total movement"} from ${t.pairs} pairs (${formatEventDate(t.from!)} to ${formatEventDate(t.to!)}): ${mm(s.p5)} to ${mm(s.p95)} ${t.rate ? "mm/yr" : "mm"}; ${pct(s.moving)} beyond ${s.threshold}.`,
      ...movementDrivers(s, t.rate ? "mm/yr" : "mm", bbox, t.uncertainty).map(
        (d) => `Likely why (hypothesis): ${d.cause} ${d.evidence}`
      )
    )
  return lines
}
