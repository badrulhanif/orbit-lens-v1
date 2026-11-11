import type { NextRequest } from "next/server"

import type { RadarState } from "@/lib/alerts"
import { radarUpdate } from "@/lib/radar-notices"
import { radarLatest } from "@/lib/server/radar-alerts"

export const maxDuration = 300

const cycle = (v: string | null) =>
  v && /^\d{1,4}$/.test(v) ? Number(v) : undefined

/**
 * Radar change notices for one watched place, since the cycles the browser
 * last checked (none the first time: that's the baseline).
 *   GET /api/alerts/radar?link=<share link>&cover=33&trend=32
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const link = params.get("link")?.slice(0, 1000) ?? ""
  const prev: RadarState = {
    cover: cycle(params.get("cover")),
    trend: cycle(params.get("trend")),
  }
  const found = await radarLatest(link, prev, 240_000).catch((error) => {
    console.error("[alerts/radar]", error)
    return null
  })
  if (!found) return Response.json({ state: prev, alerts: [], enabled: false })
  return Response.json({
    ...radarUpdate(prev, found.latest, found.bbox),
    enabled: true,
  })
}
