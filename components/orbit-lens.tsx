"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import {
  CrosshairIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MapPinOffIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"

import { LocationConsentDialog } from "@/components/location-consent-dialog"
import { MapCanvas, type FocusRequest } from "@/components/map-canvas"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDeviceLocation } from "@/hooks/use-device-location"
import { usePlaceName } from "@/hooks/use-place-name"
import { formatDistance, type SearchResult } from "@/lib/geo"
import { cn } from "@/lib/utils"

// Record the visit (IP goes to the server log only) once per page load.
let visitLogged = false

export function OrbitLens() {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [focus, setFocus] = React.useState<FocusRequest | null>(null)
  const [place, setPlace] = React.useState<SearchResult | null>(null)

  const focusOn = React.useCallback((target: FocusRequest["target"]) => {
    setFocus((prev) => ({ target, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  const location = useDeviceLocation(
    React.useCallback(() => focusOn("device"), [focusOn])
  )

  React.useEffect(() => {
    if (visitLogged) return
    visitLogged = true
    fetch("/api/visit", { method: "POST", keepalive: true }).catch(() => {})
  }, [])

  return (
    <main className="relative h-svh w-full overflow-hidden bg-background">
      <MapCanvas
        device={location.position}
        place={place}
        theme={theme}
        focus={focus}
        obstructionRef={panelRef}
      />

      <aside className="pointer-events-none absolute inset-x-3 top-3 z-10 sm:inset-x-auto sm:top-4 sm:left-4 sm:w-92">
        <div ref={panelRef} className="pointer-events-auto grid gap-2">
          <PlaceSearch
            onSelect={(result) => {
              setPlace(result)
              if (result) focusOn("place")
            }}
          />
          <LocationCard location={location} onShow={() => focusOn("device")} />
        </div>
      </aside>

      <LocationConsentDialog
        open={location.status === "ask"}
        onAllow={location.enable}
        onDeny={location.decline}
      />
    </main>
  )
}

const card =
  "rounded-2xl bg-background/90 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl"

function PlaceSearch({
  onSelect,
}: {
  onSelect: (result: SearchResult | null) => void
}) {
  const [value, setValue] = React.useState("")
  const [results, setResults] = React.useState<SearchResult[] | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  async function search(event: React.FormEvent) {
    event.preventDefault()
    const q = value.trim()
    if (q.length < 2) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? "Search failed.")
      const list = body as SearchResult[]
      setResults(list)
      setOpen(true)
      // Jump straight to the best match; the list lets them pick another.
      setSelectedId(list[0]?.id ?? null)
      onSelect(list[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.")
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setValue("")
    setResults(null)
    setSelectedId(null)
    setError(null)
    setOpen(false)
    onSelect(null)
  }

  return (
    <div className={cn(card, "overflow-hidden")}>
      <form onSubmit={search} className="relative flex items-center p-2">
        <SearchIcon className="pointer-events-none absolute left-4.5 size-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Search address, city, state…"
          aria-label="Search for a place"
          autoComplete="off"
          enterKeyHint="search"
          className="h-10 border-0 bg-transparent pr-20 pl-9 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="absolute right-3 flex items-center gap-1">
          {value && !loading && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              onClick={clear}
            >
              <XIcon />
            </Button>
          )}
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Search"
            disabled={loading || value.trim().length < 2}
          >
            {loading ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SearchIcon />
            )}
          </Button>
        </div>
      </form>

      {open && (error || results) && (
        <div className="max-h-[40svh] overflow-y-auto border-t p-1.5">
          {error ? (
            <p className="px-2.5 py-2 text-sm text-destructive">{error}</p>
          ) : results && results.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              No places found. Try a different spelling or add the city or
              country.
            </p>
          ) : (
            <ul>
              {results?.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(r.id)
                      setOpen(false)
                      onSelect(r)
                    }}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted",
                      r.id === selectedId && "bg-muted"
                    )}
                  >
                    <MapPinIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {r.label}
                      </span>
                      {r.detail && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.detail}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function LocationCard({
  location,
  onShow,
}: {
  location: ReturnType<typeof useDeviceLocation>
  onShow: () => void
}) {
  const { place, loading: placeLoading } = usePlaceName(location.position)

  switch (location.status) {
    case "checking":
    case "ask":
      return null

    case "locating":
      return (
        <div className={cn(card, "flex items-center gap-3 p-4 text-sm")}>
          <LoaderCircleIcon className="size-4 animate-spin text-sky-500" />
          Finding your location…
        </div>
      )

    case "ready": {
      const p = location.position!
      return (
        <div className={cn(card, "flex items-center gap-3 p-4")}>
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <MapPinIcon className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            {place ? (
              <>
                <p className="truncate text-sm font-medium">{place.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {place.detail ?? "Your location"} · ±
                  {formatDistance(p.accuracy)}
                </p>
              </>
            ) : placeLoading ? (
              <div className="grid gap-1.5">
                <div className="h-4 w-36 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">You are here</p>
                <p className="text-xs text-muted-foreground">
                  Accurate to ±{formatDistance(p.accuracy)}
                </p>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show my location on the map"
            onClick={onShow}
          >
            <CrosshairIcon />
          </Button>
        </div>
      )
    }

    case "off":
      return (
        <ErrorCard
          title="Location is off"
          message="You need to enable location to see where you are on the map."
          action="Enable location"
          onAction={location.enable}
        />
      )

    case "blocked":
      return (
        <ErrorCard
          title="Location is blocked"
          message="Your browser is blocking location for this site. Click the icon next to the address bar, set Location to Allow, then try again."
          action="Try again"
          onAction={location.enable}
        />
      )

    case "error":
      return (
        <ErrorCard
          title="Couldn't find your location"
          message={location.error ?? "Something went wrong."}
          action="Try again"
          onAction={location.enable}
        />
      )
  }
}

function ErrorCard({
  title,
  message,
  action,
  onAction,
}: {
  title: string
  message: string
  action: string
  onAction: () => void
}) {
  return (
    <div
      role="alert"
      className={cn(
        card,
        "grid gap-3 p-4 ring-destructive/30 dark:ring-destructive/40"
      )}
    >
      <div className="flex gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
          <MapPinOffIcon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button className="h-9" onClick={onAction}>
        <MapPinIcon data-icon="inline-start" />
        {action}
      </Button>
    </div>
  )
}
