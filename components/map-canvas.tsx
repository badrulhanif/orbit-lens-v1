"use client"

import * as React from "react"
import type { FeatureCollection } from "geojson"
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import { circleRing, isArea, type DeviceLocation, type Place } from "@/lib/geo"
import { styleFor, styleKey, type MapView } from "@/lib/map-styles"
import type { SarOverlay } from "@/lib/sar"

export type FocusRequest = {
  target: "device" | "picked" | "area"
  /** Bump to re-run the same focus request. */
  nonce: number
  /** For "area": [west, south, east, north] to frame. */
  bbox?: [number, number, number, number]
}

export type MapViewport = {
  latitude: number
  longitude: number
  zoom: number
  /** [west, south, east, north] of what's on screen. */
  bounds: [number, number, number, number]
}

type MapCanvasProps = {
  device: DeviceLocation | null
  /** The place picked in search. Exact spots get a pin; areas are framed. */
  picked: Place | null
  sar: SarOverlay | null
  view: MapView
  theme: "light" | "dark"
  focus: FocusRequest | null
  onViewportChange?: (viewport: MapViewport) => void
  /** Panels floating over the map that the camera should avoid. */
  obstructionRefs?: React.RefObject<HTMLElement | null>[]
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

/* ------------------------------------------------------------------ */
/* NISAR radar overlay                                                 */
/* ------------------------------------------------------------------ */

const SAR_PREFIX = "sar-"

/** Radar goes under the map's labels so place names stay readable. */
function firstLabelLayer(map: MapLibreMap) {
  return map.getStyle().layers?.find((l) => l.type === "symbol")?.id
}

/** Stable, style-safe id for a piece of the mosaic. */
const pieceId = (id: string) => SAR_PREFIX + id.replace(/[^A-Za-z0-9_-]/g, "_")

/**
 * Draw the radar mosaic: each swath (or day of GIBS tiles) is its own
 * source + layer. Pieces still wanted stay put (no flicker when panning);
 * pieces no longer wanted are removed; new ones are added on top.
 */
function syncSarLayers(map: MapLibreMap, sar: SarOverlay | null) {
  const wanted = new Map((sar?.pieces ?? []).map((p) => [pieceId(p.id), p]))
  const existing = (map.getStyle().layers ?? [])
    .map((l) => l.id)
    .filter((id) => id.startsWith(SAR_PREFIX))

  for (const id of existing) {
    if (wanted.has(id)) continue
    map.removeLayer(id)
    if (map.getSource(id)) map.removeSource(id)
  }

  const before = firstLabelLayer(map)
  for (const [id, piece] of wanted) {
    if (!map.getSource(id)) {
      if (piece.kind === "tiles") {
        map.addSource(id, {
          type: "raster",
          tiles: [piece.tiles],
          tileSize: 256,
          maxzoom: 13,
          bounds: piece.bounds,
          attribution:
            "NISAR: NASA/JPL-Caltech &amp; ISRO via NASA GIBS / ASF DAAC",
        })
      } else {
        map.addSource(id, {
          type: "image",
          url: piece.url,
          coordinates: piece.coordinates,
        })
      }
    }
    if (!map.getLayer(id)) {
      map.addLayer(
        {
          id,
          type: "raster",
          source: id,
          paint: { "raster-opacity": sar!.opacity, "raster-fade-duration": 0 },
        },
        before
      )
    }
  }
}

/* ------------------------------------------------------------------ */

function deviceMarkerElement() {
  const el = document.createElement("div")
  el.setAttribute("aria-label", "Your location")
  el.className = "relative grid size-8 place-items-center"
  el.innerHTML = `
    <span class="absolute inset-1 animate-ping rounded-full bg-sky-500/50"></span>
    <span class="relative size-4 rounded-full border-[3px] border-white bg-sky-500 shadow-md shadow-sky-900/40"></span>`
  return el
}

function pinElement(label: string) {
  const el = document.createElement("div")
  el.setAttribute("aria-label", label)
  el.title = label
  el.className = "drop-shadow-md"
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 32 40" aria-hidden="true">
      <path d="M16 39s13-12.4 13-23A13 13 0 0 0 3 16c0 10.6 13 23 13 23Z" fill="#ef4444" stroke="#fff" stroke-width="2"/>
      <circle cx="16" cy="16" r="5" fill="#fff"/>
    </svg>`
  return el
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

type Insets = { top: number; right: number; bottom: number; left: number }

/**
 * How much of each edge the floating panels cover. Each panel is avoided
 * along the edge it touches where that costs the least space (a wide bar at
 * the top pushes the view down; a tall column on the left pushes it right).
 */
function panelInsets(
  container: DOMRect,
  refs: React.RefObject<HTMLElement | null>[] = []
): Insets {
  const insets = { top: 40, right: 40, bottom: 40, left: 40 }
  const gap = 24
  for (const ref of refs) {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width === 0 || r.height === 0) continue
    const options: [keyof Insets, number][] = []
    if (r.top - container.top < 40)
      options.push(["top", r.bottom - container.top])
    if (container.bottom - r.bottom < 40)
      options.push(["bottom", container.bottom - r.top])
    if (r.left - container.left < 40)
      options.push(["left", r.right - container.left])
    if (container.right - r.right < 40)
      options.push(["right", container.right - r.left])
    if (!options.length) continue
    const [side, size] = options.sort((a, b) => a[1] - b[1])[0]
    insets[side] = Math.max(insets[side], size + gap)
  }
  // Always leave at least ~40% of the map to look at.
  const fitAxis = (a: "top" | "left", b: "bottom" | "right", total: number) => {
    const max = total * 0.6
    if (insets[a] + insets[b] > max) {
      const k = max / (insets[a] + insets[b])
      insets[a] *= k
      insets[b] *= k
    }
  }
  fitAxis("top", "bottom", container.height)
  fitAxis("left", "right", container.width)
  return insets
}

const mercX = (lon: number) => (lon + 180) / 360
const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

/**
 * Zoom that fits a lon/lat box into the free part of the screen, worked out
 * directly in Web Mercator. (MapLibre's own fitBounds/cameraForBounds leave
 * padding on the map that shifts markers on the globe view, and can return
 * NaN there.)
 */
function zoomToFit(
  [w, s, e, n]: [number, number, number, number],
  width: number,
  height: number,
  maxZoom: number
) {
  const dx = Math.max(mercX(e) - mercX(w), 1e-9)
  const dy = Math.max(mercY(s) - mercY(n), 1e-9)
  // MapLibre's world is 512 px wide at zoom 0.
  const zoom = Math.log2(Math.min(width / (dx * 512), height / (dy * 512)))
  return Math.max(1, Math.min(maxZoom, zoom))
}

export function MapCanvas({
  device,
  picked,
  sar,
  view,
  theme,
  focus,
  onViewportChange,
  obstructionRefs,
}: MapCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const libRef = React.useRef<typeof import("maplibre-gl") | null>(null)
  const deviceMarker = React.useRef<MapLibreMarker | null>(null)
  const pinMarker = React.useRef<MapLibreMarker | null>(null)
  const deviceRef = React.useRef(device)
  const sarRef = React.useRef(sar)
  const styleRef = React.useRef({ view, theme })
  const callbacks = React.useRef({ onViewportChange })
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    callbacks.current = { onViewportChange }
  }, [onViewportChange])

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

      const { view, theme } = styleRef.current
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleFor(view, theme),
        center: [100, 15],
        zoom: 1.6,
        maxPitch: 75,
        attributionControl: {
          compact: true,
          customAttribution:
            'Places © <a href="https://www.geonames.org">GeoNames</a> (CC BY 4.0)',
        },
      })
      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true }),
        "bottom-right"
      )

      map.on("style.load", () => {
        if (!map) return
        map.setProjection({ type: "globe" })
        syncSarLayers(map, sarRef.current)
        syncAccuracyLayer(map, deviceRef.current)
      })
      map.on("moveend", () => {
        if (!map) return
        const c = map.getCenter()
        const b = map.getBounds()
        const clamp = (v: number, lo: number, hi: number) =>
          Math.min(hi, Math.max(lo, v))
        callbacks.current.onViewportChange?.({
          latitude: c.lat,
          longitude: c.lng,
          zoom: map.getZoom(),
          bounds: [
            clamp(b.getWest(), -180, 180),
            clamp(b.getSouth(), -85, 85),
            clamp(b.getEast(), -180, 180),
            clamp(b.getNorth(), -85, 85),
          ],
        })
      })
      map.once("load", () => {
        if (!cancelled) setReady(true)
      })
      // NASA's tile server sometimes fails a tile at a swath's edge; that's
      // just a gap, not an app error.
      map.on("error", (e) => {
        const id = (e as { sourceId?: string }).sourceId
        if (id?.startsWith(SAR_PREFIX)) return
        console.error(e.error)
      })

      mapRef.current = map
    })

    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
      deviceMarker.current = null
      pinMarker.current = null
    }
  }, [])

  // Swap the base style when the view or theme changes.
  React.useEffect(() => {
    const prev = styleRef.current
    styleRef.current = { view, theme }
    const map = mapRef.current
    if (!map || styleKey(prev.view, prev.theme) === styleKey(view, theme)) {
      return
    }
    map.setStyle(styleFor(view, theme))

    if (view === "3d" && prev.view !== "3d") {
      // Tilt to show terrain and buildings; get close enough to see them.
      const target = picked ?? device ?? null
      if (map.getZoom() < 14 && target) {
        map.flyTo({
          center: [target.longitude, target.latitude],
          zoom: 16,
          pitch: 60,
          bearing: -20,
          speed: 1.4,
        })
      } else {
        map.easeTo({ pitch: 60, bearing: -20, duration: 1200 })
      }
    } else if (view !== "3d" && prev.view === "3d") {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 })
    }
    // Only the view/theme switch should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, theme])

  // Radar overlay.
  React.useEffect(() => {
    sarRef.current = sar
    const map = mapRef.current
    if (!ready || !map) return
    // Don't gate on isStyleLoaded(): it's false whenever tiles are still
    // streaming in (e.g. mid-flight), and the layer would never appear. If
    // the style really is mid-swap this throws, and the style.load handler
    // draws it from sarRef instead.
    try {
      syncSarLayers(map, sar)
    } catch {
      // Style mid-swap; style.load redraws from sarRef.
    }
  }, [sar, ready])

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

  // Pin for an exact spot (an address, a building, a hazard event). Areas
  // like states or cities have no single point worth pinning.
  React.useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!ready || !map || !lib) return
    pinMarker.current?.remove()
    pinMarker.current = null
    if (picked && !isArea(picked)) {
      pinMarker.current = new lib.Marker({
        element: pinElement(picked.name),
        anchor: "bottom",
      })
        .setLngLat([picked.longitude, picked.latitude])
        .addTo(map)
    }
  }, [picked, ready])

  // Move the camera when asked.
  React.useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focus) return

    // Make sure no padding is left on the map from anywhere else.
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 })
    const box = map.getContainer().getBoundingClientRect()
    const insets = panelInsets(box, obstructionRefs)
    const freeW = box.width - insets.left - insets.right
    const freeH = box.height - insets.top - insets.bottom
    // Put the target in the middle of the free area, not the whole screen.
    const offset: [number, number] = [
      (insets.left - insets.right) / 2,
      (insets.top - insets.bottom) / 2,
    ]
    const tilt = view === "3d" ? { pitch: 60 } : {}

    const go = (lon: number, lat: number, zoom: number) =>
      map.flyTo({ center: [lon, lat], zoom, offset, speed: 1.4, ...tilt })

    const frame = (bbox: [number, number, number, number], maxZoom: number) => {
      const [w, s, e, n] = bbox
      const lat = (n + s) / 2
      // Centre in Mercator space so the box sits evenly on screen.
      const yMid = (mercY(n) + mercY(s)) / 2
      const latMid =
        (Math.atan(Math.sinh(Math.PI * (1 - 2 * yMid))) * 180) / Math.PI
      go(
        (w + e) / 2,
        Number.isFinite(latMid) ? latMid : lat,
        zoomToFit(bbox, freeW, freeH, maxZoom)
      )
    }

    if (focus.target === "device" && device) {
      go(
        device.longitude,
        device.latitude,
        device.accuracy < 200 ? 16 : device.accuracy < 2000 ? 14 : 12
      )
    } else if (focus.target === "area" && focus.bbox) {
      frame(focus.bbox, 12)
    } else if (focus.target === "picked" && picked) {
      if (picked.bbox) frame(picked.bbox, 16)
      // Gazetteer places say how close to zoom (state 8 … village 14).
      else if (picked.zoom) go(picked.longitude, picked.latitude, picked.zoom)
      else if (isArea(picked)) go(picked.longitude, picked.latitude, 10)
      // Hazard events: show the surrounding region.
      else if (picked.date) go(picked.longitude, picked.latitude, 9)
      else go(picked.longitude, picked.latitude, Math.max(map.getZoom(), 16))
    }
    // `focus.nonce` is the trigger; the data is read at that moment.
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
