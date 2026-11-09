"use client"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { useNisar } from "@/hooks/use-nisar"
import { formatRange } from "@/lib/sar"
import { cn } from "@/lib/utils"

/**
 * Bottom-centre: step through NISAR's 12-day cycles. Each cycle is every
 * swath over the area on screen, stitched together.
 */
export function SarPassNav({
  nisar,
  className,
}: {
  nisar: ReturnType<typeof useNisar>
  className?: string
}) {
  const { cycle, cycles, cycleIndex } = nisar
  const count = cycles?.length ?? 0

  let body: React.ReactNode
  if (nisar.loading && !cycle) {
    body = (
      <Status>
        <LoaderCircleIcon className="size-4 animate-spin" />
        Finding NISAR passes here…
      </Status>
    )
  } else if (nisar.error && !cycle) {
    body = <Status className="text-destructive">{nisar.error}</Status>
  } else if (!cycle) {
    body = (
      <Status>
        No NISAR {nisar.layer === "movement" ? "ground movement" : "signal"}{" "}
        data here yet. Try another area.
      </Status>
    )
  } else {
    const swaths = cycle.passes.length
    body = (
      <>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Older cycle"
          disabled={cycleIndex >= count - 1}
          onClick={() => nisar.setCycleIndex(cycleIndex + 1)}
        >
          <ChevronLeftIcon />
        </Button>
        <div className="min-w-0 flex-1 px-1 text-center">
          <p className="flex items-center justify-center gap-1.5 truncate text-sm font-medium tabular-nums">
            {(nisar.loading || nisar.waiting > 0) && (
              <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
            {formatRange(cycle.start, cycle.end)}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {nisar.waiting > 0
              ? `Loading ${swaths - nisar.waiting} of ${swaths} swaths…`
              : [
                  nisar.layer === "movement"
                    ? "vs 12 days earlier"
                    : `${swaths} swath${swaths === 1 ? "" : "s"}`,
                  cycle.direction.toLowerCase(),
                  `cycle ${cycle.cycle}`,
                  cycle.provisional && "provisional",
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Newer cycle"
          disabled={cycleIndex <= 0}
          onClick={() => nisar.setCycleIndex(cycleIndex - 1)}
        >
          <ChevronRightIcon />
        </Button>
      </>
    )
  }

  return (
    <nav
      aria-label="NISAR cycles"
      className={cn(
        "flex min-h-12 items-center rounded-xl bg-background/90 p-1.5 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      {body}
    </nav>
  )
}

function Status({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "flex flex-1 items-center justify-center gap-2 px-3 text-center text-xs text-muted-foreground",
        className
      )}
    >
      {children}
    </p>
  )
}
