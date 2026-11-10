"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { LayersIcon, XIcon } from "lucide-react"
import { useTheme } from "next-themes"

import type { AnalysisOverlay } from "@/components/analysis-card"
import { CaseStudies } from "@/components/case-studies"
import { DataInfoContext } from "@/components/data-info"
import {
  MapCanvas,
  type FocusRequest,
  type MapViewport,
} from "@/components/map-canvas"
import { MapControls } from "@/components/map-controls"
import { AlertsBell } from "@/components/alerts-bell"
import { NearbyButton, NearbyProblem } from "@/components/nearby-card"
import { PlaceSearch, type SearchBias } from "@/components/place-search"
import { SarLegend } from "@/components/sar-legend"
import { SarPassNav } from "@/components/sar-pass-nav"
import { Button } from "@/components/ui/button"
import { useArea } from "@/hooks/use-area"
import { useDeviceLocation } from "@/hooks/use-device-location"
import { WatchesProvider } from "@/hooks/use-watches"
import { useMapView } from "@/hooks/use-map-view"
import { useNisar } from "@/hooks/use-nisar"
import { appById, inFilter, type AppId, type HazardFilter } from "@/lib/apps"
import { cn } from "@/lib/utils"
import { inPeriod, type Period } from "@/lib/area"
import { fromSearch, toSearch } from "@/lib/share"
import type { HazardIntent, LatLng, Place } from "@/lib/geo"
import type { SarCycle } from "@/lib/sar"
import type { Map as MapLibreMap } from "maplibre-gl"

// Loaded when first needed, to keep the first page load small.
const AreaPanel = dynamic(() =>
  import("@/components/area-panel").then((m) => m.AreaPanel)
)
const CompareMap = dynamic(() =>
  import("@/components/compare-map").then((m) => m.CompareMap)
)
const ChangeLegend = dynamic(() =>
  import("@/components/analysis-card").then((m) => m.ChangeLegend)
)
const DataSourcesDialog = dynamic(() =>
  import("@/components/data-sources-dialog").then((m) => m.DataSourcesDialog)
)
const LocationConsentDialog = dynamic(() =>
  import("@/components/location-consent-dialog").then(
    (m) => m.LocationConsentDialog
  )
)

const ALERT_NOTICES: Record<string, string> = {
  confirmed:
    "Email alerts are on. You'll get an email when something new happens here.",
  unsubscribed:
    "Email alerts stopped. You won't get any more emails about that place.",
  invalid: "That link has expired or was already used.",
  error: "Something went wrong with that email link. Please try again later.",
}

/** Phone-sized screen (matches Tailwind's `max-sm`). */
const isPhone = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 639px)").matches

// Record the visit (IP goes to the server log only) once per page load.
let visitLogged = false

export function OrbitLens() {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"
  const [view, setView] = useMapView()
  const [focus, setFocus] = React.useState<FocusRequest | null>(null)
  const [picked, setPicked] = React.useState<Place | null>(null)
  const viewport = React.useRef<MapViewport | null>(null)

  // Floating panels the camera keeps targets clear of.
  const searchPanelRef = React.useRef<HTMLDivElement>(null)
  const controlsRef = React.useRef<HTMLDivElement>(null)
  const passNavRef = React.useRef<HTMLDivElement>(null)
  const legendRef = React.useRef<HTMLDivElement>(null)

  const focusOn = React.useCallback(
    (target: FocusRequest["target"], bbox?: FocusRequest["bbox"]) => {
      setFocus((prev) => ({ target, bbox, nonce: (prev?.nonce ?? 0) + 1 }))
    },
    []
  )

  // Rough location, only for "Nearby me" and ranking search results.
  const location = useDeviceLocation()
  const positionRef = React.useRef(location.position)
  React.useEffect(() => {
    positionRef.current = location.position
  }, [location.position])

  React.useEffect(() => {
    if (visitLogged) return
    visitLogged = true
    fetch("/api/visit", { method: "POST", keepalive: true }).catch(() => {})
  }, [])

  const nisar = useNisar({
    getFallbackPoint: React.useCallback(() => positionRef.current, []),
    // Switched on while zoomed out: bring the radar swath into view.
    onFirstLoad: React.useCallback(
      (cycle: SarCycle) => {
        if ((viewport.current?.zoom ?? 0) >= 6) return
        // Frame the stitched swaths.
        const b = cycle.passes.reduce<[number, number, number, number]>(
          (acc, p) => [
            Math.min(acc[0], p.bbox[0]),
            Math.min(acc[1], p.bbox[1]),
            Math.max(acc[2], p.bbox[2]),
            Math.max(acc[3], p.bbox[3]),
          ],
          [180, 90, -180, -90]
        )
        focusOn("area", b)
      },
      [focusOn]
    ),
  })

  /** Rank search results around the user, else the area on screen. */
  const getBias = React.useCallback((): SearchBias | null => {
    const p = positionRef.current
    if (p) return { latitude: p.latitude, longitude: p.longitude, zoom: 14 }
    const v = viewport.current
    // Zoomed out to the globe, the map centre says nothing; the server
    // falls back to a rough location instead.
    if (v && v.zoom >= 4) return v
    return null
  }, [])

  function pick(place: Place) {
    setSelectedEventId(null)
    setFilter("all")
    setNearby((n) => (n.tried ? { ...n, tried: false } : n))
    setPicked(place)
    focusOn("picked")
    // A hazard event: show its radar layer, on the pass nearest the event.
    if (place.sarLayer) nisar.showAt(place.sarLayer, place, place.date)
  }

  // "Nearby me": open the user's district (never their exact spot).
  const [askLocation, setAskLocation] = React.useState(false)
  const [nearby, setNearby] = React.useState({
    busy: false,
    error: null as string | null,
    /** Asked for since the last pick (so problems show only then). */
    tried: false,
  })
  async function openNearby(p: LatLng) {
    setNearby({ busy: true, error: null, tried: true })
    try {
      const res = await fetch(
        `/api/nearby?lat=${p.latitude.toFixed(2)}&lon=${p.longitude.toFixed(2)}`
      )
      const { place } = (await res.json()) as { place: Place | null }
      if (!res.ok || !place) throw new Error()
      pick(place)
      setNearby({ busy: false, error: null, tried: false })
    } catch {
      setNearby({
        busy: false,
        error: "Couldn't find your district. Try again.",
        tried: true,
      })
    }
  }
  async function nearMe() {
    setNearby((n) => ({ ...n, error: null, tried: true }))
    if (location.position) return openNearby(location.position)
    if (!location.allowed) return setAskLocation(true)
    const p = await location.locate()
    if (p) openNearby(p)
  }
  async function allowLocation() {
    setAskLocation(false)
    const p = await location.locate()
    if (p) openNearby(p)
  }

  const [dataInfo, setDataInfo] = React.useState(false)
  // Phones: the map-layers card is folded into a button until opened.
  const [layersOpen, setLayersOpen] = React.useState(false)
  const openDataInfo = () => setDataInfo(true)

  function showHazard(intent: HazardIntent) {
    if (intent.near) {
      // "banjir kelantan": frame Kelantan and check the radar there.
      const area: Place = {
        id: `hazard-${intent.near.name}`,
        name: intent.near.name,
        kind: "Area",
        icon: "area",
        area: "",
        address: "",
        latitude: intent.near.latitude,
        longitude: intent.near.longitude,
        bbox: intent.near.bbox,
      }
      setPicked(area)
      focusOn("picked")
      nisar.showAt(intent.layer, intent.near)
      return
    }
    nisar.setLayer(intent.layer)
  }

  const radarOn = nisar.layer !== null

  // Compare mode: the map instance (for the swipe view) and the handle.
  const [mainMap, setMainMap] = React.useState<MapLibreMap | null>(null)
  const [split, setSplit] = React.useState(0.5)
  // (The React Compiler memoizes this; no manual useMemo needed.)
  // Application (flood, forest…) and its change-map overlay.
  const [app, setApp] = React.useState<AppId>("flood")
  const [analysis, setAnalysis] = React.useState<AnalysisOverlay | null>(null)
  // Picking an application also filters the list and map to its hazards.
  const [filter, setFilter] = React.useState<HazardFilter>("all")
  const [period, setPeriod] = React.useState<Period>("all")
  function chooseApp(next: AppId) {
    setApp(next)
    setFilter(next)
    setAnalysis(null)
    // Show the radar layer that suits it (top right still toggles it).
    nisar.setLayer(appById(next).layer)
  }
  function showAnalysis(next: AnalysisOverlay | null) {
    setAnalysis(next)
    // The change map reads best on the plain map, unless comparing dates.
    if (next && !nisar.compare) nisar.setLayer(null)
  }
  const compareControls = {
    nisar,
    split,
    onSplitChange: setSplit,
    onFocus: (bbox: [number, number, number, number]) => focusOn("area", bbox),
    app,
    onAppChange: chooseApp,
    filter,
    onFilterChange: setFilter,
    period,
    onPeriodChange: setPeriod,
    overlay: analysis,
    onOverlay: showAnalysis,
  }
  // Swipe view: two dates (from the panel) or L-band vs C-band.
  const comparing = nisar.compare !== null || nisar.cband

  // Hazard history for the picked place (the left panel).
  const area = useArea(picked)
  const [selectedEventId, setSelectedEventId] = React.useState<string | null>(
    null
  )
  const [hoveredEventId, setHoveredEventId] = React.useState<string | null>(
    null
  )
  const [searchKey, setSearchKey] = React.useState(0)
  const events = React.useMemo(
    () => area.history.data?.events ?? [],
    [area.history.data]
  )

  function selectEvent(id: string | null) {
    if (!id) {
      // Back to the area.
      setSelectedEventId(null)
      focusOn("picked")
      return
    }
    const ev = events.find((e) => e.id === id)
    if (!ev) return
    setSelectedEventId(id)
    if (ev.outline?.length) {
      // Floods with a known extent: frame the whole affected area.
      const lons = ev.outline.map((p) => p[0])
      const lats = ev.outline.map((p) => p[1])
      focusOn("area", [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ])
      return
    }
    setFocus((prev) => ({
      target: "point",
      // Feed records (quakes) are regional; named events are precise.
      point: {
        latitude: ev.latitude,
        longitude: ev.longitude,
        zoom: ev.source === "Wikipedia" || ev.source === "Wikidata" ? 13 : 9,
      },
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }

  function closeArea() {
    setAnalysis(null)
    setPicked(null)
    setSelectedEventId(null)
    setSearchKey((k) => k + 1)
  }

  // An event to open once its place's history arrives (links, alerts).
  const pendingEvent = React.useRef<string | null>(null)

  // Open a place from a link (alerts), and the event the alert is about.
  function openLink(link: string, eventId?: string) {
    const view = fromSearch(link)
    if (!view) return
    pendingEvent.current = eventId ?? null
    pick(view.place)
    if (eventId && events.some((e) => e.id === eventId))
      Promise.resolve().then(() => selectEvent(eventId))
  }
  const [notice, setNotice] = React.useState<string | null>(null)

  // Shareable link: open the view in the URL once, then keep the URL in
  // step with what's on screen (place, filter, period, event).
  const restored = React.useRef(false)
  React.useEffect(() => {
    if (restored.current) return
    restored.current = true
    const view = fromSearch(window.location.search)
    if (!view) return
    pendingEvent.current = view.event
    // Back from an email link (confirm / unsubscribe).
    const alerts = new URLSearchParams(window.location.search).get("alerts")
    if (alerts && ALERT_NOTICES[alerts])
      Promise.resolve().then(() => setNotice(ALERT_NOTICES[alerts]))
    Promise.resolve().then(() => {
      pick(view.place)
      if (view.filter !== "all") chooseApp(view.filter)
      setPeriod(view.period)
    })
    // Once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => {
    const id = pendingEvent.current
    if (!id || !events.some((e) => e.id === id)) return
    pendingEvent.current = null
    Promise.resolve().then(() => selectEvent(id))
    // Only when the history arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events])
  React.useEffect(() => {
    if (!restored.current) return
    const search = toSearch(
      picked ? { place: picked, filter, period, event: selectedEventId } : null
    )
    if (search !== window.location.search)
      window.history.replaceState(null, "", search || window.location.pathname)
  }, [picked, filter, period, selectedEventId])

  return (
    <WatchesProvider>
      <DataInfoContext.Provider value={openDataInfo}>
        <main className="relative h-svh w-full overflow-hidden bg-background">
          <MapCanvas
            picked={picked}
            events={events.filter(
              (e) =>
                e.id === selectedEventId ||
                (!e.live &&
                  inFilter(e.type, filter) &&
                  inPeriod(e.date, period))
            )}
            selectedEventId={selectedEventId}
            onSelectEvent={selectEvent}
            hoveredEventId={hoveredEventId}
            onHoverEvent={setHoveredEventId}
            outline={
              events.find((e) => e.id === selectedEventId)?.outline ?? null
            }
            sar={nisar.overlay}
            view={view}
            theme={theme}
            focus={focus}
            onViewportChange={(v) => {
              viewport.current = v
              nisar.onViewportChange(v)
            }}
            obstructionRefs={[
              searchPanelRef,
              controlsRef,
              passNavRef,
              legendRef,
            ]}
            onMap={setMainMap}
            analysis={analysis}
          />

          {comparing && (
            <CompareMap
              mainMap={mainMap}
              overlay={nisar.compareOverlay}
              view={view}
              theme={theme}
              split={split}
              onSplitChange={setSplit}
              beforeLabel={nisar.compareLabels?.before ?? ""}
              afterLabel={nisar.compareLabels?.after ?? ""}
            />
          )}

          {/* Top-left: search and your location */}
          <aside className="pointer-events-none absolute inset-x-3 top-3 z-10 sm:inset-x-auto sm:top-4 sm:left-4 sm:w-96">
            <div
              ref={searchPanelRef}
              className="pointer-events-auto flex max-h-[55svh] flex-col gap-2 sm:max-h-[calc(100svh-6rem)]"
            >
              <PlaceSearch
                key={searchKey}
                className="shrink-0"
                getBias={getBias}
                origin={location.position}
                onPick={pick}
                onHazard={showHazard}
                onClear={closeArea}
                actions={
                  <>
                    <AlertsBell onOpen={openLink} />
                    <NearbyButton
                      busy={nearby.busy || location.status === "locating"}
                      active={picked?.id.startsWith("near-") ?? false}
                      onClick={nearMe}
                    />
                  </>
                }
              />
              {notice && (
                <div
                  role="status"
                  className="flex shrink-0 items-start gap-2 rounded-2xl bg-background/90 p-3 text-sm shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl"
                >
                  <p className="min-w-0 flex-1">{notice}</p>
                  <button
                    type="button"
                    onClick={() => setNotice(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
              )}
              {nearby.tried && (
                <NearbyProblem
                  className="shrink-0"
                  location={location}
                  error={nearby.error}
                  onRetry={nearMe}
                />
              )}
              {picked ? (
                <AreaPanel
                  key={picked.id}
                  place={picked}
                  area={area}
                  hoveredEventId={hoveredEventId}
                  onHoverEvent={setHoveredEventId}
                  compare={compareControls}
                  selectedEventId={selectedEventId}
                  onSelectEvent={selectEvent}
                  onClose={closeArea}
                />
              ) : (
                <>
                  <CaseStudies
                    className="min-h-0 overflow-x-hidden overflow-y-auto max-sm:hidden"
                    onOpen={(place, nextApp) => {
                      pick(place)
                      chooseApp(nextApp)
                    }}
                  />
                </>
              )}
            </div>
          </aside>

          {/*
        Phones: one stack along the bottom (passes, legend, controls).
        Wider screens: the stack dissolves (`contents`) and each piece takes
        its own spot: controls top-right, passes bottom-centre, legend
        bottom-right.
      */}
          <div className="pointer-events-none absolute right-14 bottom-3 left-3 z-10 flex flex-col gap-2 sm:contents">
            {radarOn && !nisar.compare && (
              <div
                ref={passNavRef}
                className="pointer-events-auto sm:absolute sm:bottom-4 sm:left-4 sm:z-10 sm:w-88 lg:left-1/2 lg:-translate-x-1/2"
              >
                <SarPassNav nisar={nisar} />
              </div>
            )}
            {(analysis || (radarOn && nisar.layer)) && (
              <div
                ref={legendRef}
                className={cn(
                  "pointer-events-auto sm:absolute sm:right-14 sm:bottom-4 sm:z-10 sm:w-72",
                  // Phones: no room for the key while a place is open.
                  picked && "max-sm:hidden"
                )}
              >
                {analysis ? (
                  <ChangeLegend
                    overlay={analysis}
                    onClose={() => setAnalysis(null)}
                  />
                ) : (
                  nisar.layer && (
                    <SarLegend layer={nisar.layer} cband={nisar.cband} />
                  )
                )}
              </div>
            )}
            <div
              ref={controlsRef}
              className="pointer-events-auto flex flex-col items-end gap-2 sm:absolute sm:top-4 sm:right-4 sm:z-10 sm:block sm:w-88"
            >
              {/* Phones: the card opens from a round button, and closes once
                  something is picked. */}
              <div className={cn("w-full", !layersOpen && "max-sm:hidden")}>
                <MapControls
                  view={view}
                  onViewChange={(v) => {
                    setView(v)
                    if (isPhone()) setLayersOpen(false)
                  }}
                  radar={nisar.layer}
                  onRadarChange={(l) => {
                    nisar.setLayer(l)
                    if (isPhone()) setLayersOpen(false)
                  }}
                />
              </div>
              <Button
                variant="outline"
                aria-label={
                  layersOpen ? "Close map layers" : "Map layers and radar"
                }
                aria-expanded={layersOpen}
                onClick={() => setLayersOpen((o) => !o)}
                className="relative size-11 rounded-full bg-background/90 shadow-lg backdrop-blur-xl sm:hidden"
              >
                {layersOpen ? <XIcon /> : <LayersIcon />}
                {!layersOpen && nisar.layer && (
                  <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-violet-600 ring-2 ring-background" />
                )}
              </Button>
            </div>
          </div>

          {askLocation && (
            <LocationConsentDialog
              open
              onAllow={allowLocation}
              onDeny={() => {
                setAskLocation(false)
                location.decline()
              }}
            />
          )}
          {dataInfo && <DataSourcesDialog open onOpenChange={setDataInfo} />}
        </main>
      </DataInfoContext.Provider>
    </WatchesProvider>
  )
}
