"use client"

import * as React from "react"
import {
  BellIcon,
  BellOffIcon,
  BellPlusIcon,
  BellRingIcon,
  CloudRainIcon,
  MailIcon,
  TentIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useJson } from "@/hooks/use-json"
import { placeLink, useWatches, type StoredAlert } from "@/hooks/use-watches"
import type { AreaHistory } from "@/lib/area"
import type { Place } from "@/lib/geo"
import { cn } from "@/lib/utils"

type Features = { email: boolean; reports: boolean }

/** Which optional features (email, reports) this server has set up. */
export function useFeatures() {
  return (
    useJson<Features>("/api/alerts/status").data ?? {
      email: false,
      reports: false,
    }
  )
}

const ICON: Record<StoredAlert["kind"], React.ReactNode> = {
  warning: <CloudRainIcon className="text-amber-600" />,
  centres: <TentIcon className="text-sky-600" />,
  event: <TriangleAlertIcon className="text-red-600" />,
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 60) return `${Math.max(1, m)} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** Bell in the search bar: alerts for watched places, and the watch list. */
export function AlertsBell({
  onOpen,
}: {
  onOpen: (link: string, eventId?: string) => void
}) {
  const w = useWatches()
  const features = useFeatures()
  const [open, setOpen] = React.useState(false)
  const [permission, setPermission] = React.useState<string>(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next && w.unread) w.markRead()
      }}
    >
      <Tip label="Alerts for places you watch" side="bottom">
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Alerts${w.unread ? `, ${w.unread} new` : ""}`}
              className="relative"
            />
          }
        >
          {w.unread ? <BellRingIcon /> : <BellIcon />}
          {w.unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
              {w.unread > 9 ? "9+" : w.unread}
            </span>
          )}
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        align="end"
        className="flex max-h-[70svh] w-[min(22rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
      >
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Alerts</p>
          <p className="text-xs text-muted-foreground">
            New warnings, relief centres and events in places you watch.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {w.alerts.length ? (
            <ul className="divide-y">
              {w.alerts.map((a) => (
                <li key={`${a.link}|${a.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      w.markRead()
                      onOpen(a.link, a.eventId)
                    }}
                    className={cn(
                      "flex w-full gap-2.5 px-3 py-2.5 text-left text-xs hover:bg-muted/60",
                      !a.read && "bg-orange-500/5"
                    )}
                  >
                    <span className="mt-0.5 [&_svg]:size-4">
                      {ICON[a.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium wrap-break-word">
                        {a.place}: {a.title}
                      </span>
                      <span className="line-clamp-2 text-muted-foreground">
                        {a.detail}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {ago(a.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {w.watches.length
                ? "Nothing new yet. Places are checked every 15 minutes while this page is open."
                : "Open any place and tap the bell on its panel to watch it. You'll be alerted here when something new happens there."}
            </p>
          )}

          {w.watches.length > 0 && (
            <div className="grid gap-1.5 border-t px-3 py-2.5">
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Watching
              </p>
              {w.watches.map((p) => (
                <div key={p.link} className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onOpen(p.link)
                    }}
                    className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                  >
                    {p.name}
                  </button>
                  {features.email && <EmailAlerts link={p.link} />}
                  <Tip label={`Stop watching ${p.name}`}>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Stop watching ${p.name}`}
                      onClick={() => w.remove(p.link)}
                    >
                      <XIcon />
                    </Button>
                  </Tip>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
          {permission === "granted" ? (
            <span className="text-muted-foreground">
              Browser notifications on
            </span>
          ) : permission === "unsupported" || permission === "denied" ? (
            <span className="text-muted-foreground">
              {permission === "denied"
                ? "Browser notifications are blocked"
                : "No browser notifications here"}
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={async () =>
                setPermission(await Notification.requestPermission())
              }
            >
              <BellRingIcon data-icon="inline-start" />
              Browser notifications
            </Button>
          )}
          {w.alerts.length > 0 && (
            <button
              type="button"
              onClick={w.clear}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** "Email me" for one watched place: asks for an address, sends a confirm link. */
function EmailAlerts({ link }: { link: string }) {
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [state, setState] = React.useState<
    "idle" | "sending" | "sent" | string
  >("idle")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState("sending")
    const res = await fetch("/api/alerts/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, link }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as {
      error?: string
    } | null
    setState(
      res?.ok ? "sent" : (body?.error ?? "Couldn't set up email alerts.")
    )
  }

  if (state === "sent")
    return (
      <span className="shrink-0 text-emerald-700 dark:text-emerald-300">
        Check your email
      </span>
    )
  if (!open)
    return (
      <Tip label="Email me alerts for this place">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Email me alerts for this place"
          onClick={() => setOpen(true)}
        >
          <MailIcon />
        </Button>
      </Tip>
    )
  return (
    <form onSubmit={submit} className="flex min-w-0 shrink items-center gap-1">
      <input
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        className="h-7 w-32 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <Button
        type="submit"
        size="sm"
        className="h-7"
        disabled={state === "sending"}
      >
        Send
      </Button>
      {state !== "idle" && state !== "sending" && (
        <span className="sr-only" role="alert">
          {state}
        </span>
      )}
    </form>
  )
}

/** Bell on a place's panel: watch it (or stop). */
export function WatchButton({
  place,
  history,
}: {
  place: Place
  history: AreaHistory | null
}) {
  const w = useWatches()
  const on = w.isWatching(place)
  const label = on
    ? `Watching ${place.name}: tap to stop`
    : w.full
      ? "You're watching 10 places (the most)"
      : `Watch ${place.name} for new alerts`
  return (
    <Tip label={label} side="bottom">
      <Button
        variant={on ? "default" : "outline"}
        size="icon-sm"
        aria-label={label}
        aria-pressed={on}
        disabled={!on && w.full}
        onClick={() => w.toggle(place, history)}
      >
        {on ? <BellOffIcon /> : <BellPlusIcon />}
      </Button>
    </Tip>
  )
}

export { placeLink }
