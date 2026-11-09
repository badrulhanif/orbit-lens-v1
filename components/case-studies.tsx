"use client"

import * as React from "react"
import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react"

import { APP_ICON } from "@/components/analysis-card"
import { CASE_STUDIES, type AppId } from "@/lib/apps"
import type { Place, SearchResponse } from "@/lib/geo"
import { cn } from "@/lib/utils"

/** Klang Valley isn't an administrative area, so it's defined here. */
const KLANG_VALLEY: Place = {
  id: "case-klang-valley",
  name: "Klang Valley",
  kind: "Urban region",
  icon: "area",
  area: "Selangor, Kuala Lumpur, Putrajaya",
  address: "",
  latitude: 3.08,
  longitude: 101.6,
  bbox: [101.35, 2.85, 101.85, 3.3],
}

/**
 * Suggested Malaysian study areas, each opening with the matching analysis.
 * These are proposed uses, not confirmed findings.
 */
export function CaseStudies({
  onOpen,
  className,
}: {
  onOpen: (place: Place, app: AppId) => void
  className?: string
}) {
  const [busy, setBusy] = React.useState<string | null>(null)

  async function open(name: string, app: AppId) {
    if (name === "Klang Valley") return onOpen(KLANG_VALLEY, app)
    setBusy(name)
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(name)}&submit=1`
      )
      const data = (await res.json()) as SearchResponse
      const place =
        data.places.find((p) => p.kind === "State" && p.name === name) ??
        data.places[0]
      if (place) onOpen(place, app)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      aria-label="Malaysia case studies"
      className={cn(
        "grid gap-1 rounded-2xl bg-background/90 p-2 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      <p className="px-2 pt-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Malaysia case studies
      </p>
      {CASE_STUDIES.map((c) => {
        const Icon = APP_ICON[c.app]
        return (
          <button
            key={c.place}
            type="button"
            onClick={() => open(c.place, c.app)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-orange-500/10 text-orange-700 dark:text-orange-400">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {c.place}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {c.expect}
                </span>
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {c.data}
              </span>
            </span>
            {busy === c.place ? (
              <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            )}
          </button>
        )
      })}
    </section>
  )
}
