import type { Bbox } from "@/lib/area"
import type { FireInfo } from "@/lib/drivers"
import { areaHistory } from "@/lib/server/area-history"
import { isDay, mapLimit, TtlCache } from "@/lib/server/util"

/**
 * Was there fire between two radar passes? Radar can't tell a burn scar
 * from a cleared plot; heat-sensing satellites can.
 *  - With FIRMS_MAP_KEY (free, firms.modaps.eosdis.nasa.gov/api/map_key):
 *    NASA FIRMS VIIRS hotspots over the area, day by day.
 *  - Without: wildfires recorded in the area's history (NASA EONET), which
 *    only lists big fires, so "none" there doesn't rule fire out.
 */

const KEY = process.env.FIRMS_MAP_KEY
const FIRMS = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
const DAY = 86_400_000
const cache = new TtlCache<FireInfo | null>(
  300,
  24 * 60 * 60_000,
  (v) => v !== null
)

/** Hotspot rows in one ≤10-day window, or null if FIRMS didn't answer. */
async function firmsCount(box: Bbox, start: string, days: number) {
  // Near-real-time data covers recent weeks; older days are in the
  // standard (reprocessed) archive.
  const recent = Date.now() - Date.parse(start) < 60 * DAY
  const sources = recent
    ? ["VIIRS_SNPP_NRT", "VIIRS_SNPP_SP"]
    : ["VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"]
  for (const source of sources) {
    const url = `${FIRMS}/${KEY}/${source}/${box.map((v) => v.toFixed(3)).join(",")}/${days}/${start}`
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        next: { revalidate: 6 * 3600 },
      })
      const text = res.ok ? await res.text() : ""
      // A valid answer starts with the CSV header.
      if (!text.startsWith("latitude")) continue
      return text.trim().split("\n").length - 1
    } catch {
      // Try the other archive.
    }
  }
  return null
}

async function firms(box: Bbox, from: string, to: string) {
  const windows: { start: string; days: number }[] = []
  for (
    let t = Date.parse(from);
    t <= Date.parse(to) && windows.length < 15;
    t += 10 * DAY
  ) {
    const days = Math.min(10, Math.floor((Date.parse(to) - t) / DAY) + 1)
    windows.push({ start: new Date(t).toISOString().slice(0, 10), days })
  }
  const counts = await mapLimit(windows, 3, (w) =>
    firmsCount(box, w.start, w.days)
  )
  if (counts.some((c) => c == null)) return null
  return {
    count: counts.reduce<number>((a, c) => a + (c ?? 0), 0),
    source: "FIRMS" as const,
  }
}

async function eonet(
  box: Bbox,
  boundary: string | null,
  from: string,
  to: string
) {
  const history = await areaHistory(box, boundary)
  const count = history.events.filter(
    (e) => e.type === "wildfire" && e.date && e.date >= from && e.date <= to
  ).length
  return { count, source: "EONET" as const }
}

export function firesBetween(
  box: Bbox,
  from: string,
  to: string,
  boundary: string | null = null
): Promise<FireInfo | null> {
  if (!isDay(from) || !isDay(to) || from > to) return Promise.resolve(null)
  return cache.get(`${box.join(",")}|${boundary}|${from}|${to}`, async () =>
    KEY
      ? ((await firms(box, from, to).catch(() => null)) ??
        (await eonet(box, boundary, from, to).catch(() => null)))
      : eonet(box, boundary, from, to).catch(() => null)
  )
}
