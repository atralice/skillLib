import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || "3002";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    actionTimeout: 0,
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "serial",
      testMatch: /.*\.db\.test\.ts/,
      use: { ...devices["Desktop Chrome"] },
      fullyParallel: false,
    },
    {
      name: "parallel",
      testMatch: /.*\.noDb\.test\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  outputDir: "playwright-results/",
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    port: parseInt(PORT, 10),
    reuseExistingServer: !process.env.CI,
  },
});
