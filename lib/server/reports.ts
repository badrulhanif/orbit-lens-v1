import type { Bbox, HazardType, HistoryEvent } from "@/lib/area"
import { select, supabaseEnabled } from "@/lib/server/supabase"

/** A row of public.community_reports (see supabase/schema.sql). */
export type CommunityReport = {
  id: string
  created_at: string
  hazard: "flood" | "landslide" | "storm" | "sinkhole" | "earthquake" | "other"
  description: string
  latitude: number
  longitude: number
  precise: boolean
  occurred_on: string | null
  photo_url: string | null
  status: "pending" | "approved" | "rejected"
}

export const REPORT_HAZARDS = [
  "flood",
  "landslide",
  "storm",
  "sinkhole",
  "earthquake",
  "other",
] as const

const TYPE: Record<CommunityReport["hazard"], HazardType> = {
  flood: "flood",
  landslide: "landslide",
  storm: "storm",
  sinkhole: "landslide",
  earthquake: "earthquake",
  other: "disaster",
}

const LABEL: Record<CommunityReport["hazard"], string> = {
  flood: "Flooding",
  landslide: "Landslide",
  storm: "Storm damage",
  sinkhole: "Sinkhole",
  earthquake: "Earthquake felt",
  other: "Hazard",
}

/** Approved reports in a box, as history records (newest first). */
export async function communityEvents([w, s, e, n]: Bbox): Promise<
  HistoryEvent[]
> {
  if (!supabaseEnabled()) return []
  const rows = await select<CommunityReport>(
    "community_reports",
    `status=eq.approved&latitude=gte.${s}&latitude=lte.${n}&longitude=gte.${w}&longitude=lte.${e}&order=created_at.desc&limit=200&select=*`
  )
  return rows.map((r) => ({
    id: `community-${r.id}`,
    type: TYPE[r.hazard],
    title: `${LABEL[r.hazard]} reported by the public`,
    date: r.occurred_on ?? r.created_at.slice(0, 10),
    detail: r.description.slice(0, 120),
    description: r.description,
    source: "Community",
    url: r.photo_url,
    latitude: r.latitude,
    longitude: r.longitude,
    approximate: !r.precise,
  }))
}
