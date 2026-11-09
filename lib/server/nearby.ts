import type { Bbox } from "@/lib/area"
import type { Place } from "@/lib/geo"
import { inRings, loadBoundaries, type Rings } from "@/lib/server/boundaries"
import { adminAreasAt, nearestTown } from "@/lib/server/gazetteer"

/**
 * The district around a (rounded) location, for "Nearby me": the user sees
 * what happened in their district, never their exact position. Federal
 * territories (KL, Putrajaya, Labuan) are one city each, so the whole
 * territory is used.
 */

const CITY_STATES = new Set(["Kuala Lumpur", "Putrajaya", "Labuan"])

/** "Daerah Keluang" → "Keluang", "Tenom District" → "Tenom". */
const plainName = (name: string) =>
  name
    .replace(/^(Daerah|Daerha|W\.?P\.?)\s+/i, "")
    .replace(/\s+District$/i, "")
    .replace(/\s*\(.*\)$/, "")

function ringsBox(rings: Rings): Bbox {
  const b: Bbox = [180, 90, -180, -90]
  for (const ring of rings)
    for (const [x, y] of ring) {
      b[0] = Math.min(b[0], x)
      b[1] = Math.min(b[1], y)
      b[2] = Math.max(b[2], x)
      b[3] = Math.max(b[3], y)
    }
  return b
}

function toPlace(key: string, bbox: Bbox, kind: string): Place {
  const [, name, area] = key.split("|")
  return {
    id: `near-${key}`,
    name: plainName(name),
    kind,
    icon: "area",
    area,
    address: "",
    // The area's centre, not the user's position.
    latitude: (bbox[1] + bbox[3]) / 2,
    longitude: (bbox[0] + bbox[2]) / 2,
    bbox,
    boundaryKey: key,
  }
}

export async function nearbyArea(
  latitude: number,
  longitude: number
): Promise<Place | null> {
  const p = { latitude, longitude }
  const boundaries = await loadBoundaries()
  const admin = await adminAreasAt(latitude, longitude)
  // Prefer the gazetteer's land-only box for framing.
  const frame = (key: string, rings: Rings | null) => {
    const [kind, name] = key.split("|")
    return (
      admin.find((a) => a.kind === kind && a.name === name)?.bbox ??
      (rings ? ringsBox(rings) : null)
    )
  }

  const containing = (kind: "district" | "state") =>
    Object.entries(boundaries).find(
      ([key, rings]) =>
        key.startsWith(`${kind}|`) &&
        key.endsWith("Malaysia") &&
        rings &&
        inRings(p, rings)
    )

  // 1. A city territory.
  const state = containing("state")
  if (state && CITY_STATES.has(state[0].split("|")[1])) {
    const box = frame(state[0], state[1])
    if (box) return toPlace(state[0], box, "Your city")
  }
  // 2. The district outline that holds the point.
  const district = containing("district")
  if (district) {
    const box = frame(district[0], district[1])
    if (box) return toPlace(district[0], box, "Your district")
  }
  // 3. Districts without an outline: the smallest box that holds it.
  const d = admin.find((a) => a.kind === "district")
  if (d) {
    const key = `district|${d.name}|${d.area}`
    return toPlace(key, d.bbox, "Your district")
  }
  // 4. Elsewhere: about 20 km around the nearest town.
  const town = await nearestTown(latitude, longitude)
  const r = 0.1
  const bbox: Bbox = [longitude - r, latitude - r, longitude + r, latitude + r]
  return {
    id: `near-${latitude},${longitude}`,
    name: town ? `Around ${town.split(",")[0]}` : "Your area",
    kind: "Your area",
    icon: "area",
    area: town ?? "",
    address: "",
    latitude,
    longitude,
    bbox,
  }
}
