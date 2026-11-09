"use client"

import * as React from "react"

import type { LatLng } from "@/lib/geo"
import type {
  SarLayer,
  SarOverlay,
  SarPass,
  SarPassesResponse,
  SarScene,
} from "@/lib/sar"

type Passes = {
  layer: SarLayer
  point: LatLng | null
  list: SarPass[]
}

type Viewport = LatLng & { zoom: number }

const inside = (p: LatLng, [w, s, e, n]: SarPass["bbox"]) =>
  p.longitude >= w && p.longitude <= e && p.latitude >= s && p.latitude <= n

/** The first pass on/after `date` (passes are newest first), else newest. */
function passIndexFor(list: SarPass[], date?: string) {
  if (!date) return 0
  let best = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i].start >= date) best = i
    else break
  }
  return best
}

/**
 * NISAR radar layer state. Turn a layer on and it finds the passes over
 * the area on screen, following the map as it moves.
 */
export function useNisar({
  getFallbackPoint,
  onFirstLoad,
}: {
  /** Where to look when the map is zoomed out to the globe. */
  getFallbackPoint: () => LatLng | null
  /** A layer was just switched on and found data (e.g. to frame it). */
  onFirstLoad?: (pass: SarPass) => void
}) {
  const [layer, setLayerState] = React.useState<SarLayer | null>(null)
  const [passes, setPasses] = React.useState<Passes | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [index, setIndex] = React.useState(0)
  const [scene, setScene] = React.useState<{
    id: string
    scene: SarScene | null
    error: string | null
  } | null>(null)

  const request = React.useRef<AbortController | null>(null)
  const viewport = React.useRef<Viewport | null>(null)
  const autoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const state = React.useRef({ layer, passes, index })
  React.useEffect(() => {
    state.current = { layer, passes, index }
  }, [layer, passes, index])
  const onFirstLoadRef = React.useRef(onFirstLoad)
  React.useEffect(() => {
    onFirstLoadRef.current = onFirstLoad
  }, [onFirstLoad])

  const load = React.useCallback(
    async (
      nextLayer: SarLayer,
      point: LatLng | null,
      options: { preferDate?: string; first?: boolean } = {}
    ) => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({ layer: nextLayer })
      if (point) {
        params.set("lat", point.latitude.toFixed(3))
        params.set("lon", point.longitude.toFixed(3))
      }
      try {
        const res = await fetch(`/api/sar/passes?${params}`, {
          signal: controller.signal,
        })
        const body = await res.json()
        if (!res.ok)
          throw new Error(body?.error ?? "Couldn't reach NISAR data.")
        const list = (body as SarPassesResponse).passes
        const i = passIndexFor(list, options.preferDate)
        setPasses({ layer: nextLayer, point, list })
        setIndex(i)
        if (options.first && list[i]) onFirstLoadRef.current?.(list[i])
      } catch (err) {
        if (controller.signal.aborted) return
        setError(
          err instanceof Error ? err.message : "Couldn't reach NISAR data."
        )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    []
  )

  /** Area to check: the map centre, or the fallback when zoomed right out. */
  const lookPoint = React.useCallback((): LatLng | null => {
    const v = viewport.current
    if (v && v.zoom >= 5) return v
    return getFallbackPoint() ?? v
  }, [getFallbackPoint])

  /** Turn a layer on (or off with null). */
  const setLayer = React.useCallback(
    (next: SarLayer | null) => {
      setLayerState(next)
      if (!next) {
        request.current?.abort()
        setLoading(false)
        return
      }
      load(next, lookPoint(), { first: true })
    },
    [load, lookPoint]
  )

  /** Show a layer at a specific spot, e.g. a flood event, near its date. */
  const showAt = React.useCallback(
    (next: SarLayer, point: LatLng, preferDate?: string) => {
      setLayerState(next)
      load(next, point, { preferDate })
    },
    [load]
  )

  /** Map moved: follow it once the centre leaves the pass on screen. */
  const onViewportChange = React.useCallback(
    (v: Viewport) => {
      viewport.current = v
      if (autoTimer.current) clearTimeout(autoTimer.current)
      const { layer: current, passes: known, index: i } = state.current
      if (!current || v.zoom < 5) return
      const shown = known?.layer === current ? known.list[i] : undefined
      if (shown && inside(v, shown.bbox)) return
      // Nothing here yet, or nothing at all last time but we've moved on.
      if (!shown && known?.point && known.list.length === 0) {
        const dLat = Math.abs(known.point.latitude - v.latitude)
        const dLon = Math.abs(known.point.longitude - v.longitude)
        if (dLat < 0.5 && dLon < 0.5) return
      }
      autoTimer.current = setTimeout(() => load(current, v), 500)
    },
    [load]
  )

  React.useEffect(
    () => () => {
      if (autoTimer.current) clearTimeout(autoTimer.current)
      request.current?.abort()
    },
    []
  )

  const pass =
    layer && passes?.layer === layer ? (passes.list[index] ?? null) : null

  // Ground movement is an image overlay; fetch where it goes on the map.
  React.useEffect(() => {
    if (!pass || pass.layer !== "movement") return
    if (scene?.id === pass.id) return
    const controller = new AbortController()
    fetch(`/api/sar/scene?granule=${encodeURIComponent(pass.id)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? "Couldn't load this image.")
        setScene({ id: pass.id, scene: body as SarScene, error: null })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setScene({
          id: pass.id,
          scene: null,
          error:
            err instanceof Error ? err.message : "Couldn't load this image.",
        })
      })
    return () => controller.abort()
  }, [pass, scene?.id])

  const sceneForPass = pass && scene?.id === pass.id ? scene : null
  const overlay: SarOverlay | null =
    layer && pass
      ? {
          layer,
          pass,
          scene: layer === "movement" ? (sceneForPass?.scene ?? null) : null,
          opacity: 0.8,
        }
      : null

  const list = passes?.layer === layer ? passes.list : null

  return {
    layer,
    setLayer,
    showAt,
    onViewportChange,
    loading,
    error,
    passes: list,
    index,
    setIndex,
    pass,
    imageLoading:
      layer === "movement" &&
      !!pass &&
      (!sceneForPass || (!sceneForPass.scene && !sceneForPass.error)),
    imageError: sceneForPass?.error ?? null,
    georeference: sceneForPass?.scene?.georeference ?? null,
    overlay,
  }
}
