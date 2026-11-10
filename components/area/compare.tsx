"use client"

import * as React from "react"
import { LayersIcon } from "lucide-react"

import { analysisBox, type AnalysisOverlay } from "@/components/analysis-card"
import { Loading, Stat } from "@/components/area/ui"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { useNisar } from "@/hooks/use-nisar"
import { type AppId, type HazardFilter } from "@/lib/apps"
import { areaQuery, type Bbox, type Period } from "@/lib/area"
import { passDay, type SarLayer } from "@/lib/sar"
import { type PassOption, passOptions } from "@/lib/sar-options"
import { cn } from "@/lib/utils"

type Option = PassOption

export type CompareControls = {
  nisar: ReturnType<typeof useNisar>
  /** Swipe handle position on the map, 0–1. */
  split: number
  onSplitChange: (split: number) => void
  /** Frame an area on the map. */
  onFocus: (bbox: Bbox) => void
  /** Selected application (flood, forest…) and its change-map overlay. */
  app: AppId
  onAppChange: (app: AppId) => void
  /** Which hazards the list and map show (an app's, or all). */
  filter: HazardFilter
  onFilterChange: (filter: HazardFilter) => void
  /** How far back the list and map look. */
  period: Period
  onPeriodChange: (period: Period) => void
  overlay: AnalysisOverlay | null
  onOverlay: (overlay: AnalysisOverlay | null) => void
}

const LAYER_NAME: Record<SarLayer, string> = {
  movement: "Ground movement",
  signal: "Signal quality",
}

/**
 * Date-vs-date comparison. The images are on the map (before left, after
 * right of the swipe handle); this card picks the dates and shows the data.
 * It compares whichever radar layer is on (top right), Ground movement by
 * default.
 */
export function Compare({
  bbox,
  boundaryKey,
  around,
  controls,
}: {
  bbox: Bbox | null
  boundaryKey?: string
  /** Pick dates either side of this (ISO), if radar covers it. */
  around?: string | null
  controls: CompareControls
}) {
  const { nisar, split, onSplitChange, onFocus } = controls
  const layer = nisar.layer

  // Entering Compare: make sure a radar layer is on and frame the area.
  // Leaving it: back to the normal single-date view.
  React.useEffect(() => {
    if (!nisar.layer) nisar.setLayer("movement")
    if (bbox) onFocus(bbox)
    return () => nisar.setCompare(null)
    // Run once per Compare visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Newest first. Every date uses the same orbit track and frame where it
  // can, so both sides show the same ground from the same angle.
  const options: Option[] = React.useMemo(
    () => (bbox ? passOptions(nisar.cycles ?? [], bbox) : []),
    [nisar.cycles, bbox]
  )

  const defaults = React.useMemo((): [number, number] | null => {
    if (options.length < 2) return null
    if (around) {
      const before = options.find((o) => o.pass.end.slice(0, 10) < around)
      const after = [...options]
        .reverse()
        .find((o) => o.pass.start.slice(0, 10) >= around)
      if (before && after && before.key !== after.key) {
        return [before.key, after.key]
      }
    }
    return [options[1].key, options[0].key]
  }, [options, around])

  const [picked, setPicked] = React.useState<[number, number] | null>(null)
  // Keep the user's picks while they still exist (the list follows the map).
  const keys = options.map((o) => o.key)
  const pair =
    picked && keys.includes(picked[0]) && keys.includes(picked[1])
      ? picked
      : defaults

  const labelFor = (k: number) => options.find((o) => o.key === k)?.label ?? ""
  const aLabel = pair ? labelFor(pair[0]) : ""
  const bLabel = pair ? labelFor(pair[1]) : ""
  React.useEffect(() => {
    nisar.setCompare(pair ? { a: pair[0], b: pair[1], aLabel, bLabel } : null)
    // `nisar.setCompare` is stable; only the chosen pair matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair?.[0], pair?.[1], aLabel, bLabel])

  if (!layer || (nisar.loading && !options.length) || !bbox) {
    return <Loading>Finding NISAR dates…</Loading>
  }
  if (!pair) {
    return (
      <p className="text-sm text-muted-foreground">
        {options.length
          ? "Only one NISAR pass over here so far, so there's nothing to compare yet."
          : "No NISAR passes over here yet."}
      </p>
    )
  }

  const a = options.find((o) => o.key === pair[0])!
  const b = options.find((o) => o.key === pair[1])!
  const days = Math.round(
    (Date.parse(b.pass.start) - Date.parse(a.pass.start)) / 86400_000
  )
  const where = areaQuery(bbox)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Comparing{" "}
        <span className="font-medium text-foreground">{LAYER_NAME[layer]}</span>{" "}
        on the map. Switch layers on the top right.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <DateSelect
          label="Before"
          value={a.key}
          options={options}
          onChange={(k) => setPicked([k, b.key])}
        />
        <DateSelect
          label="After"
          value={b.key}
          options={options}
          onChange={(k) => setPicked([a.key, k])}
        />
      </div>

      <label className="grid gap-1.5">
        <span className="flex justify-between text-xs font-medium">
          Before / after swipe
          <span className="font-normal text-muted-foreground tabular-nums">
            {Math.round(split * 100)}%
          </span>
        </span>
        <input
          type="range"
          min={2}
          max={98}
          value={Math.round(split * 100)}
          onChange={(ev) => onSplitChange(Number(ev.target.value) / 100)}
          className="w-full accent-orange-600"
        />
        <span className="text-[11px] text-muted-foreground">
          Or drag the handle on the map.
          {nisar.waiting > 0 && " Loading radar images…"}
        </span>
      </label>

      <div className="grid grid-cols-3 gap-2 *:min-w-0">
        <Stat label="Span" value={`${Math.abs(days)} d`} sub="between passes" />
        <Stat
          label="Direction"
          value={b.pass.direction === "Descending" ? "Desc" : "Asc"}
          sub={b.pass.direction ?? "—"}
        />
        <Stat
          label="Track"
          value={String(b.pass.track ?? "—")}
          sub={`frame ${b.pass.frame ?? "?"}`}
        />
      </div>

      <ChangeMapButton
        layer={layer}
        bbox={bbox}
        boundaryKey={boundaryKey}
        a={a}
        b={b}
        controls={controls}
      />

      {layer === "signal" ? (
        bbox[2] - bbox[0] <= 6 && bbox[3] - bbox[1] <= 6 ? (
          <BrightnessStats
            where={where}
            a={passDay(a.pass)}
            b={passDay(b.pass)}
          />
        ) : null
      ) : (
        <p className="rounded-xl bg-orange-500/10 p-3 text-[11px] leading-relaxed text-orange-950 dark:text-orange-100">
          Each side is the ground&apos;s change over one 12-day pair; a full
          colour cycle ≈ 12 cm toward or away from the satellite. Rings in the
          same place on both sides point to real, ongoing movement; patterns
          that change completely are usually the atmosphere.
        </p>
      )}
    </div>
  )
}

/** Change map for the chosen pair, drawn on the map. */
function ChangeMapButton({
  layer,
  bbox,
  boundaryKey,
  a,
  b,
  controls,
}: {
  layer: SarLayer
  bbox: Bbox
  boundaryKey?: string
  a: Option
  b: Option
  controls: CompareControls
}) {
  const box = analysisBox(bbox)
  const key = (o: Option) => (layer === "signal" ? passDay(o.pass) : o.pass.id)
  const url = `/api/analysis/map?layer=${layer}&a=${encodeURIComponent(key(a))}&b=${encodeURIComponent(key(b))}&${areaQuery(box, boundaryKey)}`
  const showing = controls.overlay?.url === url
  return (
    <Button
      variant={showing ? "default" : "outline"}
      size="sm"
      className="h-8 justify-self-start"
      onClick={() =>
        controls.onOverlay(
          showing
            ? null
            : {
                url,
                bbox: box,
                kind: layer,
                label: `${a.label} → ${b.label}`,
              }
        )
      }
    >
      <LayersIcon data-icon="inline-start" />
      {showing ? "Hide change map" : "Show change map"}
    </Button>
  )
}

function DateSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: Option[]
  onChange: (key: number) => void
}) {
  return (
    <div className="grid min-w-0 gap-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <Select
        value={value}
        onValueChange={(v) => v !== null && onChange(Number(v))}
        items={options.map((o) => ({ value: o.key, label: o.label }))}
      >
        <SelectTrigger
          aria-label={label}
          className="h-9 w-full min-w-0 text-xs"
        >
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.key} value={o.key} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type DarkStats = {
  coverage: number
  darkA: number | null
  darkB: number | null
}

function BrightnessStats({
  where,
  a,
  b,
}: {
  where: string
  a: string
  b: string
}) {
  const key = `/api/sar/compare?a=${a}&b=${b}&${where}`
  const [state, setState] = React.useState<{
    key: string
    data: DarkStats | null
  } | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    fetch(key, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<DarkStats>) : null))
      .then((data) => setState({ key, data }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, data: null })
      })
    return () => controller.abort()
  }, [key])

  const current = state?.key === key ? state : null
  if (!current) return <Loading>Measuring water surface…</Loading>
  if (!current.data) {
    return (
      <p className="text-xs text-destructive">
        Couldn&apos;t measure these images.
      </p>
    )
  }
  const { coverage, darkA, darkB } = current.data
  if (darkA == null || darkB == null || coverage < 0.05) {
    return (
      <p className="text-xs text-muted-foreground">
        These two dates barely overlap here, so there&apos;s nothing to measure.
        Try dates from the same direction (ascending or descending).
      </p>
    )
  }
  const diff = (darkB - darkA) * 100
  return (
    <div className="grid gap-2 rounded-xl border p-3">
      <p className="text-xs font-semibold">
        Dark surface (water, smooth ground)
      </p>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-lg font-semibold">
          {(darkA * 100).toFixed(1)}%
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="text-lg font-semibold">
          {(darkB * 100).toFixed(1)}%
        </span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-medium",
            Math.abs(diff) < 1
              ? "bg-muted text-muted-foreground"
              : diff > 0
                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
          )}
        >
          {diff > 0 ? "+" : ""}
          {diff.toFixed(1)} pts
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Share of the area that looks dark on radar, counted over the{" "}
        {Math.round(coverage * 100)}% both dates cover. A rise can mean flooding
        or standing water. It&apos;s an estimate from NASA&apos;s preview
        images, not a flood map.
      </p>
    </div>
  )
}
