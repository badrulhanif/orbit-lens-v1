/** Shared server helpers: caching, fetching and limited concurrency. */

import type SharpFn from "sharp"

import type { Bbox } from "@/lib/area"

const USER_AGENT = "OrbitLens/0.1 (location demo)"

/**
 * In-memory cache of async results, keyed by string.
 *  - concurrent requests for the same key share one promise
 *  - failures (rejected promises, or values `keep` refuses) aren't kept
 *  - oldest entries go first once `max` is reached; entries expire after
 *    `ttlMs` (default: never)
 */
export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>()

  constructor(
    private max: number,
    private ttlMs = Infinity,
    private keep: (value: T) => boolean = () => true
  ) {}

  get(key: string, make: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value
    const value = make()
    value.then(
      (v) => {
        if (!this.keep(v)) this.drop(key, value)
      },
      () => this.drop(key, value)
    )
    // Re-inserted keys (expired entries) move to the back of the queue.
    this.entries.delete(key)
    if (this.entries.size >= this.max) {
      this.entries.delete(this.entries.keys().next().value!)
    }
    this.entries.set(key, { at: Date.now(), value })
    return value
  }

  private drop(key: string, value: Promise<T>) {
    if (this.entries.get(key)?.value === value) this.entries.delete(key)
  }
}

/**
 * fetch + JSON with a timeout; throws on HTTP errors. `revalidate` (seconds)
 * keeps the answer in Next's shared data cache, which survives restarts and
 * is shared between server instances.
 */
export async function fetchJson<T>(
  url: string | URL,
  {
    timeoutMs = 10_000,
    headers,
    revalidate,
  }: {
    timeoutMs?: number
    headers?: Record<string, string>
    revalidate?: number
  } = {}
): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    ...(revalidate ? { next: { revalidate } } : { cache: "no-store" }),
  })
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`)
  return (await res.json()) as T
}

/** Map over items, at most `limit` at a time. Failed items become null. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i).catch(() => null)
      }
    })
  )
  return out
}

/**
 * `p`'s value, or `fallback` once `ms` has passed (`p` keeps running, so a
 * cache behind it still fills for next time).
 */
export function within<T, F>(
  p: Promise<T>,
  ms: number,
  fallback: F
): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** A real "YYYY-MM-DD" day (not "2026-02-30"). */
export const isDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v

/** The ?boundary= outline key (states, districts), if sensibly sized. */
export function boundaryParam(params: URLSearchParams) {
  const key = params.get("boundary")
  return key && key.length <= 200 ? key : null
}

/** Latitude/longitude that are real numbers in range. */
export const validLatLng = (lat: number, lon: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180

/** An ordered ?w=&s=&e=&n= box (rounded to ~10 m), else null. */
export function parseBbox(params: URLSearchParams): Bbox | null {
  const raw = ["w", "s", "e", "n"].map((k) => params.get(k)?.trim())
  // A missing or empty value would otherwise read as 0.
  if (raw.some((v) => !v)) return null
  const box = raw.map(Number) as Bbox
  const [w, s, e, n] = box
  if (!box.every(Number.isFinite) || w >= e || s >= n) return null
  return box.map((v) => Math.round(v * 1e4) / 1e4) as Bbox
}

type Sharp = typeof SharpFn
let sharpLib: Promise<Sharp> | null = null

/**
 * sharp (a native image library), loaded on first use: routes that never
 * touch images then work even where it can't load.
 */
export const loadSharp = () =>
  (sharpLib ??= import("sharp").then(
    (m) => ((m as { default?: Sharp }).default ?? m) as Sharp
  ))
