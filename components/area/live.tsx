"use client"

import { CheckIcon, CloudRainIcon, TentIcon, UsersIcon } from "lucide-react"

import { Tip } from "@/components/tip"
import type { HistoryEvent, Warning } from "@/lib/area"
import { cn } from "@/lib/utils"

const until = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(`${iso.replace(" ", "T")}+08:00`))

function evacuees(centres: HistoryEvent[]) {
  return centres
    .flatMap((e) => e.impacts ?? [])
    .filter((i) => i.kind === "evacuees")
    .reduce((n, i) => n + i.value, 0)
}

/**
 * One line, like a weather strip: MetMalaysia warnings in force and JKM
 * relief centres open now. The centres themselves are in the list below.
 */
export function HappeningNow({
  warnings,
  centres,
  checked,
}: {
  warnings: Warning[]
  centres: HistoryEvent[]
  /** Whether the live sources answered. */
  checked: boolean
}) {
  if (!checked && !warnings.length && !centres.length) return null
  // Levels are written in capitals: "(SEVERE)", "DANGER" (not "dangerous").
  const severe = warnings.some((w) => /\b(SEVERE|DANGER)\b/.test(w.text))
  const people = evacuees(centres)
  const clear = !warnings.length && !centres.length

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2 text-xs",
        clear ? "bg-emerald-500/10" : "bg-muted/70"
      )}
    >
      <span className="flex items-center gap-1.5 font-semibold tracking-wide text-muted-foreground uppercase">
        <span
          className={cn(
            "size-1.5 rounded-full",
            clear ? "bg-emerald-500" : "animate-pulse bg-red-500"
          )}
        />
        Now
      </span>
      {clear ? (
        <Item
          icon={<CheckIcon />}
          tone="text-emerald-700 dark:text-emerald-300"
        >
          All clear
        </Item>
      ) : (
        <>
          {warnings.length > 0 && (
            <Item
              icon={<CloudRainIcon />}
              tone={severe ? "text-red-600" : "text-amber-600"}
              title={warnings
                .map(
                  (w) =>
                    `${w.title}${w.validTo ? `, until ${until(w.validTo)}` : ""}`
                )
                .join("\n")}
            >
              {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
            </Item>
          )}
          {centres.length > 0 && (
            <Item
              icon={<TentIcon />}
              tone="text-sky-600"
              title="JKM relief centres open now"
            >
              {centres.length} {centres.length === 1 ? "centre" : "centres"}
            </Item>
          )}
          {people > 0 && (
            <Item
              icon={<UsersIcon />}
              tone="text-sky-600"
              title="People in relief centres"
            >
              {people.toLocaleString("en-GB")}
            </Item>
          )}
        </>
      )}
    </div>
  )
}

function Item({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode
  tone: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <Tip label={title}>
      <span className="flex items-center gap-1 font-medium tabular-nums">
        <span className={cn("[&_svg]:size-3.5", tone)}>{icon}</span>
        {children}
      </span>
    </Tip>
  )
}
