import type { NextRequest } from "next/server"

import { changeFor, parseChange } from "@/lib/server/sar-analysis"

/**
 * Change between two NISAR dates over an area.
 *   ?layer=signal&a=YYYY-MM-DD&b=YYYY-MM-DD&w=&s=&e=&n=   (land cover change)
 *   ?layer=movement&a=<granule>&b=<granule>&w=&s=&e=&n=   (coherence change)
 */
export async function GET(request: NextRequest) {
  const parsed = parseChange(request.nextUrl.searchParams)
  if (!parsed)
    return Response.json({ error: "Invalid request." }, { status: 400 })
  try {
    const { stats } = await changeFor(parsed)
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
