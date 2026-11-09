import type { NextRequest } from "next/server"

import type { SarLayer, SarPassesResponse } from "@/lib/sar"
import { resolveCentre } from "@/lib/server/geocoder"
import { findPasses } from "@/lib/server/nisar"

/**
 * Which NISAR passes cover a spot: the client's position / map view, or the
 * visitor's rough location if it sent none.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const layer = params.get("layer") as SarLayer
  if (layer !== "movement" && layer !== "signal") {
    return Response.json({ error: "Unknown layer." }, { status: 400 })
  }

  const centre = await resolveCentre(params, request.headers)
  if (!centre) {
    return Response.json(
      { error: "Move the map to an area to check for radar passes." },
      { status: 400 }
    )
  }

  try {
    const passes = await findPasses(layer, centre.latitude, centre.longitude)
    return Response.json({ layer, passes } satisfies SarPassesResponse, {
      headers: { "Cache-Control": "private, max-age=900" },
    })
  } catch {
    return Response.json(
      { error: "Couldn't reach the NISAR archive. Try again shortly." },
      { status: 502 }
    )
  }
}
