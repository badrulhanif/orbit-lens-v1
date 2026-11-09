"use client"

import {
  ChevronRightIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  MapPinOffIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { useDeviceLocation } from "@/hooks/use-device-location"
import { cn } from "@/lib/utils"

const card =
  "rounded-2xl bg-background/90 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl"

const PROBLEM: Partial<
  Record<
    ReturnType<typeof useDeviceLocation>["status"],
    { title: string; message: string; action: string }
  >
> = {
  off: {
    title: "Location is off",
    message: "Turn on location to see what happened in your district.",
    action: "Enable location",
  },
  blocked: {
    title: "Location is blocked",
    message:
      "Your browser is blocking location for this site. Click the icon next to the address bar, set Location to Allow, then try again.",
    action: "Try again",
  },
  error: {
    title: "Couldn't find your location",
    message: "Something went wrong.",
    action: "Try again",
  },
}

/**
 * "Nearby me": opens the user's district with everything recorded there.
 * Their exact position is never shown.
 */
export function NearbyCard({
  location,
  busy,
  error,
  onNearby,
  className,
}: {
  location: ReturnType<typeof useDeviceLocation>
  /** Looking up the district. */
  busy: boolean
  /** The district lookup failed. */
  error: string | null
  onNearby: () => void
  className?: string
}) {
  const problem = PROBLEM[location.status]
  if (problem) {
    return (
      <div
        role="alert"
        className={cn(
          card,
          "grid gap-3 p-4 ring-destructive/30 dark:ring-destructive/40",
          className
        )}
      >
        <div className="flex gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
            <MapPinOffIcon className="size-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{problem.title}</p>
            <p className="text-sm text-muted-foreground">
              {location.error ?? problem.message}
            </p>
          </div>
        </div>
        <Button className="h-9" onClick={onNearby}>
          <LocateFixedIcon data-icon="inline-start" />
          {problem.action}
        </Button>
      </div>
    )
  }

  const working = busy || location.status === "locating"
  return (
    <button
      type="button"
      onClick={onNearby}
      disabled={working}
      className={cn(
        card,
        "flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/60 disabled:cursor-wait",
        className
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
        {working ? (
          <LoaderCircleIcon className="size-4.5 animate-spin" />
        ) : (
          <LocateFixedIcon className="size-4.5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Nearby me</span>
        <span
          className={cn(
            "block text-xs",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {working
            ? "Finding your district…"
            : (error ?? "What happened in your district, and what's on now")}
        </span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}
