"use client"

import * as React from "react"

import type { LatLng } from "@/lib/geo"
import {
  gibsSignalTiles,
  passDay,
  type SarCoverageResponse,
  type SarCycle,
  type SarLayer,
  type SarOverlay,
  type SarScene,
  type SarTile,
} from "@/lib/sar"

type Bbox = [number, number, number, number]

/** What the map reports after each move. */
type NisarViewport = LatLng & { zoom: number; bounds: Bbox }

const contains = (outer: Bbox, inner: Bbox) =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3]

/** The view plus a margin, so small pans don't trigger a new search. */
function padded([w, s, e, n]: Bbox, factor = 0.3): Bbox {
  const dx = (e - w) * factor
  const dy = (n - s) * factor
  return [w - dx, s - dy, e + dx, n + dy]
}

const around = (p: LatLng, deg: number): Bbox => [
  p.longitude - deg,
  p.latitude - deg,
  p.longitude + deg,
  p.latitude + deg,
]

/** The cycle covering `date` (or the first after it), else the newest. */
function cycleIndexFor(cycles: SarCycle[], date?: string, keep?: number) {
  if (keep != null) {
    const i = cycles.findIndex((c) => c.cycle === keep)
    if (i >= 0) return i
  }
  if (!date) return 0
  let best = 0
  for (let i = 0; i < cycles.length; i++) {
    if (cycles[i].end >= date) best = i
    else break
  }
  return best
}

/**
 * NISAR radar layer state. Switch a layer on and it finds every swath over
 * the area on screen, groups them by 12-day cycle and stitches the chosen
 * cycle into one picture. It follows the map as you pan and zoom.
 */
export function useNisar({
  getFallbackPoint,
  onFirstLoad,
}: {
  /** Where to look when the map is zoomed right out. */
  getFallbackPoint: () => LatLng | null
  /** A layer was switched on and found data (e.g. to frame it). */
  onFirstLoad?: (cycle: SarCycle) => void
}) {
  const [layer, setLayerState] = React.useState<SarLayer | null>(null)
  const [coverage, setCoverage] = React.useState<SarCoverageResponse | null>(
    null
  )
  const [cycleIndex, setCycleIndex] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [scenes, setScenes] = React.useState<
    Record<string, SarScene | "error">
  >({})
  const [detail, setDetail] = React.useState<"small" | "full">("small")

  const request = React.useRef<AbortController | null>(null)
  const viewport = React.useRef<NisarViewport | null>(null)
  const autoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const requested = React.useRef(new Set<string>())
  const latest = React.useRef({ layer, coverage, cycleIndex })
  React.useEffect(() => {
    latest.current = { layer, coverage, cycleIndex }
  }, [layer, coverage, cycleIndex])
  const onFirstLoadRef = React.useRef(onFirstLoad)
  React.useEffect(() => {
    onFirstLoadRef.current = onFirstLoad
  }, [onFirstLoad])

  const load = React.useCallback(
    async (
      next: SarLayer,
      area: Bbox,
      options: { preferDate?: string; keepCycle?: number; first?: boolean } = {}
    ) => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      setLoading(true)
      setError(null)
      const [w, s, e, n] = area.map((v) => v.toFixed(2))
      try {
        const res = await fetch(
          `/api/sar/coverage?layer=${next}&w=${w}&s=${s}&e=${e}&n=${n}`,
          { signal: controller.signal }
        )
        const body = await res.json()
        if (!res.ok)
          throw new Error(body?.error ?? "Couldn't reach NISAR data.")
        const data = body as SarCoverageResponse
        const i = cycleIndexFor(
          data.cycles,
          options.preferDate,
          options.keepCycle
        )
        setCoverage(data)
        setCycleIndex(i)
        if (options.first && data.cycles[i])
          onFirstLoadRef.current?.(data.cycles[i])
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

  /** The area to search right now. */
  const lookArea = React.useCallback((): Bbox | null => {
    const v = viewport.current
    if (v && v.zoom >= 4) return padded(v.bounds)
    const p = getFallbackPoint() ?? v
    return p ? around(p, 3) : null
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
      const area = lookArea()
      if (area) load(next, area, { first: true })
      else setError("Move the map to an area to see radar data.")
    },
    [load, lookArea]
  )

  /** Show a layer around a spot, e.g. a flood, on the cycle nearest a date. */
  const showAt = React.useCallback(
    (next: SarLayer, point: LatLng, preferDate?: string) => {
      setLayerState(next)
      load(next, around(point, 2), { preferDate })
    },
    [load]
  )

  /** The map moved: follow it once the view leaves the searched area. */
  const onViewportChange = React.useCallback(
    (v: NisarViewport) => {
      viewport.current = v
      setDetail(v.zoom >= 9 ? "full" : "small")
      if (autoTimer.current) clearTimeout(autoTimer.current)
      const { layer: current, coverage: known, cycleIndex: i } = latest.current
      if (!current || v.zoom < 4) return
      if (known?.layer === current && contains(known.bbox, v.bounds)) return
      autoTimer.current = setTimeout(
        () =>
          load(current, padded(v.bounds), {
            keepCycle: known?.cycles[i]?.cycle,
          }),
        600
      )
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

  const cycles = coverage && coverage.layer === layer ? coverage.cycles : null
  const cycle = cycles?.[cycleIndex] ?? null

  // Compare mode: date A on the main map, date B on the swipe side.
  const [compare, setCompare] = React.useState<{
    a: number
    b: number
    aLabel: string
    bLabel: string
  } | null>(null)
  const cycleA = compare
    ? (cycles?.find((c) => c.cycle === compare.a) ?? null)
    : null
  const cycleB = compare
    ? (cycles?.find((c) => c.cycle === compare.b) ?? null)
    : null
  const shown = compare ? cycleA : cycle

  // Ground movement swaths are images; find where each one goes.
  React.useEffect(() => {
    if (layer !== "movement") return
    const wanted = [shown, cycleB].flatMap((c) => c?.passes ?? [])
    for (const pass of wanted) {
      if (requested.current.has(pass.id)) continue
      requested.current.add(pass.id)
      fetch(`/api/sar/scene?granule=${encodeURIComponent(pass.id)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error()
          const scene = (await res.json()) as SarScene
          setScenes((s) => ({ ...s, [pass.id]: scene }))
        })
        .catch(() => {
          requested.current.delete(pass.id)
          setScenes((s) => ({ ...s, [pass.id]: "error" }))
        })
    }
  }, [shown, cycleB, layer])

  /** The drawable pieces (swath images or GIBS days) of one cycle. */
  const piecesFor = (c: SarCycle | null) => {
    const pieces: SarTile[] = []
    let waiting = 0
    if (!layer || !c) return { pieces, waiting }
    if (layer === "signal") {
      // NASA GIBS serves one map layer per day; group the swaths by day.
      const days = new Map<string, Bbox>()
      for (const p of c.passes) {
        const d = passDay(p)
        const b = days.get(d)
        days.set(
          d,
          b
            ? [
                Math.min(b[0], p.bbox[0]),
                Math.min(b[1], p.bbox[1]),
                Math.max(b[2], p.bbox[2]),
                Math.max(b[3], p.bbox[3]),
              ]
            : p.bbox
        )
      }
      for (const [day, bounds] of days) {
        pieces.push({
          id: `signal-${day}`,
          kind: "tiles",
          tiles: gibsSignalTiles(day),
          bounds,
        })
      }
    } else {
      for (const p of c.passes) {
        const scene = scenes[p.id]
        if (!scene) waiting++
        if (!scene || scene === "error") continue
        pieces.push({
          id: `${p.id}-${detail}`,
          kind: "image",
          url: `${scene.imageUrl}&size=${detail}`,
          coordinates: scene.coordinates,
        })
      }
    }
    return { pieces, waiting }
  }

  const main = piecesFor(shown)
  const side = piecesFor(cycleB)
  const overlay: SarOverlay | null =
    layer && main.pieces.length
      ? { layer, pieces: main.pieces, opacity: 0.85 }
      : null
  const compareOverlay: SarOverlay | null =
    layer && compare && side.pieces.length
      ? { layer, pieces: side.pieces, opacity: 0.85 }
      : null
  const waiting = main.waiting + (compare ? side.waiting : 0)

  return {
    layer,
    setLayer,
    showAt,
    onViewportChange,
    loading,
    error,
    cycles,
    cycleIndex,
    setCycleIndex,
    cycle,
    /** Swaths still loading in the current cycle. */
    waiting,
    overlay,
    compare,
    setCompare,
    compareOverlay,
  }
}
