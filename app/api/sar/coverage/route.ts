import type { NextRequest } from "next/server"

import type { Bbox } from "@/lib/area"
import type { SarCoverageResponse, SarLayer } from "@/lib/sar"
import { findCoverage } from "@/lib/server/nisar"
import { parseBbox } from "@/lib/server/util"

/** Largest area searched at once (degrees); the archive errors on much bigger boxes. Bigger views use the middle. */
const MAX_SPAN = 6

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
  let [w, s, e, n] = box

  const centre = { latitude: (s + n) / 2, longitude: (w + e) / 2 }
  // Zoomed far out: search the middle of the view rather than half the
  // planet (that would be thousands of swaths).
  if (e - w > MAX_SPAN) {
    w = centre.longitude - MAX_SPAN / 2
    e = centre.longitude + MAX_SPAN / 2
  }
  if (n - s > MAX_SPAN) {
    s = centre.latitude - MAX_SPAN / 2
    n = centre.latitude + MAX_SPAN / 2
  }
  const bbox = [
    Math.max(w, -180),
    Math.max(s, -85),
    Math.min(e, 180),
    Math.min(n, 85),
  ].map((v) => Math.round(v * 100) / 100) as Bbox

  try {
    const cycles = await findCoverage(layer, bbox, centre)
    return Response.json({ layer, bbox, cycles } satisfies SarCoverageResponse, {
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
