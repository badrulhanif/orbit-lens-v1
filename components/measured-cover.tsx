"use client"

import * as React from "react"
import { DownloadIcon, LayersIcon, RulerIcon } from "lucide-react"

import type { AnalysisOverlay } from "@/components/analysis-card"
import { Loading } from "@/components/area/ui"
import { Drivers } from "@/components/drivers"
import { Figure, pct } from "@/components/measured"
import { Polarizations, type PolImages } from "@/components/polarizations"
import { Button } from "@/components/ui/button"
import { useJson } from "@/hooks/use-json"
import type { AppId } from "@/lib/apps"
import { areaQuery, formatEventDate, type Bbox } from "@/lib/area"
import { coverDrivers, type CoverResult, type PolStats } from "@/lib/drivers"
import { coverGranules, granuleIds, measureBox } from "@/lib/measure-plan"
import type { SarCycle } from "@/lib/sar"

/**
 * Measured land cover from the full NISAR backscatter product (GCOV, via
 * workers/nisar): water, vegetation, open and built-up land in km² on two
 * dates, what changed, and the Radar Vegetation Index. Renders nothing
 * when the measurement service isn't set up.
 */

type CoverDate = {
  date: string
  water: number
  vegetation: number
  open: number
  built: number
  rvi: number
}

type Cover = {
  available: boolean
  reason?: string
  a?: CoverDate
  b?: CoverDate
  newWater?: number
  receded?: number
  vegLost?: number
  vegGained?: number
  measured?: number
  cut?: boolean
  frames?: number
  map?: string
  bbox?: Bbox
  /** Per-polarization stats and pictures (newer measurement service). */
  pol?: PolStats
  images?: PolImages
}

const km2 = (v: number) =>
  `${v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(1)} km²`

export function MeasuredCover({
  app,
  baseline,
  cycles,
  bbox,
  boundaryKey,
  overlay,
  onOverlay,
  onAvailable,
  onLines,
}: {
  app: AppId
  baseline: "previous" | "earliest"
  /** Brightness (GCOV) cycles over the area, newest first. */
  cycles: SarCycle[]
  bbox: Bbox
  boundaryKey?: string
  overlay: AnalysisOverlay | null
  onOverlay: (overlay: AnalysisOverlay | null) => void
  onAvailable?: (ok: boolean) => void
  onLines?: (lines: string[]) => void
}) {
  const { before, after } = coverGranules(cycles, bbox, baseline)
  const url =
    before.length && after.length
      ? `/api/analysis/measured?kind=cover&a=${granuleIds(before)}&b=${granuleIds(after)}&${areaQuery(measureBox(bbox), boundaryKey)}`
      : null
  const res = useJson<Cover>(url)
  const c = res.data
  const ok = !!c?.available

  React.useEffect(() => {
    onAvailable?.(ok)
  }, [ok, onAvailable])
  const drivers = ok ? coverDrivers(c as CoverResult, bbox) : []
  const lines = ok ? reportLines(c!, drivers) : []
  const linesKey = lines.join("\n")
  React.useEffect(() => {
    onLines?.(lines)
    // Only when the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey])

  // Not set up on this server (or nothing to compare): say nothing.
  if (!url || res.status === 501) return null

  const figures =
    !c?.available || !c.a || !c.b
      ? []
      : app === "flood"
        ? [
            ["Water now", km2(c.b.water), `was ${km2(c.a.water)}`],
            ["New water", km2(c.newWater!), "since the earlier date"],
            ["Receded", km2(c.receded!), "water now gone"],
          ]
        : app === "forest"
          ? [
              ["Vegetation", km2(c.b.vegetation), `was ${km2(c.a.vegetation)}`],
              ["Lost", km2(c.vegLost!), "canopy to open land"],
              ["Gained", km2(c.vegGained!), "open land to canopy"],
            ]
          : [
              ["Open & crop land", km2(c.b.open), `was ${km2(c.a.open)}`],
              [
                "Vegetation index",
                c.b.rvi.toFixed(2),
                `was ${c.a.rvi.toFixed(2)} (0 bare–1 dense)`,
              ],
              ["Vegetation lost", km2(c.vegLost!), "e.g. harvest, clearing"],
            ]

  return (
    <div className="grid gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
      <p className="flex items-center gap-1.5 font-semibold">
        <RulerIcon className="size-3.5 text-emerald-600" />
        Measured from full NISAR data
      </p>
      {res.loading ? (
        <Loading small>
          Reading the radar products… (up to a minute the first time)
        </Loading>
      ) : !c ? (
        <p className="text-muted-foreground">
          Couldn&apos;t measure this area right now.
        </p>
      ) : !c.available ? (
        <p className="text-muted-foreground">{c.reason}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {formatEventDate(c.a!.date)} → {formatEventDate(c.b!.date)} ·{" "}
            {km2(c.measured!)} of land measured
            {(c.frames ?? 1) > 1 && ` · ${c.frames} frames`}
            {c.cut && " · sampled across the area"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {figures.map(([label, value, sub]) => (
              <Figure key={label} label={label} value={value} sub={sub} />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Land now: {shares(c.b!)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={overlay?.url === c.map ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() =>
                c.map && c.bbox
                  ? onOverlay(
                      overlay?.url === c.map
                        ? null
                        : {
                            url: c.map,
                            bbox: c.bbox,
                            kind: "signal",
                            label: `Measured change, ${formatEventDate(c.a!.date)} → ${formatEventDate(c.b!.date)}`,
                          }
                    )
                  : undefined
              }
            >
              <LayersIcon data-icon="inline-start" />
              {overlay?.url === c.map ? "Hide map" : "Measured change map"}
            </Button>
            {c.map && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                nativeButton={false}
                render={
                  <a
                    href={c.map}
                    download={`nisar-change-${c.a!.date}-${c.b!.date}.png`}
                  />
                }
              >
                <DownloadIcon data-icon="inline-start" />
                PNG
              </Button>
            )}
          </div>
          <Drivers drivers={drivers} />
          {c.images && c.bbox && (
            <Polarizations
              images={c.images}
              pol={c.pol}
              dates={{ a: c.a!.date, b: c.b!.date }}
              bbox={c.bbox}
              overlay={overlay}
              onOverlay={onOverlay}
            />
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Classes from L-band brightness (HH and HV), checked on NISAR over
            KL, forest, peat swamp, mangrove and paddy; land only, inside the
            area&apos;s outline.
            {app === "flood" &&
              " Rice fields flooded for planting (Kedah, Perlis, Sekinchan) also show as new water."}
          </p>
        </>
      )}
    </div>
  )
}

function shares(d: CoverDate) {
  const total = d.water + d.vegetation + d.open + d.built || 1
  return [
    ["vegetation", d.vegetation],
    ["built-up", d.built],
    ["open", d.open],
    ["water", d.water],
  ]
    .map(([name, v]) => `${pct((v as number) / total)} ${name}`)
    .join(" · ")
}

function reportLines(c: Cover, drivers: ReturnType<typeof coverDrivers>) {
  const a = c.a!
  const b = c.b!
  return [
    `Measured land cover from the full NISAR product, ${formatEventDate(b.date)}: ${shares(b)} (${km2(c.measured!)} of land).`,
    `Since ${formatEventDate(a.date)}: new water ${km2(c.newWater!)}, water receded ${km2(c.receded!)}, vegetation lost ${km2(c.vegLost!)}, gained ${km2(c.vegGained!)}; vegetation index ${a.rvi.toFixed(2)} → ${b.rvi.toFixed(2)}.`,
    ...(c.pol?.a.hh != null && c.pol.b.hh != null
      ? [
          `Polarizations (median over land): HH ${c.pol.a.hh} → ${c.pol.b.hh} dB, HV ${c.pol.a.hv} → ${c.pol.b.hv} dB.`,
        ]
      : []),
    ...drivers.map((d) => `Likely why (hypothesis): ${d.cause} ${d.evidence}`),
  ]
}
