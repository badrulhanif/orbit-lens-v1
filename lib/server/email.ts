import nodemailer from "nodemailer"

/**
 * Sending email, either:
 *  - from your Gmail (GMAIL_USER + GMAIL_APP_PASSWORD, an app password from
 *    your Google account): free, no domain needed, ~500 emails a day
 *  - or through Resend (RESEND_API_KEY + ALERTS_FROM on a domain you own)
 * Off when neither is set.
 */

const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "")
const RESEND = process.env.RESEND_API_KEY
const FROM = process.env.ALERTS_FROM

export const emailEnabled = () =>
  Boolean((GMAIL_USER && GMAIL_PASS) || (RESEND && FROM))

let gmail: nodemailer.Transporter | null = null

/** The site's public address, for links in emails. */
export function appUrl(request?: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "")
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return request ? new URL(request.url).origin : "http://localhost:3000"
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!emailEnabled()) throw new Error("Email isn't set up")
  if (GMAIL_USER && GMAIL_PASS) {
    gmail ??= nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      // nodemailer waits minutes by default; a stuck send would hold up
      // the whole alerts run.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    })
    await gmail.sendMail({
      from: `"Orbit Lens" <${GMAIL_USER}>`,
      to,
      subject,
      html,
    })
    return
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok)
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** A plain, readable email body. */
export function emailHtml(
  title: string,
  paragraphs: string[],
  button?: { label: string; href: string },
  footer?: string
) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font:15px/1.5 system-ui,sans-serif;color:#111">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0 0 4px;color:#c2410c;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase">Orbit Lens</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("")}
${button ? `<p style="margin:20px 0"><a href="${escapeHtml(button.href)}" style="background:#ea580c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>` : ""}
${footer ? `<p style="margin:20px 0 0;color:#78716c;font-size:12px">${footer}</p>` : ""}
</div></body></html>`
}
