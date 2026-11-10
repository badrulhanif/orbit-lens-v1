import type { Impact } from "@/lib/area"
import { fetchJson, TtlCache } from "@/lib/server/util"

/**
 * GDACS is the original source of NASA EONET's flood records, and its own
 * data is better: EONET sometimes reuses an older event's point (two
 * Malaysian floods 7 months apart share one coordinate) or misplaces it (a
 * Sabah flood shown in Johor). GDACS also lists reported impacts by district
 * ("859 displaced in Melaka Tengah"), from national disaster agencies.
 */

type GdacsEvent = {
  latitude: number
  longitude: number
  countries: string[]
  /** A whole-number point like 101.0, 4.0: a country-level placeholder. */
  approximate: boolean
  from: string | null
  to: string | null
  /** Green / Orange / Red. */
  alert: string | null
  impacts: Impact[]
}

type GdacsResponse = {
  geometry?: { type: string; coordinates: [number, number] }
  properties?: {
    affectedcountries?: { countryname: string }[]
    fromdate?: string
    todate?: string
    alertlevel?: string
    sendai?: { sendainame?: string; sendaivalue?: string; region?: string }[]
  }
}

// Events don't change much once over; failed lookups are retried later.
const cache = new TtlCache<GdacsEvent | null>(
  2000,
  6 * 60 * 60_000,
  (v) => v !== null
)

// GDACS is slow (2–40 s an event), so finished events come from a snapshot
// (data/gdacs.json, `npm run data:gdacs`); only newer ones are fetched.
// (null = removed from GDACS.)
type Snapshot = Record<string, GdacsResponse | null>
let snapshot: Promise<Snapshot> | null = null
const loadSnapshot = () =>
  (snapshot ??= import("@/data/gdacs.json")
    .then((m) => (m.default ?? m) as unknown as Snapshot)
    .catch(() => ({}) as Snapshot))

// A lookup that just failed isn't tried again for a while, so one slow
// event can't hold up every request.
const failedAt = new Map<string, number>()
const RETRY_AFTER = 10 * 60_000

export function gdacsEventId(url: string | null | undefined) {
  return url?.match(/eventid=(\d+)/)?.[1] ?? null
}

export function gdacsEvent(eventId: string) {
  return cache.get(eventId, async () => {
    const saved = await loadSnapshot()
    if (eventId in saved) {
      const d = saved[eventId]
      return d ? parse(d) : null
    }
    if (Date.now() - (failedAt.get(eventId) ?? 0) < RETRY_AFTER) return null
    try {
      return parse(
        await fetchJson<GdacsResponse>(
          `https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=FL&eventid=${eventId}`,
          { timeoutMs: 6000, revalidate: 6 * 3600 }
        )
      )
    } catch (error) {
      // A 404 means GDACS removed the event: don't ask again.
      const gone = error instanceof Error && error.message.endsWith(" 404")
      failedAt.set(eventId, gone ? Infinity : Date.now())
      return null
    }
  })
}

function parse(d: GdacsResponse): GdacsEvent | null {
  const c = d.geometry?.type === "Point" ? d.geometry.coordinates : null
  if (!c || !c.every(Number.isFinite)) return null
  const p = d.properties ?? {}
  return {
    longitude: c[0],
    latitude: c[1],
    countries: (p.affectedcountries ?? []).map((x) => x.countryname),
    approximate: Number.isInteger(c[0]) && Number.isInteger(c[1]),
    from: p.fromdate?.slice(0, 10) ?? null,
    to: p.todate?.slice(0, 10) ?? null,
    alert: p.alertlevel ?? null,
    impacts: impactsOf(p.sendai ?? []),
  }
}

/**
 * Reports come in over the event as running totals; keep the highest figure
 * per kind and place, biggest first.
 */
function impactsOf(
  rows: { sendainame?: string; sendaivalue?: string; region?: string }[]
): Impact[] {
  const best = new Map<string, Impact>()
  for (const r of rows) {
    const value = Number(r.sendaivalue)
    if (!r.sendainame || !r.region || !Number.isFinite(value) || value <= 0)
      continue
    const kind = r.sendainame.toLowerCase()
    const key = `${kind}|${r.region}`
    if ((best.get(key)?.value ?? -1) < value)
      best.set(key, { kind, value, region: r.region.trim() })
  }
  return [...best.values()].sort((a, b) => b.value - a.value)
}
