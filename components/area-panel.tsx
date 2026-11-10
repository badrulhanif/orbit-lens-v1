"use client"

import * as React from "react"
import {
  ArrowDownUpIcon,
  CalendarIcon,
  ArrowLeftRightIcon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react"

import {
  AnalysisCard,
  analysisBox,
  AppPicker,
} from "@/components/analysis-card"
import { Compare, type CompareControls } from "@/components/area/compare"
import {
  EventSection,
  HAZARD_ICON,
  HoverContext,
  Impacts,
  SORTS,
  sortEvents,
  SourcesNote,
  type SortKey,
} from "@/components/area/events"
import { HappeningNow } from "@/components/area/live"
import { ShareButton } from "@/components/share-button"
import { measuredPairUrl } from "@/components/measured"
import { Report, slug } from "@/components/area/report"
import { areaReport, spotReport } from "@/components/area/report-doc"
import { Field, Loading, Stat, type Tab, Tabs } from "@/components/area/ui"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useArea, type AreaData } from "@/hooks/use-area"
import {
  appById,
  APPS,
  inFilter,
  type AppId,
  type HazardFilter,
} from "@/lib/apps"
import {
  type Bbox,
  formatEventDate,
  HAZARD_COLOR,
  HAZARD_LABEL,
  type HazardType,
  type HistoryEvent,
  precisionOf,
  inPeriod,
  PERIODS,
  type Period,
} from "@/lib/area"
import type { Place } from "@/lib/geo"
import { formatRange } from "@/lib/sar"
import { cn } from "@/lib/utils"

type AreaPanelProps = {
  place: Place
  area: AreaData
  hoveredEventId?: string | null
  onHoverEvent?: (id: string | null) => void
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
  hoveredEventId = null,
  onHoverEvent = () => {},
  compare,
  selectedEventId,
  onSelectEvent,
  onClose,
  className,
}: AreaPanelProps) {
  const events = area.history.data?.events ?? []
  const selected = events.find((e) => e.id === selectedEventId) ?? null

  return (
    <HoverContext.Provider
      value={{ hovered: hoveredEventId, setHovered: onHoverEvent }}
    >
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
    </HoverContext.Provider>
  )
}

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
  const [analysisLines, setAnalysisLines] = React.useState<string[]>([])

  // Start reading the measured movement now, so it's ready when a movement
  // hazard (subsidence, landslide, earthquake) is picked.
  const movement = area.radar.data?.movement
  const prefetch =
    area.bbox && movement
      ? measuredPairUrl(movement.cycles, analysisBox(area.bbox))
      : null
  React.useEffect(() => {
    if (prefetch) fetch(prefetch).catch(() => {})
  }, [prefetch])

  // Open relief centres are "now" (the strip and the map), not history.
  // Events at sea within the state's waters are listed (and counted) apart.
  const live = events.filter((e) => e.live)
  const history = events.filter((e) => !e.live)
  const onshore = history.filter((e) => !e.offshore)
  const offshore = history.filter((e) => e.offshore)
  const counts = area.history.data
    ? (Object.fromEntries(
        (["all", ...APPS.map((a) => a.id)] as HazardFilter[]).map((f) => [
          f,
          history.filter(
            (e) => inFilter(e.type, f) && inPeriod(e.date, compare.period)
          ).length,
        ])
      ) as Record<HazardFilter, number>)
    : null

  return (
    <>
      <header className="flex items-start gap-3 px-4 pt-4 pb-2">
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
        <ShareButton />
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Close area"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <AppPicker
        value={compare.filter}
        counts={counts}
        onChange={(f) =>
          f === "all" ? compare.onFilterChange("all") : compare.onAppChange(f)
        }
      />
      <Tabs tab={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 wrap-break-word">
        {tab === "overview" && (
          <AreaOverview
            place={place}
            area={area}
            onshore={onshore}
            offshore={offshore}
            live={live}
            filter={compare.filter}
            period={compare.period}
            onPeriodChange={compare.onPeriodChange}
            onSelectEvent={onSelectEvent}
            analysis={
              <AnalysisCard
                app={compare.app}
                area={area}
                boundaryKey={place.boundaryKey}
                events={onshore}
                overlay={compare.overlay}
                onOverlay={compare.onOverlay}
                onSummary={setAnalysisLines}
              />
            }
          />
        )}
        {tab === "compare" && (
          <Compare
            bbox={area.bbox}
            boundaryKey={place.boundaryKey}
            controls={compare}
          />
        )}
        {tab === "report" && (
          <Report
            loading={area.history.loading || area.radar.loading}
            doc={areaReport({
              place,
              area,
              onshore,
              offshore,
              live,
              analysisLines,
            })}
            fileName={slug(place.name)}
            events={events}
            bbox={area.bbox}
          />
        )}
      </div>
    </>
  )
}

function AreaOverview({
  place,
  area,
  onshore,
  offshore,
  live,
  filter,
  period,
  onPeriodChange,
  onSelectEvent,
  analysis,
}: {
  place: Place
  area: AreaData
  onshore: HistoryEvent[]
  offshore: HistoryEvent[]
  live: HistoryEvent[]
  filter: HazardFilter
  period: Period
  onPeriodChange: (period: Period) => void
  onSelectEvent: (id: string) => void
  analysis: React.ReactNode
}) {
  const { history, radar } = area
  const [sort, setSort] = React.useState<SortKey>("newest")
  const cycles = radar.data?.movement?.cycles.length ?? 0
  // Stats, list and map all follow the hazard filter.
  const pass = (e: HistoryEvent) =>
    inFilter(e.type, filter) && inPeriod(e.date, period)
  const inArea = onshore.filter(pass)
  const shown = sortEvents(inArea, sort)
  const atSea = sortEvents(offshore.filter(pass), sort)
  const byDate = sortEvents(inArea, "newest")
  const earliest = byDate
    .filter((e) => e.date)
    .at(-1)
    ?.date?.slice(0, 4)
  const latest = byDate[0]
  // State-wide records and floods reported here from elsewhere have no
  // point in the area, so they're listed but not on the map.
  const onMap = (e: HistoryEvent) =>
    !e.scope || e.scope === "site"
      ? !(e.latitude === 0 && e.longitude === 0)
      : false
  const offMap = shown.filter((e) => !onMap(e)).length
  const what =
    filter === "all"
      ? "hazards"
      : `${appById(filter).label.toLowerCase()} events`

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-3 gap-2 *:min-w-0">
        <Stat
          tone="warm"
          label={
            filter === "all"
              ? "Recorded events"
              : `${appById(filter).label} events`
          }
          value={history.loading ? "…" : String(inArea.length)}
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

      {history.data && (
        <HappeningNow
          warnings={history.data.warnings}
          centres={live}
          checked={history.data.sources.some(
            (s) => s.name === "JKM relief centres" && s.ok
          )}
        />
      )}

      {/* The radar overview is per hazard: hidden for "All". */}
      {filter === "all" ? (
        <p className="text-xs text-muted-foreground">
          Pick a hazard above for its NISAR radar overview.
        </p>
      ) : (
        analysis
      )}

      {history.loading ? (
        <Loading>Checking hazard records for {place.name}…</Loading>
      ) : history.error ? (
        <p className="text-sm text-destructive">{history.error}</p>
      ) : (
        <>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Choice
                label="Period"
                icon={<CalendarIcon />}
                value={period}
                options={PERIODS}
                onChange={onPeriodChange}
              />
              <Choice
                label="Sort"
                icon={<ArrowDownUpIcon />}
                value={sort}
                options={SORTS}
                onChange={setSort}
                align="end"
              />
            </div>
            <h3 className="min-w-0 truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              In {place.name} · {shown.length}
              {offMap > 0 && (
                <span className="font-normal tracking-normal normal-case">
                  {" "}
                  ({shown.length - offMap} on map)
                </span>
              )}
            </h3>
            <EventSection
              events={shown}
              empty={`No recorded ${what} in ${place.name} in these sources.`}
              onSelect={onSelectEvent}
            />
          </div>
          <EventSection
            title="Nearby, offshore"
            events={atSea}
            onSelect={onSelectEvent}
          />
        </>
      )}

      <SourcesNote sources={area.history.data?.sources} />
    </div>
  )
}

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
          <div className="flex gap-1.5">
            <ShareButton />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Close area"
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </div>
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
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        {tab === "overview" && (
          <>
            <SpotOverview
              event={event}
              areaName={areaName}
              spot={spot}
              near={near}
              onSelectEvent={onSelectEvent}
              onCompare={() => setTab("compare")}
              analysis={
                <AnalysisCard
                  app={SPOT_APP[event.type] ?? compare.app}
                  area={spot}
                  events={[event]}
                  eventDate={event.date}
                  overlay={compare.overlay}
                  onOverlay={compare.onOverlay}
                />
              }
            />
          </>
        )}
        {tab === "compare" && (
          <Compare bbox={spot.bbox} around={event.date} controls={compare} />
        )}
        {tab === "report" && (
          <Report
            loading={spot.radar.loading}
            doc={spotReport({ event, areaName, spot, near })}
            fileName={slug(event.title)}
            events={[event]}
            bbox={spot.bbox}
          />
        )}
      </div>
    </>
  )
}

/** Which analysis suits each kind of recorded event. */
const SPOT_APP: Partial<Record<HazardType, AppId>> = {
  flood: "flood",
  storm: "flood",
  landslide: "landslide",
  earthquake: "earthquake",
  tsunami: "earthquake",
  volcano: "earthquake",
  wildfire: "forest",
}

function SpotOverview({
  event,
  areaName,
  spot,
  near,
  onSelectEvent,
  onCompare,
  analysis,
}: {
  event: HistoryEvent
  areaName: string
  spot: AreaData
  near: HistoryEvent[]
  onSelectEvent: (id: string) => void
  onCompare: () => void
  /** The radar overview for this kind of event. */
  analysis: React.ReactNode
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

  // Order: the facts, the radar overview, what happened, impacts, radar
  // passes, then other records nearby.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border p-3 text-xs">
        <Field label="Date" value={formatEventDate(event.date)} />
        <Field
          label="Where"
          value={
            event.offshore
              ? `Offshore, ${areaName} waters`
              : event.scope === "reported"
                ? `Reported in ${areaName}`
                : areaName
          }
        />
        <div className="col-span-2">
          <Field
            label="Coordinates"
            value={`${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`}
          />
        </div>
        {event.detail && (
          <div className="col-span-2">
            <Field label="Detail" value={event.detail} />
          </div>
        )}
        <div className="col-span-2">
          <Field label="Location precision" value={precisionOf(event).hint} />
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

      {analysis}

      {event.description && (
        <div className="grid gap-1 text-xs leading-relaxed">
          <p className="text-sm font-semibold">What happened</p>
          <p>{event.description}</p>
        </div>
      )}
      {event.source === "GDACS" && !!event.impacts?.length && (
        <Impacts impacts={event.impacts} />
      )}

      <div className="grid gap-1.5 text-xs">
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

/** Rough distance in km (fine at these scales). */
function km(a: HistoryEvent, b: HistoryEvent) {
  const dx =
    (a.longitude - b.longitude) * Math.cos((a.latitude * Math.PI) / 180)
  const dy = a.latitude - b.latitude
  return Math.hypot(dx, dy) * 111
}

/** A small labelled dropdown (period, sort). */
function Choice<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
  align = "start",
}: {
  label: string
  icon: React.ReactNode
  value: T
  options: { id: T; label: string }[]
  onChange: (value: T) => void
  align?: "start" | "end"
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      items={options.map((o) => ({ value: o.id, label: o.label }))}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className="shrink-0 text-xs [&>svg:first-child]:size-3.5 [&>svg:first-child]:text-muted-foreground"
      >
        {icon}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={align}>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
