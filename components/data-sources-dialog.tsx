"use client"

import * as React from "react"
import { ExternalLinkIcon, InfoIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DATA_CAVEATS, DATA_GROUPS } from "@/lib/data-sources"
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
    <button
      type="button"
      onClick={open}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        iconOnly ? "size-6 justify-center" : "text-[11px] font-medium",
        className
      )}
    >
      <InfoIcon className={iconOnly ? "size-4" : "size-3.5"} />
      {!iconOnly && label}
    </button>
  )
}

export function DataSourcesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-4">
          <DialogTitle>About the data</DialogTitle>
          <DialogDescription>
            Where everything on this map comes from, how fresh it is, and its
            limits.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 overflow-y-auto p-4">
          {DATA_GROUPS.map((group) => (
            <section key={group.title} className="grid gap-2">
              <div>
                <h3 className="text-xs font-semibold tracking-wide text-orange-700 uppercase dark:text-orange-400">
                  {group.title}
                </h3>
                {group.note && (
                  <p className="text-xs text-muted-foreground">{group.note}</p>
                )}
              </div>
              <ul className="grid gap-2">
                {group.sources.map((s) => (
                  <li key={s.name} className="rounded-xl border p-3 text-xs">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-sm font-medium hover:underline"
                    >
                      {s.name}
                      <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                    </a>
                    <p className="text-muted-foreground">{s.by}</p>
                    <p className="mt-1.5">{s.gives}</p>
                    <p className="mt-1 text-muted-foreground">
                      {s.coverage}
                      {s.licence && ` · ${s.licence}`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="grid gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-orange-700 uppercase dark:text-orange-400">
              Good to know
            </h3>
            <ul className="grid list-disc gap-1 pl-4 text-xs text-muted-foreground">
              {DATA_CAVEATS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
