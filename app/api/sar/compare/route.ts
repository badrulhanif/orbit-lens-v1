import type { NextRequest } from "next/server"

import { cropSignal, darkSurfaceChange, readBbox } from "@/lib/server/sar-crop"
import { isDay } from "@/lib/server/util"

/**
 * Brightness comparison numbers for two dates over one area: how much of it
 * looks like water / smooth surface on each date.
 *   ?a=YYYY-MM-DD&b=YYYY-MM-DD&w=&s=&e=&n=
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const bbox = readBbox(params)
  const a = params.get("a") ?? ""
  const b = params.get("b") ?? ""
  if (!bbox || !isDay(a) || !isDay(b)) {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }
  try {
    const [ia, ib] = await Promise.all([
      cropSignal(a, bbox),
      cropSignal(b, bbox),
    ])
    return Response.json(await darkSurfaceChange(ia, ib), {
      headers: { "Cache-Control": "public, max-age=86400" },
    })
  } catch {
    return Response.json(
      { error: "Couldn't load the radar images." },
      { status: 502 }
    )
  }
}
