"use client"

import * as React from "react"
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * /moderate: approve or reject community reports before they're shown.
 * Needs the MODERATOR_KEY (kept in this browser's session only).
 */

type Report = {
  id: string
  created_at: string
  hazard: string
  description: string
  latitude: number
  longitude: number
  precise: boolean
  occurred_on: string | null
  photo_url: string | null
}

export function Moderation() {
  const [key, setKey] = React.useState("")
  const [reports, setReports] = React.useState<Report[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // The report being approved/rejected (its buttons wait meanwhile).
  const [deciding, setDeciding] = React.useState<string | null>(null)

  async function load(k = key) {
    setError(null)
    const res = await fetch("/api/reports/moderate", {
      headers: { "X-Moderator-Key": k },
    }).catch(() => null)
    const body = (await res?.json().catch(() => null)) as {
      reports?: Report[]
      error?: string
    } | null
    if (!res?.ok || !body?.reports) {
      setReports(null)
      setError(body?.error ?? "Couldn't load reports.")
      return
    }
    try {
      sessionStorage.setItem("orbit-lens:moderator", k)
    } catch {
      // Fine: asked again next time.
    }
    setReports(body.reports)
  }

  React.useEffect(() => {
    let saved = ""
    try {
      saved = sessionStorage.getItem("orbit-lens:moderator") ?? ""
    } catch {
      // No storage.
    }
    if (saved)
      Promise.resolve().then(() => {
        setKey(saved)
        load(saved)
      })
    // Once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function decide(id: string, status: "approved" | "rejected") {
    setDeciding(id)
    const res = await fetch("/api/reports/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Moderator-Key": key },
      body: JSON.stringify({ id, status }),
    }).catch(() => null)
    setDeciding(null)
    if (res?.ok) {
      setError(null)
      setReports((r) => r?.filter((x) => x.id !== id) ?? null)
    } else setError("Couldn't save that decision.")
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4 sm:p-8">
      <header>
        <p className="text-xs font-semibold tracking-wider text-orange-700 uppercase dark:text-orange-400">
          Orbit Lens
        </p>
        <h1 className="text-xl font-semibold">Community reports to check</h1>
        <p className="text-sm text-muted-foreground">
          Approved reports appear on the map as &ldquo;Public report&rdquo;.
          Reject anything that isn&apos;t a real hazard, or that shows people or
          personal details.
        </p>
      </header>
      {!reports && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            load()
          }}
          className="flex gap-2"
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Moderator key"
            aria-label="Moderator key"
            className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
          />
          <Button type="submit">Open</Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {reports && !reports.length && (
        <p className="text-sm text-muted-foreground">Nothing waiting. 🎉</p>
      )}
      {reports?.map((r) => (
        <article
          key={r.id}
          className="grid gap-2 rounded-xl border p-4 text-sm"
        >
          <p className="text-xs text-muted-foreground">
            {r.hazard} · {r.occurred_on ?? "date not given"} · sent{" "}
            {new Date(r.created_at).toLocaleString("en-GB")}
          </p>
          <p className="wrap-break-word">{r.description}</p>
          {r.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.photo_url}
              alt="Photo sent with the report"
              className="max-h-72 rounded-lg object-contain"
            />
          )}
          <a
            href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=15/${r.latitude}/${r.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3.5" />
            {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)} (
            {r.precise ? "GPS" : "area only"})
          </a>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={deciding === r.id}
              onClick={() => decide(r.id, "approved")}
            >
              <CheckIcon data-icon="inline-start" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={deciding === r.id}
              onClick={() => decide(r.id, "rejected")}
            >
              <XIcon data-icon="inline-start" />
              Reject
            </Button>
          </div>
        </article>
      ))}
    </main>
  )
}
