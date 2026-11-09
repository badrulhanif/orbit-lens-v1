"use client"

import * as React from "react"

import { areaBoxFor, type AreaHistory, type Bbox } from "@/lib/area"
import type { Place } from "@/lib/geo"
import type { SarCoverageResponse, SarLayer } from "@/lib/sar"

type Load<T> = { data: T | null; loading: boolean; error: string | null }

const idle = { data: null, loading: false, error: null }

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? "Request failed.")
  return body as T
}

const q = ([w, s, e, n]: Bbox) =>
  `w=${w.toFixed(3)}&s=${s.toFixed(3)}&e=${e.toFixed(3)}&n=${n.toFixed(3)}`

/**
 * Everything the area panel shows for a picked place: recorded hazard
 * history in and around it, and which NISAR radar passes cover it.
 */
export function useArea(place: Place | null) {
  const bbox = React.useMemo(() => (place ? areaBoxFor(place) : null), [place])
  const key = bbox?.join(",") ?? null

  const [history, setHistory] = React.useState<Load<AreaHistory>>(idle)
  const [radar, setRadar] =
    React.useState<Load<Record<SarLayer, SarCoverageResponse | null>>>(idle)

  React.useEffect(() => {
    if (!bbox) return
    const controller = new AbortController()
    const { signal } = controller
    // Start both loads together; set "loading" via the async callbacks.
    Promise.resolve().then(() => {
      if (signal.aborted) return
      setHistory({ data: null, loading: true, error: null })
      setRadar({ data: null, loading: true, error: null })
    })

    getJson<AreaHistory>(
      `/api/area-history?${q(bbox)}${place?.boundaryKey ? `&boundary=${encodeURIComponent(place.boundaryKey)}` : ""}`,
      signal
    )
      .then((data) => setHistory({ data, loading: false, error: null }))
      .catch((err: Error) => {
        if (!signal.aborted)
          setHistory({ data: null, loading: false, error: err.message })
      })

    Promise.all(
      (["movement", "signal"] as const).map((layer) =>
        getJson<SarCoverageResponse>(
          `/api/sar/coverage?layer=${layer}&${q(bbox)}`,
          signal
        ).catch(() => null)
      )
    ).then(([movement, signal_]) => {
      if (signal.aborted) return
      setRadar({
        data: { movement, signal: signal_ },
        loading: false,
        error: movement || signal_ ? null : "Couldn't reach the NISAR archive.",
      })
    })

    return () => controller.abort()
    // `key` captures the bbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { bbox, history: place ? history : idle, radar: place ? radar : idle }
}
