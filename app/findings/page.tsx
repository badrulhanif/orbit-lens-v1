import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon, ExternalLinkIcon, LightbulbIcon } from "lucide-react"

import {
  BANDS,
  CAPABILITIES,
  FINDINGS_INTRO,
  FUTURE,
  LEARN,
  LIMITS,
  POLARIZATION_GUIDE,
  STORIES,
  type Story,
} from "@/lib/findings"
import { RCM_CREDIT } from "@/lib/rcm"
import { toSearch } from "@/lib/share"

export const metadata: Metadata = {
  title: "Findings · Orbit Lens",
  description:
    "What NASA-ISRO NISAR radar shows over Malaysia: paddy cycles in Kedah, Kelantan before the monsoon and ground movement in the Klang Valley, plus a 2020 flash flood in Masamba, Indonesia, seen by Canada's RCM.",
}

export default function FindingsPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto grid max-w-3xl gap-10 px-4 py-8 sm:py-12">
        <header className="grid gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            Open the map
          </Link>
          <p className="text-xs font-semibold tracking-wider text-orange-700 uppercase dark:text-orange-400">
            Orbit Lens · Findings
          </p>
          <h1 className="text-3xl leading-tight font-semibold text-balance sm:text-4xl">
            Malaysia through NISAR&apos;s eyes
          </h1>
          {FINDINGS_INTRO.map((p) => (
            <p key={p} className="leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </header>

        {STORIES.map((s) => (
          <StoryCard key={s.id} story={s} />
        ))}

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">
            What a radar every 12 days can and can&apos;t do
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            NISAR passes over each place every 12 days. That&apos;s too slow to
            warn of a flood that rises in hours, but right for changes that
            build up over weeks: clearing, creeping slopes, sinking ground. So
            Orbit Lens uses it to watch slow changes and to study fast ones
            afterwards; warnings come from MetMalaysia. Radar notices for
            watched places are always marked unconfirmed, and are never sent to
            authorities automatically.
          </p>
          <ul className="grid gap-2">
            {CAPABILITIES.map((c) => (
              <li
                key={c.hazard}
                className="grid gap-1 rounded-xl p-3 ring-1 ring-foreground/10 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3"
              >
                <div className="grid content-start gap-1">
                  <span className="font-medium">{c.hazard}</span>
                  <span
                    className={
                      "justify-self-start rounded-full px-2 py-0.5 text-[11px] font-medium " +
                      FIT[c.fit].className
                    }
                  >
                    {FIT[c.fit].label}
                  </span>
                </div>
                <div className="grid gap-0.5 text-sm">
                  <span>{c.use}</span>
                  <span className="text-xs text-muted-foreground">
                    In Orbit Lens: {c.inApp}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">
            L-band (NISAR) vs C-band (Sentinel-1)
          </h2>
          {BANDS.map((p) => (
            <p key={p} className="leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">
            Which polarization shows what
          </h2>
          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="w-1/4 p-2.5 font-medium">Change</th>
                  <th className="w-1/4 p-2.5 font-medium">Watch</th>
                  <th className="p-2.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {POLARIZATION_GUIDE.map((row) => (
                  <tr key={row.change} className="border-t align-top">
                    <td className="p-2.5 font-medium">{row.change}</td>
                    <td className="p-2.5">{row.watch}</td>
                    <td className="p-2.5 text-muted-foreground">{row.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">What NISAR could do next</h2>
          <ul className="grid gap-2">
            {FUTURE.map((f) => (
              <li key={f.title} className="grid gap-0.5">
                <span className="font-medium">{f.title}</span>
                <span className="text-sm text-muted-foreground">{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-2">
          <h2 className="text-xl font-semibold">Limits</h2>
          <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
            {LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">Learn more about radar</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {LEARN.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-full gap-0.5 rounded-xl p-3 ring-1 ring-foreground/10 hover:bg-muted/60"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {l.title}
                    <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  </span>
                  <span className="text-xs text-muted-foreground">{l.by}</span>
                  <span className="text-sm text-muted-foreground">
                    {l.text}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <footer className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          NISAR data: NASA/JPL-Caltech and ISRO, via the Alaska Satellite
          Facility DAAC. Sentinel-1: ESA Copernicus, processed by NASA OPERA.
          Population: WorldPop. RADARSAT Constellation Mission Imagery ©
          Government of Canada (2020); RADARSAT is an official mark of the
          Canadian Space Agency (open data,{" "}
          <a
            href={RCM_CREDIT.licence}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            licence
          </a>
          ). Measured with Orbit Lens (open source, MIT).
        </footer>
      </div>
    </main>
  )
}

const FIT = {
  watch: {
    label: "Watch it change",
    className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  after: {
    label: "After the event",
    className: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  rarely: {
    label: "Rarely",
    className: "bg-muted text-muted-foreground",
  },
  no: { label: "Not here", className: "bg-muted text-muted-foreground" },
}

function StoryCard({ story: s }: { story: Story }) {
  const link = toSearch({
    place: s.place,
    filter: s.app,
    period: "all",
    event: null,
  })
  return (
    <article className="grid gap-4 rounded-2xl p-4 ring-1 ring-foreground/10 sm:p-6">
      <div className="grid gap-1">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {s.kicker}
        </p>
        <h2 className="text-2xl leading-tight font-semibold text-balance">
          {s.title}
        </h2>
        <p className="text-sm text-muted-foreground">{s.dates}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {s.figures.map((f) => (
          <div key={f.label} className="min-w-0 rounded-lg bg-muted/60 p-2.5">
            <p className="truncate text-[11px] text-muted-foreground">
              {f.label}
            </p>
            <p className="truncate text-lg font-semibold tabular-nums">
              {f.value}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {f.sub}
            </p>
          </div>
        ))}
      </div>

      {s.images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {s.images.map((img) => (
            <figure key={img.src} className="grid gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.caption}
                loading="lazy"
                className="aspect-square w-full rounded-lg bg-muted object-contain ring-1 ring-foreground/10 [image-rendering:pixelated]"
              />
              <figcaption className="text-[11px] leading-snug text-muted-foreground">
                {img.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="grid gap-2 text-sm leading-relaxed">
        <h3 className="font-semibold">What NISAR shows</h3>
        {s.shows.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>

      <div className="grid gap-2 rounded-xl bg-amber-500/10 p-3 text-sm leading-relaxed">
        <h3 className="flex items-center gap-1.5 font-semibold">
          <LightbulbIcon className="size-4 text-amber-500" />
          Likely why (our hypothesis)
        </h3>
        {s.why.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>

      <div className="grid gap-1 text-sm leading-relaxed">
        <h3 className="font-semibold">What to watch next</h3>
        <p className="text-muted-foreground">{s.next}</p>
      </div>

      <Link
        href={`/${link}`}
        className="flex items-center gap-1.5 justify-self-start rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
      >
        Open {s.place.name} live
        <ExternalLinkIcon className="size-3.5" />
      </Link>
    </article>
  )
}
