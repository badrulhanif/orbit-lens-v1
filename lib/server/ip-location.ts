import { isIP } from "node:net"

import { fetchJson, TtlCache } from "@/lib/server/util"

/** Caller's IP from the proxy headers set by the host. */
export function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  const candidate = first || headers.get("x-real-ip")?.trim() || null
  if (!candidate) return null
  const ip = candidate.replace(/^::ffff:/, "")
  return isIP(ip) ? ip : null
}

/** Loopback / LAN addresses can't be geolocated. */
function isPrivateIp(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number)
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const lower = ip.toLowerCase()
  return (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  )
}

type IpLocation = {
  ip: string | null
  latitude: number
  longitude: number
  place: string
  isp: string | null
}

type IpWhoResponse = {
  success: boolean
  ip: string
  city?: string
  region?: string
  country?: string
  latitude?: number
  longitude?: number
  connection?: { isp?: string }
}

const cache = new TtlCache<IpLocation | null>(5000, 6 * 60 * 60_000)

/**
 * Rough location for an IP (city level). Pass null to look up this server's
 * own public IP, which is the visitor's IP in local dev. Never throws; a
 * lookup that failed (timeout, service down) isn't kept, so it's retried.
 */
function lookupIp(ip: string | null): Promise<IpLocation | null> {
  return cache
    .get(ip ?? "self", async () => {
      const data = await fetchJson<IpWhoResponse>(
        `https://ipwho.is/${ip ?? ""}?fields=success,ip,city,region,country,latitude,longitude,connection`,
        { timeoutMs: 5000 }
      )
      if (!data.success || data.latitude == null || data.longitude == null) {
        return null
      }
      return {
        ip: data.ip,
        latitude: data.latitude,
        longitude: data.longitude,
        place: [data.city, data.region, data.country]
          .filter((v, i, arr) => v && arr.indexOf(v) === i)
          .join(", "),
        isp: data.connection?.isp ?? null,
      }
    })
    .catch(() => null) // Unknown location; callers cope.
}

/** The visitor's rough location, from their request headers. */
export async function locateRequest(headers: Headers) {
  const ip = clientIp(headers)
  return lookupIp(ip && !isPrivateIp(ip) ? ip : null)
}
