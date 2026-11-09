import type { NextRequest } from "next/server"

import type { PlaceName } from "@/lib/geo"

type NominatimResponse = {
  name?: string
  display_name?: string
  address?: Record<string, string | undefined>
  error?: string
}

/**
 * Turn device coordinates into a readable place name using OpenStreetMap's
 * Nominatim. Proxied server-side so we can send the identifying User-Agent
 * their usage policy asks for.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const lat = Number(params.get("lat"))
  const lon = Number(params.get("lon"))

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 })
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("lat", lat.toFixed(5))
  url.searchParams.set("lon", lon.toFixed(5))
  url.searchParams.set("zoom", "16")
  url.searchParams.set(
    "accept-language",
    request.headers.get("accept-language") ?? "en"
  )

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "OrbitLens/0.1 (location demo)" },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`)
    const data = (await res.json()) as NominatimResponse
    if (data.error) throw new Error(data.error)

    const a = data.address ?? {}
    const locality =
      a.suburb ||
      a.neighbourhood ||
      a.village ||
      a.town ||
      a.city_district ||
      a.city
    const city = a.city || a.town || a.state_district || a.county
    const parts = [a.road, locality].filter(Boolean)
    const place: PlaceName = {
      label:
        parts.join(", ") || data.name || data.display_name || "Unknown place",
      detail:
        [city !== locality ? city : null, a.state, a.country]
          .filter(Boolean)
          .join(", ") || null,
    }

    return Response.json(place, {
      headers: { "Cache-Control": "private, max-age=3600" },
    })
  } catch {
    return Response.json(
      { error: "Couldn't name this place." },
      { status: 502 }
    )
  }
}
