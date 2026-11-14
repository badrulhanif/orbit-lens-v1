"use client"

import * as React from "react"

import { areaBoxFor, areaQuery, type AreaHistory } from "@/lib/area"
import type { Place } from "@/lib/geo"
import type { SarCoverageResponse, SarLayer } from "@/lib/sar"

type Load<T> = { data: T | null; loading: boolean; error: string | null }
/** A finished load, tagged with the area it was for. */
type Loaded<T> = Load<T> & { key: string }

const idle = { data: null, loading: false, error: null }
const pending = { data: null, loading: true, error: null }

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  const body = await res.json().catch(() => null)
  if (!res.ok || body === null)
    throw new Error(body?.error ?? "Couldn't load this right now.")
  return body as T
}

/**
 * Everything the area panel shows for a picked place: recorded hazard
 * history in and around it, and which NISAR radar passes cover it.
 */
export type AreaData = ReturnType<typeof useArea>

export function useArea(place: Place | null) {
  const bbox = React.useMemo(() => (place ? areaBoxFor(place) : null), [place])
  // The history is clipped to the place's boundary when it has one.
  const key = bbox ? `${bbox.join(",")}|${place?.boundaryKey ?? ""}` : null

  const [history, setHistory] = React.useState<Loaded<AreaHistory> | null>(null)
  const [radar, setRadar] = React.useState<Loaded<
    Record<SarLayer, SarCoverageResponse | null>
  > | null>(null)

  React.useEffect(() => {
    if (!bbox || !key) return
    const controller = new AbortController()
    const { signal } = controller

    getJson<AreaHistory>(
      `/api/area-history?${areaQuery(bbox, place?.boundaryKey)}`,
      signal
    )
      .then((data) => setHistory({ key, data, loading: false, error: null }))
      .catch((err: Error) => {
        if (!signal.aborted)
          setHistory({ key, data: null, loading: false, error: err.message })
      })

    Promise.all(
      (["movement", "signal"] as const).map((layer) =>
        getJson<SarCoverageResponse>(
          `/api/sar/coverage?layer=${layer}&${areaQuery(bbox)}`,
          signal
        ).catch(() => null)
      )
    ).then(([movement, signal_]) => {
      if (signal.aborted) return
      setRadar({
        key,
        data: { movement, signal: signal_ },
        loading: false,
        error: movement || signal_ ? null : "Couldn't reach the NISAR archive.",
      })
    })

    return () => controller.abort()
    // `key` captures the bbox and boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Results for another area (the one picked before) never show: until this
  // area's arrive, it's loading.
  const current = <T>(s: Loaded<T> | null): Load<T> =>
    !key ? idle : s?.key === key ? s : pending

  return { bbox, history: current(history), radar: current(radar) }
}
