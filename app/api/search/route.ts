import type { NextRequest } from "next/server"

import {
  distanceMeters,
  isArea,
  type HazardIntent,
  type Place,
  type SearchResponse,
} from "@/lib/geo"
import { searchGazetteer } from "@/lib/server/gazetteer"
import {
  nominatimSearch,
  photonSearch,
  PhotonUnavailableError,
  resolveCentre,
} from "@/lib/server/geocoder"
import { detectHazard } from "@/lib/server/hazards"

/**
 * Search box backend.
 *
 * Places: an offline gazetteer answers instantly and ranks the way people
 * expect (country → state → district → town → kampung, nearest first among
 * equals). Photon adds buildings, malls and streets when it's reachable.
 *
 * Hazards ("flood", "banjir kelantan"): returns which NISAR layer shows it;
 * the client then loads recent real events from /api/hazards.
 *
 * `submit=1` marks an explicit Enter: if nothing is found locally and Photon
 * is down, we ask Nominatim (which only allows searches like that).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const q = params.get("q")?.trim().slice(0, 200) ?? ""
  const submit = params.get("submit") === "1"
  if (q.length < 2) {
    return Response.json({ intent: null, places: [] } satisfies SearchResponse)
  }

  const centre = await resolveCentre(params, request.headers)

  const match = detectHazard(q)
  if (match) {
    const { hazard, near } = match
    // "banjir kelantan" → Kelantan (the state, not a street named after it).
    const place = near ? (await searchGazetteer(near, centre, 1))[0] : null
    const intent: HazardIntent = {
      hazard: hazard.key,
      label: hazard.label,
      layer: hazard.layer,
      why: hazard.why,
      near: place
        ? {
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            bbox: place.bbox,
          }
        : null,
    }
    return ok({ intent, places: [] })
  }

  const local = await searchGazetteer(q, centre, 8)
  const strong = local.filter((p) => p.match < 2)
  const weak = local.filter((p) => p.match === 2)

  // Buildings, malls, streets… from Photon (skipped instantly while down).
  let pois: Place[] = []
  let photonDown = false
  try {
    pois = (await photonSearch(q, centre, 6)).filter((p) => !isArea(p))
  } catch (error) {
    photonDown = error instanceof PhotonUnavailableError
  }
  if (photonDown && submit && strong.length === 0) {
    pois = await nominatimSearch(q, centre, 6).catch(() => [])
  }

  // Names that match well first, then specific spots, then loose matches.
  const merged: Place[] = []
  for (const p of [...strong, ...pois, ...weak]) {
    const dupe = merged.some(
      (m) =>
        m.name.toLowerCase() === p.name.toLowerCase() &&
        distanceMeters(m, p) < 2_000
    )
    if (!dupe) merged.push(p)
    if (merged.length >= 8) break
  }

  if (merged.length === 0 && photonDown && !submit) {
    // Not in the offline index; the online search needs an explicit Enter.
    return Response.json(
      { intent: null, places: [], needsSubmit: true },
      { status: 503 }
    )
  }

  return ok({
    intent: null,
    // Strip internal ranking fields.
    places: merged.map((p) => {
      const place = { ...p } as Place & { match?: number; rank?: number }
      delete place.match
      delete place.rank
      return place
    }),
  })
}

function ok(body: SearchResponse) {
  return Response.json(body, {
    headers: { "Cache-Control": "private, max-age=300" },
  })
}
