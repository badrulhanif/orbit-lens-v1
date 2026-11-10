"use client"

import * as React from "react"
import { CheckIcon, Link2Icon } from "lucide-react"

import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"

/** Copies the page link (which holds the current view) to the clipboard. */
export function ShareButton() {
  const [copied, setCopied] = React.useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; the address bar still has the link.
    }
  }
  return (
    <Tip
      label={copied ? "Link copied" : "Copy link to this view"}
      side="bottom"
    >
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Copy link to this view"
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <Link2Icon />}
      </Button>
    </Tip>
  )
}
