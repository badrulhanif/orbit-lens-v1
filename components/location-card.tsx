"use client"

import {
  CrosshairIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MapPinOffIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { useDeviceLocation } from "@/hooks/use-device-location"
import { usePlaceName } from "@/hooks/use-place-name"
import { formatDistance } from "@/lib/geo"
import { cn } from "@/lib/utils"

const card =
  "rounded-2xl bg-background/90 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl"

export function LocationCard({
  location,
  onShow,
  className,
}: {
  location: ReturnType<typeof useDeviceLocation>
  onShow: () => void
  className?: string
}) {
  const { place, loading: placeLoading } = usePlaceName(location.position)

  switch (location.status) {
    case "checking":
    case "ask":
      return null

    case "locating":
      return (
        <div
          className={cn(card, "flex items-center gap-3 p-4 text-sm", className)}
        >
          <LoaderCircleIcon className="size-4 animate-spin text-sky-500" />
          Finding your location…
        </div>
      )

    case "ready": {
      const p = location.position!
      return (
        <div className={cn(card, "flex items-center gap-3 p-3", className)}>
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <MapPinIcon className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            {place ? (
              <>
                <p className="truncate text-sm font-medium">{place.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {place.detail ?? "Your location"} · ±
                  {formatDistance(p.accuracy)}
                </p>
              </>
            ) : placeLoading ? (
              <div className="grid gap-1.5">
                <div className="h-4 w-36 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">You are here</p>
                <p className="text-xs text-muted-foreground">
                  Accurate to ±{formatDistance(p.accuracy)}
                </p>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show my location on the map"
            onClick={onShow}
          >
            <CrosshairIcon />
          </Button>
        </div>
      )
    }

    case "off":
      return (
        <ErrorCard
          className={className}
          title="Location is off"
          message="You need to enable location to see where you are on the map."
          action="Enable location"
          onAction={location.enable}
        />
      )

    case "blocked":
      return (
        <ErrorCard
          className={className}
          title="Location is blocked"
          message="Your browser is blocking location for this site. Click the icon next to the address bar, set Location to Allow, then try again."
          action="Try again"
          onAction={location.enable}
        />
      )

    case "error":
      return (
        <ErrorCard
          className={className}
          title="Couldn't find your location"
          message={location.error ?? "Something went wrong."}
          action="Try again"
          onAction={location.enable}
        />
      )
  }
}

function ErrorCard({
  title,
  message,
  action,
  onAction,
  className,
}: {
  title: string
  message: string
  action: string
  onAction: () => void
  className?: string
}) {
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
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button className="h-9" onClick={onAction}>
        <MapPinIcon data-icon="inline-start" />
        {action}
      </Button>
    </div>
  )
}
