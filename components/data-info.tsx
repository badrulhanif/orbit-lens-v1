"use client"

import * as React from "react"
import { InfoIcon } from "lucide-react"

import { Tip } from "@/components/tip"
import { cn } from "@/lib/utils"

/** Opens the "About the data" dialog from anywhere on the page. */
export const DataInfoContext = React.createContext<() => void>(() => {})

/** Small "About the data" trigger. */
export function DataInfoButton({
  label = "About the data",
  iconOnly,
  className,
}: {
  label?: string
  iconOnly?: boolean
  className?: string
}) {
  const open = React.useContext(DataInfoContext)
  return (
    <Tip label={iconOnly ? label : null}>
      <button
        type="button"
        onClick={open}
        aria-label={label}
        className={cn(
          "inline-flex items-center gap-1 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          iconOnly ? "size-6 justify-center" : "text-[11px] font-medium",
          className
        )}
      >
        <InfoIcon className={iconOnly ? "size-4" : "size-3.5"} />
        {!iconOnly && label}
      </button>
    </Tip>
  )
}
