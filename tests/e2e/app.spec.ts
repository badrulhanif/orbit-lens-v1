import { expect, test, type Page } from "@playwright/test"

/** Page errors and console errors (network hiccups from map tiles aside). */
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !/Failed to load resource|50[123]/.test(m.text())
    )
      errors.push(m.text())
  })
  return errors
}

async function open(page: Page, query: string) {
  const box = page.getByLabel("Search for a place")
  await box.fill("")
  await box.pressSequentially(query, { delay: 30 })
  await page.getByRole("option").first().click()
  await expect(page.locator("section[aria-label$='details']")).toBeVisible()
}

const panel = (page: Page) => page.locator("section[aria-label$='details']")

test("home page loads without errors and asks for nothing", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/")
  await expect(page.getByLabel("Search for a place")).toBeVisible()
  await page.waitForTimeout(2000)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(errors).toEqual([])
})

test("typo search still finds Malaysian places", async ({ page }) => {
  await page.goto("/")
  await page
    .getByLabel("Search for a place")
    .pressSequentially("segmat", { delay: 30 })
  await expect(page.getByRole("option").first()).toContainText("Segamat")
})

test("stats, list and map agree for every hazard filter", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto("/")
  await open(page, "Selangor")
  const stat = panel(page).locator("p.text-2xl").first()
  await expect(stat).not.toHaveText("…")
  for (const chip of ["All", "Flood", "Landslide", "Agriculture"]) {
    await page.getByRole("radio", { name: new RegExp(`^${chip}`) }).click()
    const header = panel(page).locator("h3").filter({ hasText: "In Selangor" })
    const listed = Number((await header.innerText()).match(/· (\d+)/)?.[1])
    expect(Number(await stat.innerText()), chip).toBe(listed)
    const onMap = Number(
      (await header.innerText()).match(/\((\d+) on map\)/)?.[1] ?? listed
    )
    await expect(page.locator(".maplibregl-marker"), chip).toHaveCount(onMap)
  }
  expect(errors).toEqual([])
})

test("a shared link reopens the same view", async ({ page }) => {
  await page.goto(
    "/?name=Selangor&at=3.35,101.5&area=Malaysia&kind=State&bbox=100.8,2.55,102,3.95&b=state%7CSelangor%7CMalaysia&f=flood&t=5y"
  )
  await expect(
    panel(page).getByRole("heading", { name: "Selangor", exact: true })
  ).toBeVisible()
  await expect(page.getByRole("radio", { name: /^Flood/ })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await expect(
    panel(page).getByRole("combobox", { name: "Period" })
  ).toContainText("Last 5 years")
})

test("about the data opens from the info icon", async ({ page }) => {
  await page.goto("/")
  await page
    .getByRole("button", { name: "About the data and its sources" })
    .click()
  await expect(page.getByRole("dialog")).toContainText(
    "Where everything on this map comes from"
  )
})

test("the area panel never scrolls sideways", async ({ page }) => {
  await page.goto("/")
  await open(page, "Perak")
  await expect(panel(page).locator("p.text-2xl").first()).not.toHaveText("…")
  for (const tab of ["Overview", "Report"]) {
    await panel(page).getByText(tab, { exact: true }).first().click()
    const wide = await panel(page).evaluate(
      (el) =>
        [el, ...el.querySelectorAll("*")].filter((n) => {
          const s = getComputedStyle(n)
          return (
            /(auto|scroll)/.test(s.overflowX) &&
            n.scrollWidth > n.clientWidth + 1
          )
        }).length
    )
    expect(wide, tab).toBe(0)
  }
})

test("watching a place lists it under the alerts bell", async ({ page }) => {
  await page.goto("/")
  await open(page, "Kuala Lumpur")
  await expect(panel(page).locator("p.text-2xl").first()).not.toHaveText("…")
  await panel(page)
    .getByRole("button", { name: /^Watch Kuala Lumpur/ })
    .click()
  // The watch box explains it (and offers email when that's set up).
  await expect(page.getByText("Watching Kuala Lumpur")).toBeVisible()
  // Radar change notices are a topic, explained as unconfirmed.
  await expect(
    page.getByRole("button", { name: /Radar changes/ })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText(/a reason to look, not proof/)).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /^Alerts/ }).click()
  await expect(page.getByText("Watching", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Kuala Lumpur", exact: true })
  ).toBeVisible()
})

test("scheduled jobs and moderation refuse callers without the secret", async ({
  request,
}) => {
  expect((await request.get("/api/cron/prewarm")).status()).toBe(401)
  expect((await request.get("/api/cron/alerts")).status()).toBe(401)
  const status = await (await request.get("/api/alerts/status")).json()
  expect(typeof status.email).toBe("boolean")
  const moderate = (await request.get("/api/reports/moderate")).status()
  expect([401, 501]).toContain(moderate)
})

test("findings page tells the stories and links back to the map", async ({
  page,
}) => {
  const errors = watchErrors(page)
  await page.goto("/findings")
  await expect(
    page.getByRole("heading", { name: /Malaysia through NISAR/ })
  ).toBeVisible()
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible()
  const live = page.getByRole("link", { name: /live$/ }).first()
  await expect(live).toHaveAttribute("href", /name=/)
  const width = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(width).toBeLessThanOrEqual(0)
  expect(errors).toEqual([])
})

test("radar layer has a time-lapse and a C-band comparison", async ({
  page,
}) => {
  await page.goto("/?name=Kuala%20Lumpur&at=3.1478,101.6953&kind=City")
  await page.getByRole("button", { name: /Signal quality/ }).click()
  const nav = page.getByRole("navigation", { name: "NISAR cycles" })
  await expect(
    nav.getByRole("button", { name: "Play time-lapse" })
  ).toBeVisible({
    timeout: 30_000,
  })
  const cband = nav.getByRole("button", { name: "C-band" })
  await expect(cband).toBeVisible()
  await cband.click()
  await expect(cband).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText(/Sentinel-1 (C-band ·|: )/).first()).toBeVisible({
    timeout: 30_000,
  })
})
