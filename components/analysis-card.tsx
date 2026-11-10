"use client"

import * as React from "react"
import {
  ActivityIcon,
  LandPlotIcon,
  LayersIcon,
  SproutIcon,
  TreesIcon,
  TrendingDownIcon,
  WavesIcon,
  type LucideIcon,
} from "lucide-react"

import { Loading } from "@/components/area/ui"
import { Button } from "@/components/ui/button"
import type { useArea } from "@/hooks/use-area"
import { Measured } from "@/components/measured"
import { analysisBox } from "@/lib/measure-plan"
import { MeasuredCover } from "@/components/measured-cover"
import { useJson } from "@/hooks/use-json"
import { appById, APPS, type AppId, type HazardFilter } from "@/lib/apps"
import { areaQuery, type Bbox, type HistoryEvent } from "@/lib/area"
import { formatRange, passDay } from "@/lib/sar"
import { passOptions, type PassOption } from "@/lib/sar-options"
import { cn } from "@/lib/utils"

type AreaData = ReturnType<typeof useArea>

export const APP_ICON: Record<AppId, LucideIcon> = {
  flood: WavesIcon,
  subsidence: TrendingDownIcon,
  landslide: LandPlotIcon,
  forest: TreesIcon,
  agriculture: SproutIcon,
  earthquake: ActivityIcon,
}

/** What the map should draw for an analysis. */
export type AnalysisOverlay = {
  url: string
  bbox: Bbox
  kind: "signal" | "movement" | "measured"
  label: string
  /** Measured maps: the colour scale runs from -range to +range (unit). */
  range?: number
  unit?: string
}

type SignalChange = {
  a: Record<"water" | "vegetation" | "open" | "built", number>
  b: Record<"water" | "vegetation" | "open" | "built", number>
  newWater: number
  waterLoss: number
  vegetationLoss: number
  vegetationGain: number
  openBrightening: number | null
  coverage: number
  areaKm2: number
}

type CoherenceChange = {
  coherentA: number
  coherentB: number
  newlyLost: number
  regained: number
  coverage: number
  areaKm2: number
}

type Series = {
  items: string[]
  values: (Record<string, number> | null)[]
}

/**
 * The hazard filter: All, or one application (which also picks the
 * analysis and radar layer). Counts are recorded events per chip.
 */
export function AppPicker({
  value,
  counts,
  onChange,
}: {
  value: HazardFilter
  counts: Record<HazardFilter, number> | null
  onChange: (id: HazardFilter) => void
}) {
  const chips = [
    { id: "all" as const, label: "All", Icon: LayersIcon },
    ...APPS.map((a) => ({ id: a.id, label: a.label, Icon: APP_ICON[a.id] })),
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Hazard filter"
      className="flex flex-wrap gap-1.5 px-3 pb-2"
    >
      {chips.map(({ id, label, Icon }) => {
        const on = value === id
        const n = counts?.[id]
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              on
                ? "border-orange-600 bg-orange-600 text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {n !== undefined && (
              <span
                className={cn(
                  "tabular-nums",
                  on ? "text-white/80" : "text-muted-foreground/70"
                )}
              >
                {n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The selected application's analysis for an area: compares the latest
 * NISAR pass with an earlier one and shows the result and the trend.
 */
export function AnalysisCard({
  app,
  area,
  boundaryKey,
  events,
  overlay,
  onOverlay,
  onSummary,
  eventDate,
}: {
  /** For one recorded event: its date, to say if the radar is from after it. */
  eventDate?: string | null
  app: AppId
  area: AreaData
  boundaryKey?: string
  events: HistoryEvent[]
  overlay: AnalysisOverlay | null
  onOverlay: (overlay: AnalysisOverlay | null) => void
  /** Plain-text result, for the report. */
  onSummary?: (lines: string[]) => void
}) {
  const def = appById(app)
  const layer = def.layer
  const bbox = area.bbox ? analysisBox(area.bbox) : null
  const coverage = area.radar.data?.[layer] ?? null
  const options: PassOption[] = React.useMemo(
    () => (bbox && coverage ? passOptions(coverage.cycles, bbox) : []),
    // bbox is derived from area.bbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coverage, area.bbox]
  )
  const latest = options[0]
  const base =
    options.length > 1
      ? def.baseline === "earliest"
        ? options[options.length - 1]
        : options[1]
      : undefined

  const key = (o: PassOption) =>
    layer === "signal" ? passDay(o.pass) : o.pass.id
  const where = bbox ? areaQuery(bbox, boundaryKey) : ""
  const changeUrl =
    latest && base
      ? `/api/analysis/change?layer=${layer}&a=${encodeURIComponent(key(base))}&b=${encodeURIComponent(key(latest))}&${where}`
      : null
  const mapUrl = changeUrl?.replace("/api/analysis/change", "/api/analysis/map")
  // Oldest → newest, up to 8 passes.
  const seriesItems = options.slice(0, 8).reverse()
  const seriesUrl =
    seriesItems.length > 2
      ? `/api/analysis/series?layer=${layer}&items=${seriesItems.map((o) => encodeURIComponent(key(o))).join(",")}&${where}`
      : null

  const change = useJson<SignalChange & CoherenceChange>(changeUrl)
  // Measured values from the full products, when the service is set up.
  const [measured, setMeasured] = React.useState(false)
  const series = useJson<Series>(seriesUrl)
  const showing = !!overlay && overlay.url === mapUrl

  const related = events.filter((e) => def.hazards.includes(e.type))
  const quakes = events.filter((e) => e.type === "earthquake")

  const [measuredLines, setMeasuredLines] = React.useState<string[]>([])
  const lines = [
    ...summaryLines(app, change.data, base, latest, related, quakes),
    ...measuredLines,
  ]
  const linesKey = lines.join("\n")
  React.useEffect(() => {
    onSummary?.(lines)
    // Only when the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey])

  if (area.radar.loading)
    return (
      <Shell def={def}>
        <Loading small>Finding NISAR passes…</Loading>
      </Shell>
    )
  if (options.length < 2) {
    return (
      <Shell def={def}>
        <p className="text-xs text-muted-foreground">
          {options.length
            ? "Only one NISAR pass over this area so far, so there's nothing to compare yet."
            : "No NISAR passes over this area yet."}
        </p>
      </Shell>
    )
  }

  const d = change.data
  const seriesValues = (series.data?.values ?? []).map((v) => {
    if (!v) return null
    if (layer === "movement") return v.coherent
    if (app === "flood") return v.water
    if (app === "forest") return v.vegetation
    return v.open
  })
  const seriesLabel =
    layer === "movement"
      ? "Coherent (measurable) ground"
      : app === "flood"
        ? "Water extent"
        : app === "forest"
          ? "Vegetation cover"
          : "Open & crop land"

  return (
    <Shell def={def}>
      <p className="text-[11px] text-muted-foreground">
        {base!.label} → {latest!.label} · track {latest!.pass.track}
      </p>

      {eventDate && base!.pass.start.slice(0, 10) > eventDate && (
        <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
          This event was on {eventDate.split("-").reverse().join("/")}, before
          these radar passes. The changes below happened around this spot
          afterwards and are not caused by it.
        </p>
      )}

      {layer === "movement" && bbox && (
        <Measured
          cycles={coverage?.cycles ?? []}
          bbox={bbox}
          overlay={overlay}
          onOverlay={onOverlay}
          onAvailable={setMeasured}
          onLines={setMeasuredLines}
        />
      )}

      {layer === "signal" && bbox && (
        <MeasuredCover
          app={app}
          baseline={def.baseline}
          cycles={coverage?.cycles ?? []}
          bbox={bbox}
          boundaryKey={boundaryKey}
          overlay={overlay}
          onOverlay={onOverlay}
          onAvailable={setMeasured}
          onLines={setMeasuredLines}
        />
      )}
      {layer === "signal" && measured && (
        <p className="text-[11px] text-muted-foreground">
          Quick estimates from NASA&apos;s preview images below; use the
          measured values above.
        </p>
      )}

      {layer === "movement" && (
        <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
          {measured
            ? "The figures below are quick estimates from NASA's preview images; use the measured values above."
            : "Low confidence: coherence is judged from NASA's smoothed preview interferograms, which look coherent over almost all land. These figures reliably separate water from land, but not stable from disturbed ground."}
        </p>
      )}

      {change.loading ? (
        <Loading small>Analysing radar images…</Loading>
      ) : change.error || !d ? (
        <p className="text-xs text-destructive">
          Couldn&apos;t analyse these passes.
        </p>
      ) : (
        <Metrics app={app} d={d} related={related} quakes={quakes} />
      )}

      {seriesUrl && (
        <div className="grid gap-1">
          <p className="flex justify-between text-[11px] text-muted-foreground">
            <span>{seriesLabel} over time</span>
            {series.loading && <span>loading…</span>}
          </p>
          <Sparkline
            values={seriesValues}
            labels={seriesItems.map((o) => o.label)}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={showing ? "default" : "outline"}
          size="sm"
          className="h-8"
          disabled={!mapUrl || !d}
          onClick={() =>
            onOverlay(
              showing || !mapUrl || !bbox
                ? null
                : {
                    url: mapUrl,
                    bbox,
                    kind: layer,
                    label:
                      `${base!.label} → ${latest!.label}` +
                      (eventDate && base!.pass.start.slice(0, 10) > eventDate
                        ? " · after the event, not caused by it"
                        : ""),
                  }
            )
          }
        >
          <LayersIcon data-icon="inline-start" />
          {showing ? "Hide change map" : "Show change map"}
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {def.measures} {NOTES[app]}
      </p>
    </Shell>
  )
}

const NOTES: Record<AppId, string> = {
  flood:
    "Estimates from NASA's preview images. Along the coast, tides and mudflats also change between passes.",
  subsidence:
    "Rates in mm/year need a time series of full-resolution interferograms (unwrapped phase), which isn't processed here. Download links are in Report.",
  landslide:
    "Lost coherence also comes from crops being harvested or ground cleared, so check flagged patches against slopes and past landslides.",
  forest:
    "Compared with the earliest pass here. Plantation replanting shows as loss then regrowth.",
  agriculture:
    "Brightness is a proxy, not a soil-moisture measurement; rain shortly before a pass makes fields brighter.",
  earthquake:
    "Displacement in cm needs the full-resolution interferogram spanning the quake, which isn't processed here.",
}

function Metrics({
  app,
  d,
  related,
  quakes,
}: {
  app: AppId
  d: SignalChange & CoherenceChange
  related: HistoryEvent[]
  quakes: HistoryEvent[]
}) {
  const km = (v: number) =>
    `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²`
  const pct = (v: number) => `${Math.round(v * 100)}%`
  let tiles: [string, string, string?][] = []
  if (app === "flood") {
    tiles = [
      ["New water", km(d.newWater), "blue"],
      ["Water receded", km(d.waterLoss)],
      ["Past floods here", String(related.length)],
    ]
  } else if (app === "forest") {
    const net = d.vegetationGain - d.vegetationLoss
    tiles = [
      ["Vegetation", km(d.b.vegetation), "green"],
      ["Lost", km(d.vegetationLoss), "orange"],
      ["Net change", `${net >= 0 ? "+" : ""}${km(net)}`],
    ]
  } else if (app === "agriculture") {
    const b = d.openBrightening
    tiles = [
      ["Open & crop land", km(d.b.open), "amber"],
      ["Brightness", b == null ? "—" : `${b >= 0 ? "+" : ""}${b.toFixed(1)}%`],
      [
        "Reading",
        b == null ? "—" : b > 1 ? "Wetter" : b < -1 ? "Drier" : "Stable",
      ],
    ]
  } else if (app === "subsidence") {
    tiles = [
      ["Measurable ground", pct(d.coherentB), "violet"],
      ["Area covered", pct(d.coverage)],
      ["Change", `${Math.round((d.coherentB - d.coherentA) * 100)} pts`],
    ]
  } else if (app === "landslide") {
    tiles = [
      ["Newly disturbed", km(d.newlyLost), "red"],
      ["Recovered", km(d.regained)],
      ["Past landslides", String(related.length)],
    ]
  } else {
    const biggest = [...quakes].sort((a, b) => magnitude(b) - magnitude(a))[0]
    tiles = [
      ["Recorded quakes", String(quakes.length), "red"],
      ["Largest", biggest ? `M${magnitude(biggest).toFixed(1)}` : "—"],
      ["Newly disturbed", km(d.newlyLost)],
    ]
  }
  return (
    <div className="grid grid-cols-3 gap-2 *:min-w-0">
      {tiles.map(([label, value, tone]) => (
        <div
          key={label}
          className={cn("rounded-lg p-2", tone ? TONE[tone] : "bg-muted")}
        >
          <p className="truncate text-[10px] font-medium opacity-80">{label}</p>
          <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  )
}

const TONE: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-800 dark:text-blue-200",
  green: "bg-green-500/10 text-green-800 dark:text-green-200",
  orange: "bg-orange-500/10 text-orange-800 dark:text-orange-200",
  amber: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  violet: "bg-violet-500/10 text-violet-800 dark:text-violet-200",
  red: "bg-red-500/10 text-red-800 dark:text-red-200",
}

const magnitude = (e: HistoryEvent) =>
  Number(e.title.match(/M(\d+(\.\d+)?)/)?.[1] ?? 0)

function summaryLines(
  app: AppId,
  d: (SignalChange & CoherenceChange) | null,
  base: PassOption | undefined,
  latest: PassOption | undefined,
  related: HistoryEvent[],
  quakes: HistoryEvent[]
) {
  const def = appById(app)
  if (!d || !base || !latest)
    return [`${def.label} analysis: not available yet.`]
  const span = `${formatRange(base.pass.start, base.pass.end)} → ${formatRange(latest.pass.start, latest.pass.end)}`
  const km = (v: number) => `${v.toFixed(1)} km²`
  const out = [`${def.label} analysis (NISAR, ${span}):`]
  if (app === "flood") {
    out.push(
      `- New water: ${km(d.newWater)}; water receded: ${km(d.waterLoss)}.`,
      `- Recorded floods in the area: ${related.length}.`
    )
  } else if (app === "forest") {
    out.push(
      `- Vegetation: ${km(d.b.vegetation)}; lost ${km(d.vegetationLoss)}, regrown ${km(d.vegetationGain)}.`
    )
  } else if (app === "agriculture") {
    out.push(
      `- Open/crop land: ${km(d.b.open)}; brightness change ${d.openBrightening?.toFixed(1) ?? "n/a"}% (moisture/growth proxy).`
    )
  } else if (app === "subsidence") {
    out.push(
      `- Measurable (coherent) ground: ${Math.round(d.coherentB * 100)}%. Rates in mm/year require time-series processing of full-resolution GUNW products.`
    )
  } else if (app === "landslide") {
    out.push(
      `- Newly disturbed ground (coherence lost): ${km(d.newlyLost)}; recovered ${km(d.regained)}.`,
      `- Recorded landslides in the area: ${related.length}.`
    )
  } else {
    out.push(
      `- Recorded quakes: ${quakes.length}; newly disturbed ground: ${km(d.newlyLost)}.`
    )
  }
  out.push(
    `- Estimates from NASA preview images over ${Math.round(d.coverage * 100)}% of ${d.areaKm2.toLocaleString()} km².`
  )
  return out
}

function Sparkline({
  values,
  labels,
}: {
  values: (number | null)[]
  labels: string[]
}) {
  const pts = values
    .map((v, i) => (v == null ? null : ([i, v] as const)))
    .filter((p): p is readonly [number, number] => p !== null)
  if (pts.length < 2) {
    return <div className="h-12 animate-pulse rounded-md bg-muted" />
  }
  const W = 300
  const H = 48
  const vs = pts.map((p) => p[1])
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const pad = (hi - lo) * 0.2 || 0.005
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (W - 8) + 4
  const y = (v: number) =>
    H - 6 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 12)
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i)},${y(v)}`).join(" ")
  const last = pts[pts.length - 1]
  return (
    <div className="grid gap-0.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-12 w-full overflow-visible"
        role="img"
        aria-label={`Trend from ${labels[0]} to ${labels.at(-1)}`}
      >
        <path
          d={d}
          fill="none"
          stroke="#ea580c"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {pts.map(([i, v]) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="#ea580c">
            <title>
              {labels[i]}: {(v * 100).toFixed(1)}%
            </title>
          </circle>
        ))}
        <text
          x={x(last[0])}
          y={y(last[1]) - 6}
          textAnchor="end"
          className="fill-foreground text-[10px] font-semibold"
        >
          {(last[1] * 100).toFixed(1)}%
        </text>
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels.at(-1)}</span>
      </div>
    </div>
  )
}

function Shell({
  def,
  children,
}: {
  def: ReturnType<typeof appById>
  children: React.ReactNode
}) {
  const Icon = APP_ICON[def.id]
  return (
    <section className="grid gap-2.5 rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-orange-500/10 text-orange-700 dark:text-orange-400">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{def.label} · radar overview</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {def.output}
          </p>
        </div>
      </div>
      {children}
    </section>
  )
}

/** Key for the change map on the map (bottom right). */
export function ChangeLegend({
  overlay,
  onClose,
}: {
  overlay: AnalysisOverlay
  onClose: () => void
}) {
  if (overlay.kind === "measured")
    return <MeasuredLegend overlay={overlay} onClose={onClose} />
  const rows =
    overlay.kind === "signal"
      ? [
          ["#2563eb", "New water", "dark on radar now, not before"],
          ["#7dd3fc", "Water receded", "was water, now land"],
          ["#ea580c", "Vegetation lost", "canopy echo dropped"],
          ["#16a34a", "Vegetation gained", "canopy echo rose"],
        ]
      : [
          [
            "#dc2626",
            "Newly disturbed",
            "coherence lost since the earlier pair",
          ],
          ["#14b8a6", "Recovered", "coherence regained"],
          ["#71717a", "Not measurable", "water or dense canopy in both"],
        ]
  return (
    <section className="grid gap-2 rounded-xl bg-background/90 p-3 text-xs shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">Change map</p>
          <p className="text-[11px] text-muted-foreground">{overlay.label}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <ul className="grid gap-1.5">
        {rows.map(([color, label, hint]) => (
          <li key={label} className="flex items-center gap-2.5">
            <span
              className="size-3.5 shrink-0 rounded ring-1 ring-foreground/15"
              style={{ background: color }}
            />
            <span className="w-28 shrink-0 font-medium">{label}</span>
            <span className="min-w-0 text-[11px] text-muted-foreground">
              {hint}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Colour scale for measured movement maps. */
function MeasuredLegend({
  overlay,
  onClose,
}: {
  overlay: AnalysisOverlay
  onClose: () => void
}) {
  const r = overlay.range ?? 20
  return (
    <section className="grid gap-2 rounded-xl bg-background/90 p-3 text-xs shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">Measured movement</p>
          <p className="text-[11px] text-muted-foreground">{overlay.label}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <div
        className="h-2.5 rounded-full ring-1 ring-foreground/10"
        style={{
          background: "linear-gradient(90deg, #ff3f32, #ffffff, #323fff)",
        }}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>
          −{r} {overlay.unit} away (sinking)
        </span>
        <span>+{r} toward (rising)</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Along the radar&apos;s line of sight, relative to the area&apos;s
        median. Clear = not measurable (water, dense forest).
      </p>
    </section>
  )
}
