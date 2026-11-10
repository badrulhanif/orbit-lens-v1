import type { NextRequest } from "next/server"

import type { SarCoverageResponse, SarLayer } from "@/lib/sar"
import { coverageForArea } from "@/lib/server/nisar"
import { parseBbox } from "@/lib/server/util"

/**
 * Every NISAR swath over the area on screen, grouped into 12-day cycles so
 * the client can stitch them into one picture.
 *   GET /api/sar/coverage?layer=movement&w=…&s=…&e=…&n=…
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const layer = params.get("layer") as SarLayer
  if (layer !== "movement" && layer !== "signal") {
    return Response.json({ error: "Unknown layer." }, { status: 400 })
  }
  const box = parseBbox(params)
  if (!box) {
    return Response.json({ error: "Invalid area." }, { status: 400 })
  }
  try {
    const body = await coverageForArea(layer, box)
    return Response.json(body satisfies SarCoverageResponse, {
      headers: { "Cache-Control": "private, max-age=900" },
    })
  } catch (error) {
    console.error("[sar/coverage]", error)
    return Response.json(
      { error: "Couldn't reach the NISAR archive. Try again shortly." },
      { status: 502 }
    )
  }
}
