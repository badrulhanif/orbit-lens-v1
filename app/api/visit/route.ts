import type { NextRequest } from "next/server"

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

  return new Response(null, { status: 204 })
}
