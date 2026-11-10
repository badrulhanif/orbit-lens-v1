import { defineConfig, devices } from "@playwright/test"

/**
 * Tests: `npm test` (all), `npm run test:unit` (no browser, no network).
 * End-to-end tests start the production build on port 3100, so run
 * `npm run build` first. They use the live data sources.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100" },
  projects: [
    { name: "unit", testMatch: /unit\/.*\.spec\.ts/ },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 900 },
      },
    },
  ],
  webServer: {
    command: "npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
