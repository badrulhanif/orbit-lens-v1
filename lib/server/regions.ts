import { loadBoundaries } from "@/lib/server/boundaries"
import { gazetteerPlace } from "@/lib/server/gazetteer"

/**
 * Matching place names written by other agencies ("Pontian District",
 * "Kedah, Penang", "N. Sembilan", "Kluang") to our states and districts, so
 * reports that only name a place can be attached to the right area.
 */

/** Lower case, no punctuation or admin words: "Daerah Keluang" → "keluang". */
export function normaliseRegion(text: string) {
  const n = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " dan ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(
      /\b(daerah|daerha|jajahan|bahagian|district|division|wilayah persekutuan|w p|wp|federal territory of|state of)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim()
  return ALIAS[n] ?? n
}

// Different spellings of the same place → one form.
const ALIAS: Record<string, string> = {
  kluang: "keluang",
  "johor bahru": "johor baharu",
  temerloh: "temerluh",
  "hulu perak": "ulu perak",
  "seberang perai tengah": "s p tengah",
  "seberang prai tengah": "s p tengah",
  "larut matang selama": "larut matang dan selama",
  "larut matang and selama": "larut matang dan selama",
  penang: "pulau pinang",
  "penang island": "pulau pinang",
  malacca: "melaka",
  "n sembilan": "negeri sembilan",
}

/** Every way a state is written in warning texts. */
const STATE_NAMES: Record<string, string[]> = {
  "Pulau Pinang": ["Pulau Pinang", "Penang"],
  Melaka: ["Melaka", "Malacca"],
  "Negeri Sembilan": ["Negeri Sembilan", "N. Sembilan"],
  "Kuala Lumpur": ["Kuala Lumpur"],
}

type Resolved = { state: string; district: string | null }

type Index = { states: Set<string>; districts: Map<string, Resolved> }

let index: Promise<Index> | null = null

/** Malaysian states and districts, by normalised name. */
function load() {
  index ??= loadBoundaries().then((b) => {
    const states = new Set<string>()
    const districts = new Map<string, Resolved>()
    for (const key of Object.keys(b)) {
      const [kind, name, area] = key.split("|")
      if (!area?.endsWith("Malaysia")) continue
      if (kind === "state") states.add(normaliseRegion(name))
      if (kind === "district")
        districts.set(normaliseRegion(name), {
          state: normaliseRegion(area.split(",")[0]),
          district: normaliseRegion(name),
        })
    }
    return { states, districts }
  })
  return index
}

const resolved = new Map<string, Promise<Resolved | null>>()

/** Where a named place is: its state, and district when known. */
function resolve(name: string): Promise<Resolved | null> {
  let hit = resolved.get(name)
  if (!hit) {
    hit = lookup(name).catch(() => null)
    if (resolved.size > 5000) resolved.clear()
    resolved.set(name, hit)
  }
  return hit
}

async function lookup(name: string): Promise<Resolved | null> {
  const n = normaliseRegion(name)
  if (!n || n === "malaysia") return null
  const { states, districts } = await load()
  if (states.has(n)) return { state: n, district: null }
  const d = districts.get(n)
  if (d) return d
  // A town: "Taiping" → Larut Matang & Selama, Perak.
  const place = await gazetteerPlace(name)
  if (!place) return null
  const parts = place.area
    .split(", ")
    .filter((p) => p !== "Malaysia")
    .map(normaliseRegion)
  const state = parts.at(-1)
  if (!state || !states.has(state)) return null
  if (place.kind === "district") return { state, district: n }
  return { state, district: parts.length > 1 ? parts[0] : null }
}

/**
 * A test for whether a place name (or a list, "Kedah, Penang") lies in the
 * area of a boundary key ("state|Johor|Malaysia" or a district). Null when
 * the key isn't a Malaysian state or district.
 */
export async function regionMatcher(boundaryKey: string | null | undefined) {
  const [kind, name, area] = boundaryKey?.split("|") ?? []
  if (!area?.endsWith("Malaysia") || (kind !== "state" && kind !== "district"))
    return null
  const target = normaliseRegion(name)
  const targetState =
    kind === "state" ? target : normaliseRegion(area.split(",")[0])
  const cache = new Map<string, boolean>()
  return async (names: string, state?: string) => {
    const key = `${names}|${state ?? ""}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let found = false
    for (const part of names.split(",")) {
      const r = await resolve(part)
      // A JKM row names its state too; trust it over a same-named town.
      const s = state ? normaliseRegion(state) : r?.state
      if (!r || s !== targetState) continue
      if (kind === "state" || r.district === target) {
        found = true
        break
      }
    }
    cache.set(key, found)
    return found
  }
}

/** The ways the area's name may be written in a warning text. */
export function areaNames(boundaryKey: string) {
  const [kind, name, area] = boundaryKey.split("|")
  const stateName =
    kind === "state" ? name : (area?.split(",")[0]?.trim() ?? name)
  const state = STATE_NAMES[stateName] ?? [stateName]
  if (kind === "state") return { district: null, state }
  const plain = name
    .replace(/^(Daerah|Daerha|W\.?P\.?)\s+/i, "")
    .replace(/\s+District$/i, "")
    .replace(/\s*\(.*\)$/, "")
  const alt = Object.entries(ALIAS)
    .filter(([, v]) => v === normaliseRegion(plain))
    .map(([k]) => k)
  return { district: [plain, ...alt], state }
}
