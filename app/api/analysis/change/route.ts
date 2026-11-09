import type { NextRequest } from "next/server"

import { ringsFor } from "@/lib/server/boundaries"
import { cachedChange } from "@/lib/server/sar-analysis"
import { readBbox } from "@/lib/server/sar-crop"
import { isGranuleName } from "@/lib/server/nisar"

/**
 * Change between two NISAR dates over an area.
 *   ?layer=signal&a=YYYY-MM-DD&b=YYYY-MM-DD&w=&s=&e=&n=   (land cover change)
 *   ?layer=movement&a=<granule>&b=<granule>&w=&s=&e=&n=   (coherence change)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const parsed = parse(params)
  if (!parsed)
    return Response.json({ error: "Invalid request." }, { status: 400 })
  try {
    const boundary = params.get("boundary")
    const rings = await ringsFor(boundary)
    const { stats } = await cachedChange(
      parsed.layer,
      parsed.a,
      parsed.b,
      parsed.bbox,
      rings,
      rings ? boundary! : ""
    )
    return Response.json(stats, {
      headers: { "Cache-Control": "public, max-age=86400" },
    })
  } catch {
    return Response.json(
      { error: "Couldn't analyse these images." },
      { status: 502 }
    )
  }
}

function parse(params: URLSearchParams) {
  const bbox = readBbox(params)
  const layer = params.get("layer")
  const a = params.get("a") ?? ""
  const b = params.get("b") ?? ""
  if (!bbox) return null
  if (layer === "signal") {
    const day = /^\d{4}-\d{2}-\d{2}$/
    return day.test(a) && day.test(b) ? ({ layer, a, b, bbox } as const) : null
  }
  if (layer === "movement") {
    return isGranuleName(a) && isGranuleName(b)
      ? ({ layer, a, b, bbox } as const)
      : null
  }
  return null
}
