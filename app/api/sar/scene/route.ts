import type { NextRequest } from "next/server"

import type { SarScene } from "@/lib/sar"
import { isGranuleName, loadScene } from "@/lib/server/nisar"

/** Where a ground-movement image goes on the map, plus its image URL. */
export async function GET(request: NextRequest) {
  const granule = request.nextUrl.searchParams.get("granule") ?? ""
  if (!isGranuleName(granule)) {
    return Response.json({ error: "Invalid granule." }, { status: 400 })
  }

  try {
    const { scene } = await loadScene(granule)
    return Response.json(
      {
        ...scene,
        imageUrl: `/api/sar/image?granule=${encodeURIComponent(granule)}`,
      } satisfies SarScene,
      { headers: { "Cache-Control": "public, max-age=86400" } }
    )
  } catch {
    return Response.json(
      { error: "Couldn't load this radar image." },
      { status: 502 }
    )
  }
}
