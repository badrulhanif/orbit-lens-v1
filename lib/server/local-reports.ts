import type { HazardType, HistoryEvent, Warning } from "@/lib/area"
import { areaNames } from "@/lib/server/regions"
import { fetchJson, TtlCache } from "@/lib/server/util"

/**
 * Live reports from Malaysian agencies:
 *  - JKM (Social Welfare Department) InfoBencana: relief centres open right
 *    now, with exact locations and evacuee counts
 *  - MetMalaysia warnings (via data.gov.my): heavy rain, thunderstorms,
 *    strong winds, by state and district
 */

/* ------------------------------------------------------------------ */
/* JKM relief centres                                                  */
/* ------------------------------------------------------------------ */

type JkmCentre = {
  id: number
  name: string
  latti: number
  longi: number
  negeri: string
  daerah: string
  mukim: string
  bencana: string
  mangsa: number
  keluarga: number
}

// Fires (Kebakaran) are mostly house fires: not a natural hazard here.
const JKM_TYPE: Record<string, HazardType | null> = {
  banjir: "flood",
  "tanah runtuh": "landslide",
  "ribut/taufan": "storm",
  ribut: "storm",
  "hakisan pantai": "disaster",
  kebakaran: null,
}

const JKM_LABEL: Partial<Record<HazardType, string>> = {
  flood: "Flood",
  landslide: "Landslide",
  storm: "Storm",
}

/** "SEKOLAH KEBANGSAAN DATO\' MAHARAJA LELA" → "Sekolah Kebangsaan Dato' Maharaja Lela". */
function tidyName(s: string) {
  return s
    .replace(/\\'/g, "'")
    .toLowerCase()
    .replace(/(^|[\s(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(Sk|Smk|Sjk|Sa|Sra|Kpg|Kg)\b/g, (m) => m.toUpperCase())
}

// Points outside Malaysia's window are typos (one centre sits at 26.8°E).
const inMalaysia = (lat: number, lon: number) =>
  lat > 0.5 && lat < 7.6 && lon > 99.5 && lon < 119.5

type ReliefCentre = { event: HistoryEvent; state: string; district: string }

const centres = new TtlCache<ReliefCentre[]>(1, 10 * 60_000)

export function reliefCentres(): Promise<ReliefCentre[]> {
  return centres.get("all", async () => {
    const { points } = await fetchJson<{ points: JkmCentre[] | null }>(
      "https://infobencanajkmv2.jkm.gov.my/api/pusat-buka.php?a=0&b=0",
      { timeoutMs: 8000 }
    )
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
    })
    return (points ?? []).flatMap((c): ReliefCentre[] => {
      const type = JKM_TYPE[c.bencana.toLowerCase()] ?? "disaster"
      if (!type) return []
      const ok = inMalaysia(c.latti, c.longi)
      const where = [c.mukim, c.daerah].filter(Boolean).join(", ")
      const people = c.mangsa
        ? `${c.mangsa.toLocaleString("en-GB")} evacuees from ${c.keluarga} ${c.keluarga === 1 ? "family" : "families"}`
        : "No evacuees registered yet"
      return [
        {
          state: c.negeri,
          district: c.daerah,
          event: {
            id: `jkm-${c.id}`,
            type,
            title: `${JKM_LABEL[type] ?? c.bencana} relief centre: ${tidyName(c.name)}`,
            date: today,
            detail: `${people} · ${where}`,
            description: `Evacuation centre open now for ${c.bencana.toLowerCase()} victims in ${where}, ${c.negeri}. ${people}.`,
            source: "JKM",
            url: "https://infobencanajkmv2.jkm.gov.my/",
            latitude: ok ? c.latti : 0,
            longitude: ok ? c.longi : 0,
            // A bad point: keep it in the list, off the map.
            ...(ok ? {} : { scope: "reported" as const }),
            live: true,
            impacts: c.mangsa
              ? [{ kind: "evacuees", value: c.mangsa, region: c.daerah }]
              : [],
          },
        },
      ]
    })
  })
}

/* ------------------------------------------------------------------ */
/* MetMalaysia warnings                                                */
/* ------------------------------------------------------------------ */

type MetWarning = {
  warning_issue: { issued: string; title_en: string }
  valid_from: string | null
  valid_to: string | null
  heading_en: string
  text_en: string
}

const warnings = new TtlCache<MetWarning[]>(1, 15 * 60_000)

function allWarnings() {
  return warnings.get("all", () =>
    fetchJson<MetWarning[]>("https://api.data.gov.my/weather/warning/", {
      timeoutMs: 8000,
    })
  )
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Warnings in force that mention the area, cut down to the sections that
 * do. A district matches when it's named, or when its whole state is (a
 * state followed by a list of districts only covers those).
 */
export async function warningsFor(boundaryKey: string): Promise<Warning[]> {
  const { district, state } = areaNames(boundaryKey)
  const word = (names: string[]) =>
    new RegExp(`\\b(${names.map(escape).join("|")})\\b`, "i")
  const stateRe = word(state)
  const wholeStateRe = new RegExp(
    `\\b(${state.map(escape).join("|")})\\b(?!\\s*[(:])`,
    "i"
  )
  const districtRe = district ? word(district) : null
  const mentions = (text: string) =>
    districtRe
      ? districtRe.test(text) || wholeStateRe.test(text)
      : stateRe.test(text)

  // Times are Malaysian local time (UTC+8).
  const now = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 19)
  const list = await allWarnings()
  const seen = new Set<string>()
  return list.flatMap((w, i): Warning[] => {
    if (!w.valid_to || w.valid_to.replace(" ", "T") < now) return []
    const sections = w.text_en
      .split(/(?=SECTION [A-Z]:)|(?=\b\d\)\s)/)
      .map((s) => s.trim())
      .filter(Boolean)
    const relevant = sections.filter(mentions)
    // The same bulletin is often issued as several records.
    const text = relevant.join(" ")
    if (!relevant.length || seen.has(text)) return []
    seen.add(text)
    return [
      {
        id: `met-${i}-${w.warning_issue.issued}`,
        title: w.warning_issue.title_en,
        issued: w.warning_issue.issued,
        validFrom: w.valid_from,
        validTo: w.valid_to,
        text,
      },
    ]
  })
}
