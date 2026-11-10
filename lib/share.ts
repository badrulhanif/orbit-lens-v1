import { PERIODS, type Bbox, type Period } from "@/lib/area"
import { APPS, type HazardFilter } from "@/lib/apps"
import type { Place } from "@/lib/geo"

/**
 * Shareable links: the open place, hazard filter, period and selected event
 * live in the page URL, e.g.
 *   /?name=Selangor&area=Malaysia&kind=State&at=3.35,101.5
 *     &bbox=100.8,2.55,102,3.95&b=state|Selangor|Malaysia&f=flood&t=5y&e=usgs-…
 */

type ViewState = {
  place: Place
  filter: HazardFilter
  period: Period
  event: string | null
}

const round = (v: number) => Math.round(v * 1e4) / 1e4

export function toSearch(view: ViewState | null) {
  if (!view) return ""
  const { place: p } = view
  const q = new URLSearchParams({
    name: p.name,
    at: `${round(p.latitude)},${round(p.longitude)}`,
  })
  if (p.area) q.set("area", p.area)
  if (p.kind) q.set("kind", p.kind)
  if (p.bbox) q.set("bbox", p.bbox.map(round).join(","))
  if (p.boundaryKey) q.set("b", p.boundaryKey)
  if (p.zoom) q.set("z", String(p.zoom))
  if (view.filter !== "all") q.set("f", view.filter)
  if (view.period !== "all") q.set("t", view.period)
  if (view.event) q.set("e", view.event)
  return `?${q}`
}

export function fromSearch(search: string): ViewState | null {
  const q = new URLSearchParams(search)
  const name = q.get("name")?.slice(0, 200)
  const at = q.get("at")?.split(",").map(Number)
  if (!name || !at || at.length !== 2 || !at.every(Number.isFinite)) return null
  const [latitude, longitude] = at
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  const box = q.get("bbox")?.split(",").map(Number)
  const bbox =
    box?.length === 4 &&
    box.every(Number.isFinite) &&
    box[0] < box[2] &&
    box[1] < box[3]
      ? (box as Bbox)
      : null
  const zoom = Number(q.get("z"))
  const f = q.get("f")
  const t = q.get("t")
  return {
    place: {
      id: `link-${name}-${latitude},${longitude}`,
      name,
      kind: q.get("kind")?.slice(0, 60) ?? "Place",
      icon: bbox ? "area" : "pin",
      area: q.get("area")?.slice(0, 200) ?? "",
      address: "",
      latitude,
      longitude,
      bbox,
      ...(q.get("b") ? { boundaryKey: q.get("b")!.slice(0, 200) } : {}),
      ...(zoom > 0 ? { zoom } : {}),
    },
    filter: APPS.some((a) => a.id === f) ? (f as HazardFilter) : "all",
    period: PERIODS.some((p) => p.id === t) ? (t as Period) : "all",
    event: q.get("e")?.slice(0, 200) ?? null,
  }
}
