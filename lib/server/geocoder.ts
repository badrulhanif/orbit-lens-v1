import { distanceMeters, type LatLng, type Place } from "@/lib/geo"
import { locateRequest } from "@/lib/server/ip-location"
import { describeKind, iconFor, isNoise, joinUnique } from "@/lib/server/places"
import { fetchJson, TtlCache, validLatLng } from "@/lib/server/util"

type SearchCentre = LatLng & {
  /** How local the bias should be (map-style zoom). */
  zoom: number
}

/**
 * Where to rank results around: the client's position or map view if it sent
 * one, otherwise the visitor's rough IP location, otherwise nowhere.
 */
export async function resolveCentre(
  params: URLSearchParams,
  headers: Headers
): Promise<SearchCentre | null> {
  const lat = Number(params.get("lat"))
  const lon = Number(params.get("lon"))
  const zoom = Number(params.get("zoom"))
  if (params.has("lat") && params.has("lon") && validLatLng(lat, lon)) {
    return {
      latitude: lat,
      longitude: lon,
      zoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(zoom, 16) : 14,
    }
  }
  const ip = await locateRequest(headers)
  return ip
    ? { latitude: ip.latitude, longitude: ip.longitude, zoom: 10 }
    : null
}

/* ------------------------------------------------------------------ */
/* Photon: fast, typo-tolerant typeahead over OpenStreetMap            */
/* ------------------------------------------------------------------ */

type PhotonFeature = {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_type: string
    osm_id: number
    osm_key: string
    osm_value: string
    type?: string
    name?: string
    housenumber?: string
    street?: string
    locality?: string
    district?: string
    city?: string
    county?: string
    state?: string
    postcode?: string
    country?: string
    /** [minLon, maxLat, maxLon, minLat] */
    extent?: [number, number, number, number]
  }
}

type PhotonPlace = Place & { country: string | null }

function photonToPlace(f: PhotonFeature): PhotonPlace | null {
  const p = f.properties
  const [longitude, latitude] = f.geometry.coordinates
  const street = joinUnique([
    p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street,
  ])
  const name = p.name || street || p.city || p.state || p.country
  if (!name) return null

  return {
    id: `${p.osm_type}${p.osm_id}`,
    name,
    kind: describeKind(p.osm_key, p.osm_value, p.type),
    icon: iconFor(p.osm_key, p.osm_value),
    country: p.country ?? null,
    area: joinUnique(
      [p.district || p.locality, p.city, p.state, p.country].filter(
        (v) => v !== name
      )
    )
      .split(", ")
      .slice(0, 3)
      .join(", "),
    address: joinUnique([
      name !== street ? street : null,
      p.locality,
      p.district,
      joinUnique([p.postcode, p.city]).replace(", ", " "),
      p.state,
      p.country,
    ]),
    latitude,
    longitude,
    bbox: p.extent
      ? [p.extent[0], p.extent[3], p.extent[2], p.extent[1]]
      : null,
  }
}

/** So repeated keystrokes/queries are instant. */
const photonCache = new TtlCache<PhotonFeature[]>(1000, 30 * 60_000)

/** Thrown when the typeahead service can't be reached. */
export class PhotonUnavailableError extends Error {}

// After a failure, skip Photon for a minute instead of making every
// keystroke wait for a timeout.
let photonDownUntil = 0

function fetchPhoton(url: URL): Promise<PhotonFeature[]> {
  return photonCache.get(url.toString(), async () => {
    if (Date.now() < photonDownUntil) {
      throw new PhotonUnavailableError("Photon is unavailable")
    }
    try {
      return (
        await fetchJson<{ features: PhotonFeature[] }>(url, { timeoutMs: 4000 })
      ).features
    } catch (error) {
      photonDownUntil = Date.now() + 60_000
      throw new PhotonUnavailableError(
        error instanceof Error ? error.message : "Photon is unavailable"
      )
    }
  })
}

function photonUrl(
  q: string,
  centre: SearchCentre | null,
  options: {
    limit: number
    biasScale: number
    zoom?: number
    layers?: string[]
  }
) {
  const url = new URL("https://photon.komoot.io/api/")
  url.searchParams.set("q", q)
  url.searchParams.set("limit", String(options.limit))
  url.searchParams.set("lang", "en")
  for (const layer of options.layers ?? []) {
    url.searchParams.append("layer", layer)
  }
  if (centre) {
    // Rounded so nearby users share cache entries.
    url.searchParams.set("lat", centre.latitude.toFixed(2))
    url.searchParams.set("lon", centre.longitude.toFixed(2))
    url.searchParams.set(
      "zoom",
      String(options.zoom ?? Math.round(centre.zoom))
    )
    // Lower = stronger preference for nearby results.
    url.searchParams.set("location_bias_scale", String(options.biasScale))
  }
  return url
}

/** Bigger areas first when several share a name. */
const AREA_RANK: Record<string, number> = {
  Country: 0,
  State: 1,
  City: 2,
  District: 3,
  Town: 4,
  Suburb: 5,
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()

/**
 * Typeahead search. Two Photon lookups run in parallel:
 *  - places near the user (shops, streets, buildings…)
 *  - areas only (countries, states, cities, districts), so "Selangor" or
 *    "Malaysia" find the region instead of a local shop with that name.
 * Areas whose name matches what was typed go first.
 */
export async function photonSearch(
  q: string,
  centre: SearchCentre | null,
  limit = 7
): Promise<Place[]> {
  const [localFeatures, areaFeatures] = await Promise.all([
    fetchPhoton(photonUrl(q, centre, { limit: limit * 2, biasScale: 0.3 })),
    // Areas: only a light regional preference (zoom 4 ≈ country scale).
    fetchPhoton(
      photonUrl(q, centre, {
        limit: 6,
        biasScale: 0.9,
        zoom: 4,
        layers: ["country", "state", "city", "county", "district"],
      })
    ).catch(() => [] as PhotonFeature[]),
  ])

  const toPlaces = (features: PhotonFeature[]) =>
    features
      .filter((f) => !isNoise(f.properties.osm_key, f.properties.osm_value))
      .map(photonToPlace)
      .filter((p): p is PhotonPlace => p !== null)

  const local = toPlaces(localFeatures)
  const areas = toPlaces(areaFeatures)

  // The user's country: from their nearby results, else the top area.
  const home = local[0]?.country ?? areas[0]?.country ?? null
  const query = norm(q)
  const isExact = (p: PhotonPlace) => norm(p.name) === query
  const matches = (p: PhotonPlace) =>
    norm(p.name).startsWith(query) ||
    norm(p.name).split(" ").includes(query.split(" ")[0])

  const exactAreas = areas
    .filter(isExact)
    // Same country first, then bigger areas first.
    .sort(
      (a, b) =>
        Number(a.country !== home) - Number(b.country !== home) ||
        (AREA_RANK[a.kind] ?? 9) - (AREA_RANK[b.kind] ?? 9)
    )
  const homeAreas = areas.filter(
    (p) => !isExact(p) && p.country === home && matches(p)
  )
  const otherAreas = areas.filter(
    (p) => !exactAreas.includes(p) && !homeAreas.includes(p)
  )

  // Photon's bias is soft; keep anything within ~300 km of the user ahead
  // of far-away matches (Photon's order otherwise).
  const near = centre
    ? local.filter((p) => distanceMeters(centre, p) < 300_000)
    : local
  const far = centre ? local.filter((p) => !near.includes(p)) : []

  const merged: PhotonPlace[] = []
  for (const place of [
    ...exactAreas,
    ...homeAreas,
    ...near,
    ...far,
    ...otherAreas,
  ]) {
    // Drop duplicates: same OSM object, or same name and kind close by
    // (e.g. a city's point and its boundary).
    const dupe = merged.find(
      (p) =>
        p.id === place.id ||
        (norm(p.name) === norm(place.name) &&
          (p.kind === place.kind || p.icon === "area") &&
          distanceMeters(p, place) < (place.icon === "area" ? 30_000 : 500))
    )
    if (!dupe) merged.push(place)
    // A city is often a point plus a separate area; keep the area's extent
    // so the map can frame the whole city.
    else dupe.bbox ??= place.bbox
    if (merged.length >= limit) break
  }

  // `country` was only needed for ranking.
  return merged.map((p) => {
    const place: Place & { country?: string | null } = { ...p }
    delete place.country
    return place
  })
}

/* ------------------------------------------------------------------ */
/* Nominatim: fallback search when the typeahead service is down       */
/* ------------------------------------------------------------------ */

type NominatimResult = {
  place_id: number
  osm_type: "node" | "way" | "relation"
  osm_id: number
  lat: string
  lon: string
  name?: string
  category: string
  type: string
  addresstype?: string
  display_name: string
  /** [south, north, west, east] */
  boundingbox?: [string, string, string, string]
  address?: Record<string, string | undefined>
}

const AREA_TYPES = new Set([
  "country",
  "state",
  "county",
  "district",
  "city",
  "town",
  "village",
  "suburb",
  "municipality",
])

function nominatimToPlace(r: NominatimResult): Place {
  const a = r.address ?? {}
  const street = joinUnique([
    a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road,
  ])
  const district = a.suburb || a.neighbourhood || a.quarter || a.city_district
  const city = a.city || a.town || a.village || a.municipality
  const isArea =
    (r.category === "boundary" || r.category === "place") &&
    AREA_TYPES.has(r.addresstype ?? r.type)
  const kind = isArea
    ? describeKind("place", r.addresstype ?? r.type)
    : describeKind(r.category, r.type)
  const name = r.name || a.brand || street || kind
  const bb = r.boundingbox?.map(Number)

  return {
    id: `${r.osm_type[0].toUpperCase()}${r.osm_id}`,
    name,
    kind,
    icon: isArea ? "area" : iconFor(r.category, r.type),
    area: isArea
      ? joinUnique([a.county, a.state, a.country].filter((v) => v !== name))
      : joinUnique([district, city]),
    address: joinUnique([
      street,
      district,
      joinUnique([a.postcode, city]).replace(", ", " "),
      a.state,
      a.country,
    ]),
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    bbox:
      isArea && bb && bb.every(Number.isFinite)
        ? [bb[2], bb[0], bb[3], bb[1]]
        : null,
  }
}

/**
 * Full search for when the typeahead service is down. Only used on an
 * explicit Enter: Nominatim's policy doesn't allow search-as-you-type.
 */
export async function nominatimSearch(
  q: string,
  centre: LatLng | null,
  limit = 7
): Promise<Place[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("q", q)
  url.searchParams.set("limit", String(limit + 3))
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("accept-language", "en")
  if (centre) {
    // Prefer (but don't require) results around the user.
    url.searchParams.set(
      "viewbox",
      [
        centre.longitude - 1,
        centre.latitude + 1,
        centre.longitude + 1,
        centre.latitude - 1,
      ]
        .map((n) => n.toFixed(3))
        .join(",")
    )
  }

  const data = await fetchJson<NominatimResult[]>(url, { timeoutMs: 8000 })
  return data
    .filter((r) => !isNoise(r.category, r.type))
    .map(nominatimToPlace)
    .slice(0, limit)
}
