import type { NextRequest } from "next/server"

import { ringsFor } from "@/lib/server/boundaries"
import { mapLimit } from "@/lib/server/util"
import { isGranuleName } from "@/lib/server/nisar"
import { movementCoherence, signalCover } from "@/lib/server/sar-analysis"
import { readBbox } from "@/lib/server/sar-crop"

/**
 * One value per NISAR pass over an area, for trend charts.
 *   ?layer=signal&items=YYYY-MM-DD,…&w=&s=&e=&n=     → land cover shares
 *   ?layer=movement&items=<granule>,…&w=&s=&e=&n=    → coherent share
 * Up to 12 items.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const bbox = readBbox(params)
  const layer = params.get("layer")
  const items = (params.get("items") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, 12)
  const day = /^\d{4}-\d{2}-\d{2}$/
  if (
    !bbox ||
    !items.length ||
    (layer === "signal" && !items.every((d) => day.test(d))) ||
    (layer === "movement" && !items.every(isGranuleName)) ||
    (layer !== "signal" && layer !== "movement")
  ) {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }
  const rings = await ringsFor(params.get("boundary"))
  const values =
    layer === "signal"
      ? await mapLimit(items, 3, (d) => signalCover(d, bbox, rings))
      : await mapLimit(items, 3, (g) => movementCoherence(g, bbox, rings))
  return Response.json(
    { items, values },
    { headers: { "Cache-Control": "public, max-age=86400" } }
  )
}
