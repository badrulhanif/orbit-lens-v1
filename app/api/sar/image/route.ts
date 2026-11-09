import type { NextRequest } from "next/server"

import { isGranuleName, sceneImage } from "@/lib/server/nisar"

/**
 * A NISAR browse image, served from our origin so the map can draw it
 * (ASF's image host doesn't send CORS headers). `size=small` is a lighter
 * copy for zoomed-out views.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const granule = params.get("granule") ?? ""
  if (!isGranuleName(granule)) {
    return new Response("Invalid granule", { status: 400 })
  }
  const size = params.get("size") === "small" ? "small" : "full"

  try {
    const png = await sceneImage(granule, size)
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // Published products don't change.
        "Cache-Control": "public, max-age=604800, immutable",
      },
    })
  } catch {
    return new Response("Image unavailable", { status: 502 })
  }
}
