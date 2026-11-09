"use client"

import * as React from "react"
import {
  ArrowLeftRightIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  LoaderCircleIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { id: "compare", label: "Compare", icon: ArrowLeftRightIcon },
  { id: "report", label: "Report", icon: FileTextIcon },
] as const

export type Tab = (typeof TABS)[number]["id"]

export function Tabs({
  tab,
  onChange,
}: {
  tab: Tab
  onChange: (t: Tab) => void
}) {
  return (
    <div
      role="tablist"
      className="mx-3 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            tab === t.id &&
              "bg-background text-orange-700 shadow-sm ring-1 ring-foreground/10 dark:text-orange-400"
          )}
        >
          <t.icon className="size-4" />
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: "warm"
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3",
        tone === "warm" ? "bg-orange-500/10" : "bg-muted"
      )}
    >
      <p
        className={cn(
          "text-[11px] leading-tight font-medium",
          tone === "warm"
            ? "text-orange-700 dark:text-orange-400"
            : "text-muted-foreground"
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-2xl leading-none font-semibold tabular-nums">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium wrap-break-word">{value}</dd>
    </div>
  )
}

export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        on
          ? "border-foreground bg-foreground text-background"
          : "hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}

export function Loading({
  children,
  small,
}: {
  children: React.ReactNode
  small?: boolean
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-muted-foreground",
        small ? "text-xs" : "text-sm"
      )}
    >
      <LoaderCircleIcon
        className={cn("animate-spin", small ? "size-3.5" : "size-4")}
      />
      {children}
    </p>
  )
}
