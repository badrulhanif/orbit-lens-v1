/**
 * Supabase (Postgres + file storage) over its REST API, from the server
 * only, with the secret key. Off unless SUPABASE_URL and
 * SUPABASE_SECRET_KEY (or SUPABASE_SECRET) are set. Tables: supabase/schema.sql.
 */

const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, "")
const KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET

export const supabaseEnabled = () => Boolean(URL_ && KEY)

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: KEY!,
    // Older service_role keys are JWTs and go here too; the newer
    // sb_secret_ keys only go in `apikey`.
    ...(KEY!.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}),
    ...extra,
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseEnabled()) throw new Error("Supabase isn't set up")
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string>) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok)
    throw new Error(
      `Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`
    )
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/** Rows from a table; `query` is PostgREST syntax, e.g. "status=eq.approved". */
export const select = <T>(table: string, query = "") =>
  call<T[]>(`/rest/v1/${table}?${query}`)

export const insert = <T>(table: string, row: Record<string, unknown>) =>
  call<T[]>(`/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  }).then((rows) => rows[0])

export const update = (
  table: string,
  query: string,
  patch: Record<string, unknown>
) =>
  call<unknown>(`/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  })

export const remove = (table: string, query: string) =>
  call<unknown>(`/rest/v1/${table}?${query}`, { method: "DELETE" })

/** Count matching rows (for rate limits). */
export async function count(table: string, query: string) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=id&${query}`, {
    method: "HEAD",
    headers: headers({ Prefer: "count=exact" }),
    cache: "no-store",
  })
  return Number(res.headers.get("content-range")?.split("/")[1] ?? 0)
}

/** Upload a file to a public bucket; returns its public URL. */
export async function upload(bucket: string, path: string, body: Blob) {
  await call(`/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { "Content-Type": body.type || "application/octet-stream" },
    body,
  })
  return `${URL_}/storage/v1/object/public/${bucket}/${path}`
}
