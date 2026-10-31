import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of the demo app, in a real browser. They run against a production build:
//
//   npm run build:demo
//   npm run e2e                  # starts the demo on port 3100 itself, or reuses one that is running
//
// E2E_BASE_URL points them at a server that is already running somewhere else. CHROMIUM_PATH
// uses a Chromium you already have instead of the one Playwright installed.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const executablePath = process.env.CHROMIUM_PATH || undefined;
const allBrowsers = process.env.E2E_ALL_BROWSERS === "1";

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "../playwright-report" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    // Dates, locale and time zone are fixed so the pages do not depend on the machine.
    locale: "en-US",
    timezoneId: "UTC",
  },
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -w next-flipbook-demo -- -p ${port}`,
        cwd: "..",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, launchOptions: { executablePath } },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], launchOptions: { executablePath } },
    },
    // Other engines are opt-in: they need `npx playwright install firefox webkit`.
    ...(allBrowsers
      ? [
          { name: "firefox", testMatch: /(book|toolbar)\.spec\.ts/, use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 900 } } },
          { name: "webkit", testMatch: /(book|toolbar)\.spec\.ts/, use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } } },
        ]
      : []),
  ],
});
