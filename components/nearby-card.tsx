"use client"

import { LoaderCircleIcon, LocateFixedIcon, MapPinOffIcon } from "lucide-react"

import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"
import type { useDeviceLocation } from "@/hooks/use-device-location"
import { cn } from "@/lib/utils"

type Location = ReturnType<typeof useDeviceLocation>

/**
 * "Nearby me", in the search bar: opens the user's district with everything
 * recorded there. Their exact position is never shown.
 */
export function NearbyButton({
  busy,
  active,
  onClick,
}: {
  busy: boolean
  /** The open area is the user's own. */
  active: boolean
  onClick: () => void
}) {
  return (
    <Tip label="Nearby me: what happened in your district" side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Nearby me: what happened in your district"
        aria-pressed={active}
        disabled={busy}
        onClick={onClick}
        className={cn(
          "border-l",
          active && "text-sky-600 dark:text-sky-400",
          busy && "cursor-wait"
        )}
      >
        {busy ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <LocateFixedIcon />
        )}
      </Button>
    </Tip>
  )
}

const PROBLEM: Partial<
  Record<Location["status"], { title: string; message: string; action: string }>
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

/** Shown under the search bar only when "Nearby me" can't work. */
export function NearbyProblem({
  location,
  error,
  onRetry,
  className,
}: {
  location: Location
  /** The district lookup failed. */
  error: string | null
  onRetry: () => void
  className?: string
}) {
  const problem =
    PROBLEM[location.status] ??
    (error
      ? {
          title: "Couldn't find your district",
          message: error,
          action: "Try again",
        }
      : null)
  if (!problem) return null
  return (
    <div
      role="alert"
      className={cn(
        "grid gap-3 rounded-2xl bg-background/90 p-4 shadow-lg ring-1 shadow-black/10 ring-destructive/30 backdrop-blur-xl dark:ring-destructive/40",
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
      <Button className="h-9" onClick={onRetry}>
        <LocateFixedIcon data-icon="inline-start" />
        {problem.action}
      </Button>
    </div>
  )
}
