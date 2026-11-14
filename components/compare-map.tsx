"use client"

import * as React from "react"
import type { Map as MapLibreMap } from "maplibre-gl"

import { syncSarLayers } from "@/components/map-canvas"
import { styleFor, type MapView } from "@/lib/map-styles"
import type { SarOverlay } from "@/lib/sar"

/**
 * Before/after swipe on the map. A second map (same base style, date B's
 * radar) sits inside the main map, under its markers, clipped to the right
 * of the handle. It follows the main map's camera; all gestures go to the
 * main map.
 */
export function CompareMap({
  mainMap,
  overlay,
  view,
  theme,
  split,
  onSplitChange,
  beforeLabel,
  afterLabel,
}: {
  mainMap: MapLibreMap | null
  /** Date B's radar. */
  overlay: SarOverlay | null
  view: MapView
  theme: "light" | "dark"
  /** Handle position, 0–1 from the left. */
  split: number
  onSplitChange: (split: number) => void
  beforeLabel: string
  afterLabel: string
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const overlayRef = React.useRef(overlay)
  const [ready, setReady] = React.useState(false)

  // Create the side map inside the main map's canvas container, right after
  // its canvas, so markers (added later to the same container) stay on top.
  React.useEffect(() => {
    if (!mainMap) return
    let cancelled = false
    const el = document.createElement("div")
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;"
    const host = mainMap.getCanvasContainer()
    host.insertBefore(el, mainMap.getCanvas().nextSibling)
    containerRef.current = el
    let side: MapLibreMap | null = null

    import("maplibre-gl").then((maplibregl) => {
      if (cancelled) return
      side = new maplibregl.Map({
        container: el,
        style: styleFor(view, theme),
        center: mainMap.getCenter(),
        zoom: mainMap.getZoom(),
        bearing: mainMap.getBearing(),
        pitch: mainMap.getPitch(),
        interactive: false,
        attributionControl: false,
        maxPitch: 75,
      })
      side.on("style.load", () => {
        if (!side) return
        side.setProjection({ type: "globe" })
        try {
          syncSarLayers(side, overlayRef.current)
        } catch {
          // Retried when the overlay changes.
        }
      })
      side.once("load", () => !cancelled && setReady(true))
      mapRef.current = side
    })

    const follow = () =>
      mapRef.current?.jumpTo({
        center: mainMap.getCenter(),
        zoom: mainMap.getZoom(),
        bearing: mainMap.getBearing(),
        pitch: mainMap.getPitch(),
      })
    const resize = () => mapRef.current?.resize()
    mainMap.on("move", follow)
    mainMap.on("resize", resize)

    return () => {
      cancelled = true
      mainMap.off("move", follow)
      mainMap.off("resize", resize)
      side?.remove()
      el.remove()
      mapRef.current = null
      containerRef.current = null
      setReady(false)
    }
    // The base style is applied below; don't rebuild the map for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainMap])

  // Same base map as the main map.
  React.useEffect(() => {
    if (ready) mapRef.current?.setStyle(styleFor(view, theme))
  }, [view, theme, ready])

  // Date B's radar.
  React.useEffect(() => {
    overlayRef.current = overlay
    const side = mapRef.current
    if (!ready || !side) return
    try {
      syncSarLayers(side, overlay)
    } catch {
      // Style mid-swap; style.load redraws.
    }
  }, [overlay, ready])

  // Show only the part right of the handle.
  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.clipPath = `inset(0 0 0 ${split * 100}%)`
    }
  }, [split, ready])

  // Dragging the handle.
  const dragging = React.useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    // currentTarget: the button itself, even when pressed on its icon.
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !mainMap) return
    const box = mainMap.getContainer().getBoundingClientRect()
    onSplitChange(
      Math.min(0.98, Math.max(0.02, (e.clientX - box.left) / box.width))
    )
  }
  const onPointerUp = () => {
    dragging.current = false
  }

  if (!mainMap) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-5">
      <div
        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-orange-600 shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
        style={{ left: `${split * 100}%` }}
      />
      <button
        type="button"
        aria-label="Drag to compare dates"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // A cancelled touch (e.g. the browser took over the gesture) ends
        // the drag too, or the handle would follow the next hover.
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSplitChange(Math.max(0.02, split - 0.05))
          if (e.key === "ArrowRight")
            onSplitChange(Math.min(0.98, split + 0.05))
        }}
        className="pointer-events-auto absolute top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-full border-2 border-orange-600 bg-background text-orange-600 shadow-lg outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30"
        style={{ left: `${split * 100}%` }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m9 18-6-6 6-6" />
          <path d="m15 6 6 6-6 6" />
        </svg>
      </button>
      <span
        className="absolute top-[calc(50%+34px)] -translate-x-[calc(100%+10px)] rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-background shadow-lg"
        style={{ left: `${split * 100}%` }}
      >
        {beforeLabel}
      </span>
      <span
        className="absolute top-[calc(50%+34px)] translate-x-2.5 rounded-full bg-orange-600 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow-lg"
        style={{ left: `${split * 100}%` }}
      >
        {afterLabel}
      </span>
    </div>
  )
}
