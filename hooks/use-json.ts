"use client"

import * as React from "react"

/** GET a JSON URL (null = nothing to load); aborts when the URL changes. */
export function useJson<T>(url: string | null) {
  const [state, setState] = React.useState<{
    url: string
    data: T | null
    status: number
  } | null>(null)
  React.useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then(async (r) =>
        setState({
          url,
          data: r.ok ? ((await r.json()) as T) : null,
          status: r.status,
        })
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ url, data: null, status: 0 })
      })
    return () => controller.abort()
  }, [url])
  const current = url && state?.url === url ? state : null
  return {
    data: current?.data ?? null,
    loading: !!url && !current,
    error: !!current && !current.data,
    /** HTTP status (0 = network error). */
    status: current?.status ?? null,
  }
}
