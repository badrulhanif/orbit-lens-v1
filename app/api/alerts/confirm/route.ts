import type { NextRequest } from "next/server"

import { snapshotOf } from "@/lib/alerts"
import { appUrl } from "@/lib/server/email"
import { select, update } from "@/lib/server/supabase"
import { historyFor, type Watch } from "@/lib/server/watches"

/** The link in the confirmation email: start sending alerts. */
export async function GET(request: NextRequest) {
  const app = appUrl(request)
  const token = request.nextUrl.searchParams.get("token") ?? ""
  try {
    const [watch] = await select<Watch>(
      "watches",
      `token=eq.${encodeURIComponent(token)}&select=*`
    )
    if (!watch) return Response.redirect(`${app}/?alerts=invalid`, 302)
    // Today's state is the baseline: alerts are for what's new after it.
    const history = await historyFor(watch.place.link)?.catch(() => null)
    await update("watches", `id=eq.${watch.id}`, {
      confirmed: true,
      snapshot: history ? snapshotOf(history) : null,
    })
    return Response.redirect(`${app}/${watch.place.link}&alerts=confirmed`, 302)
  } catch (error) {
    console.error("[alerts/confirm]", error)
    return Response.redirect(`${app}/?alerts=error`, 302)
  }
}
