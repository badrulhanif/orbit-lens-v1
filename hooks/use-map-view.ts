"use client"

import * as React from "react"

import { MAP_VIEWS, type MapView } from "@/lib/map-styles"

const KEY = "orbit-lens:map-view"
const EVENT = "orbit-lens:map-view-change"

const isView = (value: unknown): value is MapView =>
  MAP_VIEWS.some((v) => v.id === value)

/** This tab's choice, for when storage is blocked (private mode etc.). */
let chosen: MapView | null = null

function read(): MapView {
  try {
    const value = window.localStorage.getItem(KEY)
    if (isView(value)) return value
  } catch {
    // Storage blocked: fall back to this tab's choice.
  }
  return chosen ?? "map"
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(EVENT, callback)
  }
}

/** The chosen map view, remembered in this browser. */
export function useMapView() {
  const view = React.useSyncExternalStore<MapView>(subscribe, read, () => "map")
  const setView = React.useCallback((next: MapView) => {
    chosen = next
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // Storage blocked — the choice just won't be remembered.
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [view, setView] as const
}
