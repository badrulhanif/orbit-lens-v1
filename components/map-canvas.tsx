"use client"

import * as React from "react"
import type { FeatureCollection } from "geojson"
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import { isArea, type Place } from "@/lib/geo"
import { styleFor, styleKey, type MapView } from "@/lib/map-styles"
import {
  formatEventDate,
  HAZARD_COLOR,
  HAZARD_LABEL,
  precisionOf,
  type HistoryEvent,
} from "@/lib/area"
import type { SarOverlay } from "@/lib/sar"

export type FocusRequest = {
  target: "picked" | "area" | "point"
  /** Bump to re-run the same focus request. */
  nonce: number
  /** For "area": [west, south, east, north] to frame. */
  bbox?: [number, number, number, number]
  /** For "point": where to fly to. */
  point?: { latitude: number; longitude: number; zoom: number }
}

export type MapViewport = {
  latitude: number
  longitude: number
  zoom: number
  /** [west, south, east, north] of what's on screen. */
  bounds: [number, number, number, number]
}

type MapCanvasProps = {
  /** The place picked in search. Exact spots get a pin; areas are framed. */
  picked: Place | null
  /** Hazard history markers for the picked area. */
  events?: HistoryEvent[]
  selectedEventId?: string | null
  /** Event under the pointer (on the map or in the list). */
  hoveredEventId?: string | null
  onHoverEvent?: (id: string | null) => void
  onSelectEvent?: (id: string) => void
  /** Affected-area outline of the selected event, if it has one. */
  outline?: [number, number][] | null
  sar: SarOverlay | null
  view: MapView
  theme: "light" | "dark"
  focus: FocusRequest | null
  onViewportChange?: (viewport: MapViewport) => void
  /** Panels floating over the map that the camera should avoid. */
  obstructionRefs?: React.RefObject<HTMLElement | null>[]
  /** An analysis result image (e.g. a change map) over an area. */
  analysis?: { url: string; bbox: [number, number, number, number] } | null
  /** The MapLibre map, once it has loaded (for the compare view). */
  onMap?: (map: MapLibreMap | null) => void
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
export function syncSarLayers(map: MapLibreMap, sar: SarOverlay | null) {
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

const ANALYSIS_SOURCE = "analysis-overlay"

/** Draw (or replace / remove) the analysis image, above radar, below labels. */
function syncAnalysisLayer(
  map: MapLibreMap,
  analysis: { url: string; bbox: [number, number, number, number] } | null
) {
  const current = map.getSource(ANALYSIS_SOURCE) as
    (import("maplibre-gl").ImageSource & { url?: string }) | undefined
  if (current && analysis && current.url === analysis.url) return
  if (map.getLayer(ANALYSIS_SOURCE)) map.removeLayer(ANALYSIS_SOURCE)
  if (current) map.removeSource(ANALYSIS_SOURCE)
  if (!analysis) return
  const [w, s, e, n] = analysis.bbox
  map.addSource(ANALYSIS_SOURCE, {
    type: "image",
    url: analysis.url,
    coordinates: [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ],
  })
  map.addLayer(
    {
      id: ANALYSIS_SOURCE,
      type: "raster",
      source: ANALYSIS_SOURCE,
      paint: { "raster-opacity": 0.95, "raster-resampling": "nearest" },
    },
    firstLabelLayer(map)
  )
}

const OUTLINE_SOURCE = "event-outline"

function syncOutlineLayer(map: MapLibreMap, ring: [number, number][] | null) {
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: ring?.length
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [ring] },
          },
        ]
      : [],
  }
  const source = map.getSource(OUTLINE_SOURCE) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  map.addSource(OUTLINE_SOURCE, { type: "geojson", data })
  map.addLayer({
    id: "event-outline-fill",
    type: "fill",
    source: OUTLINE_SOURCE,
    paint: { "fill-color": "#2563eb", "fill-opacity": 0.12 },
  })
  map.addLayer({
    id: "event-outline-line",
    type: "line",
    source: OUTLINE_SOURCE,
    paint: { "line-color": "#2563eb", "line-width": 2 },
  })
}

/** The little card shown when hovering an event (built as DOM, no HTML). */
function hoverCard(ev: HistoryEvent) {
  const box = document.createElement("div")
  box.className = "grid gap-0.5 text-xs"
  const kind = document.createElement("p")
  kind.className = "text-[10px] font-semibold tracking-wide uppercase"
  kind.style.color = HAZARD_COLOR[ev.type]
  kind.textContent = `${HAZARD_LABEL[ev.type]} · ${formatEventDate(ev.date)}`
  const title = document.createElement("p")
  title.className = "font-semibold leading-snug"
  title.textContent = ev.title
  box.append(kind, title)
  if (ev.detail) {
    const detail = document.createElement("p")
    detail.className = "text-muted-foreground"
    detail.textContent = ev.detail
    box.append(detail)
  }
  const meta = document.createElement("p")
  meta.className = "text-[10px] text-muted-foreground"
  meta.textContent = [
    ev.live && "Open now",
    ev.offshore && "Offshore",
    precisionOf(ev).label,
    ev.source,
    "click to open",
  ]
    .filter(Boolean)
    .join(" · ")
  box.append(meta)
  return box
}

/** Small coloured dot for a past hazard (hollow at sea); ringed when selected. */
function eventMarkerElement(ev: HistoryEvent) {
  const el = document.createElement("button")
  el.type = "button"
  el.setAttribute(
    "aria-label",
    `${ev.title} (${ev.date?.slice(0, 4) ?? "date unknown"})`
  )
  el.className =
    // No transform/scale on this element: MapLibre positions markers with a
    // CSS transform, and scaling here would scale the position too.
    "group relative grid size-5 cursor-pointer place-items-center rounded-full"
  const color = HAZARD_COLOR[ev.type]
  const fill = ev.offshore
    ? `background:white;border-color:${color}`
    : `background:${color}`
  el.innerHTML = `<span style="${fill}" class="block size-3.5 rounded-full ${ev.offshore ? "border-[3px]" : "border-2 border-white"} shadow-md shadow-black/30 transition-transform group-hover:scale-125 group-data-[selected=true]:scale-150 group-data-[selected=true]:ring-2 group-data-[selected=true]:ring-orange-500 group-data-[hovered=true]:scale-150 group-data-[hovered=true]:ring-2 group-data-[hovered=true]:ring-foreground/70"></span>${
    // Happening now: a pulse around the dot.
    ev.live
      ? `<span style="background:${color}" class="pointer-events-none absolute inset-0 animate-ping rounded-full opacity-40"></span>`
      : ""
  }`
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

const mercYToLat = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI

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
  picked,
  events = [],
  selectedEventId = null,
  hoveredEventId = null,
  onHoverEvent,
  onSelectEvent,
  outline = null,
  sar,
  view,
  theme,
  focus,
  onViewportChange,
  obstructionRefs,
  onMap,
  analysis = null,
}: MapCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const libRef = React.useRef<typeof import("maplibre-gl") | null>(null)
  const pinMarker = React.useRef<MapLibreMarker | null>(null)
  const eventMarkers = React.useRef(new Map<string, MapLibreMarker>())
  const hoverPopup = React.useRef<import("maplibre-gl").Popup | null>(null)
  const onHoverEventRef = React.useRef(onHoverEvent)
  React.useEffect(() => {
    onHoverEventRef.current = onHoverEvent
  }, [onHoverEvent])
  const onSelectEventRef = React.useRef(onSelectEvent)
  React.useEffect(() => {
    onSelectEventRef.current = onSelectEvent
  }, [onSelectEvent])
  const sarRef = React.useRef(sar)
  const outlineRef = React.useRef(outline)
  const analysisRef = React.useRef(analysis)
  const styleRef = React.useRef({ view, theme })
  const callbacks = React.useRef({ onViewportChange })
  const onMapRef = React.useRef(onMap)
  React.useEffect(() => {
    onMapRef.current = onMap
  }, [onMap])
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
        syncOutlineLayer(map, outlineRef.current)
        syncAnalysisLayer(map, analysisRef.current)
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
        if (cancelled) return
        setReady(true)
        onMapRef.current?.(map)
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
      onMapRef.current?.(null)
      map?.remove()
      mapRef.current = null
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
      const target = picked
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

  // Analysis result image.
  React.useEffect(() => {
    analysisRef.current = analysis
    const map = mapRef.current
    if (!ready || !map) return
    try {
      syncAnalysisLayer(map, analysis)
    } catch {
      // Style mid-swap; style.load redraws it.
    }
  }, [analysis, ready])

  // Outline of the selected flood's affected area.
  React.useEffect(() => {
    outlineRef.current = outline
    const map = mapRef.current
    if (!ready || !map) return
    if (map.getSource(OUTLINE_SOURCE) || map.isStyleLoaded()) {
      syncOutlineLayer(map, outline)
    }
  }, [outline, ready])

  // Hazard history markers.
  React.useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    const markers = eventMarkers.current
    if (!ready || !map || !lib) return
    for (const m of markers.values()) m.remove()
    markers.clear()
    for (const ev of events) {
      // State-wide records, and those whose point lies outside the area,
      // aren't marked.
      if (ev.scope === "state" || ev.scope === "reported") continue
      // Never let one bad record take the map down.
      if (Math.abs(ev.latitude) > 90 || Math.abs(ev.longitude) > 180) continue
      const el = eventMarkerElement(ev)
      el.addEventListener("click", (e) => {
        e.stopPropagation()
        onSelectEventRef.current?.(ev.id)
      })
      el.addEventListener("mouseenter", () => onHoverEventRef.current?.(ev.id))
      el.addEventListener("mouseleave", () => onHoverEventRef.current?.(null))
      el.addEventListener("focus", () => onHoverEventRef.current?.(ev.id))
      el.addEventListener("blur", () => onHoverEventRef.current?.(null))
      markers.set(
        ev.id,
        new lib.Marker({ element: el })
          .setLngLat([ev.longitude, ev.latitude])
          .addTo(map)
      )
    }
  }, [events, ready])

  // Selected / hovered marker styling, and the hover card.
  React.useEffect(() => {
    const focusId = hoveredEventId ?? selectedEventId
    for (const [id, m] of eventMarkers.current) {
      const el = m.getElement()
      el.dataset.selected = String(id === selectedEventId)
      el.dataset.hovered = String(id === hoveredEventId)
      // Fade the others while one is hovered, so it stands out.
      // (MapLibre sets the marker element's own opacity, so fade the dot.)
      const dot = el.firstElementChild as HTMLElement | null
      if (dot) {
        const dimmed = !!hoveredEventId && id !== hoveredEventId
        dot.style.opacity = dimmed ? "0.25" : "1"
      }
      el.style.zIndex = id === focusId ? "3" : ""
    }

    hoverPopup.current?.remove()
    hoverPopup.current = null
    const map = mapRef.current
    const lib = libRef.current
    const ev = hoveredEventId
      ? events.find((e) => e.id === hoveredEventId)
      : null
    if (!ready || !map || !lib || !ev || ev.scope === "state") return
    hoverPopup.current = new lib.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      className: "event-hover",
      maxWidth: "260px",
    })
      .setLngLat([ev.longitude, ev.latitude])
      .setDOMContent(hoverCard(ev))
      .addTo(map)
  }, [selectedEventId, hoveredEventId, events, ready])

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

    // flyTo's own `offset` overshoots on the globe view, so shift the camera
    // centre ourselves: the target should land `offset` px from the middle.
    const go = (lon: number, lat: number, zoom: number) => {
      const worldPx = 512 * 2 ** zoom
      const x = mercX(lon) - offset[0] / worldPx
      const y = Math.min(
        0.999,
        Math.max(0.001, mercY(lat) - offset[1] / worldPx)
      )
      map.flyTo({
        center: [x * 360 - 180, mercYToLat(y)],
        zoom,
        speed: 1.4,
        ...tilt,
      })
    }

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

    if (focus.target === "area" && focus.bbox) {
      frame(focus.bbox, 12)
    } else if (focus.target === "point" && focus.point) {
      go(focus.point.longitude, focus.point.latitude, focus.point.zoom)
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
