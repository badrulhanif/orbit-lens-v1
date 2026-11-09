import type { Impact } from "@/lib/area"

/** Plain-language descriptions of events, built from each source's data. */

const n = (v: number) => v.toLocaleString("en-GB")

const day = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso))

function dateRange(from: string | null, to: string | null) {
  if (!from) return null
  if (!to || to === from) return day(from)
  return `${day(from)} to ${day(to)}`
}

/** "859 displaced in Melaka Tengah, 43 in Jasin; 1 death in Sepang". */
export function impactSentence(impacts: Impact[], max = 6) {
  const byKind = new Map<string, Impact[]>()
  for (const i of impacts) {
    if (i.region === "Malaysia" && impacts.length > 1) continue
    byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i])
  }
  const parts: string[] = []
  for (const [kind, list] of byKind) {
    const shown = list.slice(0, max)
    const label =
      kind === "death"
        ? (v: number) => (v === 1 ? "death" : "deaths")
        : () => kind
    const first = shown[0]
    const rest = shown
      .slice(1)
      .map((i) => `${n(i.value)} in ${i.region}`)
      .join(", ")
    parts.push(
      `${n(first.value)} ${label(first.value)} in ${first.region}${rest ? `, ${rest}` : ""}${list.length > max ? ` and ${list.length - max} more places` : ""}`
    )
  }
  return parts.join("; ")
}

export function describeFlood(e: {
  from: string | null
  to: string | null
  alert: string | null
  impacts: Impact[]
}) {
  const when = dateRange(e.from, e.to)
  const parts = [
    [
      when && `Flooding ${when}`,
      e.alert && `GDACS ${e.alert.toLowerCase()} alert`,
    ]
      .filter(Boolean)
      .join(", "),
  ]
  if (e.impacts.length) parts.push(`Reported: ${impactSentence(e.impacts)}`)
  return parts.filter(Boolean).join(". ") + "."
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

export function describeQuake(p: {
  mag: number
  magType?: string | null
  place: string | null
  depth: number | null
  felt?: number | null
  cdi?: number | null
  alert?: string | null
  tsunami?: number | null
}) {
  const depth =
    p.depth == null
      ? null
      : `${Math.round(p.depth)} km deep (${p.depth < 70 ? "shallow" : p.depth < 300 ? "intermediate" : "deep"})`
  const lines = [
    [
      `Magnitude ${p.mag.toFixed(1)}${p.magType ? ` (${p.magType})` : ""}`,
      depth,
      p.place,
    ]
      .filter(Boolean)
      .join(", ") + ".",
  ]
  if (p.felt)
    lines.push(
      `Felt by ${n(p.felt)} ${p.felt === 1 ? "person" : "people"} who reported to USGS${
        p.cdi
          ? `, strongest shaking intensity ${ROMAN[Math.round(p.cdi) - 1] ?? Math.round(p.cdi)}`
          : ""
      }.`
    )
  if (p.alert) lines.push(`USGS PAGER impact alert: ${p.alert}.`)
  if (p.tsunami)
    lines.push("Flagged for tsunami potential (not a confirmed tsunami).")
  return lines.join(" ")
}
