"use client"

import * as React from "react"
import { LoaderCircleIcon, RadarIcon, SearchIcon, XIcon } from "lucide-react"

import { PlaceIcon } from "@/components/place-icon"
import { Button } from "@/components/ui/button"
import {
  distanceMeters,
  formatDistance,
  type LatLng,
  type Place,
  type HazardIntent,
  mergePlaces,
  type SearchResponse,
} from "@/lib/geo"
import { cn } from "@/lib/utils"

export type SearchBias = LatLng & { zoom: number }

type PlaceSearchProps = {
  /** Where to rank results around right now (user or map view). */
  getBias: () => SearchBias | null
  /** Used to show "1.2 km" next to suggestions. */
  origin: LatLng | null
  onPick: (place: Place) => void
  onHazard: (intent: HazardIntent) => void
  onClear: () => void
  /** Extra buttons at the end of the search bar. */
  actions?: React.ReactNode
  className?: string
}

function biasParams(bias: SearchBias | null) {
  if (!bias) return ""
  return `&lat=${bias.latitude.toFixed(5)}&lon=${bias.longitude.toFixed(5)}&zoom=${Math.round(bias.zoom)}`
}

/** Bold the part of `text` that matches what was typed. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-semibold text-foreground">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  )
}

export function PlaceSearch({
  getBias,
  origin,
  onPick,
  onHazard,
  onClear,
  actions,
  className,
}: PlaceSearchProps) {
  const listId = React.useId()
  const [value, setValue] = React.useState("")
  const [data, setData] = React.useState<SearchResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  /** Quick suggestions are down; search runs on Enter instead. */
  const [needsSubmit, setNeedsSubmit] = React.useState(false)
  /** Hazard search: real events are loading (they come from slower feeds). */
  const [eventsLoading, setEventsLoading] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = React.useRef<AbortController | null>(null)
  // Answers we've already had, so backspacing or retyping is instant.
  const cache = React.useRef(new Map<string, SearchResponse>())

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      request.current?.abort()
    },
    []
  )

  // Rows in the dropdown: the "find nearby" action first, then places.
  const rows: (
    { type: "intent"; intent: HazardIntent } | { type: "place"; place: Place }
  )[] = [
    ...(data?.intent ? [{ type: "intent" as const, intent: data.intent }] : []),
    ...(data?.places ?? []).map((place) => ({ type: "place" as const, place })),
  ]

  function show(response: SearchResponse) {
    setData(response)
    setError(null)
    setActive(-1)
    setOpen(true)
  }

  /** Recent real events for a hazard, added under the hazard suggestion. */
  function loadEvents(intent: HazardIntent, cacheKey: string) {
    const at = intent.near ?? getBias()
    const where = at
      ? `&lat=${at.latitude.toFixed(3)}&lon=${at.longitude.toFixed(3)}`
      : ""
    setEventsLoading(true)
    fetch(`/api/hazards?hazard=${intent.hazard}${where}`)
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then(({ events }: { events: Place[] }) => {
        const withEvents = { intent, places: events }
        cache.current.set(cacheKey, withEvents)
        // Only if the user is still looking at this hazard.
        setData((d) => (d?.intent?.hazard === intent.hazard ? withEvents : d))
      })
      .catch(() => {})
      .finally(() => setEventsLoading(false))
  }

  function fetchSuggestions(q: string, submit = false) {
    request.current?.abort()
    const bias = biasParams(getBias())
    const key = `${q.toLowerCase()}|${bias}`
    const hit = cache.current.get(key)
    if (hit && !submit) {
      setLoading(false)
      show(hit)
      return
    }

    const controller = new AbortController()
    const { signal } = controller
    request.current = controller
    const url = (extra: string) =>
      `/api/search?q=${encodeURIComponent(q)}${bias}${extra}`
    setLoading(true)

    // Enter means "go": one full search, then jump to the best match.
    if (submit) {
      fetch(url("&submit=1"), { signal })
        .then(async (res) => {
          const body = (await res.json()) as SearchResponse
          const best = body.places?.[0]
          if (!res.ok) throw new Error("Search failed.")
          if (best && !body.intent) {
            setData(body)
            setOpen(false)
            setValue(best.name)
            onPick(best)
          } else {
            show(body)
            if (body.intent) loadEvents(body.intent, key)
          }
        })
        .catch(fail(signal))
        .finally(() => !signal.aborted && setLoading(false))
      return
    }

    // Typing: offline matches show at once; buildings and streets from the
    // online search are merged in when they arrive.
    fetch(url("&stage=local"), { signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Search failed.")
        const local = (await res.json()) as SearchResponse
        if (local.intent) {
          cache.current.set(key, local)
          show(local)
          setLoading(false)
          loadEvents(local.intent, key)
          return
        }
        show(local)
        const n = local.strong ?? local.places.length
        const strong = local.places.slice(0, n)
        const weak = local.places.slice(n)
        const online = await fetch(url("&stage=online"), { signal })
        const spots = online.ok
          ? ((await online.json()) as SearchResponse).places
          : []
        const merged = {
          intent: null,
          places: mergePlaces(strong, spots, weak),
        }
        if (online.ok) cache.current.set(key, merged)
        // The online search being down only matters if nothing matched.
        setNeedsSubmit(!online.ok && !merged.places.length)
        setData(merged)
      })
      .catch(fail(signal))
      .finally(() => !signal.aborted && setLoading(false))
  }

  const fail = (signal: AbortSignal) => (err: unknown) => {
    if (signal.aborted) return
    setError(err instanceof Error ? err.message : "Search failed.")
    setOpen(true)
  }

  function onChange(next: string) {
    setValue(next)
    if (timer.current) clearTimeout(timer.current)
    if (next.trim().length < 2) {
      request.current?.abort()
      setData(null)
      setError(null)
      setLoading(false)
      setOpen(false)
      return
    }
    timer.current = setTimeout(() => fetchSuggestions(next.trim()), 150)
  }

  function choose(index: number) {
    const row = rows[index]
    if (!row) return
    setOpen(false)
    if (row.type === "intent") {
      onHazard(row.intent)
    } else {
      setValue(row.place.name)
      onPick(row.place)
    }
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current)
    request.current?.abort()
    setValue("")
    setData(null)
    setError(null)
    setLoading(false)
    setOpen(false)
    onClear()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" && rows.length) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % rows.length)
    } else if (event.key === "ArrowUp" && rows.length) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const hasPlaces = (data?.places.length ?? 0) > 0
      if (open && active >= 0) choose(active)
      else if (needsSubmit && !hasPlaces && value.trim().length >= 2) {
        if (timer.current) clearTimeout(timer.current)
        fetchSuggestions(value.trim(), true)
      } else if (open && rows.length) choose(0)
      else if (value.trim().length >= 2) fetchSuggestions(value.trim(), true)
    } else if (event.key === "Escape") {
      if (open) setOpen(false)
      else if (value) clear()
    }
  }

  const showList = open && (error || data)

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl bg-background/90 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      <div className="relative flex items-center p-1.5">
        <SearchIcon className="pointer-events-none absolute left-4 size-4 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded={Boolean(showList)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-label="Search for a place"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => data && setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder="Search a place, or a hazard like “flood”"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className={cn(
            "h-10 w-full min-w-0 bg-transparent pl-9 text-base outline-none placeholder:text-muted-foreground md:text-sm",
            actions ? "pr-20" : "pr-10"
          )}
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {loading ? (
            <LoaderCircleIcon className="mr-1.5 size-4 animate-spin text-muted-foreground" />
          ) : value ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              onClick={clear}
            >
              <XIcon />
            </Button>
          ) : null}
          {actions}
        </div>
      </div>

      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          // Keep focus in the input while clicking an option.
          onMouseDown={(event) => event.preventDefault()}
          className="flex max-h-[50svh] flex-col overflow-x-hidden overflow-y-auto border-t p-1.5"
        >
          {eventsLoading && data?.intent && !data.places.length && (
            <p className="order-last flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Loading recent {data.intent.label.toLowerCase()} events…
            </p>
          )}
          {needsSubmit && !data?.places.length && !error && (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              Quick suggestions are busy right now. Press{" "}
              <kbd className="rounded border px-1 font-sans text-xs">Enter</kbd>{" "}
              to search.
            </p>
          )}
          {error ? (
            <p className="px-2.5 py-2 text-sm text-destructive">{error}</p>
          ) : needsSubmit && rows.length === 0 ? null : rows.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              {loading
                ? "Searching buildings and streets…"
                : "No matches. Try adding a city or state."}
            </p>
          ) : (
            rows.map((row, i) => (
              <div
                key={row.type === "intent" ? "intent" : row.place.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2",
                  i === active && "bg-muted"
                )}
              >
                {row.type === "intent" ? (
                  <>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 [&_svg]:size-4">
                      <RadarIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {row.intent.label}: show{" "}
                        {row.intent.layer === "movement"
                          ? "Ground movement"
                          : "Signal quality"}
                        {row.intent.near
                          ? ` in ${row.intent.near.name}`
                          : " here"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.intent.why}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <PlaceIcon icon={row.place.icon} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        <Highlight text={row.place.name} query={value} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[row.place.kind, row.place.area]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {/* Distance to a whole state/country isn't meaningful. */}
                    {origin && row.place.icon !== "area" && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatDistance(distanceMeters(origin, row.place))}
                      </span>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
