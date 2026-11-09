import { fetchJson, mapLimit } from "@/lib/server/util"

/**
 * Short plain-text summaries (first sentences of the article) for English
 * Wikipedia links, fetched 20 at a time and kept for a day.
 */

const DAY = 24 * 60 * 60_000
const kept = new Map<string, { at: number; text: string | null }>()

export const wikiTitle = (url: string | null | undefined) => {
  const m = url?.match(/^https:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/)
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null
}

export async function wikipediaSummaries(
  urls: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const titles = [...new Set(urls.map(wikiTitle).filter((t) => t !== null))]
  const missing = titles.filter((t) => {
    const k = kept.get(t)
    return !k || Date.now() - k.at > DAY
  })
  const chunks: string[][] = []
  for (let i = 0; i < missing.length; i += 20)
    chunks.push(missing.slice(i, i + 20))

  await mapLimit(chunks, 3, async (chunk) => {
    const url = new URL("https://en.wikipedia.org/w/api.php")
    url.search = new URLSearchParams({
      action: "query",
      prop: "extracts",
      exintro: "1",
      explaintext: "1",
      exsentences: "3",
      exlimit: "20",
      titles: chunk.join("|"),
      redirects: "1",
      format: "json",
    }).toString()
    const data = await fetchJson<{
      query?: {
        redirects?: { from: string; to: string }[]
        normalized?: { from: string; to: string }[]
        pages?: Record<string, { title: string; extract?: string }>
      }
    }>(url, { timeoutMs: 8000 })
    const q = data.query ?? {}
    const byTitle = new Map(
      Object.values(q.pages ?? {}).map((p) => [p.title, p.extract ?? null])
    )
    for (const t of chunk) {
      let to = t
      to = q.normalized?.find((n) => n.from === to)?.to ?? to
      to = q.redirects?.find((r) => r.from === to)?.to ?? to
      kept.set(t, { at: Date.now(), text: byTitle.get(to)?.trim() || null })
    }
  })

  const out = new Map<string, string>()
  for (const t of titles) {
    const text = kept.get(t)?.text
    if (text) out.set(t, text)
  }
  return out
}
