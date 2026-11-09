"use client"

import {
  ActivityIcon,
  MapIcon,
  MountainIcon,
  RadarIcon,
  SatelliteIcon,
} from "lucide-react"

import { MAP_VIEWS, type MapView } from "@/lib/map-styles"
import type { SarLayer } from "@/lib/sar"
import { cn } from "@/lib/utils"

const VIEW_ICONS: Record<MapView, React.ReactNode> = {
  map: <MapIcon />,
  satellite: <SatelliteIcon />,
  "3d": <MountainIcon />,
}

const RADAR: { id: SarLayer; label: string; icon: React.ReactNode }[] = [
  { id: "movement", label: "Ground movement", icon: <ActivityIcon /> },
  { id: "signal", label: "Signal quality", icon: <RadarIcon /> },
]

const item =
  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:shrink-0"

/**
 * Top: NISAR radar layers (tap the active one again to turn it off).
 * Bottom: the base map.
 */
export function MapControls({
  view,
  onViewChange,
  radar,
  onRadarChange,
  className,
}: {
  view: MapView
  onViewChange: (view: MapView) => void
  radar: SarLayer | null
  onRadarChange: (layer: SarLayer | null) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded-xl bg-background/90 p-1 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      <div role="group" aria-label="NISAR radar layer" className="flex gap-1">
        {RADAR.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={radar === r.id}
            onClick={() => onRadarChange(radar === r.id ? null : r.id)}
            className={cn(
              item,
              radar === r.id &&
                "bg-purple-600 text-white hover:text-white dark:bg-purple-500"
            )}
          >
            {r.icon}
            {r.label}
          </button>
        ))}
      </div>

      <div className="h-px bg-border" />

      <div role="radiogroup" aria-label="Map view" className="flex gap-1">
        {MAP_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            onClick={() => onViewChange(v.id)}
            className={cn(
              item,
              view === v.id &&
                "bg-foreground text-background hover:text-background"
            )}
          >
            {VIEW_ICONS[v.id]}
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}
