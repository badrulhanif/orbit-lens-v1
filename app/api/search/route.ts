import type { NextRequest } from "next/server"

import {
  isArea,
  type HazardIntent,
  type LatLng,
  type Place,
  type SearchResponse,
} from "@/lib/geo"
import {
  nominatimSearch,
  photonSearch,
  PhotonUnavailableError,
  resolveCentre,
  type SearchCentre,
} from "@/lib/server/geocoder"
import { detectHazard, hazardEvents } from "@/lib/server/hazards"

/**
 * Search box backend.
 *
 * - Hazards ("flood", "banjir kelantan", "landslide near Ipoh"): returns
 *   which NISAR layer shows it, plus recent real events nearby.
 * - Anything else: place suggestions as you type (Photon), nearby first.
 *
 * `submit=1` marks an explicit Enter: if the typeahead service is down we
 * fall back to Nominatim, which only allows searches like that.
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
    // "banjir kelantan": find Kelantan first, then events around it.
    let place: Place | null = null
    if (near) {
      // Only uses the Nominatim fallback on Enter (its usage policy).
      const found = await findPlaces(near, centre, submit, 5).catch(() => [])
      // "kelantan" means the state, not a street named after it nearby.
      place = found.find(isArea) ?? found[0] ?? null
    }
    const around: LatLng | null = place ?? centre
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
    const events = await hazardEvents(hazard, around)
    return ok({ intent, places: events })
  }

  try {
    return ok({ intent: null, places: await findPlaces(q, centre, submit) })
  } catch (error) {
    if (error instanceof PhotonUnavailableError && !submit) {
      // Let the UI ask for Enter instead of searching on every keystroke.
      return Response.json(
        { intent: null, places: [], needsSubmit: true },
        { status: 503 }
      )
    }
    return Response.json(
      { error: "Search isn't available right now. Try again." },
      { status: 502 }
    )
  }
}

/** Photon, or Nominatim on an explicit search if Photon is down. */
async function findPlaces(
  q: string,
  centre: SearchCentre | null,
  submit: boolean,
  limit?: number
) {
  try {
    return await photonSearch(q, centre, limit)
  } catch (error) {
    if (error instanceof PhotonUnavailableError && submit) {
      return nominatimSearch(q, centre, limit)
    }
    throw error
  }
}

function ok(body: SearchResponse) {
  return Response.json(body, {
    headers: { "Cache-Control": "private, max-age=300" },
  })
}
