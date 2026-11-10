"use client"

import * as React from "react"
import { LayersIcon } from "lucide-react"

import type { AnalysisOverlay } from "@/components/analysis-card"
import { Button } from "@/components/ui/button"
import { formatEventDate, type Bbox } from "@/lib/area"
import type { PolStats } from "@/lib/drivers"
import { cn } from "@/lib/utils"

/**
 * The same NISAR pass seen in each polarization, and how each changed.
 * Shows which polarization highlights which kind of change.
 */

export type PolImages = {
  hh: string
  hv: string
  rgb: string
  dhh: string
  dhv: string
}

const VIEWS: {
  id: keyof PolImages
  label: string
  about: string
}[] = [
  {
    id: "rgb",
    label: "Colour mix",
    about:
      "Red = HH, green = HV, blue = HH÷HV. Forest looks green-white, towns pink-red, open fields blue-purple, water black.",
  },
  {
    id: "hh",
    label: "HH",
    about:
      "Sent and received horizontally. Brightest from buildings and from flooded trees (the wave bounces off water, then trunks). Best for floods under canopy and built-up land.",
  },
  {
    id: "hv",
    label: "HV",
    about:
      "Sent horizontally, received vertically: only a jumble of branches and leaves twists the wave like this. Best for how much vegetation there is, and clearing.",
  },
  {
    id: "dhh",
    label: "HH change",
    about:
      "Blue = brighter than the earlier pass, red = darker. Red patches on land are often new water; blue in forest can be water under the trees.",
  },
  {
    id: "dhv",
    label: "HV change",
    about:
      "Blue = more vegetation volume (crops growing), red = less (clearing, harvest).",
  },
]

const db = (v: number | null) => (v == null ? "–" : `${v.toFixed(1)} dB`)

export function Polarizations({
  images,
  pol,
  dates,
  bbox,
  overlay,
  onOverlay,
}: {
  images: PolImages
  pol?: PolStats
  dates: { a: string; b: string }
  bbox: Bbox
  overlay: AnalysisOverlay | null
  onOverlay: (overlay: AnalysisOverlay | null) => void
}) {
  const [view, setView] = React.useState<keyof PolImages>("rgb")
  const v = VIEWS.find((x) => x.id === view)!
  const url = images[view]
  const onMap = overlay?.url === url
  const change = view === "dhh" || view === "dhv"

  return (
    <div className="grid gap-2 border-t pt-2">
      <p className="text-[11px] font-semibold">
        What each polarization sees · {formatEventDate(dates.b)}
      </p>
      <div
        role="radiogroup"
        aria-label="Polarization"
        className="flex flex-wrap gap-1"
      >
        {VIEWS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={view === x.id}
            onClick={() => setView(x.id)}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px]",
              view === x.id
                ? "border-foreground bg-foreground text-background"
                : "hover:bg-muted"
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${v.label}, NISAR ${formatEventDate(dates.b)}`}
          className="aspect-square w-20 rounded-md bg-muted object-cover ring-1 ring-foreground/10 [image-rendering:pixelated]"
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          {v.about}
          {change && ` Since ${formatEventDate(dates.a)}.`}
        </p>
      </div>
      {pol && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Typical land: HH {db(pol.a.hh)} → {db(pol.b.hh)} · HV {db(pol.a.hv)} →{" "}
          {db(pol.b.hv)}
        </p>
      )}
      <Button
        variant={onMap ? "default" : "outline"}
        size="sm"
        className="h-8 justify-self-start"
        onClick={() =>
          onOverlay(
            onMap
              ? null
              : {
                  url,
                  bbox,
                  kind: "polarization",
                  label: change
                    ? `NISAR ${v.label}, ${formatEventDate(dates.a)} → ${formatEventDate(dates.b)}`
                    : `NISAR ${v.label}, ${formatEventDate(dates.b)}`,
                  note: v.about,
                  diverging: change,
                }
          )
        }
      >
        <LayersIcon data-icon="inline-start" />
        {onMap ? "Hide map" : `Show ${v.label} on map`}
      </Button>
    </div>
  )
}
