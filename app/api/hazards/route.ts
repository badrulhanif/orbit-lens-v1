import type { NextRequest } from "next/server"

import type { Place } from "@/lib/geo"
import { resolveCentre } from "@/lib/server/geocoder"
import { hazardByKey, hazardEvents } from "@/lib/server/hazards"

/**
 * Recent real events for a hazard (floods, quakes…), closest first. Kept
 * separate from /api/search so the hazard suggestion shows instantly while
 * the (slower) NASA/USGS feeds load.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const hazard = hazardByKey(params.get("hazard") ?? "")
  if (!hazard) {
    return Response.json({ error: "Unknown hazard." }, { status: 400 })
  }
  const centre = await resolveCentre(params, request.headers)
  const events: Place[] = await hazardEvents(hazard, centre)
  return Response.json(
    { events },
    { headers: { "Cache-Control": "private, max-age=900" } }
  )
}
