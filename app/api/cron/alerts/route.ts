import type { NextRequest } from "next/server"

import { newAlerts, snapshotOf } from "@/lib/alerts"
import {
  appUrl,
  emailEnabled,
  emailHtml,
  escapeHtml,
  sendEmail,
} from "@/lib/server/email"
import { select, supabaseEnabled, update } from "@/lib/server/supabase"
import { historyFor, type Watch } from "@/lib/server/watches"

export const maxDuration = 300
const BUDGET_MS = 270_000

/**
 * Daily (Vercel Cron, see vercel.json): for every confirmed watch, email
 * what's new at the place since the last check.
 *   GET /api/cron/alerts   (Authorization: Bearer $CRON_SECRET)
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorised" }, { status: 401 })
  if (!emailEnabled() || !supabaseEnabled())
    return Response.json({ skipped: "Email alerts aren't set up." })

  const started = Date.now()
  const app = appUrl(request)
  const watches = await select<Watch>(
    "watches",
    "confirmed=eq.true&select=*&order=last_sent_at.asc.nullsfirst&limit=1000"
  )
  // One history lookup per place, however many people watch it.
  const byPlace = new Map<string, Watch[]>()
  for (const w of watches)
    byPlace.set(w.place.link, [...(byPlace.get(w.place.link) ?? []), w])

  let sent = 0
  let checked = 0
  for (const [link, group] of byPlace) {
    if (Date.now() - started > BUDGET_MS) break
    const history = await historyFor(link)?.catch(() => null)
    if (!history) continue
    checked++
    const snapshot = snapshotOf(history)
    for (const w of group) {
      const alerts = newAlerts(w.snapshot, history)
      try {
        if (alerts.length) {
          const name = escapeHtml(w.place.name)
          await sendEmail(
            w.email,
            `${w.place.name}: ${alerts.length === 1 ? alerts[0].title : `${alerts.length} new alerts`}`,
            emailHtml(
              `New in ${w.place.name}`,
              alerts.map(
                (a) =>
                  `<b>${escapeHtml(a.title)}</b><br><span style="color:#57534e">${escapeHtml(a.detail)}</span>`
              ),
              { label: `Open ${w.place.name}`, href: `${app}/${link}` },
              `You asked for alerts about ${name}. <a href="${app}/api/alerts/unsubscribe?token=${w.token}">Stop these emails</a>.`
            )
          )
          sent++
        }
        await update("watches", `id=eq.${w.id}`, {
          snapshot,
          ...(alerts.length ? { last_sent_at: new Date().toISOString() } : {}),
        })
      } catch (error) {
        console.error("[cron/alerts]", w.id, error)
      }
    }
  }
  return Response.json({
    places: byPlace.size,
    checked,
    sent,
    took: Date.now() - started,
  })
}
