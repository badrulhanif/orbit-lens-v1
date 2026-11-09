import { isIP } from "node:net"
import type { NextRequest } from "next/server"

/**
 * Visitor log. The page pings this once per visit; we record the visitor's
 * IP (and its rough location) in the server log. Nothing is sent back to the
 * browser, so the IP never appears in the UI.
 */

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  const candidate = first || request.headers.get("x-real-ip")?.trim() || null
  if (!candidate) return null
  const ip = candidate.replace(/^::ffff:/, "")
  return isIP(ip) ? ip : null
}

function isPrivate(ip: string) {
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

type IpWhoResponse = {
  success: boolean
  ip: string
  city?: string
  region?: string
  country?: string
  connection?: { isp?: string }
}

/** Best-effort IP → place lookup for the log line. Never throws. */
async function describeIp(ip: string | null) {
  try {
    // With no IP (local dev), ipwho.is returns this machine's public IP.
    const res = await fetch(
      `https://ipwho.is/${ip ?? ""}?fields=success,ip,city,region,country,connection`,
      { signal: AbortSignal.timeout(5000) }
    )
    const data = (await res.json()) as IpWhoResponse
    if (!data.success) return { ip }
    return {
      ip: data.ip,
      place: [data.city, data.region, data.country]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .join(", "),
      isp: data.connection?.isp,
    }
  } catch {
    return { ip }
  }
}

export async function POST(request: NextRequest) {
  const raw = clientIp(request)
  const info = await describeIp(raw && !isPrivate(raw) ? raw : null)

  console.log(
    "[visit]",
    JSON.stringify({
      time: new Date().toISOString(),
      ip: info.ip ?? raw ?? "unknown",
      ...("place" in info && { place: info.place, isp: info.isp }),
      userAgent: request.headers.get("user-agent"),
      referer: request.headers.get("referer"),
    })
  )

  return new Response(null, { status: 204 })
}
