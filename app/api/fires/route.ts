import type { NextRequest } from "next/server"

import { firesBetween } from "@/lib/server/fires"
import { boundaryParam, parseBbox } from "@/lib/server/util"

export const maxDuration = 60

/**
 * Fires seen over an area between two dates (NASA FIRMS hotspots, or
 * recorded wildfires when FIRMS isn't set up).
 *   GET /api/fires?w=…&s=…&e=…&n=…&from=2026-06-16&to=2026-10-14[&boundary=…]
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const box = parseBbox(params)
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  // Same size limit as /api/area-history, which the fallback reads.
  if (!box || box[2] - box[0] > 25 || box[3] - box[1] > 25 || from > to)
    return Response.json({ error: "Invalid area or dates." }, { status: 400 })
  const fires = await firesBetween(box, from, to, boundaryParam(params))
  return Response.json(
    { fires },
    {
      headers: {
        "Cache-Control": fires ? "public, max-age=21600" : "no-store",
      },
    }
  )
}
