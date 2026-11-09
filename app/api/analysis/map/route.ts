import type { NextRequest } from "next/server"

import { ringsFor } from "@/lib/server/boundaries"
import { cachedChange } from "@/lib/server/sar-analysis"
import { isGranuleName } from "@/lib/server/nisar"
import { readBbox } from "@/lib/server/sar-crop"

/** The change map image for the same request as /api/analysis/change. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const bbox = readBbox(params)
  const layer = params.get("layer")
  const a = params.get("a") ?? ""
  const b = params.get("b") ?? ""
  const day = /^\d{4}-\d{2}-\d{2}$/
  const ok =
    bbox &&
    ((layer === "signal" && day.test(a) && day.test(b)) ||
      (layer === "movement" && isGranuleName(a) && isGranuleName(b)))
  if (!ok) return new Response("Invalid request", { status: 400 })
  try {
    const boundary = params.get("boundary")
    const rings = await ringsFor(boundary)
    const { map } = await cachedChange(
      layer,
      a,
      b,
      bbox,
      rings,
      rings ? boundary! : ""
    )
    return new Response(new Uint8Array(map), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch {
    return new Response("Unavailable", { status: 502 })
  }
}
