import type { NextRequest } from "next/server"

import { sentinel1Days } from "@/lib/server/sentinel1"
import { isDay, parseBbox } from "@/lib/server/util"

/**
 * Sentinel-1 (C-band) days over an area, nearest to a date first.
 *   GET /api/sar/sentinel1?w=…&s=…&e=…&n=…&near=2026-10-27
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const box = parseBbox(params)
  const near = params.get("near") ?? ""
  if (!box || !isDay(near)) {
    return Response.json({ error: "Invalid area or date." }, { status: 400 })
  }
  try {
    const days = await sentinel1Days(box, near)
    return Response.json(
      { days },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    )
  } catch (error) {
    console.error("[sar/sentinel1]", error)
    return Response.json(
      { error: "Couldn't reach the Sentinel-1 archive." },
      { status: 502 }
    )
  }
}
