"use client"

import * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** A styled tooltip around any element (instead of the browser's `title`). */
export function Tip({
  label,
  side = "top",
  children,
}: {
  label: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  children: React.ReactElement
}) {
  if (!label) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="max-w-64 whitespace-pre-line">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
