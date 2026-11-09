import type { NextRequest } from "next/server"

import { hazardByKey, hazardEvents } from "@/lib/server/hazards"
import { clientIp, locateRequest } from "@/lib/server/ip-location"

/**
 * Visitor log. The page pings this once per visit; we record the visitor's
 * IP (and its rough location) in the server log. Nothing is sent back to the
 * browser, so the IP never appears in the UI.
 */
export async function POST(request: NextRequest) {
  const info = await locateRequest(request.headers)

  console.log(
    "[visit]",
    JSON.stringify({
      time: new Date().toISOString(),
      ip: info?.ip ?? clientIp(request.headers) ?? "unknown",
      place: info?.place,
      isp: info?.isp,
      userAgent: request.headers.get("user-agent"),
      referer: request.headers.get("referer"),
    })
  )

  // Warm the flood feed for this region in the background, so a "flood"
  // search later answers instantly (NASA's feed takes a few seconds).
  const flood = hazardByKey("flood")
  if (flood && info) void hazardEvents(flood, info).catch(() => {})

  return new Response(null, { status: 204 })
}
