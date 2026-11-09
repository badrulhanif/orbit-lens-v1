/**
 * Which days NASA GIBS has published NISAR backscatter tiles for. GIBS runs
 * a couple of weeks behind the ASF archive, so the newest passes may not
 * have tiles yet; those are left out rather than shown as empty.
 */

const DOMAINS_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/NISAR_L2_Geocoded_Polarimetric_Covariance/default/GoogleMapsCompatible_Level13/all/2025-01-01--2030-12-31.xml"

let cached: { at: number; ranges: [string, string][] } | null = null
const TTL_MS = 60 * 60 * 1000

/** Published date ranges, e.g. [["2025-10-29","2026-03-01"], …]. */
async function ranges(): Promise<[string, string][] | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ranges
  try {
    const res = await fetch(DOMAINS_URL, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return cached?.ranges ?? null
    const xml = await res.text()
    const domain = xml.match(/<Domain>([^<]+)<\/Domain>/)?.[1] ?? ""
    const list = domain
      .split(",")
      .map((r) => r.split("/").slice(0, 2) as [string, string])
      .filter((r) => r.length === 2 && r[0] && r[1])
    cached = { at: Date.now(), ranges: list }
    return list
  } catch {
    return cached?.ranges ?? null
  }
}

/** A function telling whether GIBS has tiles for a "YYYY-MM-DD" day. */
export async function gibsHasDay() {
  const list = await ranges()
  // Unknown (GIBS unreachable): don't filter anything out.
  if (!list) return () => true
  return (day: string) => list.some(([a, b]) => day >= a && day <= b)
}
