"use client"

import * as React from "react"

import type { DeviceLocation } from "@/lib/geo"

export type LocationStatus =
  /** Working out whether we already have permission. */
  | "checking"
  /** Need to ask the user (show our prompt). */
  | "ask"
  | "locating"
  | "ready"
  /** User said no to our prompt. */
  | "off"
  /** Browser has location blocked for this site. */
  | "blocked"
  /** Anything else: no GPS fix, timeout, unsupported browser. */
  | "error"

type State = {
  status: LocationStatus
  position: DeviceLocation | null
  error: string | null
}

export function useDeviceLocation(
  onFirstFix?: (location: DeviceLocation) => void
) {
  const [state, setState] = React.useState<State>({
    status: "checking",
    position: null,
    error: null,
  })
  const watchId = React.useRef<number | null>(null)
  const onFirstFixRef = React.useRef(onFirstFix)

  React.useEffect(() => {
    onFirstFixRef.current = onFirstFix
  }, [onFirstFix])

  const stop = React.useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
  }, [])

  /** Starts tracking. Triggers the browser's own permission prompt if needed. */
  const start = React.useCallback(() => {
    stop()
    let hadFix = false
    setState((s) => ({ ...s, status: "locating", error: null }))

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const position: DeviceLocation = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        }
        setState({ status: "ready", position, error: null })
        if (!hadFix) {
          hadFix = true
          onFirstFixRef.current?.(position)
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stop()
          setState({ status: "blocked", position: null, error: null })
          return
        }
        // Keep showing the last good position if we already had one.
        setState((s) =>
          s.position
            ? s
            : {
                status: "error",
                position: null,
                error:
                  err.code === err.TIMEOUT
                    ? "Finding your location took too long."
                    : "Your device couldn't find its location. Check that location services are on.",
              }
        )
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
    )
  }, [stop])

  // On load: if the browser already allows location, just go. Otherwise ask.
  React.useEffect(() => {
    let cancelled = false
    let permission: PermissionStatus | null = null

    async function init() {
      let current: PermissionState = "prompt"
      try {
        permission = await navigator.permissions.query({ name: "geolocation" })
        current = permission.state
        // If the user changes the site setting while the page is open, follow it.
        permission.onchange = () => {
          if (permission?.state === "granted") start()
          if (permission?.state === "denied") {
            stop()
            setState({ status: "blocked", position: null, error: null })
          }
        }
      } catch {
        // Permissions API not available — fall back to asking.
      }
      if (cancelled) return

      if (!("geolocation" in navigator)) {
        setState({
          status: "error",
          position: null,
          error: "This browser doesn't support location.",
        })
      } else if (current === "granted") {
        start()
      } else if (current === "denied") {
        setState({ status: "blocked", position: null, error: null })
      } else {
        setState((s) => ({ ...s, status: "ask" }))
      }
    }

    init()
    return () => {
      cancelled = true
      if (permission) permission.onchange = null
      stop()
    }
  }, [start, stop])

  const decline = React.useCallback(() => {
    stop()
    setState({ status: "off", position: null, error: null })
  }, [stop])

  return { ...state, enable: start, decline }
}
