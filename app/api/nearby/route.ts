import type { NextRequest } from "next/server"

import { nearbyArea } from "@/lib/server/nearby"
import { validLatLng } from "@/lib/server/util"

/**
 * The district around the user, for "Nearby me".
 *   GET /api/nearby?lat=…&lon=…
 * Coordinates are rounded to ~1 km here (the client rounds them too) and
 * aren't logged or stored.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const lat = Math.round(Number(params.get("lat")) * 100) / 100
  const lon = Math.round(Number(params.get("lon")) * 100) / 100
  if (!params.has("lat") || !params.has("lon") || !validLatLng(lat, lon)) {
    return Response.json({ error: "Invalid location." }, { status: 400 })
  }
  const place = await nearbyArea(lat, lon)
  return Response.json(
    { place },
    { headers: { "Cache-Control": "private, max-age=3600" } }
  )
}
