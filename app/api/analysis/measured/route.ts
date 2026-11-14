import type { NextRequest } from "next/server"

import {
  measureCover,
  measuredEnabled,
  measurePair,
  measureTrend,
} from "@/lib/server/measured"
import { isGranuleName } from "@/lib/server/nisar"
import { boundaryParam, parseBbox } from "@/lib/server/util"

// Reading several full products can take a few minutes the first time.
export const maxDuration = 300

const list = (v: string | null, kind: "GUNW" | "GCOV", max: number) =>
  (v ?? "")
    .split(",")
    .filter((g) => g.includes(`_${kind}_`) && isGranuleName(g))
    .slice(0, max)

/**
 * Measured values from the full NISAR products (see lib/server/measured.ts).
 *   ?kind=pair&granules=<GUNW>,…            movement, one 12-day pair
 *   ?kind=trend&granules=<GUNW>,…           movement over several pairs
 *   ?kind=cover&a=<GCOV>,…&b=<GCOV>,…       land cover on two dates
 * plus &w=…&s=…&e=…&n=… (and &boundary= for cover).
 * 501 when the measurement service isn't set up.
 */
export async function GET(request: NextRequest) {
  if (!measuredEnabled()) {
    return Response.json(
      { error: "Measured values aren't set up on this server." },
      { status: 501 }
    )
  }
  const params = request.nextUrl.searchParams
  const box = parseBbox(params)
  // 6° a side (measureBox caps it there; rounding can add a hair).
  if (!box || box[2] - box[0] > 6.001 || box[3] - box[1] > 6.001) {
    return Response.json({ error: "Invalid area." }, { status: 400 })
  }
  const kind = params.get("kind")
  try {
    let body: unknown
    if (kind === "cover") {
      const a = list(params.get("a"), "GCOV", 8)
      const b = list(params.get("b"), "GCOV", 8)
      if (!a.length || !b.length) throw new RangeError()
      body = await measureCover(a, b, box, boundaryParam(params))
    } else {
      const granules = list(params.get("granules"), "GUNW", 40)
      if (!granules.length) throw new RangeError()
      body =
        kind === "trend"
          ? await measureTrend(granules, box)
          : await measurePair(granules.slice(0, 8), box)
    }
    return Response.json(body, {
      headers: { "Cache-Control": "private, max-age=3600" },
    })
  } catch (error) {
    if (error instanceof RangeError)
      return Response.json({ error: "Invalid request." }, { status: 400 })
    console.error("[measured]", error)
    return Response.json(
      { error: "Couldn't measure this area right now." },
      { status: 502 }
    )
  }
}
