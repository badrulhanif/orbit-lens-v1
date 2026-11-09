"use client"

import * as React from "react"
import { useTheme } from "next-themes"

import { LocationCard } from "@/components/location-card"
import { LocationConsentDialog } from "@/components/location-consent-dialog"
import {
  MapCanvas,
  type FocusRequest,
  type MapViewport,
} from "@/components/map-canvas"
import { MapControls } from "@/components/map-controls"
import { PlaceSearch, type SearchBias } from "@/components/place-search"
import { SarLegend } from "@/components/sar-legend"
import { SarPassNav } from "@/components/sar-pass-nav"
import { useDeviceLocation } from "@/hooks/use-device-location"
import { useMapView } from "@/hooks/use-map-view"
import { useNisar } from "@/hooks/use-nisar"
import type { HazardIntent, Place } from "@/lib/geo"

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

  const focusOn = React.useCallback((target: FocusRequest["target"]) => {
    setFocus((prev) => ({ target, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  const location = useDeviceLocation(
    React.useCallback(() => focusOn("device"), [focusOn])
  )
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
    onFirstLoad: React.useCallback(() => {
      if ((viewport.current?.zoom ?? 0) < 6) focusOn("sar")
    }, [focusOn]),
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
    setPicked(place)
    focusOn("picked")
    // A hazard event: show its radar layer, on the pass nearest the event.
    if (place.sarLayer) nisar.showAt(place.sarLayer, place, place.date)
  }

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

  return (
    <main className="relative h-svh w-full overflow-hidden bg-background">
      <MapCanvas
        device={location.position}
        picked={picked}
        sar={nisar.overlay}
        view={view}
        theme={theme}
        focus={focus}
        onViewportChange={(v) => {
          viewport.current = v
          nisar.onViewportChange(v)
        }}
        obstructionRefs={[searchPanelRef, controlsRef, passNavRef, legendRef]}
      />

      {/* Top-left: search and your location */}
      <aside className="pointer-events-none absolute inset-x-3 top-3 z-10 sm:inset-x-auto sm:top-4 sm:left-4 sm:w-96">
        <div
          ref={searchPanelRef}
          className="pointer-events-auto flex flex-col gap-2"
        >
          <PlaceSearch
            className="shrink-0"
            getBias={getBias}
            origin={location.position}
            onPick={pick}
            onHazard={showHazard}
            onClear={() => setPicked(null)}
          />
          <LocationCard
            className="shrink-0"
            location={location}
            onShow={() => focusOn("device")}
          />
        </div>
      </aside>

      {/*
        Phones: one stack along the bottom (passes, legend, controls).
        Wider screens: the stack dissolves (`contents`) and each piece takes
        its own spot: controls top-right, passes bottom-centre, legend
        bottom-right.
      */}
      <div className="pointer-events-none absolute right-14 bottom-3 left-3 z-10 flex flex-col gap-2 sm:contents">
        {radarOn && (
          <div
            ref={passNavRef}
            className="pointer-events-auto sm:absolute sm:bottom-4 sm:left-4 sm:z-10 sm:w-88 lg:left-1/2 lg:-translate-x-1/2"
          >
            <SarPassNav nisar={nisar} />
          </div>
        )}
        {radarOn && nisar.layer && (
          <div
            ref={legendRef}
            className="pointer-events-auto sm:absolute sm:right-14 sm:bottom-4 sm:z-10 sm:w-72"
          >
            <SarLegend layer={nisar.layer} />
          </div>
        )}
        <div
          ref={controlsRef}
          className="pointer-events-auto sm:absolute sm:top-4 sm:right-4 sm:z-10 sm:w-88"
        >
          <MapControls
            view={view}
            onViewChange={setView}
            radar={nisar.layer}
            onRadarChange={nisar.setLayer}
          />
        </div>
      </div>

      <LocationConsentDialog
        open={location.status === "ask"}
        onAllow={location.enable}
        onDeny={location.decline}
      />
    </main>
  )
}
