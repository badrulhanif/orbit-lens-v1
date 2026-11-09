"use client"

import * as React from "react"
import { ChevronDownIcon, InfoIcon } from "lucide-react"

import type { SarLayer } from "@/lib/sar"
import { cn } from "@/lib/utils"

const INFO: Record<SarLayer, { title: string; about: string; more: string }> = {
  movement: {
    title: "Ground movement",
    about: "Change between two passes, 12 days apart",
    more: "Each full colour cycle ≈ 12 cm of movement toward or away from the satellite. Look for small, local rings of colour (around a mine, reclaimed land or sinking ground) — that's the ground moving. Bands or patches stretching across the whole scene are usually the atmosphere, not the ground. Grainy areas are water or dense forest, where the two passes can't be compared.",
  },
  signal: {
    title: "Signal quality",
    about: "Strength of the radar echo from the ground",
    more: "NISAR sends out microwave pulses and records the echo that bounces back from each patch of ground. Rough, leafy surfaces scatter a strong echo back; smooth surfaces like water (and flood water) bounce it away, so they look dark. Radar sees through cloud and works at night.",
  },
}

/** Bottom-right key for the radar layer, with an expandable explanation. */
export function SarLegend({
  layer,
  className,
}: {
  layer: SarLayer
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const info = INFO[layer]
  const id = React.useId()

  return (
    <section
      aria-label={`${info.title} legend`}
      className={cn(
        "grid gap-2 rounded-xl bg-background/90 p-3 text-xs shadow-lg ring-1 shadow-black/10 ring-foreground/10 backdrop-blur-xl",
        className
      )}
    >
      <div>
        <p className="font-medium">{info.title}</p>
        <p className="text-[11px] text-muted-foreground">{info.about}</p>
      </div>

      {layer === "movement" ? (
        <div className="grid gap-1">
          {/* Same cyclic colours as NISAR's interferogram previews. */}
          <div
            className="h-2.5 rounded-full ring-1 ring-foreground/10"
            style={{
              background:
                "linear-gradient(to right, #f3e7ec, #9cbbe0, #5a5fc8, #3a1b55, #7c2b3b, #cd8a63, #f3e7ec)",
            }}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>0</span>
            <span>6 cm</span>
            <span>12 cm</span>
          </div>
        </div>
      ) : (
        <ul className="grid gap-1.5 text-xs">
          <Swatch color="#4bbf4b" label="Vegetation">
            Forest and crops echo strongly
          </Swatch>
          <Swatch color="#c4906e" label="Open land">
            Bare ground, buildings, plantations
          </Swatch>
          <Swatch color="#0e1a2b" label="Water">
            Rivers, sea and flood water look dark
          </Swatch>
        </ul>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 justify-self-start rounded text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <InfoIcon className="size-3.5" />
        {open ? "Less info" : "More info"}
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <p id={id} className="leading-relaxed text-muted-foreground">
          {info.more}
        </p>
      )}
    </section>
  )
}

function Swatch({
  color,
  label,
  children,
}: {
  color: string
  label: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className="size-3.5 shrink-0 rounded ring-1 ring-foreground/15"
        style={{ background: color }}
      />
      <span className="w-20 shrink-0 font-medium">{label}</span>
      <span className="min-w-0 text-[11px] leading-snug text-muted-foreground">
        {children}
      </span>
    </li>
  )
}
