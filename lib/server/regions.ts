import type { LatLng } from "@/lib/geo"
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

/**
 * Where a named place is: its state, and district when known. `near` (where
 * the report came from) picks between same-named kampungs.
 */
function resolve(name: string, near?: LatLng | null): Promise<Resolved | null> {
  const key = near
    ? `${name}|${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}`
    : name
  let hit = resolved.get(key)
  if (!hit) {
    hit = lookup(name, near).catch(() => null)
    if (resolved.size > 5000) resolved.clear()
    resolved.set(key, hit)
  }
  return hit
}

async function lookup(
  name: string,
  near?: LatLng | null
): Promise<Resolved | null> {
  const n = normaliseRegion(name)
  if (!n || n === "malaysia") return null
  const { states, districts } = await load()
  if (states.has(n)) return { state: n, district: null }
  const d = districts.get(n)
  if (d) return d
  // A town: "Taiping" → Larut Matang & Selama, Perak.
  const place = await gazetteerPlace(name, near)
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
 * area of a boundary key ("state|Johor|Malaysia" or a district), and which
 * of the listed names do (`.parts`). Null when the key isn't a Malaysian
 * state or district.
 */
export async function regionMatcher(boundaryKey: string | null | undefined) {
  const [kind, name, area] = boundaryKey?.split("|") ?? []
  if (!area?.endsWith("Malaysia") || (kind !== "state" && kind !== "district"))
    return null
  const target = normaliseRegion(name)
  const targetState =
    kind === "state" ? target : normaliseRegion(area.split(",")[0])
  type Opts = { state?: string; near?: LatLng | null }
  const cache = new Map<string, Promise<string[]>>()
  const parts = (names: string, { state, near }: Opts = {}) => {
    const key = `${names}|${state ?? ""}|${near?.latitude},${near?.longitude}`
    let hit = cache.get(key)
    if (!hit) {
      hit = (async () => {
        const inside: string[] = []
        for (const raw of names.split(",")) {
          const part = raw.trim()
          const r = part ? await resolve(part, near) : null
          // A JKM row names its state too; trust it over a same-named town.
          const s = state ? normaliseRegion(state) : r?.state
          if (
            r &&
            s === targetState &&
            (kind === "state" || r.district === target)
          )
            inside.push(part)
        }
        return inside
      })()
      cache.set(key, hit)
    }
    return hit
  }
  const match = async (names: string, opts?: Opts) =>
    (await parts(names, opts)).length > 0
  return Object.assign(match, { parts })
}

/** "Daerah Keluang" → "Keluang", "Tenom District" → "Tenom". */
export const plainName = (name: string) =>
  name
    .replace(/^(Daerah|Daerha|W\.?P\.?)\s+/i, "")
    .replace(/\s+District$/i, "")
    .replace(/\s*\(.*\)$/, "")

/** The ways the area's name may be written in a warning text. */
export function areaNames(boundaryKey: string) {
  const [kind, name, area] = boundaryKey.split("|")
  const stateName =
    kind === "state" ? name : (area?.split(",")[0]?.trim() ?? name)
  const state = STATE_NAMES[stateName] ?? [stateName]
  if (kind === "state") return { district: null, state }
  const plain = plainName(name)
  const alt = Object.entries(ALIAS)
    .filter(([, v]) => v === normaliseRegion(plain))
    .map(([k]) => k)
  return { district: [plain, ...alt], state }
}
