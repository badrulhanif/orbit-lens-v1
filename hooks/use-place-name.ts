"use client"

import * as React from "react"

import type { DeviceLocation, PlaceName } from "@/lib/geo"

/**
 * Reverse-geocodes the device position. Coordinates are rounded to ~100 m so
 * small GPS jitter doesn't trigger new lookups.
 */
export function usePlaceName(position: DeviceLocation | null) {
  const key = position
    ? `${position.latitude.toFixed(3)},${position.longitude.toFixed(3)}`
    : null
  const [result, setResult] = React.useState<{
    key: string
    place: PlaceName | null
  } | null>(null)

  React.useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const [lat, lon] = key.split(",")
    fetch(`/api/reverse?lat=${lat}&lon=${lon}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<PlaceName>) : null))
      .then((place) => setResult({ key, place }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, place: null })
      })
    return () => controller.abort()
  }, [key])

  if (!key) return { place: null, loading: false }
  // Keep showing the previous name while a nearby lookup is in flight.
  return { place: result?.place ?? null, loading: result?.key !== key }
}
