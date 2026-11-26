import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end smoke tests for the apps (`vp run test:e2e`).
 * Paths are relative to this file (`e2e/`); web servers start from here too.
 *
 * Each app runs its own dev server on a dedicated port (4170–4173), never
 * the ports you develop on. Locally an already running test server is
 * reused (e.g. one kept alive by the VS Code Playwright extension); on CI a
 * fresh one is always started. Every test gets a fresh browser context,
 * which also means empty IndexedDB storage.
 */
const PIXEL_PORT = 4170;
const LEVEL_PORT = 4171;
const PACKER_PORT = 4172;
const DOCS_PORT = 4173;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "pixel",
      testMatch: "pixel.spec.ts",
      use: { baseURL: `http://localhost:${PIXEL_PORT}` },
    },
    {
      name: "levels",
      testMatch: "levels.spec.ts",
      use: { baseURL: `http://localhost:${LEVEL_PORT}` },
    },
    {
      name: "packer",
      testMatch: "packer.spec.ts",
      use: { baseURL: `http://localhost:${PACKER_PORT}` },
    },
    {
      name: "docs",
      testMatch: "docs.spec.ts",
      use: { baseURL: `http://localhost:${DOCS_PORT}` },
    },
  ],
  webServer: [
    {
      command: `pnpm --dir ../apps/pixel exec vp dev --port ${PIXEL_PORT} --strictPort`,
      url: `http://localhost:${PIXEL_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --dir ../apps/levels exec vp dev --port ${LEVEL_PORT} --strictPort`,
      url: `http://localhost:${LEVEL_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --dir ../apps/packer exec vp dev --port ${PACKER_PORT} --strictPort`,
      url: `http://localhost:${PACKER_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --dir ../apps/docs exec vp dev --port ${DOCS_PORT} --strictPort`,
      url: `http://localhost:${DOCS_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
