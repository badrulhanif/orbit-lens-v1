import type { NextRequest } from "next/server"

import type { SearchResult } from "@/lib/geo"

type NominatimResult = {
  place_id: number
  lat: string
  lon: string
  name?: string
  display_name: string
  type?: string
  addresstype?: string
  /** [south, north, west, east] as strings */
  boundingbox?: [string, string, string, string]
}

/**
 * Place search (addresses, cities, states, countries…) via OpenStreetMap's
 * Nominatim. Proxied so we can send the User-Agent their policy requires.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 2) {
    return Response.json({ error: "Type a place to search." }, { status: 400 })
  }

  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("q", q.slice(0, 200))
  url.searchParams.set("limit", "6")
  url.searchParams.set(
    "accept-language",
    request.headers.get("accept-language") ?? "en"
  )

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "OrbitLens/0.1 (location demo)" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`)
    const data = (await res.json()) as NominatimResult[]

    const results: SearchResult[] = data.map((r) => {
      const [first, ...rest] = r.display_name.split(", ")
      const bb = r.boundingbox?.map(Number)
      return {
        id: String(r.place_id),
        label: r.name || first,
        detail: (r.name && r.name !== first ? [first, ...rest] : rest).join(
          ", "
        ),
        latitude: Number(r.lat),
        longitude: Number(r.lon),
        bbox:
          bb && bb.every(Number.isFinite)
            ? [bb[2], bb[0], bb[3], bb[1]] // [west, south, east, north]
            : null,
      }
    })

    return Response.json(results, {
      headers: { "Cache-Control": "public, max-age=86400" },
    })
  } catch {
    return Response.json(
      { error: "Search isn't available right now. Try again." },
      { status: 502 }
    )
  }
}
