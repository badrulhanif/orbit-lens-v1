import { randomBytes } from "node:crypto"

import { cleanTopics, TOPICS } from "@/lib/alerts"
import { fromSearch } from "@/lib/share"
import {
  appUrl,
  emailEnabled,
  emailHtml,
  escapeHtml,
  sendEmail,
} from "@/lib/server/email"
import { count, insert, supabaseEnabled } from "@/lib/server/supabase"
import { validEmail } from "@/lib/server/watches"

/**
 * Email alerts for a place: stores a pending subscription and sends a
 * confirmation link. Nothing is sent until the link is clicked.
 *   POST { email, link }   (link = the place's share link query, "?name=…")
 */
export async function POST(request: Request) {
  if (!emailEnabled() || !supabaseEnabled())
    return Response.json(
      { error: "Email alerts aren't set up." },
      { status: 501 }
    )
  const body = (await request.json().catch(() => null)) as {
    email?: string
    link?: string
    topics?: unknown
  } | null
  const email = body?.email?.trim().toLowerCase() ?? ""
  const view = fromSearch(body?.link ?? "")
  if (!validEmail(email) || !view)
    return Response.json({ error: "Check the email address." }, { status: 400 })
  // Keep only the place in the link (not the filter or open event).
  const link = `?${new URLSearchParams([...new URLSearchParams(body!.link!)].filter(([k]) => !["f", "t", "e"].includes(k)))}`

  try {
    if ((await count("watches", `email=eq.${encodeURIComponent(email)}`)) >= 10)
      return Response.json(
        { error: "That address already watches 10 places." },
        { status: 429 }
      )
    const token = randomBytes(24).toString("base64url")
    const topics = cleanTopics(body?.topics)
    await insert("watches", {
      email,
      place: { name: view.place.name, link, topics },
      token,
    })
    const about = TOPICS.filter((t) => topics.includes(t.id))
      .map((t) => t.label.toLowerCase())
      .join(", ")
    const app = appUrl(request)
    await sendEmail(
      email,
      `Confirm alerts for ${view.place.name}`,
      emailHtml(
        `Alerts for ${view.place.name}`,
        [
          `Someone (hopefully you) asked Orbit Lens to email this address when something new happens in <b>${escapeHtml(view.place.name)}</b>: ${escapeHtml(about)}.`,
          "Confirm to start. If this wasn't you, ignore this email and nothing will be sent.",
        ],
        {
          label: "Confirm alerts",
          href: `${app}/api/alerts/confirm?token=${token}`,
        }
      )
    )
    return Response.json({ ok: true })
  } catch (error) {
    console.error("[alerts/subscribe]", error)
    return Response.json(
      { error: "Couldn't set up alerts right now." },
      { status: 502 }
    )
  }
}
