import { emailEnabled } from "@/lib/server/email"
import { supabaseEnabled } from "@/lib/server/supabase"

/** Which optional features this server has set up. */
export function GET() {
  return Response.json({
    email: emailEnabled() && supabaseEnabled(),
    reports: supabaseEnabled(),
  })
}
