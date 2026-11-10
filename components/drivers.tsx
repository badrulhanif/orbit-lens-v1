"use client"

import { LightbulbIcon } from "lucide-react"

import type { Driver } from "@/lib/drivers"

/** "Likely why": hypotheses for a measured change, with their evidence. */
export function Drivers({ drivers }: { drivers: Driver[] }) {
  if (!drivers.length) return null
  return (
    <div className="grid gap-1.5 rounded-md bg-background/70 p-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold">
        <LightbulbIcon className="size-3.5 text-amber-500" />
        Likely why
      </p>
      <ul className="grid gap-1.5">
        {drivers.map((d) => (
          <li key={d.id} className="grid gap-0.5 text-[11px] leading-snug">
            <span>{d.cause}</span>
            <span className="text-muted-foreground">{d.evidence}</span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        Best guesses from the radar alone. Check them on the ground or against
        local news before acting on them.
      </p>
    </div>
  )
}
