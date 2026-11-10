import { createHash, randomUUID } from "node:crypto"

import { clientIp } from "@/lib/server/ip-location"
import { REPORT_HAZARDS } from "@/lib/server/reports"
import { count, insert, supabaseEnabled, upload } from "@/lib/server/supabase"
import { validLatLng } from "@/lib/server/util"

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
// Vercel limits request bodies to 4.5 MB.
const MAX_PHOTO = 4 * 1024 * 1024
const PER_DAY = 5

/**
 * A report from the public ("I see flooding here"). Saved as pending and
 * shown only after a moderator approves it (/moderate).
 *   POST multipart: hazard, description, latitude, longitude, precise,
 *        occurredOn (YYYY-MM-DD), photo (optional image)
 */
export async function POST(request: Request) {
  if (!supabaseEnabled())
    return Response.json({ error: "Reports aren't set up." }, { status: 501 })
  const form = await request.formData().catch(() => null)
  const field = (k: string) => String(form?.get(k) ?? "").trim()
  const hazard = field("hazard")
  const description = field("description").slice(0, 600)
  const latitude = Number(field("latitude"))
  const longitude = Number(field("longitude"))
  const occurredOn = /^\d{4}-\d{2}-\d{2}$/.test(field("occurredOn"))
    ? field("occurredOn")
    : null
  if (
    !REPORT_HAZARDS.includes(hazard as (typeof REPORT_HAZARDS)[number]) ||
    description.length < 5 ||
    !validLatLng(latitude, longitude) ||
    (occurredOn && occurredOn > new Date().toISOString().slice(0, 10))
  )
    return Response.json({ error: "Please check the report." }, { status: 400 })

  // Rate limit by a one-way hash of the IP (the IP itself isn't stored).
  const reporter = createHash("sha256")
    .update(
      `${clientIp(request.headers) ?? "unknown"}|${process.env.SUPABASE_URL}`
    )
    .digest("hex")
    .slice(0, 32)
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    if (
      (await count(
        "community_reports",
        `reporter=eq.${reporter}&created_at=gt.${since}`
      )) >= PER_DAY
    )
      return Response.json(
        { error: "Thanks — that's the limit for today." },
        { status: 429 }
      )
    let photoUrl: string | null = null
    const photo = form?.get("photo")
    if (photo instanceof Blob && photo.size > 0) {
      const ext = PHOTO_TYPES[photo.type]
      if (!ext || photo.size > MAX_PHOTO)
        return Response.json(
          { error: "Photos must be JPEG, PNG or WebP, under 4 MB." },
          { status: 400 }
        )
      photoUrl = await upload("report-photos", `${randomUUID()}.${ext}`, photo)
    }
    await insert("community_reports", {
      hazard,
      description,
      latitude: Math.round(latitude * 1e5) / 1e5,
      longitude: Math.round(longitude * 1e5) / 1e5,
      precise: field("precise") === "true",
      occurred_on: occurredOn,
      photo_url: photoUrl,
      reporter,
    })
    return Response.json({ ok: true })
  } catch (error) {
    console.error("[reports]", error)
    return Response.json(
      { error: "Couldn't send the report right now." },
      { status: 502 }
    )
  }
}
