"use client"

import * as React from "react"
import type { FeatureCollection } from "geojson"
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import { circleRing, type DeviceLocation, type SearchResult } from "@/lib/geo"

export type FocusRequest = {
  target: "device" | "place"
  /** Bump to re-run the same focus request. */
  nonce: number
}

type MapCanvasProps = {
  device: DeviceLocation | null
  place: SearchResult | null
  theme: "light" | "dark"
  focus: FocusRequest | null
  /** UI floating over the map that the camera should avoid. */
  obstructionRef?: React.RefObject<HTMLElement | null>
}

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
}

const DEVICE_COLOR = "#0ea5e9" // sky-500
const ACCURACY_SOURCE = "device-accuracy"

function accuracyGeoJSON(device: DeviceLocation | null): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: device
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [circleRing(device, Math.max(device.accuracy, 5))],
            },
          },
        ]
      : [],
  }
}

/** Sources/layers are wiped by setStyle, so this runs on every style load. */
function syncAccuracyLayer(map: MapLibreMap, device: DeviceLocation | null) {
  const data = accuracyGeoJSON(device)
  const source = map.getSource(ACCURACY_SOURCE) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  map.addSource(ACCURACY_SOURCE, { type: "geojson", data })
  map.addLayer({
    id: "device-accuracy-fill",
    type: "fill",
    source: ACCURACY_SOURCE,
    paint: { "fill-color": DEVICE_COLOR, "fill-opacity": 0.12 },
  })
  map.addLayer({
    id: "device-accuracy-line",
    type: "line",
    source: ACCURACY_SOURCE,
    paint: {
      "line-color": DEVICE_COLOR,
      "line-width": 1.5,
      "line-opacity": 0.6,
    },
  })
}

function deviceMarkerElement() {
  const el = document.createElement("div")
  el.setAttribute("aria-label", "Your location")
  el.className = "relative grid size-8 place-items-center"
  el.innerHTML = `
    <span class="absolute inset-1 animate-ping rounded-full bg-sky-500/50"></span>
    <span class="relative size-4 rounded-full border-[3px] border-white bg-sky-500 shadow-md shadow-sky-900/40"></span>`
  return el
}

function placeMarkerElement(label: string) {
  const el = document.createElement("div")
  el.setAttribute("aria-label", label)
  el.className = "drop-shadow-md"
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40" aria-hidden="true">
      <path d="M16 39s13-12.4 13-23A13 13 0 0 0 3 16c0 10.6 13 23 13 23Z" fill="#ef4444" stroke="#fff" stroke-width="2"/>
      <circle cx="16" cy="16" r="5" fill="#fff"/>
    </svg>`
  return el
}

export function MapCanvas({
  device,
  place,
  theme,
  focus,
  obstructionRef,
}: MapCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const libRef = React.useRef<typeof import("maplibre-gl") | null>(null)
  const deviceMarker = React.useRef<MapLibreMarker | null>(null)
  const placeMarker = React.useRef<MapLibreMarker | null>(null)
  const deviceRef = React.useRef(device)
  const themeRef = React.useRef(theme)
  const [ready, setReady] = React.useState(false)

  // Create the map once.
  React.useEffect(() => {
    let cancelled = false
    let map: MapLibreMap | null = null

    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return
      libRef.current = maplibregl
      // MapLibre can't find its worker once bundled; it's copied to public/
      // by scripts/copy-maplibre-worker.mjs.
      maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs")

      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLES[themeRef.current],
        center: [100, 15],
        zoom: 1.6,
        attributionControl: { compact: true },
      })
      map.addControl(new maplibregl.NavigationControl(), "bottom-right")

      map.on("style.load", () => {
        if (!map) return
        map.setProjection({ type: "globe" })
        syncAccuracyLayer(map, deviceRef.current)
      })
      map.once("load", () => {
        if (!cancelled) setReady(true)
      })

      mapRef.current = map
    })

    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
      deviceMarker.current = null
      placeMarker.current = null
    }
  }, [])

  // Swap basemap when the app theme changes.
  React.useEffect(() => {
    if (themeRef.current === theme) return
    themeRef.current = theme
    mapRef.current?.setStyle(STYLES[theme])
  }, [theme])

  // Device marker + accuracy circle.
  React.useEffect(() => {
    deviceRef.current = device
    const map = mapRef.current
    const lib = libRef.current
    if (!ready || !map || !lib) return

    // isStyleLoaded() is false while tiles stream in (e.g. mid-flyTo); if our
    // source isn't there yet, the style.load handler adds it from deviceRef.
    if (map.getSource(ACCURACY_SOURCE) || map.isStyleLoaded()) {
      syncAccuracyLayer(map, device)
    }

    if (!device) {
      deviceMarker.current?.remove()
      deviceMarker.current = null
    } else if (deviceMarker.current) {
      deviceMarker.current.setLngLat([device.longitude, device.latitude])
    } else {
      deviceMarker.current = new lib.Marker({ element: deviceMarkerElement() })
        .setLngLat([device.longitude, device.latitude])
        .addTo(map)
    }
  }, [device, ready])

  // Search result pin.
  React.useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!ready || !map || !lib) return

    placeMarker.current?.remove()
    placeMarker.current = null
    if (place) {
      placeMarker.current = new lib.Marker({
        element: placeMarkerElement(place.label),
        anchor: "bottom",
      })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map)
    }
  }, [place, ready])

  // Move the camera when asked.
  React.useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!ready || !map || !lib || !focus) return

    // Keep the target clear of the floating panel: it sits on the left on
    // wide screens and across the top on phones.
    const padding = { top: 60, right: 60, bottom: 60, left: 60 }
    const panel = obstructionRef?.current?.getBoundingClientRect()
    const box = map.getContainer().getBoundingClientRect()
    if (panel && panel.width > 0) {
      if (panel.width > box.width / 2) padding.top = panel.bottom - box.top + 40
      else padding.left = panel.right - box.left + 40
    }

    if (focus.target === "device" && device) {
      const zoom = device.accuracy < 200 ? 16 : device.accuracy < 2000 ? 14 : 12
      map.flyTo({
        center: [device.longitude, device.latitude],
        zoom,
        padding,
        speed: 1.4,
      })
    }

    if (focus.target === "place" && place) {
      if (place.bbox) {
        const [w, s, e, n] = place.bbox
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding, maxZoom: 17, speed: 1.4 }
        )
      } else {
        map.flyTo({
          center: [place.longitude, place.latitude],
          zoom: 15,
          padding,
          speed: 1.4,
        })
      }
    }
    // `focus.nonce` is the trigger; device/place are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready])

  // MapLibre's CSS forces `position: relative` on the container, so the
  // positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
    </div>
  )
}
