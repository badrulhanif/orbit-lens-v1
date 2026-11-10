import { expect, test } from "@playwright/test"

import { inFilter } from "@/lib/apps"
import {
  formatEventDate,
  inPeriod,
  precisionOf,
  type HistoryEvent,
} from "@/lib/area"
import { mergePlaces, type Place } from "@/lib/geo"
import { fromSearch, toSearch } from "@/lib/share"

const event = (over: Partial<HistoryEvent>): HistoryEvent => ({
  id: "e",
  type: "flood",
  title: "Flood",
  date: "2025-11-27",
  detail: null,
  source: "GDACS",
  url: null,
  latitude: 3,
  longitude: 101,
  ...over,
})

test("each hazard chip filters to its own hazard only", () => {
  expect(inFilter("flood", "flood")).toBe(true)
  expect(inFilter("storm", "flood")).toBe(false)
  expect(inFilter("flood", "agriculture")).toBe(false)
  expect(inFilter("earthquake", "earthquake")).toBe(true)
  expect(inFilter("landslide", "all")).toBe(true)
})

test("period filter keeps recent dates and drops undated ones", () => {
  const recent = new Date(Date.now() - 30 * 86400_000)
    .toISOString()
    .slice(0, 10)
  expect(inPeriod(recent, "1y")).toBe(true)
  expect(inPeriod("2008-12-06", "5y")).toBe(false)
  expect(inPeriod("2008-12-06", "all")).toBe(true)
  expect(inPeriod(null, "10y")).toBe(false)
})

test("dates show only what's known", () => {
  expect(formatEventDate("2021-12")).toBe("Dec 2021")
  expect(formatEventDate("2021-12-16")).toBe("16 Dec 2021")
  expect(formatEventDate(null)).toBe("Date unknown")
})

test("location precision labels", () => {
  expect(precisionOf(event({ source: "USGS", type: "earthquake" })).label).toBe(
    "Epicentre"
  )
  expect(precisionOf(event({ scope: "state" })).label).toBe("State-wide")
  expect(precisionOf(event({ scope: "reported" })).label).toBe("Reported here")
  expect(precisionOf(event({ source: "JKM" })).label).toBe("Relief centre")
})

test("search results: strong matches first, near-duplicates dropped", () => {
  const p = (name: string, lat = 3): Place => ({
    id: name + lat,
    name,
    kind: "Town",
    icon: "area",
    area: "",
    address: "",
    latitude: lat,
    longitude: 101,
    bbox: null,
  })
  const merged = mergePlaces(
    [p("Bangi")],
    [p("Bangi"), p("Bangi Mall")],
    [p("Bandar Baru Bangi")]
  )
  expect(merged.map((m) => m.name)).toEqual([
    "Bangi",
    "Bangi Mall",
    "Bandar Baru Bangi",
  ])
})

test("shareable links round-trip the view", () => {
  const view = {
    place: {
      id: "x",
      name: "Selangor",
      kind: "State",
      icon: "area" as const,
      area: "Malaysia",
      address: "",
      latitude: 3.35,
      longitude: 101.5,
      bbox: [100.8, 2.55, 102, 3.95] as [number, number, number, number],
      boundaryKey: "state|Selangor|Malaysia",
    },
    filter: "flood" as const,
    period: "5y" as const,
    event: "usgs-abc",
  }
  const back = fromSearch(toSearch(view))!
  expect(back.place.name).toBe("Selangor")
  expect(back.place.bbox).toEqual(view.place.bbox)
  expect(back.place.boundaryKey).toBe(view.place.boundaryKey)
  expect(back.filter).toBe("flood")
  expect(back.period).toBe("5y")
  expect(back.event).toBe("usgs-abc")
  expect(fromSearch("?name=x&at=999,1")).toBeNull()
  expect(fromSearch("?f=flood")).toBeNull()
})

test("alerts: nothing the first time, then only what's new", async () => {
  const { newAlerts, snapshotOf } = await import("@/lib/alerts")
  const recent = new Date().toISOString().slice(0, 10)
  const base = {
    bbox: [0, 0, 1, 1] as [number, number, number, number],
    searched: [0, 0, 1, 1] as [number, number, number, number],
    sources: [],
    warnings: [],
    events: [event({ id: "old", date: "2001-01-01" })],
  }
  expect(newAlerts(null, base)).toEqual([])
  const snap = snapshotOf(base)
  const later = {
    ...base,
    warnings: [
      {
        id: "w1",
        title: "Thunderstorms",
        issued: "",
        validFrom: null,
        validTo: null,
        text: "Selangor",
      },
    ],
    events: [...base.events, event({ id: "new", date: recent })],
  }
  const alerts = newAlerts(snap, later)
  expect(alerts.map((a) => a.kind).sort()).toEqual(["event", "warning"])
  expect(newAlerts(snapshotOf(later), later)).toEqual([])
})

test("short periods: last 7 and 30 days", () => {
  const day = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
  expect(inPeriod(day(3), "7d")).toBe(true)
  expect(inPeriod(day(10), "7d")).toBe(false)
  expect(inPeriod(day(10), "30d")).toBe(true)
  expect(inPeriod(day(40), "30d")).toBe(false)
})

test("alerts only cover the topics picked", async () => {
  const { newAlerts, snapshotOf } = await import("@/lib/alerts")
  const today = new Date().toISOString().slice(0, 10)
  const base = {
    bbox: [0, 0, 1, 1] as [number, number, number, number],
    searched: [0, 0, 1, 1] as [number, number, number, number],
    sources: [],
    warnings: [],
    events: [],
  }
  const later = {
    ...base,
    warnings: [
      {
        id: "w",
        title: "Rain",
        issued: "",
        validFrom: null,
        validTo: null,
        text: "",
      },
    ],
    events: [
      event({ id: "f", type: "flood", date: today }),
      event({ id: "q", type: "earthquake", source: "USGS", date: today }),
    ],
  }
  const kinds = (topics: Parameters<typeof newAlerts>[2]) =>
    newAlerts(snapshotOf(base), later, topics)
      .map((a) => a.id)
      .sort()
  expect(kinds(["flood"])).toEqual(["f"])
  expect(kinds(["earthquake", "warnings"])).toEqual(["q", "w"])
  expect(kinds(undefined)).toEqual(["f", "q", "w"])
})
