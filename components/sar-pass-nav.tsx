"use client"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { useNisar } from "@/hooks/use-nisar"
import { formatPassDates } from "@/lib/sar"
import { cn } from "@/lib/utils"

/** Bottom-centre: step through the NISAR passes over the area on screen. */
export function SarPassNav({
  nisar,
  className,
}: {
  nisar: ReturnType<typeof useNisar>
  className?: string
}) {
  const { pass, passes, index } = nisar
  const count = passes?.length ?? 0

  let body: React.ReactNode
  if (nisar.loading && !pass) {
    body = (
      <Status>
        <LoaderCircleIcon className="size-4 animate-spin" />
        Finding NISAR passes here…
      </Status>
    )
  } else if (nisar.error) {
    body = <Status className="text-destructive">{nisar.error}</Status>
  } else if (!pass) {
    body = (
      <Status>
        No NISAR {nisar.layer === "movement" ? "ground movement" : "signal"}{" "}
        data here yet. Try another area.
      </Status>
    )
  } else {
    body = (
      <>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Older pass"
          disabled={index >= count - 1}
          onClick={() => nisar.setIndex(index + 1)}
        >
          <ChevronLeftIcon />
        </Button>
        <div className="min-w-0 flex-1 px-1 text-center">
          <p className="flex items-center justify-center gap-1.5 truncate text-sm font-medium tabular-nums">
            {(nisar.loading || nisar.imageLoading) && (
              <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
            {formatPassDates(pass)}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {[
              pass.direction,
              pass.track != null && `track ${pass.track}`,
              `${index + 1} of ${count}`,
              pass.provisional && "provisional",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Newer pass"
          disabled={index <= 0}
          onClick={() => nisar.setIndex(index - 1)}
        >
          <ChevronRightIcon />
        </Button>
      </>
    )
  }

  return (
    <nav
      aria-label="NISAR passes"
      className={cn(
        "flex min-h-12 items-center rounded-xl bg-background/90 p-1.5 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      {body}
      {nisar.imageError && (
        <span className="sr-only" role="status">
          {nisar.imageError}
        </span>
      )}
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
