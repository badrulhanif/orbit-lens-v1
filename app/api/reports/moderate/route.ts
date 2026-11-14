import { select, supabaseEnabled, update } from "@/lib/server/supabase"
import type { CommunityReport } from "@/lib/server/reports"

/**
 * Moderation for community reports (used by /moderate). Needs the
 * MODERATOR_KEY in the X-Moderator-Key header.
 *   GET                      pending reports, oldest first
 *   POST { id, status }      approve or reject one
 */
function allowed(request: Request) {
  const key = process.env.MODERATOR_KEY
  return Boolean(key) && request.headers.get("x-moderator-key") === key
}

export async function GET(request: Request) {
  if (!supabaseEnabled())
    return Response.json({ error: "Not set up." }, { status: 501 })
  if (!allowed(request))
    return Response.json({ error: "Wrong key." }, { status: 401 })
  try {
    const rows = await select<CommunityReport>(
      "community_reports",
      "status=eq.pending&order=created_at.asc&limit=100&select=*"
    )
    return Response.json({ reports: rows })
  } catch (error) {
    console.error("[reports/moderate]", error)
    return Response.json({ error: "Couldn't load reports." }, { status: 502 })
  }
}

export async function POST(request: Request) {
  if (!supabaseEnabled())
    return Response.json({ error: "Not set up." }, { status: 501 })
  if (!allowed(request))
    return Response.json({ error: "Wrong key." }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    id?: string
    status?: string
  } | null
  if (
    !body?.id ||
    !/^[0-9a-f-]{36}$/.test(body.id) ||
    !["approved", "rejected"].includes(body.status ?? "")
  )
    return Response.json({ error: "Invalid request." }, { status: 400 })
  try {
    await update("community_reports", `id=eq.${body.id}`, {
      status: body.status,
    })
    return Response.json({ ok: true })
  } catch (error) {
    console.error("[reports/moderate]", error)
    return Response.json(
      { error: "Couldn't save that decision." },
      { status: 502 }
    )
  }
}
