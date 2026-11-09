import type { NextRequest } from "next/server"

import { areaHistory } from "@/lib/server/area-history"
import { parseBbox } from "@/lib/server/util"

/**
 * Recorded natural hazards in an area (inside its boundary when given).
 *   GET /api/area-history?w=…&s=…&e=…&n=…
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const box = parseBbox(params)
  if (!box) {
    return Response.json({ error: "Invalid area." }, { status: 400 })
  }
  // Keep requests to a sensible size (roughly a large state).
  if (box[2] - box[0] > 25 || box[3] - box[1] > 25) {
    return Response.json({ error: "Area too large." }, { status: 400 })
  }
  const boundary = params.get("boundary")
  const data = await areaHistory(
    box,
    boundary && boundary.length < 200 ? boundary : null
  )
  return Response.json(data, {
    headers: { "Cache-Control": "private, max-age=1800" },
  })
}
