"use client"

import * as React from "react"
import { CheckIcon, Link2Icon } from "lucide-react"

import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"

/**
 * Copy text to the clipboard; `copied` stays true for a moment after.
 * Copying again restarts the moment; nothing fires after unmount.
 */
export function useCopy() {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const copy = React.useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard blocked.
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }, [])
  return { copied, copy }
}

/** Copies the page link (which holds the current view) to the clipboard. */
export function ShareButton() {
  // If the clipboard is blocked, the address bar still has the link.
  const { copied, copy } = useCopy()
  return (
    <Tip
      label={copied ? "Link copied" : "Copy link to this view"}
      side="bottom"
    >
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Copy link to this view"
        onClick={() => copy(window.location.href)}
      >
        {copied ? <CheckIcon /> : <Link2Icon />}
      </Button>
    </Tip>
  )
}
