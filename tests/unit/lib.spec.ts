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

test("measurements skip a newest cycle that only clips the area", async () => {
  const { coverGranules, latestUsable } = await import("@/lib/measure-plan")
  const pass = (
    id: string,
    frame: number,
    bbox: [number, number, number, number]
  ) => ({
    id,
    layer: "signal" as const,
    start: "2026-10-01T00:00:00Z",
    end: "2026-10-01T00:00:00Z",
    direction: "Ascending" as const,
    track: 1,
    provisional: false,
    frame,
    footprint: [],
    bbox,
  })
  const cycle = (n: number, passes: ReturnType<typeof pass>[]) => ({
    cycle: n,
    direction: "Ascending" as const,
    start: "2026-10-01T00:00:00Z",
    end: "2026-10-01T00:00:00Z",
    provisional: false,
    passes,
  })
  const area: [number, number, number, number] = [101, 4, 103, 6]
  const cycles = [
    cycle(34, [pass("sliver", 9, [102.9, 3, 105, 7])]),
    cycle(33, [pass("full-33", 4, [100, 3, 104, 7])]),
    cycle(32, [pass("full-32", 4, [100, 3, 104, 7])]),
  ]
  expect(latestUsable(cycles, area)).toBe(1)
  const { before, after } = coverGranules(cycles, area, "previous")
  expect(after.map((p) => p.id)).toEqual(["full-33"])
  expect(before.map((p) => p.id)).toEqual(["full-32"])
})

test("likely-why notes follow the radar evidence", async () => {
  const { coverDrivers, movementDrivers } = await import("@/lib/drivers")
  const day = (date: string, water: number, vegetation: number) => ({
    date,
    water,
    vegetation,
    open: 100,
    built: 20,
    rvi: 0.5,
  })
  const base = {
    a: day("2026-11-01", 10, 500),
    b: day("2026-11-13", 40, 470),
    newWater: 30,
    receded: 0,
    vegLost: 0,
    vegGained: 0,
    measured: 620,
    pol: {
      a: { hh: -8, hv: -15 },
      b: { hh: -9, hv: -15 },
      vegHH: 3,
      vegHV: 0.4,
      openHH: 0,
      openHV: 0,
      vegPixels: 5000,
      openPixels: 3000,
    },
  }
  const kelantan: [number, number, number, number] = [101.5, 4.7, 102.5, 6.2]
  const ids = coverDrivers(base, kelantan).map((d) => d.id)
  expect(ids).toContain("flood")
  expect(ids).toContain("under-canopy")
  expect(coverDrivers(base, kelantan)[0].cause).toMatch(/monsoon/)
  // Nothing changed: no notes.
  const calm = { ...base, newWater: 0, pol: { ...base.pol, vegHH: 0.2 } }
  expect(coverDrivers(calm, kelantan)).toEqual([])
  // Sinking ground.
  const sinking = movementDrivers(
    { p5: -30, p95: 4, moving: 0.12, threshold: 10 },
    "mm/yr",
    kelantan
  )
  expect(sinking.map((d) => d.id)).toEqual(["subsidence"])
  // Movement inside its own uncertainty isn't called sinking.
  const noisy = movementDrivers(
    { p5: -28, p95: 23, moving: 0.19, threshold: 20 },
    "mm",
    kelantan,
    35
  )
  expect(noisy.map((d) => d.id)).toEqual(["unclear"])
})

test("radar notices: baseline first, then only real changes, marked unconfirmed", async () => {
  const { radarUpdate } = await import("@/lib/radar-notices")
  const box: [number, number, number, number] = [100, 5, 101, 6]
  const day = (date: string) => ({
    date,
    water: 30,
    vegetation: 5000,
    open: 300,
    built: 400,
    rvi: 0.88,
  })
  const cover = {
    a: day("2026-10-02"),
    b: day("2026-10-14"),
    newWater: 0.5,
    receded: 0,
    vegLost: 40,
    vegGained: 0,
    measured: 5800,
  }
  // First check: baseline only.
  const first = radarUpdate(
    undefined,
    { cover: { cycle: 33, result: cover } },
    box
  )
  expect(first.alerts).toEqual([])
  expect(first.state.cover).toBe(33)
  // A new cycle with 40 km² cleared (> 0.5% of 5,800 km²).
  const next = radarUpdate(
    { cover: 32 },
    {
      cover: { cycle: 33, result: cover, fires: { count: 0, source: "FIRMS" } },
    },
    box
  )
  expect(next.alerts.map((a) => a.title)).toEqual([
    "Vegetation cleared: 40.0 km²",
  ])
  expect(next.alerts[0].detail).toMatch(/Unconfirmed/)
  // With fire hotspots: a burn scar.
  const burnt = radarUpdate(
    { cover: 32 },
    {
      cover: {
        cycle: 33,
        result: cover,
        fires: { count: 12, source: "FIRMS" },
      },
    },
    box
  )
  expect(burnt.alerts[0].title).toMatch(/burn scar/)
  // Small changes in a big state: nothing to tell.
  const small = radarUpdate(
    { cover: 32 },
    { cover: { cycle: 33, result: { ...cover, vegLost: 20 } } },
    box
  )
  expect(small.alerts).toEqual([])
  // A failed measurement is retried (state unchanged).
  const failed = radarUpdate(
    { cover: 32 },
    { cover: { cycle: 33, result: null } },
    box
  )
  expect(failed.state.cover).toBe(32)
  // Movement inside its uncertainty: no notice.
  const trend = {
    available: true,
    to: "2026-10-10",
    pairs: 7,
    uncertainty: 35,
    total: { p5: -28, p95: 23, moving: 0.19, threshold: 20 },
  }
  expect(
    radarUpdate({ trend: 31 }, { trend: { cycle: 32, result: trend } }, box)
      .alerts
  ).toEqual([])
  const moving = radarUpdate(
    { trend: 31 },
    { trend: { cycle: 32, result: { ...trend, uncertainty: 5 } } },
    box
  )
  expect(moving.alerts[0].title).toMatch(/^Ground moving/)
})
