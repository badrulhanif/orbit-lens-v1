import type { NextRequest } from "next/server"

import { populationOf } from "@/lib/server/population"
import { boundaryParam, parseBbox } from "@/lib/server/util"

export const maxDuration = 30

/**
 * People living in an area (WorldPop 2020 estimate).
 *   GET /api/population?w=…&s=…&e=…&n=…[&boundary=…]
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const box = parseBbox(params)
  if (!box) return Response.json({ error: "Invalid area." }, { status: 400 })
  // Very large areas (whole countries) are slow and blur the point.
  if ((box[2] - box[0]) * (box[3] - box[1]) > 60) {
    return Response.json({ people: null })
  }
  const people = await populationOf(box, boundaryParam(params)).catch(
    (error) => {
      console.error("[population]", error)
      return null
    }
  )
  return Response.json(
    { people, source: "WorldPop 2020" },
    {
      headers: {
        "Cache-Control": people == null ? "no-store" : "public, max-age=86400",
      },
    }
  )
}
