"use client"

import * as React from "react"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PrinterIcon,
} from "lucide-react"

import { Loading } from "@/components/area/ui"
import {
  toHtml,
  toMarkdown,
  type ReportDoc,
} from "@/components/area/report-doc"
import { Button } from "@/components/ui/button"
import { DATA_PORTALS } from "@/lib/apps"
import { type Bbox, type HistoryEvent, precisionOf } from "@/lib/area"

export function Report({
  loading,
  doc,
  fileName,
  events,
  bbox,
}: {
  loading: boolean
  doc: ReportDoc
  fileName: string
  events: HistoryEvent[]
  bbox?: Bbox | null
}) {
  const [copied, setCopied] = React.useState(false)
  if (loading) return <Loading>Putting the report together…</Loading>

  async function copy() {
    try {
      await navigator.clipboard.writeText(toMarkdown(doc))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked.
    }
  }

  const buttons: [string, React.ReactNode, () => void, boolean?][] = [
    [copied ? "Copied" : "Copy", copied ? <CheckIcon /> : <CopyIcon />, copy],
    ["Print / PDF", <PrinterIcon key="p" />, () => print(toHtml(doc))],
    [
      "Markdown",
      <DownloadIcon key="m" />,
      () => download(`${fileName}.md`, toMarkdown(doc), "text/markdown"),
    ],
    [
      "CSV",
      <DownloadIcon key="c" />,
      () => download(`${fileName}.csv`, toCsv(events), "text/csv"),
      !events.length,
    ],
    [
      "GeoJSON",
      <DownloadIcon key="g" />,
      () =>
        download(
          `${fileName}.geojson`,
          toGeoJson(events),
          "application/geo+json"
        ),
      !events.length,
    ],
  ]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap gap-1.5">
        {buttons.map(([label, icon, onClick, disabled]) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            className="h-8"
            disabled={disabled}
            onClick={onClick}
          >
            {icon}
            {label}
          </Button>
        ))}
      </div>
      <ReportView doc={doc} />
      <DataSources bbox={bbox ?? null} />
    </div>
  )
}

/** The report, formatted in the panel. */
function ReportView({ doc }: { doc: ReportDoc }) {
  return (
    <article className="grid gap-4 rounded-xl border p-3 text-xs leading-relaxed">
      <header>
        <h3 className="text-base leading-snug font-semibold">{doc.title}</h3>
        <p className="text-muted-foreground">{doc.subtitle}</p>
        <p className="text-[11px] text-muted-foreground">
          Generated {doc.generated}
        </p>
      </header>
      {doc.sections.map((s) => (
        <section key={s.heading} className="grid gap-2">
          <h4 className="text-[11px] font-semibold tracking-wider text-orange-700 uppercase dark:text-orange-400">
            {s.heading}
          </h4>
          {s.blocks.map((b, i) =>
            b.kind === "p" ? (
              <p key={i}>{b.text}</p>
            ) : b.kind === "list" ? (
              <ul key={i} className="grid list-disc gap-1 pl-4">
                {b.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : b.kind === "table" ? (
              <div key={i} className="overflow-x-auto">
                <table className="w-full">
                  {b.head.length > 0 && (
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        {b.head.map((h) => (
                          <th key={h} className="pr-2 pb-1 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody className="divide-y">
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td
                            key={k}
                            className={
                              b.head.length
                                ? "py-1 pr-2 align-top"
                                : k === 0
                                  ? "w-1/3 py-1 pr-2 align-top text-muted-foreground"
                                  : "py-1 align-top break-words"
                            }
                          >
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ol key={i} className="grid gap-2.5">
                {b.items.map((e, j) => (
                  <li
                    key={j}
                    className="grid gap-0.5 border-b pb-2.5 last:border-0"
                  >
                    <p className="font-medium">{e.heading}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {e.meta}
                    </p>
                    {e.body && <p>{e.body}</p>}
                    {e.link && (
                      <a
                        href={e.link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLinkIcon className="size-3" />
                        Source
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            )
          )}
        </section>
      ))}
    </article>
  )
}

/** Print through a hidden frame (no pop-up to block). */
function print(html: string) {
  const frame = document.createElement("iframe")
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0"
  frame.srcdoc = html
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.append(frame)
}

/** Where to get the full NISAR data for this area. */
function DataSources({ bbox }: { bbox: Bbox | null }) {
  const asf = bbox
    ? `https://search.asf.alaska.edu/#/?dataset=NISAR&polygon=${encodeURIComponent(
        `POLYGON((${bbox[0].toFixed(3)} ${bbox[1].toFixed(3)},${bbox[2].toFixed(3)} ${bbox[1].toFixed(3)},${bbox[2].toFixed(3)} ${bbox[3].toFixed(3)},${bbox[0].toFixed(3)} ${bbox[3].toFixed(3)},${bbox[0].toFixed(3)} ${bbox[1].toFixed(3)}))`
      )}`
    : null
  return (
    <div className="grid gap-2 rounded-xl border p-3">
      <p className="text-xs font-semibold">Get the full data</p>
      <ul className="grid gap-1.5 text-xs">
        {asf && (
          <li>
            <a
              href={asf}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-medium text-orange-700 hover:underline dark:text-orange-400"
            >
              <ExternalLinkIcon className="size-3.5" />
              NISAR products over this area (ASF Vertex)
            </a>
          </li>
        )}
        {DATA_PORTALS.map((p) => (
          <li key={p.url}>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-medium hover:underline"
            >
              <ExternalLinkIcon className="size-3.5" />
              {p.name}
            </a>
            <p className="pl-5 text-[11px] text-muted-foreground">{p.note}</p>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        NISAR L-band is collected globally; S-band mostly over India and
        selected science targets. Rates in mm/year and flood maps at full
        resolution need these full products processed.
      </p>
    </div>
  )
}

function toCsv(events: HistoryEvent[]) {
  const esc = (v: string | number | null) =>
    v == null ? "" : `"${String(v).replace(/"/g, '""')}"`
  const rows = events.map((e) =>
    [
      e.type,
      e.title,
      e.date,
      e.latitude,
      e.longitude,
      e.offshore ? "offshore" : "onshore",
      precisionOf(e).label,
      e.source,
      e.url,
      e.description ?? e.detail,
    ]
      .map(esc)
      .join(",")
  )
  return [
    "type,title,date,latitude,longitude,where,precision,source,url,description",
    ...rows,
  ].join("\n")
}

function toGeoJson(events: HistoryEvent[]) {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: events.map((e) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.longitude, e.latitude] },
        properties: {
          type: e.type,
          title: e.title,
          date: e.date,
          offshore: !!e.offshore,
          precision: precisionOf(e).label,
          description: e.description ?? e.detail,
          source: e.source,
          url: e.url,
        },
      })),
    },
    null,
    2
  )
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-")
