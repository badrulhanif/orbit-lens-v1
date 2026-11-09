"use client"

import * as React from "react"

import type { LatLng } from "@/lib/geo"

type LocationStatus =
  /** Nothing asked yet. */
  | "idle"
  | "locating"
  | "ready"
  /** User said no to our prompt. */
  | "off"
  /** Browser has location blocked for this site. */
  | "blocked"
  /** Anything else: no fix, timeout, unsupported browser. */
  | "error"

type State = {
  status: LocationStatus
  /** Rounded to ~1 km: enough to find the district, never the street. */
  position: LatLng | null
  error: string | null
}

const round = (v: number) => Math.round(v * 100) / 100

/**
 * The user's rough location, only when asked for ("Nearby me"). One reading,
 * no tracking, and only a rounded position is ever kept.
 */
export function useDeviceLocation() {
  const [state, setState] = React.useState<State>({
    status: "idle",
    position: null,
    error: null,
  })
  const [allowed, setAllowed] = React.useState(false)

  const locate = React.useCallback(
    () =>
      new Promise<LatLng | null>((resolve) => {
        if (!("geolocation" in navigator)) {
          setState({
            status: "error",
            position: null,
            error: "This browser doesn't support location.",
          })
          resolve(null)
          return
        }
        setState((s) => ({ ...s, status: "locating", error: null }))
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const position = {
              latitude: round(pos.coords.latitude),
              longitude: round(pos.coords.longitude),
            }
            setAllowed(true)
            setState({ status: "ready", position, error: null })
            resolve(position)
          },
          (err) => {
            setState({
              status: err.code === err.PERMISSION_DENIED ? "blocked" : "error",
              position: null,
              error:
                err.code === err.TIMEOUT
                  ? "Finding your location took too long."
                  : "Your device couldn't find its location. Check that location services are on.",
            })
            resolve(null)
          },
          // City-level is all we need: fast, low power.
          {
            enableHighAccuracy: false,
            maximumAge: 10 * 60_000,
            timeout: 15_000,
          }
        )
      }),
    []
  )

  // Already allowed for this site: read it quietly (it ranks search
  // results). Otherwise wait until the user asks.
  React.useEffect(() => {
    let permission: PermissionStatus | null = null
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        permission = p
        if (p.state === "granted") {
          setAllowed(true)
          locate()
        }
        p.onchange = () => {
          setAllowed(p.state === "granted")
          if (p.state === "denied")
            setState({ status: "blocked", position: null, error: null })
        }
      })
      .catch(() => {
        // Permissions API not available: ask when needed.
      })
    return () => {
      if (permission) permission.onchange = null
    }
  }, [locate])

  const decline = React.useCallback(
    () => setState({ status: "off", position: null, error: null }),
    []
  )

  return { ...state, allowed, locate, decline }
}
