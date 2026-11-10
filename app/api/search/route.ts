import type { NextRequest } from "next/server"

import {
  isArea,
  mergePlaces,
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
 * Search box backend, in two stages so typing never waits on the network:
 *  - stage=local: hazards ("flood", "banjir kelantan") and the offline
 *    gazetteer, ranked country → state → district → town → kampung, nearest
 *    first among equals. Answers in milliseconds.
 *  - stage=online: buildings, malls and streets from Photon (1–2 s). The
 *    client merges them in when they arrive.
 * With no stage (an explicit Enter, `submit=1`) both run, and if nothing is
 * found and Photon is down we ask Nominatim (which only allows searches
 * like that).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const q = params.get("q")?.trim().slice(0, 200) ?? ""
  const stage = params.get("stage")
  const submit = params.get("submit") === "1"
  if (q.length < 2) return ok({ intent: null, places: [] })

  const centre = await resolveCentre(params, request.headers)

  if (stage === "online") {
    try {
      const places = (await photonSearch(q, centre, 6)).filter(
        (p) => !isArea(p)
      )
      return ok({ intent: null, places })
    } catch (error) {
      return Response.json(
        {
          intent: null,
          places: [],
          down: error instanceof PhotonUnavailableError,
        },
        { status: 503 }
      )
    }
  }

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
  const strong = local.filter((p) => p.match < 2).map(strip)
  // Loose matches: a later word, or a name with a typo.
  const weak = local.filter((p) => p.match >= 2).map(strip)
  if (stage === "local") {
    return ok({
      intent: null,
      places: [...strong, ...weak],
      strong: strong.length,
    })
  }

  let spots: Place[] = []
  try {
    spots = (await photonSearch(q, centre, 6)).filter((p) => !isArea(p))
  } catch (error) {
    if (error instanceof PhotonUnavailableError && submit && !strong.length)
      spots = await nominatimSearch(q, centre, 6).catch(() => [])
  }
  return ok({ intent: null, places: mergePlaces(strong, spots, weak) })
}

/** Drop the gazetteer's internal ranking fields. */
function strip(p: Place & { match?: number; rank?: number }): Place {
  const place = { ...p }
  delete place.match
  delete place.rank
  return place
}

function ok(body: SearchResponse) {
  return Response.json(body, {
    headers: { "Cache-Control": "private, max-age=300" },
  })
}
