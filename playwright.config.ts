import { defineConfig, devices } from "@playwright/test";

const taskEnvironment = (
  globalThis as unknown as {
    process: { env: Record<string, string | undefined> };
  }
).process.env;

export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: taskEnvironment.QRECALL_BASE_URL || "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: taskEnvironment.QRECALL_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
