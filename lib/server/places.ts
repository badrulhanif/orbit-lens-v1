import type { PlaceIcon } from "@/lib/geo"

/* ------------------------------------------------------------------ */
/* Labels and icons for OSM tags                                      */
/* ------------------------------------------------------------------ */

const KIND_LABELS: Record<string, string> = {
  mall: "Shopping mall",
  department_store: "Department store",
  supermarket: "Supermarket",
  convenience: "Convenience store",
  fuel: "Petrol station",
  charging_station: "EV charging",
  cafe: "Café",
  restaurant: "Restaurant",
  fast_food: "Fast food",
  food_court: "Food court",
  hospital: "Hospital",
  clinic: "Clinic",
  doctors: "Doctor",
  dentist: "Dentist",
  pharmacy: "Pharmacy",
  place_of_worship: "Place of worship",
  atm: "ATM",
  bank: "Bank",
  school: "School",
  university: "University",
  college: "College",
  kindergarten: "Kindergarten",
  hotel: "Hotel",
  hostel: "Hostel",
  guest_house: "Guest house",
  park: "Park",
  garden: "Garden",
  playground: "Playground",
  station: "Station",
  halt: "Station",
  aerodrome: "Airport",
  parking: "Parking",
  police: "Police station",
  fitness_centre: "Gym",
  sports_centre: "Sports centre",
  attraction: "Attraction",
  museum: "Museum",
  apartments: "Apartments",
  residential: "Residential",
  commercial: "Commercial",
  retail: "Retail",
  office: "Office",
  company: "Company",
  toilets: "Toilets",
  townhall: "Town hall",
  government: "Government office",
}

const AREA_LABELS: Record<string, string> = {
  country: "Country",
  state: "State",
  county: "District",
  district: "District",
  city: "City",
  town: "Town",
  village: "Village",
  suburb: "Suburb",
  neighbourhood: "Neighbourhood",
  locality: "Area",
  quarter: "Area",
  hamlet: "Village",
}

function humanise(value: string) {
  const text = value.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * @param key   OSM key / Nominatim category, e.g. "amenity"
 * @param value OSM value / Nominatim type, e.g. "cafe"
 * @param type  Photon's place type ("city", "street", "house"…), if any
 */
export function describeKind(key: string, value: string, type?: string) {
  if (key === "place" || key === "boundary") {
    return AREA_LABELS[value] ?? AREA_LABELS[type ?? ""] ?? humanise(value)
  }
  if (key === "highway") return "Road"
  if (key === "building" && value === "yes") return "Building"
  if (key === "shop" && !KIND_LABELS[value]) return `${humanise(value)} shop`
  return KIND_LABELS[value] ?? humanise(value)
}

export function iconFor(key: string, value: string): PlaceIcon {
  switch (value) {
    case "cafe":
      return "cafe"
    case "restaurant":
    case "fast_food":
    case "food_court":
    case "bar":
    case "pub":
      return "food"
    case "fuel":
      return "fuel"
    case "charging_station":
      return "ev"
    case "hospital":
    case "clinic":
    case "doctors":
    case "dentist":
      return "health"
    case "pharmacy":
      return "pharmacy"
    case "place_of_worship":
      return "worship"
    case "atm":
    case "bank":
    case "bureau_de_change":
      return "money"
    case "school":
    case "university":
    case "college":
    case "kindergarten":
      return "education"
    case "hotel":
    case "hostel":
    case "guest_house":
    case "motel":
      return "lodging"
    case "park":
    case "garden":
    case "nature_reserve":
    case "playground":
      return "park"
    case "aerodrome":
      return "air"
    case "parking":
      return "car"
    case "police":
      return "police"
    case "fitness_centre":
    case "sports_centre":
      return "fitness"
    case "station":
    case "halt":
      return "transit"
  }
  switch (key) {
    case "shop":
      return "shop"
    case "railway":
    case "public_transport":
      return "transit"
    case "highway":
      return "street"
    case "place":
    case "boundary":
      return "area"
    case "building":
      return "building"
  }
  return "pin"
}

/** Map clutter that makes poor search suggestions. */
export function isNoise(key: string, value: string) {
  if (key === "highway")
    return [
      "bus_stop",
      "motorway_junction",
      "service",
      "platform",
      "crossing",
      "traffic_signals",
      "turning_circle",
      "elevator",
    ].includes(value)
  if (key === "railway")
    return [
      "stop",
      "platform",
      "light_rail",
      "rail",
      "subway",
      "subway_entrance",
      "monorail",
      "switch",
    ].includes(value)
  if (key === "public_transport")
    return ["platform", "stop_position"].includes(value)
  if (key === "entrance" || key === "barrier") return true
  return false
}

export function joinUnique(parts: (string | null | undefined)[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const v = p?.trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out.join(", ")
}
