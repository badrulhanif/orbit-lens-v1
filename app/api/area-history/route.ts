import type { NextRequest } from "next/server"

import type { Bbox } from "@/lib/area"
import { areaHistory } from "@/lib/server/area-history"

/**
 * Recorded natural hazards in (and just around) an area.
 *   GET /api/area-history?w=…&s=…&e=…&n=…
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const box = ["w", "s", "e", "n"].map((k) => Number(params.get(k))) as Bbox
  const [w, s, e, n] = box
  if (!box.every(Number.isFinite) || w >= e || s >= n) {
    return Response.json({ error: "Invalid area." }, { status: 400 })
  }
  // Keep requests to a sensible size (roughly a large state).
  if (e - w > 25 || n - s > 25) {
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
