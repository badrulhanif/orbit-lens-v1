import type { AreaHistory, HistoryEvent, Warning } from "@/lib/area"
import { formatEventDate, HAZARD_LABEL } from "@/lib/area"

/**
 * Alerts for a watched place: what's new since the last check. Used by the
 * in-app notifications (browser) and the email alerts (server).
 */

/** What was already seen at a place. */
export type Snapshot = {
  events: string[]
  warnings: string[]
  centres: number
  checkedAt: string
  /** The last NISAR cycles checked for radar change notices. */
  radar?: RadarState
}

/** NISAR cycle numbers already compared (land cover, movement trend). */
export type RadarState = { cover?: number; trend?: number }

export type Alert = {
  id: string
  kind: "warning" | "centres" | "event" | "radar"
  title: string
  detail: string
  /** The event to open, when there is one. */
  eventId?: string
}

/** What a watcher wants to hear about (all of them by default). */
export const TOPICS = [
  { id: "warnings", label: "Weather warnings" },
  { id: "centres", label: "Relief centres opening" },
  { id: "flood", label: "Floods" },
  { id: "landslide", label: "Landslides" },
  { id: "earthquake", label: "Earthquakes" },
  { id: "other", label: "Storms and other" },
  { id: "radar", label: "Radar changes (NISAR, every 12 days)" },
] as const
export type Topic = (typeof TOPICS)[number]["id"]
const ALL_TOPICS: Topic[] = TOPICS.map((t) => t.id)

/** Which topic an event belongs to. */
const topicOf = (e: HistoryEvent): Topic =>
  e.type === "flood" || e.type === "landslide"
    ? e.type
    : e.type === "earthquake" || e.type === "tsunami" || e.type === "volcano"
      ? "earthquake"
      : "other"

/** Keep only known topics (from links or stored data). */
export const cleanTopics = (v: unknown): Topic[] => {
  const list = Array.isArray(v)
    ? v.filter((t): t is Topic => ALL_TOPICS.includes(t as Topic))
    : []
  return list.length ? list : ALL_TOPICS
}

/** Only recent records count as news (older ones are history). */
const RECENT_DAYS = 60

export function snapshotOf(history: AreaHistory): Snapshot {
  return {
    events: history.events.filter((e) => !e.live).map((e) => e.id),
    warnings: history.warnings.map((w) => w.id),
    centres: history.events.filter((e) => e.live).length,
    checkedAt: new Date().toISOString(),
  }
}

const evacuees = (events: HistoryEvent[]) =>
  events
    .flatMap((e) => e.impacts ?? [])
    .filter((i) => i.kind === "evacuees")
    .reduce((n, i) => n + i.value, 0)

const until = (w: Warning) =>
  w.validTo ? ` until ${formatEventDate(w.validTo.slice(0, 10))}` : ""

/** New alerts since `prev` (none the first time: that's the baseline),
 * on the chosen topics. */
export function newAlerts(
  prev: Snapshot | null,
  history: AreaHistory,
  topics: Topic[] = ALL_TOPICS
): Alert[] {
  if (!prev) return []
  const wants = new Set(topics)
  const alerts: Alert[] = []
  const seenWarnings = new Set(prev.warnings)
  for (const w of history.warnings) {
    if (!wants.has("warnings") || seenWarnings.has(w.id)) continue
    alerts.push({
      id: w.id,
      kind: "warning",
      title: `${w.title}${until(w)}`,
      detail: w.text.slice(0, 280),
    })
  }
  const live = history.events.filter((e) => e.live)
  if (wants.has("centres") && live.length > prev.centres) {
    const people = evacuees(live)
    alerts.push({
      id: `centres-${live.length}-${new Date().toISOString().slice(0, 10)}`,
      kind: "centres",
      title: `${live.length} relief ${live.length === 1 ? "centre" : "centres"} open`,
      detail: `${people.toLocaleString("en-GB")} evacuees (JKM). Up from ${prev.centres}.`,
    })
  }
  const seen = new Set(prev.events)
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)
  for (const e of history.events) {
    if (e.live || seen.has(e.id) || (e.date ?? "") < cutoff) continue
    if (!wants.has(topicOf(e))) continue
    alerts.push({
      id: e.id,
      kind: "event",
      title: `${HAZARD_LABEL[e.type]}: ${e.title}`,
      detail: [formatEventDate(e.date), e.detail ?? e.source]
        .filter(Boolean)
        .join(" · "),
      eventId: e.id,
    })
  }
  return alerts
}
