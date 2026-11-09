"use client"

import * as React from "react"

import { MAP_VIEWS, type MapView } from "@/lib/map-styles"

const KEY = "orbit-lens:map-view"
const EVENT = "orbit-lens:map-view-change"

function read(): MapView {
  try {
    const value = window.localStorage.getItem(KEY)
    return MAP_VIEWS.some((v) => v.id === value) ? (value as MapView) : "map"
  } catch {
    return "map"
  }
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
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // Storage blocked — the choice just won't be remembered.
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [view, setView] as const
}
