import type { NextRequest } from "next/server"

import type { Bbox } from "@/lib/area"
import {
  analysisBox,
  coverGranules,
  measureBox,
  movementGranules,
} from "@/lib/measure-plan"
import { areaHistory } from "@/lib/server/area-history"
import { malaysianStates } from "@/lib/server/gazetteer"
import {
  measureCover,
  measuredEnabled,
  measurePair,
  measureTrend,
} from "@/lib/server/measured"
import { coverageForArea } from "@/lib/server/nisar"
import { within } from "@/lib/server/util"

export const maxDuration = 300

/** States warmed per run: 16 states in 8 days, inside the 12-day cycle. */
const PER_RUN = 2
const BUDGET_MS = 270_000

/** As the page sends it: 4 decimals. */
const round = (b: Bbox) => b.map((v) => Number(v.toFixed(4))) as Bbox

/**
 * Nightly job (Vercel Cron, see vercel.json): opens a couple of states the
 * way a visitor would, so their history and measured radar values are
 * already cached when someone looks. Heavy readings keep running in the
 * measurement service even after this request gives up waiting.
 *   GET /api/cron/prewarm             (Authorization: Bearer $CRON_SECRET)
 *   GET /api/cron/prewarm?state=Sabah  one state
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 })
  }
  const started = Date.now()
  const left = () => BUDGET_MS - (Date.now() - started)
  const status = <T>(p: Promise<T>) =>
    within(
      p.then(
        () => "done" as const,
        () => "failed" as const
      ),
      Math.max(1000, left()),
      "still running" as const
    )

  const states = (await malaysianStates()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  const only = request.nextUrl.searchParams.get("state")
  const day = Math.floor(Date.now() / 86_400_000)
  const picked = only
    ? states.filter((s) => s.name.toLowerCase() === only.toLowerCase())
    : Array.from(
        { length: PER_RUN },
        (_, i) => states[(day * PER_RUN + i) % states.length]
      )

  const report: Record<string, Record<string, string>> = {}
  for (const state of picked) {
    if (left() < 5000) break
    const r: Record<string, string> = {}
    report[state.name] = r
    const bbox = round(state.bbox as Bbox)
    r.history = await status(areaHistory(bbox, state.boundaryKey))
    if (!measuredEnabled()) continue

    const area = analysisBox(bbox)
    const box = round(measureBox(area))
    const [movement, signal] = await Promise.all([
      coverageForArea("movement", bbox).catch(() => null),
      coverageForArea("signal", bbox).catch(() => null),
    ])
    const ids = (ps: { id: string }[]) => ps.map((p) => p.id)
    if (movement?.cycles.length) {
      const { latest, trend } = movementGranules(movement.cycles, area)
      if (latest.length)
        r.movement = await status(measurePair(ids(latest), box))
      if (trend.length > 1)
        r.trend = await status(measureTrend(ids(trend), box))
    }
    if (signal?.cycles.length) {
      // Flood and farmland compare with the previous pass; forest with the
      // earliest.
      for (const baseline of ["previous", "earliest"] as const) {
        const { before, after } = coverGranules(signal.cycles, area, baseline)
        if (before.length && after.length)
          r[`cover-${baseline}`] = await status(
            measureCover(ids(before), ids(after), box, state.boundaryKey)
          )
      }
    }
  }
  return Response.json({ took: Date.now() - started, report })
}
