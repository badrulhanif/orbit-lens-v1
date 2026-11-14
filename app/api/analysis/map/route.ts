import type { NextRequest } from "next/server"

import { changeFor, parseChange } from "@/lib/server/sar-analysis"

/** The change map image for the same request as /api/analysis/change. */
export async function GET(request: NextRequest) {
  const parsed = parseChange(request.nextUrl.searchParams)
  if (!parsed) return new Response("Invalid request", { status: 400 })
  try {
    const { map } = await changeFor(parsed)
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
