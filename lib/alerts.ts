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
}

export type Alert = {
  id: string
  kind: "warning" | "centres" | "event"
  title: string
  detail: string
  /** The event to open, when there is one. */
  eventId?: string
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

/** New alerts since `prev` (none the first time: that's the baseline). */
export function newAlerts(
  prev: Snapshot | null,
  history: AreaHistory
): Alert[] {
  if (!prev) return []
  const alerts: Alert[] = []
  const seenWarnings = new Set(prev.warnings)
  for (const w of history.warnings) {
    if (seenWarnings.has(w.id)) continue
    alerts.push({
      id: w.id,
      kind: "warning",
      title: `${w.title}${until(w)}`,
      detail: w.text.slice(0, 280),
    })
  }
  const live = history.events.filter((e) => e.live)
  if (live.length > prev.centres) {
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
