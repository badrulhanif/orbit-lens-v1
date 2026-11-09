"use client"

import * as React from "react"
import { CloudRainIcon } from "lucide-react"

import { EventSection } from "@/components/area/events"
import type { HistoryEvent, Warning } from "@/lib/area"
import { cn } from "@/lib/utils"

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(`${iso.replace(" ", "T")}+08:00`))

/** Total evacuees across open relief centres. */
function evacuees(centres: HistoryEvent[]) {
  return centres
    .flatMap((e) => e.impacts ?? [])
    .filter((i) => i.kind === "evacuees")
    .reduce((n, i) => n + i.value, 0)
}

/**
 * MetMalaysia warnings and JKM relief centres open right now, above the
 * history. Says so plainly when there's nothing.
 */
export function HappeningNow({
  name,
  warnings,
  centres,
  checked,
  onSelect,
}: {
  name: string
  warnings: Warning[]
  centres: HistoryEvent[]
  /** Whether the live sources answered. */
  checked: boolean
  onSelect: (id: string) => void
}) {
  if (!warnings.length && !centres.length) {
    if (!checked) return null
    return (
      <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
        No weather warnings or open relief centres for {name} right now.
      </p>
    )
  }
  const people = evacuees(centres)
  return (
    <section className="grid gap-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
        Happening now
      </h3>
      {warnings.map((w) => (
        <WarningCard key={w.id} warning={w} />
      ))}
      {centres.length > 0 && (
        <EventSection
          title={`Relief centres open · ${people.toLocaleString("en-GB")} evacuees`}
          events={centres}
          onSelect={onSelect}
        />
      )}
    </section>
  )
}

function WarningCard({ warning }: { warning: Warning }) {
  const [open, setOpen] = React.useState(false)
  // Levels are written in capitals: "(SEVERE)", "DANGER" (not "dangerous").
  const severe = /\b(SEVERE|DANGER)\b/.test(warning.text)
  const atSea = /\bwaters of\b/i.test(warning.text)
  return (
    <div
      className={cn(
        "grid gap-1 rounded-xl border p-3 text-xs",
        severe
          ? "border-red-500/30 bg-red-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      )}
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <CloudRainIcon
          className={cn(
            "size-4 shrink-0",
            severe ? "text-red-600" : "text-amber-600"
          )}
        />
        {warning.title}
      </p>
      <p className="text-muted-foreground">
        MetMalaysia
        {atSea && " · coastal waters"}
        {warning.validTo && ` · until ${when(warning.validTo)}`}
      </p>
      <p className={cn("leading-relaxed", !open && "line-clamp-3")}>
        {warning.text}
      </p>
      {warning.text.length > 180 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="justify-self-start font-medium text-muted-foreground hover:text-foreground"
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  )
}
