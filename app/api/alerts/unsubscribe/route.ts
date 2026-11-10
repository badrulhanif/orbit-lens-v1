import type { NextRequest } from "next/server"

import { appUrl } from "@/lib/server/email"
import { remove } from "@/lib/server/supabase"

/** The link in every alert email: stop and forget this subscription. */
export async function GET(request: NextRequest) {
  const app = appUrl(request)
  const token = request.nextUrl.searchParams.get("token") ?? ""
  try {
    if (token) await remove("watches", `token=eq.${encodeURIComponent(token)}`)
    return Response.redirect(`${app}/?alerts=unsubscribed`, 302)
  } catch (error) {
    console.error("[alerts/unsubscribe]", error)
    return Response.redirect(`${app}/?alerts=error`, 302)
  }
}
