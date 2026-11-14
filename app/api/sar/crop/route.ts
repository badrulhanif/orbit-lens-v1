import type { NextRequest } from "next/server"

import { isGranuleName } from "@/lib/server/nisar"
import { cropMovement, cropSignal, readBbox } from "@/lib/server/sar-crop"
import { isDay } from "@/lib/server/util"

/**
 * One NISAR image cut to an area, for comparing dates.
 *   ?layer=movement&granule=NISAR_L2_…&w=&s=&e=&n=
 *   ?layer=signal&date=YYYY-MM-DD&w=&s=&e=&n=
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const bbox = readBbox(params)
  if (!bbox) return new Response("Invalid area", { status: 400 })

  try {
    let png: Buffer
    if (params.get("layer") === "movement") {
      const granule = params.get("granule") ?? ""
      if (!isGranuleName(granule))
        return new Response("Invalid granule", { status: 400 })
      png = await cropMovement(granule, bbox)
    } else if (params.get("layer") === "signal") {
      const date = params.get("date") ?? ""
      if (!isDay(date)) return new Response("Invalid date", { status: 400 })
      png = await cropSignal(date, bbox)
    } else {
      return new Response("Unknown layer", { status: 400 })
    }
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch {
    return new Response("Image unavailable", { status: 502 })
  }
}
