import type { AreaData } from "@/hooks/use-area"
import { appById, inFilter, type HazardFilter } from "@/lib/apps"
import {
  formatEventDate,
  HAZARD_LABEL,
  inPeriod,
  PERIODS,
  precisionOf,
  type Period,
  type HazardType,
  type HistoryEvent,
  type Impact,
  type Warning,
} from "@/lib/area"
import { DATA_CAVEATS, DATA_GROUPS } from "@/lib/data-sources"
import type { Place } from "@/lib/geo"
import { formatRange } from "@/lib/sar"

/**
 * Reports as plain data, so the same content can be shown in the panel,
 * copied or saved as Markdown, and printed (or saved as PDF).
 */

type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | {
      kind: "events"
      items: {
        heading: string
        meta: string
        body: string | null
        link: string | null
      }[]
    }

type ReportSection = { heading: string; blocks: Block[] }

export type ReportDoc = {
  title: string
  subtitle: string
  generated: string
  sections: ReportSection[]
}

/** Earthquake magnitude from its title ("M5.2 earthquake near …"), else 0. */
export const magnitude = (e: HistoryEvent) =>
  Number(e.title.match(/\bM(\d+(?:\.\d+)?)/)?.[1] ?? 0)

const num = (v: number) => v.toLocaleString("en-GB")
const plural = (n: number, word: string) =>
  `${num(n)} ${word}${n === 1 ? "" : "s"}`

const now = () =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date()) + " (Malaysia time)"

function mix(events: HistoryEvent[]) {
  const counts = new Map<HazardType, number>()
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => plural(n, HAZARD_LABEL[t].toLowerCase()))
    .join(", ")
}

function radarLines(radar: AreaData["radar"]) {
  const m = radar.data?.movement
  const s = radar.data?.signal
  const lines: string[] = []
  if (m?.cycles[0]) {
    lines.push(
      `Ground movement: ${plural(m.cycles.length, "12-day cycle")} recorded; latest pair ${formatRange(m.cycles[0].start, m.cycles[0].end)}${m.cycles[0].provisional ? " (provisional)" : ""}; first ${formatEventDate(m.cycles.at(-1)!.start)}.`
    )
  }
  if (s?.cycles[0]) {
    lines.push(
      `Radar brightness (land cover, water): latest pass ${formatRange(s.cycles[0].start, s.cycles[0].end)}.`
    )
  }
  if (!lines.length) lines.push("No NISAR passes over this area yet.")
  return lines
}

const where = (e: HistoryEvent) =>
  e.scope === "state"
    ? "state-wide"
    : e.latitude === 0 && e.longitude === 0
      ? "location not given"
      : `${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}`

function eventItem(e: HistoryEvent) {
  return {
    heading: `${formatEventDate(e.date)}: ${e.title}`,
    meta: [
      HAZARD_LABEL[e.type],
      precisionOf(e).label,
      e.offshore && "offshore",
      where(e),
      e.source,
    ]
      .filter(Boolean)
      .join(" · "),
    body:
      [e.description, e.detail && e.detail !== e.description ? e.detail : null]
        .filter(Boolean)
        .join(" ") || null,
    link: e.url,
  }
}

function warningItems(warnings: Warning[]) {
  return warnings.map(
    (w) =>
      `${w.title}${w.validTo ? ` (until ${formatEventDate(w.validTo.slice(0, 10))})` : ""}: ${w.text}`
  )
}

function centreTable(centres: HistoryEvent[]): Block {
  return {
    kind: "table",
    head: ["Relief centre", "Hazard", "Evacuees", "Where"],
    rows: centres.map((c) => [
      c.title.replace(/^.*?relief centre: /, ""),
      HAZARD_LABEL[c.type],
      num(c.impacts?.find((i) => i.kind === "evacuees")?.value ?? 0),
      c.detail?.split(" · ").at(-1) ?? "",
    ]),
  }
}

function impactTable(impacts: Impact[]): Block {
  return {
    kind: "table",
    head: ["Place", "Impact", "People / houses"],
    rows: impacts.map((i) => [i.region, i.kind, num(i.value)]),
  }
}

function byDecade(events: HistoryEvent[]): Block | null {
  const dated = events.filter((e) => e.date)
  if (dated.length < 3) return null
  const cols: (HazardType | "other")[] = [
    "flood",
    "earthquake",
    "landslide",
    "other",
  ]
  const rows = new Map<string, number[]>()
  for (const e of dated) {
    const decade = `${e.date!.slice(0, 3)}0s`
    const row = rows.get(decade) ?? [0, 0, 0, 0]
    const c = cols.indexOf(e.type)
    row[c === -1 ? 3 : c]++
    rows.set(decade, row)
  }
  return {
    kind: "table",
    head: ["Decade", "Floods", "Earthquakes", "Landslides", "Other", "Total"],
    rows: [...rows]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([d, r]) => [
        d,
        ...r.map(String),
        String(r.reduce((a, b) => a + b, 0)),
      ]),
  }
}

const sourcesSection = (): ReportSection => ({
  heading: "Data sources and limits",
  blocks: [
    {
      kind: "list",
      items: DATA_GROUPS.flatMap((g) =>
        g.sources.map((s) => `${s.name} (${s.by}): ${s.gives}. ${s.coverage}.`)
      ),
    },
    { kind: "list", items: DATA_CAVEATS },
  ],
})

export function areaReport({
  place,
  area,
  onshore,
  offshore,
  live,
  analysisLines,
  filter,
  period,
}: {
  place: Place
  area: AreaData
  onshore: HistoryEvent[]
  offshore: HistoryEvent[]
  live: HistoryEvent[]
  analysisLines: string[]
  /** Same as the panel: which hazards and how far back. */
  filter: HazardFilter
  period: Period
}): ReportDoc {
  const keep = (e: HistoryEvent) =>
    inFilter(e.type, filter) && inPeriod(e.date, period)
  onshore = onshore.filter(keep)
  offshore = offshore.filter(keep)
  const history = [...onshore, ...offshore]
  const hazards =
    filter === "all" ? "All hazards" : `${appById(filter).label} only`
  const periodLabel = PERIODS.find((p) => p.id === period)!.label
  const scope: ReportSection = {
    heading: "This report covers",
    blocks: [
      {
        kind: "list",
        items: [
          `Place: ${place.name}${place.area ? ` (${place.area})` : ""}, ${
            place.boundaryKey
              ? "inside its official outline (land and state waters)"
              : "the area framed on the map"
          }.`,
          `Hazards: ${hazards}. Period: ${periodLabel.toLowerCase()}${
            period === "all" ? " (records from 1970 onwards)" : ""
          }.`,
          "Happening now: weather warnings and open relief centres at the time this report was made.",
          "Radar: the latest NISAR passes over the area.",
        ],
      },
    ],
  }
  const warnings = area.history.data?.warnings ?? []
  const name = place.name
  const dated = onshore.filter((e) => e.date)
  const since = dated.at(-1)?.date?.slice(0, 4)
  const quakes = history
    .filter((e) => e.type === "earthquake")
    .sort((a, b) => magnitude(b) - magnitude(a))
  const yearAgo = new Date(Date.now() - 365 * 86400_000)
    .toISOString()
    .slice(0, 10)
  const recent = history.filter((e) => (e.date ?? "") >= yearAgo)

  const summary: string[] = []
  summary.push(
    onshore.length
      ? `${plural(onshore.length, "hazard event")} recorded in ${name}${period === "all" && since ? ` since ${since}` : ""} (${periodLabel.toLowerCase()}): ${mix(onshore)}.`
      : `No ${filter === "all" ? "hazard events" : `${appById(filter).label.toLowerCase()} events`} recorded in ${name} for ${periodLabel.toLowerCase()} in these sources.`
  )
  if (offshore.length)
    summary.push(
      `${plural(offshore.length, "more event")} offshore, in state waters (${mix(offshore)}).`
    )
  const facts: string[] = []
  if (onshore[0])
    facts.push(
      `Most recent: ${onshore[0].title}, ${formatEventDate(onshore[0].date)} (${onshore[0].source}).`
    )
  if (quakes[0])
    facts.push(
      `Strongest earthquake: ${quakes[0].title}, ${formatEventDate(quakes[0].date)}${quakes[0].detail ? `, ${quakes[0].detail}` : ""}.`
    )
  facts.push(
    recent.length
      ? `Last 12 months: ${plural(recent.length, "event")} (${mix(recent)}).`
      : "Last 12 months: no events recorded."
  )
  const reported = history.filter((e) => e.scope === "reported")
  if (reported.length)
    facts.push(
      `${plural(reported.length, "flood")} recorded elsewhere with impacts reported in ${name} (GDACS).`
    )

  const nowBlocks: Block[] = []
  if (warnings.length)
    nowBlocks.push({ kind: "list", items: warningItems(warnings) })
  if (live.length) {
    const people = live
      .flatMap((e) => e.impacts ?? [])
      .reduce((n, i) => n + (i.kind === "evacuees" ? i.value : 0), 0)
    nowBlocks.push({
      kind: "p",
      text: `${plural(live.length, "relief centre")} open, sheltering ${plural(people, "evacuee")} (JKM).`,
    })
    nowBlocks.push(centreTable(live))
  }
  if (!nowBlocks.length)
    nowBlocks.push({
      kind: "p",
      text: "No MetMalaysia warnings in force and no JKM relief centres open.",
    })

  const decades = byDecade(history)
  return {
    title: `Hazard report: ${name}`,
    subtitle: [place.kind, place.area].filter(Boolean).join(" · "),
    generated: now(),
    sections: [
      scope,
      {
        heading: "Summary",
        blocks: [
          ...summary.map((text) => ({ kind: "p" as const, text })),
          { kind: "list", items: facts },
        ],
      },
      { heading: "Happening now", blocks: nowBlocks },
      ...(decades ? [{ heading: "Events by decade", blocks: [decades] }] : []),
      {
        heading: "NISAR satellite radar",
        blocks: [
          {
            kind: "list",
            items: [...radarLines(area.radar), ...analysisLines],
          },
        ],
      },
      {
        heading: `Event log (${history.length})`,
        blocks: history.length
          ? [{ kind: "events", items: history.map(eventItem) }]
          : [{ kind: "p", text: "Nothing recorded." }],
      },
      sourcesSection(),
    ],
  }
}

export function spotReport({
  event,
  areaName,
  spot,
  near,
}: {
  event: HistoryEvent
  areaName: string
  spot: AreaData
  near: HistoryEvent[]
}): ReportDoc {
  const p = precisionOf(event)
  const rows: string[][] = [
    ["Date", formatEventDate(event.date)],
    ["Type", HAZARD_LABEL[event.type]],
    ["Area", `${event.offshore ? "Offshore, " : ""}${areaName}`],
    ["Location", where(event)],
    ["Location precision", `${p.label}: ${p.hint}`],
    ...(event.detail ? [["Detail", event.detail]] : []),
    ["Source", [event.source, event.url].filter(Boolean).join(" · ")],
  ]
  return {
    title: event.title,
    subtitle: `${HAZARD_LABEL[event.type]} · ${formatEventDate(event.date)} · ${areaName}`,
    generated: now(),
    sections: [
      { heading: "Event", blocks: [{ kind: "table", head: [], rows }] },
      ...(event.description
        ? [
            {
              heading: "What happened",
              blocks: [{ kind: "p" as const, text: event.description }],
            },
          ]
        : []),
      ...(event.impacts?.length && event.source === "GDACS"
        ? [
            {
              heading: "Reported impacts",
              blocks: [impactTable(event.impacts)],
            },
          ]
        : []),
      ...(near.length
        ? [
            {
              heading: "Other records within 15 km",
              blocks: [{ kind: "events" as const, items: near.map(eventItem) }],
            },
          ]
        : []),
      {
        heading: "NISAR satellite radar",
        blocks: [{ kind: "list", items: radarLines(spot.radar) }],
      },
      sourcesSection(),
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Output formats                                                      */
/* ------------------------------------------------------------------ */

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ")

export function toMarkdown(doc: ReportDoc) {
  const out = [
    `# ${doc.title}`,
    "",
    `${doc.subtitle}  `,
    `Generated ${doc.generated}`,
  ]
  for (const s of doc.sections) {
    out.push("", `## ${s.heading}`, "")
    for (const b of s.blocks) {
      if (b.kind === "p") out.push(b.text, "")
      if (b.kind === "list") out.push(...b.items.map((i) => `- ${i}`), "")
      if (b.kind === "table") {
        const head = b.head.length ? b.head : ["", ""]
        out.push(
          `| ${head.map(cell).join(" | ")} |`,
          `| ${head.map(() => "---").join(" | ")} |`,
          ...b.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
          ""
        )
      }
      if (b.kind === "events")
        for (const e of b.items)
          out.push(
            `### ${e.heading}`,
            `*${e.meta}*`,
            "",
            ...(e.body ? [e.body, ""] : []),
            ...(e.link ? [`Source: ${e.link}`, ""] : [])
          )
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n")
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** A standalone page for printing / saving as PDF. */
export function toHtml(doc: ReportDoc) {
  const blocks = (b: Block) => {
    if (b.kind === "p") return `<p>${esc(b.text)}</p>`
    if (b.kind === "list")
      return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
    if (b.kind === "table")
      return `<table>${b.head.length ? `<thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : ""}<tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`
    return b.items
      .map(
        (e) =>
          `<div class="ev"><h3>${esc(e.heading)}</h3><p class="meta">${esc(e.meta)}</p>${e.body ? `<p>${esc(e.body)}</p>` : ""}${e.link ? `<p class="meta">${esc(e.link)}</p>` : ""}</div>`
      )
      .join("")
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
body{font:11pt/1.5 system-ui,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:20pt;margin:0}h2{font-size:13pt;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px;color:#c2410c}
h3{font-size:10.5pt;margin:0}.sub,.meta{color:#666;font-size:9pt;margin:2px 0}
table{border-collapse:collapse;width:100%;font-size:9.5pt}td,th{border-bottom:1px solid #eee;padding:3px 6px;text-align:left;vertical-align:top}
ul{padding-left:18px}.ev{padding:6px 0;border-bottom:1px solid #f1f1f1;break-inside:avoid}
</style></head><body><h1>${esc(doc.title)}</h1><p class="sub">${esc(doc.subtitle)}</p><p class="sub">Generated ${esc(doc.generated)}</p>${doc.sections
    .map((s) => `<h2>${esc(s.heading)}</h2>${s.blocks.map(blocks).join("")}`)
    .join("")}</body></html>`
}
