import { areaBoxFor, type AreaHistory } from "@/lib/area"
import type { Snapshot } from "@/lib/alerts"
import { fromSearch } from "@/lib/share"
import { areaHistory } from "@/lib/server/area-history"

/** A row of public.watches (see supabase/schema.sql). */
export type Watch = {
  id: string
  email: string
  place: { name: string; link: string; topics?: string[] }
  token: string
  confirmed: boolean
  snapshot: Snapshot | null
  last_sent_at: string | null
}

/** The place's history, from its link (the same one the page shares). */
export function historyFor(link: string): Promise<AreaHistory> | null {
  const view = fromSearch(link)
  if (!view) return null
  return areaHistory(areaBoxFor(view.place), view.place.boundaryKey ?? null)
}

export const validEmail = (s: string) =>
  s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)
