import type { Bbox } from "@/lib/area"
import { granuleUrl } from "@/lib/server/nisar"
import { TtlCache } from "@/lib/server/util"

/**
 * Measured ground movement from the full NISAR products, computed by the
 * Python service in workers/nisar (it reads only the tiles over an area).
 * Off unless NISAR_WORKER_URL is set; the app then shows preview-based
 * estimates only.
 */

const WORKER = process.env.NISAR_WORKER_URL?.replace(/\/$/, "")
const KEY = process.env.NISAR_WORKER_KEY

export const measuredEnabled = () => Boolean(WORKER)

type Stats = {
  p5: number
  median: number
  p95: number
  /** Share of the area moving more than `threshold` mm (or mm/yr). */
  moving: number
  threshold: number
}

type MeasuredPair = {
  available: boolean
  reason?: string
  from?: string
  to?: string
  coverage?: number
  coherence?: number
  reliable?: number
  /** The area was bigger than the service reads; only its centre was. */
  cut?: boolean
  frames?: number
  movement?: Stats | null
  map?: string
  bbox?: Bbox
}

type MeasuredTrend = {
  available: boolean
  reason?: string
  pairs?: number
  from?: string
  to?: string
  days?: number
  frames?: number
  /** Typical ± of the rate (mm/yr) or total (mm). */
  uncertainty?: number | null
  /** Share of pixels that behave consistently over time. */
  consistent?: number
  total?: Stats | null
  rate?: Stats | null
  map?: string
  mapOf?: "rate" | "total"
  bbox?: Bbox
}

// Products never change, so answers are kept; failures aren't.
const answers = new TtlCache<unknown>(200, 24 * 60 * 60_000)

async function ask<T>(
  path: string,
  params: Record<string, string>,
  timeoutMs: number
) {
  const url = `${WORKER}${path}?${new URLSearchParams(params)}`
  return answers.get(url, async () => {
    const res = await fetch(url, {
      headers: KEY ? { "X-Worker-Key": KEY } : {},
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`NISAR service answered ${res.status}`)
    return res.json()
  }) as Promise<T>
}

const urlsFor = async (granules: string[]) =>
  (await Promise.all(granules.map(granuleUrl))).filter((u): u is string => !!u)

type MeasuredCover = {
  available: boolean
  reason?: string
  a?: CoverDate
  b?: CoverDate
  newWater?: number
  receded?: number
  vegLost?: number
  vegGained?: number
  measured?: number
  cut?: boolean
  frames?: number
  map?: string
  bbox?: Bbox
}

type CoverDate = {
  date: string
  water: number
  vegetation: number
  open: number
  built: number
  rvi: number
}

/** Land cover on two dates (each: the frames of one cycle). */
export async function measureCover(
  before: string[],
  after: string[],
  bbox: Bbox,
  boundary: string | null
) {
  const [a, b] = await Promise.all([urlsFor(before), urlsFor(after)])
  if (!a.length || !b.length)
    return { available: false, reason: "Products not found." }
  return ask<MeasuredCover>(
    "/cover",
    {
      a: a.join(","),
      b: b.join(","),
      bbox: bbox.join(","),
      ...(boundary ? { boundary } : {}),
    },
    150_000
  )
}

/** One 12-day pair: its frames over the area (granules of one cycle). */
export async function measurePair(granules: string[], bbox: Bbox) {
  const urls = await urlsFor(granules)
  if (!urls.length) return { available: false, reason: "Product not found." }
  return ask<MeasuredPair>(
    "/measure",
    { urls: urls.join(","), bbox: bbox.join(",") },
    150_000
  )
}

export async function measureTrend(granules: string[], bbox: Bbox) {
  const urls = await urlsFor(granules)
  if (urls.length < 2) return { available: false, reason: "Not enough pairs." }
  return ask<MeasuredTrend>(
    "/rate",
    { urls: urls.join(","), bbox: bbox.join(",") },
    290_000
  )
}
