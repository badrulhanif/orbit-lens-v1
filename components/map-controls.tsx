"use client"

import {
  ActivityIcon,
  CheckIcon,
  MapIcon,
  MountainIcon,
  RadarIcon,
  SatelliteIcon,
} from "lucide-react"

import { DataInfoButton } from "@/components/data-sources-dialog"
import { MAP_VIEWS, type MapView } from "@/lib/map-styles"
import type { SarLayer } from "@/lib/sar"
import { cn } from "@/lib/utils"

const VIEW_ICONS: Record<MapView, React.ReactNode> = {
  map: <MapIcon />,
  satellite: <SatelliteIcon />,
  "3d": <MountainIcon />,
}

const RADAR: {
  id: SarLayer
  label: string
  hint: string
  icon: React.ReactNode
  /** A tiny painting of what the layer looks like. */
  preview: string
}[] = [
  {
    id: "movement",
    label: "Ground movement",
    hint: "Sinking, sliding, shifting",
    icon: <ActivityIcon />,
    // Interferogram fringes: the same cyclic colours as the real data.
    preview:
      "repeating-radial-gradient(circle at 68% 62%, #f3e7ec 0 5px, #9cbbe0 5px 9px, #5a5fc8 9px 13px, #3a1b55 13px 17px, #7c2b3b 17px 21px, #cd8a63 21px 25px)",
  },
  {
    id: "signal",
    label: "Signal quality",
    hint: "Forest, land, water, floods",
    icon: <RadarIcon />,
    // Backscatter: green vegetation, brown open land, dark water.
    preview:
      "radial-gradient(ellipse 30% 40% at 22% 35%, #57c457 0 60%, transparent 62%), radial-gradient(ellipse 28% 30% at 62% 30%, #c4906e 0 60%, transparent 62%), radial-gradient(ellipse 45% 30% at 80% 85%, #0e1a2b 0 70%, transparent 72%), linear-gradient(160deg, #3f9f45, #6fbf5a 45%, #b48a62 70%, #24364f)",
  },
]

const viewItem =
  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:shrink-0"

/**
 * Top: pick a NISAR radar layer (tap the chosen card again to hide it).
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
        "grid gap-2 rounded-2xl bg-background/90 p-2 shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          NISAR radar
        </p>
        <DataInfoButton iconOnly label="About the data and its sources" />
      </div>
      <div
        role="group"
        aria-label="NISAR radar layer"
        className="grid grid-cols-2 gap-2"
      >
        {RADAR.map((r) => {
          const on = radar === r.id
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              onClick={() => onRadarChange(on ? null : r.id)}
              className={cn(
                "group relative overflow-hidden rounded-xl text-left ring-1 ring-foreground/10 transition outline-none hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring",
                on &&
                  "ring-2 ring-purple-600 hover:ring-purple-600 dark:ring-purple-400"
              )}
            >
              <span
                aria-hidden
                className="block h-14 w-full transition-transform duration-300 group-hover:scale-105 max-sm:h-10"
                style={{ background: r.preview }}
              />
              {on && (
                <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-purple-600 text-white shadow dark:bg-purple-500">
                  <CheckIcon className="size-3" strokeWidth={3} />
                </span>
              )}
              <span className="flex items-start gap-2 p-2">
                <span
                  className={cn(
                    "mt-0.5 text-muted-foreground [&_svg]:size-4",
                    on && "text-purple-600 dark:text-purple-400"
                  )}
                >
                  {r.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs leading-tight font-medium">
                    {r.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground max-sm:hidden">
                    {r.hint}
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div
        role="radiogroup"
        aria-label="Map view"
        className="flex gap-1 rounded-xl bg-muted p-1"
      >
        {MAP_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            onClick={() => onViewChange(v.id)}
            className={cn(
              viewItem,
              view === v.id &&
                "bg-background text-foreground shadow-sm ring-1 ring-foreground/10"
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
