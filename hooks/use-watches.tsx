"use client"

import * as React from "react"

import {
  cleanTopics,
  newAlerts,
  snapshotOf,
  type Alert,
  type RadarState,
  type Snapshot,
  type Topic,
} from "@/lib/alerts"
import { areaBoxFor, areaQuery, type AreaHistory } from "@/lib/area"
import type { Place } from "@/lib/geo"
import { fromSearch, toSearch } from "@/lib/share"

/**
 * Watched places and their alerts, kept in this browser (no account): the
 * page checks each watched place every 15 minutes while it's open, and
 * can show a system notification when something new turns up.
 */

type Watched = {
  link: string
  name: string
  snapshot: Snapshot | null
  /** What to alert about (all when missing). */
  topics?: Topic[]
  /** NISAR cycles already compared, and when radar was last checked. */
  radar?: RadarState
  radarAt?: string
}
export type StoredAlert = Alert & {
  link: string
  place: string
  at: string
  read: boolean
}

const WATCHES = "orbit-lens:watches"
const ALERTS = "orbit-lens:alerts"
const MAX_WATCHES = 10
const CHECK_EVERY = 15 * 60_000
// NISAR passes every 12 days; measuring is slow, so check a few times a day.
const RADAR_EVERY = 6 * 60 * 60_000

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode / storage full: watching just won't persist.
  }
}

/** A place's canonical link (place only, no filters). */
export const placeLink = (place: Place) =>
  toSearch({ place, filter: "all", period: "all", event: null })

async function radarOf(link: string, prev: RadarState | undefined) {
  const q = new URLSearchParams({ link })
  if (prev?.cover != null) q.set("cover", String(prev.cover))
  if (prev?.trend != null) q.set("trend", String(prev.trend))
  const res = await fetch(`/api/alerts/radar?${q}`).catch(() => null)
  return res?.ok
    ? ((await res.json().catch(() => null)) as {
        state: RadarState
        alerts: Alert[]
      } | null)
    : null
}

async function historyOf(link: string): Promise<AreaHistory | null> {
  const view = fromSearch(link)
  if (!view) return null
  const res = await fetch(
    `/api/area-history?${areaQuery(areaBoxFor(view.place), view.place.boundaryKey)}`
  ).catch(() => null)
  return res?.ok ? ((await res.json().catch(() => null)) as AreaHistory) : null
}

function useWatchesState() {
  const [watches, setWatches] = React.useState<Watched[]>([])
  const [alerts, setAlerts] = React.useState<StoredAlert[]>([])
  const watchesRef = React.useRef(watches)
  React.useEffect(() => {
    watchesRef.current = watches
  }, [watches])

  // Load what this browser saved (after mount: no storage on the server).
  React.useEffect(() => {
    Promise.resolve().then(() => {
      setWatches(load<Watched[]>(WATCHES, []))
      setAlerts(load<StoredAlert[]>(ALERTS, []))
    })
  }, [])

  const storeWatches = React.useCallback((next: Watched[]) => {
    // Right away, so back-to-back updates build on each other.
    watchesRef.current = next
    setWatches(next)
    save(WATCHES, next)
  }, [])
  const storeAlerts = React.useCallback(
    (update: (prev: StoredAlert[]) => StoredAlert[]) =>
      setAlerts((prev) => {
        const next = update(prev).slice(0, 50)
        save(ALERTS, next)
        return next
      }),
    []
  )

  /** Save new alerts and show system notifications for them. */
  const announce = React.useCallback(
    (found: StoredAlert[]) => {
      if (!found.length) return
      storeAlerts((prev) => {
        const known = new Set(prev.map((a) => `${a.link}|${a.id}`))
        return [
          ...found.filter((a) => !known.has(`${a.link}|${a.id}`)),
          ...prev,
        ]
      })
      // A system notification, if the user turned them on.
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      )
        try {
          for (const a of found.slice(0, 3))
            new Notification(`${a.place}: ${a.title}`, {
              body: a.detail,
              tag: a.id,
            })
        } catch {
          // Android Chrome only notifies from a service worker (the
          // constructor throws); the alerts are still under the bell.
        }
    },
    [storeAlerts]
  )

  // Radar change notices: one place at a time, in the background.
  const radarBusy = React.useRef(false)
  const checkRadar = React.useCallback(async () => {
    if (radarBusy.current) return
    radarBusy.current = true
    try {
      const due = watchesRef.current.filter(
        (w) =>
          cleanTopics(w.topics).includes("radar") &&
          (!w.radarAt || Date.now() - Date.parse(w.radarAt) > RADAR_EVERY)
      )
      for (const w of due) {
        const r = await radarOf(w.link, w.radar)
        if (!r) continue
        const now = new Date().toISOString()
        // Only this watch's radar fields change (others may have moved on).
        storeWatches(
          watchesRef.current.map((x) =>
            x.link === w.link ? { ...x, radar: r.state, radarAt: now } : x
          )
        )
        announce(
          r.alerts.map((a) => ({
            ...a,
            link: w.link,
            place: w.name,
            at: now,
            read: false,
          }))
        )
      }
    } finally {
      radarBusy.current = false
    }
  }, [announce, storeWatches])

  // One check at a time: two at once would compare against the same
  // snapshot and notify about the same news twice.
  const checkBusy = React.useRef(false)
  const check = React.useCallback(async () => {
    const list = watchesRef.current
    if (!list.length || checkBusy.current) return
    checkBusy.current = true
    try {
      const found: StoredAlert[] = []
      const updated: Watched[] = []
      for (const w of list) {
        const history = await historyOf(w.link)
        if (!history) {
          updated.push(w)
          continue
        }
        const now = new Date().toISOString()
        for (const a of newAlerts(w.snapshot, history, cleanTopics(w.topics)))
          found.push({
            ...a,
            link: w.link,
            place: w.name,
            at: now,
            read: false,
          })
        updated.push({ ...w, snapshot: snapshotOf(history) })
      }
      // Keep fields set meanwhile (radar), update the snapshot.
      const snap = new Map(updated.map((w) => [w.link, w.snapshot]))
      storeWatches(
        watchesRef.current.map((w) =>
          snap.has(w.link) ? { ...w, snapshot: snap.get(w.link)! } : w
        )
      )
      announce(found)
    } finally {
      checkBusy.current = false
    }
    void checkRadar()
  }, [announce, checkRadar, storeWatches])

  // Check on load and every 15 minutes while the page is open.
  const count = watches.length
  React.useEffect(() => {
    if (!count) return
    const first = setTimeout(check, 5_000)
    const every = setInterval(check, CHECK_EVERY)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [count, check])

  const isWatching = (place: Place | null) =>
    !!place && watches.some((w) => w.link === placeLink(place))

  /** Start or stop watching; `history` (what's shown now) is the baseline. */
  function toggle(place: Place, history: AreaHistory | null) {
    const link = placeLink(place)
    if (watches.some((w) => w.link === link))
      return storeWatches(watches.filter((w) => w.link !== link))
    if (watches.length >= MAX_WATCHES) return
    storeWatches([
      ...watches,
      {
        link,
        name: place.name,
        snapshot: history ? snapshotOf(history) : null,
      },
    ])
  }

  const watched = (place: Place | null) =>
    place ? watches.find((w) => w.link === placeLink(place)) : undefined

  return {
    watches,
    /** A watched place's topics (all by default). */
    topicsOf: (place: Place) => cleanTopics(watched(place)?.topics),
    setTopics: (place: Place, topics: Topic[]) =>
      storeWatches(
        watches.map((w) =>
          w.link === placeLink(place)
            ? { ...w, topics: cleanTopics(topics) }
            : w
        )
      ),
    alerts,
    unread: alerts.filter((a) => !a.read).length,
    isWatching,
    toggle,
    full: watches.length >= MAX_WATCHES,
    remove: (link: string) =>
      storeWatches(watches.filter((w) => w.link !== link)),
    markRead: () =>
      storeAlerts((prev) => prev.map((a) => ({ ...a, read: true }))),
    clear: () => storeAlerts(() => []),
  }
}

type Watches = ReturnType<typeof useWatchesState>

const WatchesContext = React.createContext<Watches | null>(null)

export function WatchesProvider({ children }: { children: React.ReactNode }) {
  const value = useWatchesState()
  return (
    <WatchesContext.Provider value={value}>{children}</WatchesContext.Provider>
  )
}

export function useWatches() {
  const value = React.useContext(WatchesContext)
  if (!value) throw new Error("useWatches needs a WatchesProvider")
  return value
}
