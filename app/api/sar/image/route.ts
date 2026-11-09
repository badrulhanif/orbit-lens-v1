import type { NextRequest } from "next/server"

import { isGranuleName, loadScene } from "@/lib/server/nisar"

/**
 * The NISAR browse image itself, served from our origin so the map can draw
 * it (ASF's image host doesn't send CORS headers).
 */
export async function GET(request: NextRequest) {
  const granule = request.nextUrl.searchParams.get("granule") ?? ""
  if (!isGranuleName(granule)) {
    return new Response("Invalid granule", { status: 400 })
  }

  try {
    const { png } = await loadScene(granule)
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
