"use client"

import * as React from "react"
import { CameraIcon, LoaderCircleIcon, MegaphoneIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Place } from "@/lib/geo"
import { cn } from "@/lib/utils"

/**
 * "See something? Report it": a hazard seen by a member of the public.
 * Saved for a moderator, shown on the map once approved.
 */

const HAZARDS = [
  { id: "flood", label: "Flooding" },
  { id: "landslide", label: "Landslide" },
  { id: "storm", label: "Storm damage" },
  { id: "sinkhole", label: "Sinkhole" },
  { id: "earthquake", label: "Earthquake felt" },
  { id: "other", label: "Something else" },
]

const field =
  "w-full min-w-0 rounded-lg border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

export function ReportButton({ place }: { place: Place }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 justify-self-start"
        onClick={() => setOpen(true)}
      >
        <MegaphoneIcon data-icon="inline-start" />
        See something? Report it
      </Button>
      {open && <ReportDialog place={place} onClose={() => setOpen(false)} />}
    </>
  )
}

function ReportDialog({
  place,
  onClose,
}: {
  place: Place
  onClose: () => void
}) {
  const [hazard, setHazard] = React.useState("flood")
  const [description, setDescription] = React.useState("")
  const [date, setDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [where, setWhere] = React.useState<"area" | "gps">("area")
  const [gps, setGps] = React.useState<{
    latitude: number
    longitude: number
  } | null>(null)
  const [gpsState, setGpsState] = React.useState<"idle" | "finding" | "error">(
    "idle"
  )
  const [photo, setPhoto] = React.useState<File | null>(null)
  const [state, setState] = React.useState<
    "idle" | "sending" | "sent" | string
  >("idle")

  function useGps() {
    setWhere("gps")
    if (gps) return
    setGpsState("finding")
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({ latitude: p.coords.latitude, longitude: p.coords.longitude })
        setGpsState("idle")
      },
      () => {
        setGpsState("error")
        setWhere("area")
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const at = where === "gps" && gps ? gps : place
    const form = new FormData()
    form.set("hazard", hazard)
    form.set("description", description)
    form.set("occurredOn", date)
    form.set("latitude", String(at.latitude))
    form.set("longitude", String(at.longitude))
    form.set("precise", String(where === "gps" && !!gps))
    if (photo) form.set("photo", photo)
    setState("sending")
    const res = await fetch("/api/reports", {
      method: "POST",
      body: form,
    }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as {
      error?: string
    } | null
    setState(
      res?.ok ? "sent" : (body?.error ?? "Couldn't send the report right now.")
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Report what you see</DialogTitle>
          <DialogDescription>
            In or near {place.name}. Checked by a moderator before it appears on
            the map.
          </DialogDescription>
        </DialogHeader>
        {state === "sent" ? (
          <div className="grid gap-3 p-4 text-sm">
            <p className="font-medium">Thank you, your report was sent.</p>
            <p className="text-muted-foreground">
              It will appear on the map once it&apos;s checked. If anyone is in
              danger, call 999.
            </p>
            <Button className="justify-self-start" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="grid gap-3 overflow-x-hidden overflow-y-auto p-4 text-sm"
          >
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                What is it?
              </span>
              <Select
                value={hazard}
                onValueChange={(v) => v && setHazard(v)}
                items={HAZARDS.map((h) => ({ value: h.id, label: h.label }))}
              >
                <SelectTrigger className="h-9 w-full" aria-label="Hazard">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HAZARDS.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                What do you see? (water depth, roads cut, cracks…)
              </span>
              <textarea
                required
                minLength={5}
                maxLength={600}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={cn(field, "resize-none")}
                placeholder="e.g. Water knee-deep on Jalan Kebun, cars can't pass"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  When
                </span>
                <input
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={field}
                />
              </label>
              <div className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Where
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setWhere("area")}
                    aria-pressed={where === "area"}
                    className={cn(
                      "flex-1 rounded-lg border px-2 py-2 text-xs",
                      where === "area" &&
                        "border-foreground bg-foreground text-background"
                    )}
                  >
                    This area
                  </button>
                  <button
                    type="button"
                    onClick={useGps}
                    aria-pressed={where === "gps"}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs",
                      where === "gps" &&
                        "border-foreground bg-foreground text-background"
                    )}
                  >
                    {gpsState === "finding" && (
                      <LoaderCircleIcon className="size-3 animate-spin" />
                    )}
                    Here (GPS)
                  </button>
                </div>
              </div>
            </div>
            {gpsState === "error" && (
              <p className="text-xs text-destructive">
                Couldn&apos;t get your location; the report will use this area.
              </p>
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted/60">
              <CameraIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {photo ? photo.name : "Add a photo (optional, under 4 MB)"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Please don&apos;t include names, phone numbers or faces. Only the
              description, place, date and photo are kept.
            </p>
            {state !== "idle" && state !== "sending" && (
              <p className="text-xs text-destructive" role="alert">
                {state}
              </p>
            )}
            <Button
              type="submit"
              disabled={state === "sending" || gpsState === "finding"}
            >
              {state === "sending" ? "Sending…" : "Send report"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
