"use client"

import * as React from "react"
import {
  ActivityIcon,
  ArrowLeftRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  CloudLightningIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FlameIcon,
  LandPlotIcon,
  LayoutDashboardIcon,
  LoaderCircleIcon,
  MountainSnowIcon,
  TriangleAlertIcon,
  WavesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useArea } from "@/hooks/use-area"
import type { useNisar } from "@/hooks/use-nisar"
import {
  formatEventDate,
  HAZARD_COLOR,
  HAZARD_LABEL,
  type Bbox,
  type HazardType,
  type HistoryEvent,
} from "@/lib/area"
import type { Place } from "@/lib/geo"
import { formatRange, passDay, type SarLayer, type SarPass } from "@/lib/sar"
import { cn } from "@/lib/utils"

type AreaData = ReturnType<typeof useArea>

const HAZARD_ICON: Record<HazardType, LucideIcon> = {
  flood: WavesIcon,
  landslide: LandPlotIcon,
  earthquake: ActivityIcon,
  tsunami: WavesIcon,
  storm: CloudLightningIcon,
  wildfire: FlameIcon,
  volcano: MountainSnowIcon,
  disaster: TriangleAlertIcon,
}

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { id: "compare", label: "Compare", icon: ArrowLeftRightIcon },
  { id: "report", label: "Report", icon: FileTextIcon },
] as const
type Tab = (typeof TABS)[number]["id"]

type AreaPanelProps = {
  place: Place
  area: AreaData
  compare: CompareControls
  selectedEventId: string | null
  /** Open a hazard's details (null goes back to the area). */
  onSelectEvent: (id: string | null) => void
  onClose: () => void
  className?: string
}

export function AreaPanel({
  place,
  area,
  compare,
  selectedEventId,
  onSelectEvent,
  onClose,
  className,
}: AreaPanelProps) {
  const events = area.history.data?.events ?? []
  const selected = events.find((e) => e.id === selectedEventId) ?? null

  return (
    <section
      aria-label={`${place.name} details`}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl bg-background/95 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      {selected ? (
        <SpotView
          key={selected.id}
          event={selected}
          areaName={place.name}
          areaEvents={events}
          compare={compare}
          onBack={() => onSelectEvent(null)}
          onSelectEvent={onSelectEvent}
          onClose={onClose}
        />
      ) : (
        <AreaView
          place={place}
          area={area}
          events={events}
          compare={compare}
          onSelectEvent={onSelectEvent}
          onClose={onClose}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Area                                                                */
/* ------------------------------------------------------------------ */

function AreaView({
  place,
  area,
  events,
  compare,
  onSelectEvent,
  onClose,
}: {
  place: Place
  area: AreaData
  events: HistoryEvent[]
  compare: CompareControls
  onSelectEvent: (id: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = React.useState<Tab>("overview")
  const inside = events.filter((e) => e.inside)
  const nearby = events.filter((e) => !e.inside)

  return (
    <>
      <header className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          {place.area && (
            <p className="truncate text-[11px] font-semibold tracking-wider text-orange-700 uppercase dark:text-orange-400">
              {place.area.split(", ").join(" · ")}
            </p>
          )}
          <h2 className="truncate text-lg leading-tight font-semibold">
            {place.name}
          </h2>
          <p className="text-xs text-muted-foreground">{place.kind}</p>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Close area"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <Tabs tab={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "overview" && (
          <AreaOverview
            place={place}
            area={area}
            inside={inside}
            nearby={nearby}
            onSelectEvent={onSelectEvent}
          />
        )}
        {tab === "compare" && <Compare bbox={area.bbox} controls={compare} />}
        {tab === "report" && (
          <Report
            loading={area.history.loading || area.radar.loading}
            text={areaSummary(place, area, inside, nearby)}
            fileName={slug(place.name)}
            events={[...inside, ...nearby]}
          />
        )}
      </div>
    </>
  )
}

function AreaOverview({
  place,
  area,
  inside,
  nearby,
  onSelectEvent,
}: {
  place: Place
  area: AreaData
  inside: HistoryEvent[]
  nearby: HistoryEvent[]
  onSelectEvent: (id: string) => void
}) {
  const { history, radar } = area
  const [filter, setFilter] = React.useState<HazardType | "all">("all")
  const earliest = inside
    .filter((e) => e.date)
    .at(-1)
    ?.date?.slice(0, 4)
  const latest = inside[0]
  const cycles = radar.data?.movement?.cycles.length ?? 0
  const types = countByType([...inside, ...nearby])
  const pass = (e: HistoryEvent) => filter === "all" || e.type === filter

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-3 gap-2 *:min-w-0">
        <Stat
          tone="warm"
          label="Recorded events"
          value={history.loading ? "…" : String(inside.length)}
          sub={earliest ? `since ${earliest}` : "in this area"}
        />
        <Stat
          label="Most recent"
          value={
            history.loading ? "…" : latest?.date ? latest.date.slice(0, 4) : "—"
          }
          sub={latest ? HAZARD_LABEL[latest.type] : "none recorded"}
        />
        <Stat
          label="NISAR cycles"
          value={radar.loading ? "…" : String(cycles)}
          sub="12-day passes"
        />
      </div>

      {history.loading ? (
        <Loading>Checking hazard records for {place.name}…</Loading>
      ) : history.error ? (
        <p className="text-sm text-destructive">{history.error}</p>
      ) : (
        <>
          {types.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <Chip on={filter === "all"} onClick={() => setFilter("all")}>
                All
              </Chip>
              {types.map(([type, n]) => (
                <Chip
                  key={type}
                  on={filter === type}
                  onClick={() => setFilter(type)}
                >
                  <Dot type={type} />
                  {HAZARD_LABEL[type]}
                  <span className="tabular-nums opacity-70">{n}</span>
                </Chip>
              ))}
            </div>
          )}

          <EventSection
            title={`In ${place.name}`}
            events={inside.filter(pass)}
            empty={`No recorded hazards inside ${place.name} in these sources.`}
            onSelect={onSelectEvent}
          />
          <EventSection
            title="Nearby"
            events={nearby.filter(pass)}
            onSelect={onSelectEvent}
          />
        </>
      )}
      <SourcesNote sources={area.history.data?.sources} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* One hazard spot                                                     */
/* ------------------------------------------------------------------ */

/** The small area around one recorded event. */
function spotPlace(event: HistoryEvent): Place {
  let bbox: Bbox
  if (event.outline?.length) {
    const lons = event.outline.map((p) => p[0])
    const lats = event.outline.map((p) => p[1])
    const cx = (Math.min(...lons) + Math.max(...lons)) / 2
    const cy = (Math.min(...lats) + Math.max(...lats)) / 2
    // Keep it within what the radar tools can handle.
    const hx = Math.min(
      2.5,
      Math.max(0.1, (Math.max(...lons) - Math.min(...lons)) / 2)
    )
    const hy = Math.min(
      2.5,
      Math.max(0.1, (Math.max(...lats) - Math.min(...lats)) / 2)
    )
    bbox = [cx - hx, cy - hy, cx + hx, cy + hy]
  } else {
    // Named events are precise; feed records (quake epicentres) less so.
    const r =
      event.source === "Wikipedia" || event.source === "Wikidata" ? 0.06 : 0.2
    bbox = [
      event.longitude - r,
      event.latitude - r,
      event.longitude + r,
      event.latitude + r,
    ]
  }
  return {
    id: `spot-${event.id}`,
    name: event.title,
    kind: HAZARD_LABEL[event.type],
    icon: "pin",
    area: "",
    address: "",
    latitude: event.latitude,
    longitude: event.longitude,
    bbox,
  }
}

function SpotView({
  event,
  areaName,
  areaEvents,
  compare,
  onBack,
  onSelectEvent,
  onClose,
}: {
  event: HistoryEvent
  areaName: string
  areaEvents: HistoryEvent[]
  compare: CompareControls
  onBack: () => void
  onSelectEvent: (id: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = React.useState<Tab>("overview")
  const place = React.useMemo(() => spotPlace(event), [event])
  const spot = useArea(place)
  const Icon = HAZARD_ICON[event.type]
  const color = HAZARD_COLOR[event.type]

  // Other records within ~15 km.
  const near = areaEvents
    .filter((e) => e.id !== event.id)
    .map((e) => ({ e, d: km(e, event) }))
    .filter(({ d }) => d < 15)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ e }) => e)

  return (
    <>
      <header className="grid gap-2 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeftIcon className="size-4" />
            {areaName}
          </button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Close area"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl"
            style={{ background: `${color}1a`, color }}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p
              className="text-[11px] font-semibold tracking-wider uppercase"
              style={{ color }}
            >
              {HAZARD_LABEL[event.type]} · {formatEventDate(event.date)}
            </p>
            <h2 className="text-base leading-snug font-semibold">
              {event.title}
            </h2>
          </div>
        </div>
      </header>
      <Tabs tab={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "overview" && (
          <SpotOverview
            event={event}
            areaName={areaName}
            spot={spot}
            near={near}
            onSelectEvent={onSelectEvent}
            onCompare={() => setTab("compare")}
          />
        )}
        {tab === "compare" && (
          <Compare bbox={spot.bbox} around={event.date} controls={compare} />
        )}
        {tab === "report" && (
          <Report
            loading={spot.radar.loading}
            text={spotSummary(event, areaName, spot)}
            fileName={slug(event.title)}
            events={[event]}
          />
        )}
      </div>
    </>
  )
}

const PRECISION: Record<HistoryEvent["source"], string> = {
  Wikipedia: "Named site, from Wikipedia",
  Wikidata: "Named site, from Wikidata",
  USGS: "Earthquake epicentre (USGS)",
  GDACS: "Centre of the affected area (outline on map)",
  "NASA EONET": "Approximate centre (NASA EONET)",
}

function SpotOverview({
  event,
  areaName,
  spot,
  near,
  onSelectEvent,
  onCompare,
}: {
  event: HistoryEvent
  areaName: string
  spot: AreaData
  near: HistoryEvent[]
  onSelectEvent: (id: string) => void
  onCompare: () => void
}) {
  const cycles = spot.radar.data?.movement?.cycles ?? []
  const firstPass = cycles.at(-1)?.start
  const date = event.date
  const before = date
    ? cycles.find((c) => c.end.slice(0, 10) < date)
    : undefined
  const after = date
    ? [...cycles].reverse().find((c) => c.start.slice(0, 10) >= date)
    : undefined

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border p-3 text-xs">
        <Field label="Date" value={formatEventDate(event.date)} />
        <Field label="Type" value={HAZARD_LABEL[event.type]} />
        <Field
          label="Where"
          value={event.inside ? `Inside ${areaName}` : `Near ${areaName}`}
        />
        <Field
          label="Coordinates"
          value={`${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`}
        />
        {event.detail && (
          <div className="col-span-2">
            <Field label="Detail" value={event.detail} />
          </div>
        )}
        <div className="col-span-2">
          <Field label="Location precision" value={PRECISION[event.source]} />
        </div>
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noreferrer"
            className="col-span-2 flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3.5" />
            View on {event.source}
          </a>
        )}
      </dl>

      <div className="grid gap-2 rounded-xl bg-muted/60 p-3 text-xs">
        <p className="text-sm font-semibold">NISAR radar here</p>
        {spot.radar.loading ? (
          <Loading>Checking passes…</Loading>
        ) : !cycles.length ? (
          <p className="text-muted-foreground">
            No NISAR passes over this spot yet.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              {cycles.length} ground-movement cycles over this spot, from{" "}
              {formatEventDate(firstPass ?? null)}.
            </p>
            {date && !before && firstPass && date < firstPass ? (
              <p className="text-muted-foreground">
                This happened before NISAR started observing here, so
                there&apos;s no radar from the time. Compare shows how the spot
                looks now.
              </p>
            ) : before && after ? (
              <p className="text-muted-foreground">
                Radar from before ({formatRange(before.start, before.end)}) and
                after ({formatRange(after.start, after.end)}) the event.
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 justify-self-start"
              onClick={onCompare}
            >
              <ArrowLeftRightIcon data-icon="inline-start" />
              Compare dates
            </Button>
          </>
        )}
      </div>

      {near.length > 0 && (
        <EventSection
          title="Other records nearby"
          events={near}
          onSelect={onSelectEvent}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Compare: date vs date                                               */
/* ------------------------------------------------------------------ */

type Option = { key: number; pass: SarPass; label: string }

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

export type CompareControls = {
  nisar: ReturnType<typeof useNisar>
  /** Swipe handle position on the map, 0–1. */
  split: number
  onSplitChange: (split: number) => void
  /** Frame an area on the map. */
  onFocus: (bbox: Bbox) => void
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
function Compare({
  bbox,
  around,
  controls,
}: {
  bbox: Bbox | null
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
  const options: Option[] = React.useMemo(() => {
    const cycles = nisar.cycles ?? []
    if (!bbox) return []
    const ref = cycles[0] ? passFor(cycles[0].passes, bbox) : null
    return cycles.map((c) => {
      const same = ref
        ? c.passes.find((p) => p.track === ref.track && p.frame === ref.frame)
        : undefined
      const pass = same ?? passFor(c.passes, bbox)
      return { key: c.cycle, pass, label: formatRange(pass.start, pass.end) }
    })
  }, [nisar.cycles, bbox])

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
  const [w, s, e, n] = bbox.map((v) => v.toFixed(4))
  const where = `w=${w}&s=${s}&e=${e}&n=${n}`

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

      {layer === "signal" ? (
        e && Number(e) - Number(w) <= 6 && Number(n) - Number(s) <= 6 ? (
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
    <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-full min-w-0 rounded-lg border bg-background px-2 text-xs text-foreground"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
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

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

function Report({
  loading,
  text,
  fileName,
  events,
}: {
  loading: boolean
  text: string
  fileName: string
  events: HistoryEvent[]
}) {
  const [copied, setCopied] = React.useState(false)
  if (loading) return <Loading>Putting the report together…</Loading>

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked.
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <pre className="rounded-xl bg-muted p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" size="sm" className="h-8" onClick={copy}>
          {copied ? (
            <CheckIcon data-icon="inline-start" />
          ) : (
            <CopyIcon data-icon="inline-start" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!events.length}
          onClick={() => download(`${fileName}.csv`, toCsv(events), "text/csv")}
        >
          <DownloadIcon data-icon="inline-start" />
          CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!events.length}
          onClick={() =>
            download(
              `${fileName}.geojson`,
              toGeoJson(events),
              "application/geo+json"
            )
          }
        >
          <DownloadIcon data-icon="inline-start" />
          GeoJSON
        </Button>
      </div>
    </div>
  )
}

function radarLines(radar: AreaData["radar"]) {
  const m = radar.data?.movement
  const s = radar.data?.signal
  const lines: string[] = []
  if (m?.cycles[0]) {
    lines.push(
      `NISAR ground movement: ${m.cycles.length} 12-day cycles; latest pair ${formatRange(m.cycles[0].start, m.cycles[0].end)}${m.cycles[0].provisional ? " (provisional)" : ""}.`
    )
  }
  if (s?.cycles[0]) {
    lines.push(
      `NISAR brightness: latest pass ${formatRange(s.cycles[0].start, s.cycles[0].end)}.`
    )
  }
  if (!lines.length) lines.push("No NISAR passes here yet.")
  return lines
}

const SOURCES_LINE =
  "Sources: Wikipedia/Wikidata, USGS, NASA EONET (GDACS), NASA/JPL-Caltech & ISRO NISAR via ASF DAAC and NASA GIBS."

function areaSummary(
  place: Place,
  area: AreaData,
  inside: HistoryEvent[],
  nearby: HistoryEvent[]
) {
  const lines = [`${place.name}${place.area ? ` (${place.area})` : ""}`, ""]
  if (inside.length) {
    const mix = countByType(inside)
      .map(
        ([t, n]) => `${n} ${HAZARD_LABEL[t].toLowerCase()}${n > 1 ? "s" : ""}`
      )
      .join(", ")
    lines.push(
      `Recorded hazard events inside the area: ${inside.length} (${mix}).`
    )
    lines.push(
      `Most recent: ${inside[0].title}, ${formatEventDate(inside[0].date)} (${inside[0].source}).`
    )
  } else {
    lines.push("No recorded hazard events inside the area in these sources.")
  }
  if (nearby.length) lines.push(`${nearby.length} more recorded close by.`)
  lines.push("", ...radarLines(area.radar), "", SOURCES_LINE)
  return lines.join("\n")
}

function spotSummary(event: HistoryEvent, areaName: string, spot: AreaData) {
  return [
    event.title,
    `${HAZARD_LABEL[event.type]} · ${formatEventDate(event.date)} · ${event.inside ? "inside" : "near"} ${areaName}`,
    `Location: ${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)} (${PRECISION[event.source].toLowerCase()})`,
    ...(event.detail ? [`Detail: ${event.detail}`] : []),
    ...(event.url ? [`Source: ${event.url}`] : []),
    "",
    ...radarLines(spot.radar),
    "",
    SOURCES_LINE,
  ].join("\n")
}

function toCsv(events: HistoryEvent[]) {
  const esc = (v: string | number | null) =>
    v == null ? "" : `"${String(v).replace(/"/g, '""')}"`
  const rows = events.map((e) =>
    [
      e.type,
      e.title,
      e.date,
      e.latitude,
      e.longitude,
      e.inside ? "inside" : "nearby",
      e.source,
      e.url,
    ]
      .map(esc)
      .join(",")
  )
  return ["type,title,date,latitude,longitude,where,source,url", ...rows].join(
    "\n"
  )
}

function toGeoJson(events: HistoryEvent[]) {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: events.map((e) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.longitude, e.latitude] },
        properties: {
          type: e.type,
          title: e.title,
          date: e.date,
          inside: e.inside,
          source: e.source,
          url: e.url,
        },
      })),
    },
    null,
    2
  )
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-")

/** Rough distance in km (fine at these scales). */
function km(a: HistoryEvent, b: HistoryEvent) {
  const dx =
    (a.longitude - b.longitude) * Math.cos((a.latitude * Math.PI) / 180)
  const dy = a.latitude - b.latitude
  return Math.hypot(dx, dy) * 111
}

function countByType(events: HistoryEvent[]) {
  const counts = new Map<HazardType, number>()
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      role="tablist"
      className="mx-3 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            tab === t.id &&
              "bg-background text-orange-700 shadow-sm ring-1 ring-foreground/10 dark:text-orange-400"
          )}
        >
          <t.icon className="size-4" />
          {t.label}
        </button>
      ))}
    </div>
  )
}

function EventSection({
  title,
  events,
  empty,
  onSelect,
}: {
  title: string
  events: HistoryEvent[]
  empty?: string
  onSelect: (id: string) => void
}) {
  if (!events.length && !empty) return null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title} · {events.length}
      </h3>
      {events.length ? (
        events.map((e) => <EventRow key={e.id} event={e} onSelect={onSelect} />)
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

function EventRow({
  event,
  onSelect,
}: {
  event: HistoryEvent
  onSelect: (id: string) => void
}) {
  const Icon = HAZARD_ICON[event.type]
  const color = HAZARD_COLOR[event.type]
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      className="flex w-full min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        style={{ background: `${color}1a`, color }}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {event.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[formatEventDate(event.date), event.detail ?? event.source]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <ChevronLeftIcon className="size-4 shrink-0 rotate-180 text-muted-foreground" />
    </button>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: "warm"
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3",
        tone === "warm" ? "bg-orange-500/10" : "bg-muted"
      )}
    >
      <p
        className={cn(
          "text-[11px] leading-tight font-medium",
          tone === "warm"
            ? "text-orange-700 dark:text-orange-400"
            : "text-muted-foreground"
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-2xl leading-none font-semibold tabular-nums">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium wrap-break-word">{value}</dd>
    </div>
  )
}

function Dot({ type }: { type: HazardType }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ background: HAZARD_COLOR[type] }}
    />
  )
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        on
          ? "border-foreground bg-foreground text-background"
          : "hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}

function Loading({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" />
      {children}
    </p>
  )
}

function SourcesNote({
  sources,
}: {
  sources?: { name: string; ok: boolean }[]
}) {
  const down = sources?.filter((s) => !s.ok) ?? []
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      Records from Wikipedia/Wikidata, USGS and NASA EONET (GDACS). Only events
      these sources list are shown.
      {down.length > 0 &&
        ` ${down.map((s) => s.name).join(", ")} didn't respond, so this may be incomplete.`}
    </p>
  )
}
