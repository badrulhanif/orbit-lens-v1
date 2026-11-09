"use client"

import * as React from "react"
import {
  ActivityIcon,
  ChevronLeftIcon,
  CloudLightningIcon,
  ExternalLinkIcon,
  FlameIcon,
  LandPlotIcon,
  type LucideIcon,
  MountainSnowIcon,
  TriangleAlertIcon,
  WavesIcon,
} from "lucide-react"

import { DataInfoButton } from "@/components/data-sources-dialog"
import {
  formatEventDate,
  HAZARD_COLOR,
  type HazardType,
  type HistoryEvent,
  type Impact,
  precisionOf,
  SOURCE_COVERAGE,
} from "@/lib/area"
import { cn } from "@/lib/utils"

/** Event under the pointer, shared between the list and the map. */
export const HoverContext = React.createContext<{
  hovered: string | null
  setHovered: (id: string | null) => void
}>({ hovered: null, setHovered: () => {} })

export const HAZARD_ICON: Record<HazardType, LucideIcon> = {
  flood: WavesIcon,
  landslide: LandPlotIcon,
  earthquake: ActivityIcon,
  tsunami: WavesIcon,
  storm: CloudLightningIcon,
  wildfire: FlameIcon,
  volcano: MountainSnowIcon,
  disaster: TriangleAlertIcon,
}

export function countByType(events: HistoryEvent[]) {
  const counts = new Map<HazardType, number>()
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

export function EventSection({
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

const PRECISION_TONE = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  fair: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  rough: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
}

function EventRow({
  event,
  onSelect,
}: {
  event: HistoryEvent
  onSelect: (id: string) => void
}) {
  const { hovered, setHovered } = React.useContext(HoverContext)
  const ref = React.useRef<HTMLElement>(null)
  const Icon = HAZARD_ICON[event.type]
  const color = HAZARD_COLOR[event.type]
  const precision = precisionOf(event)
  const isHovered = hovered === event.id
  // No point on the map to open: link to the source instead.
  const stateWide =
    event.scope === "state" || (event.latitude === 0 && event.longitude === 0)

  // Hovering its marker on the map brings this row into view.
  React.useEffect(() => {
    if (isHovered)
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [isHovered])

  const body = (
    <>
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
        <span
          title={precision.hint}
          className={cn(
            "mt-1 inline-block rounded px-1.5 py-px text-[10px] font-medium",
            PRECISION_TONE[precision.tone]
          )}
        >
          {precision.label}
          {stateWide && ` · ${event.source}`}
        </span>
        {event.live && (
          <span
            title="Open now (JKM InfoBencana)"
            className="mt-1 ml-1 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            Open now
          </span>
        )}
        {event.offshore && (
          <span
            title="At sea, inside the state's waters"
            className="mt-1 ml-1 inline-block rounded bg-blue-500/10 px-1.5 py-px text-[10px] font-medium text-blue-700 dark:text-blue-300"
          >
            Offshore
          </span>
        )}
      </span>
      {stateWide ? (
        <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronLeftIcon className="size-4 shrink-0 rotate-180 text-muted-foreground" />
      )}
    </>
  )
  const className = cn(
    "flex w-full min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left transition-colors hover:bg-muted/60",
    isHovered && "border-foreground/30 bg-muted/60"
  )

  // State-wide records have no spot to open; link to their article instead.
  if (stateWide) {
    return (
      <a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        href={event.url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        {body}
      </a>
    )
  }
  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={() => onSelect(event.id)}
      onMouseEnter={() => setHovered(event.id)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setHovered(event.id)}
      onBlur={() => setHovered(null)}
      className={className}
    >
      {body}
    </button>
  )
}

export function Dot({ type }: { type: HazardType }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ background: HAZARD_COLOR[type] }}
    />
  )
}

export function SourcesNote({
  sources,
}: {
  sources?: { name: string; ok: boolean }[]
}) {
  const down = sources?.filter((s) => !s.ok) ?? []
  return (
    <div className="grid gap-1 text-[11px] leading-snug text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground/80">
          What these records cover
        </p>
        <DataInfoButton label="All data sources" />
      </div>
      <ul className="grid gap-0.5">
        {SOURCE_COVERAGE.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
      <p>
        Only events these sources list are shown; absence isn&apos;t proof
        nothing happened.
      </p>
      {down.length > 0 && (
        <p className="text-destructive">
          {down.map((s) => s.name).join(", ")} didn&apos;t respond, so this may
          be incomplete.
        </p>
      )}
    </div>
  )
}

/** Reported impacts by place (GDACS floods), largest first. */
export function Impacts({ impacts }: { impacts: Impact[] }) {
  const [all, setAll] = React.useState(false)
  const shown = all ? impacts : impacts.slice(0, 6)
  return (
    <div className="grid gap-1.5 text-xs">
      <p className="text-sm font-semibold">Reported impacts</p>
      <table className="w-full">
        <tbody className="divide-y">
          {shown.map((i) => (
            <tr key={`${i.kind}|${i.region}`}>
              <td className="py-1 pr-2">{i.region}</td>
              <td className="py-1 pr-2 text-muted-foreground capitalize">
                {i.kind}
              </td>
              <td className="py-1 text-right font-medium tabular-nums">
                {i.value.toLocaleString("en-GB")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {impacts.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="justify-self-start font-medium text-muted-foreground hover:text-foreground"
        >
          Show all {impacts.length}
        </button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Highest figure reported to GDACS for each place, from national disaster
        agencies.
      </p>
    </div>
  )
}
