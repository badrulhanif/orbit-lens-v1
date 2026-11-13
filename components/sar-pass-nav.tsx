"use client"

import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react"

import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"
import type { useNisar } from "@/hooks/use-nisar"
import { formatRange } from "@/lib/sar"
import { cn } from "@/lib/utils"

/** How long each cycle stays on screen while playing (once it's drawn). */
const FRAME_MS = 1800

/**
 * Bottom-centre: step through NISAR's 12-day cycles, or play them in order
 * as a time-lapse. Each cycle is every swath over the area on screen,
 * stitched together. On the brightness layer, "C-band" sets Sentinel-1
 * beside NISAR.
 */
export function SarPassNav({
  nisar,
  className,
}: {
  nisar: ReturnType<typeof useNisar>
  className?: string
}) {
  const { cycle, cycles, cycleIndex, setCycleIndex } = nisar
  const count = cycles?.length ?? 0
  const [playing, setPlaying] = React.useState(false)
  const ready = !nisar.loading && nisar.waiting === 0

  // Time-lapse: oldest → newest, moving on once each cycle has drawn.
  React.useEffect(() => {
    if (!playing || !ready) return
    const timer = setTimeout(() => {
      if (cycleIndex > 0) setCycleIndex(cycleIndex - 1)
      else setPlaying(false)
    }, FRAME_MS)
    return () => clearTimeout(timer)
  }, [playing, ready, cycleIndex, setCycleIndex])

  function togglePlay() {
    if (playing) return setPlaying(false)
    // From the start when already at the newest.
    if (cycleIndex === 0) setCycleIndex(count - 1)
    setPlaying(true)
  }

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
        <Tip label={playing ? "Pause" : "Play every pass, oldest first"}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? "Pause time-lapse" : "Play time-lapse"}
            aria-pressed={playing}
            disabled={count < 2}
            onClick={togglePlay}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
        </Tip>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Older cycle"
          disabled={cycleIndex >= count - 1}
          onClick={() => {
            setPlaying(false)
            setCycleIndex(cycleIndex + 1)
          }}
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
                  playing && `${count - cycleIndex} of ${count}`,
                  nisar.layer === "movement"
                    ? "vs 12 days earlier"
                    : `${swaths} swath${swaths === 1 ? "" : "s"}`,
                  cycle.direction.toLowerCase(),
                  !playing && `cycle ${cycle.cycle}`,
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
          onClick={() => {
            setPlaying(false)
            setCycleIndex(cycleIndex - 1)
          }}
        >
          <ChevronRightIcon />
        </Button>
        {nisar.layer === "signal" && (
          <Tip label="Set Sentinel-1 (C-band) beside NISAR (L-band) on a nearby date">
            <Button
              variant={
                nisar.cband && nisar.cbandSource === "s1" ? "default" : "ghost"
              }
              size="sm"
              aria-pressed={nisar.cband && nisar.cbandSource === "s1"}
              className="h-7 px-2 text-[11px]"
              onClick={() =>
                nisar.showCband(
                  nisar.cband && nisar.cbandSource === "s1" ? null : "s1"
                )
              }
            >
              C-band
            </Button>
          </Tip>
        )}
        {nisar.layer === "signal" && nisar.rcm && (
          <Tip
            label={`Set Canada's RCM radar (C-band, ${nisar.rcm.day.slice(0, 4)}) beside NISAR: ${nisar.rcm.event}`}
          >
            <Button
              variant={
                nisar.cband && nisar.cbandSource === "rcm" ? "default" : "ghost"
              }
              size="sm"
              aria-pressed={nisar.cband && nisar.cbandSource === "rcm"}
              className="h-7 px-2 text-[11px]"
              onClick={() =>
                nisar.showCband(
                  nisar.cband && nisar.cbandSource === "rcm" ? null : "rcm"
                )
              }
            >
              RCM {nisar.rcm.day.slice(0, 4)}
            </Button>
          </Tip>
        )}
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
