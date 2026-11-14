import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end smoke tests for both apps (`vp run test:e2e`).
 * Paths are relative to this file (`e2e/`); web servers start from here too.
 *
 * Each app runs its own dev server on a dedicated port, so tests never reuse
 * a server you started yourself. Every test gets a fresh browser context,
 * which also means empty IndexedDB storage.
 */
const PIXEL_PORT = 4170;
const LEVEL_PORT = 4171;

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
      name: "pixel-editor",
      testMatch: "pixel-editor.spec.ts",
      use: { baseURL: `http://localhost:${PIXEL_PORT}` },
    },
    {
      name: "level-designer",
      testMatch: "level-designer.spec.ts",
      use: { baseURL: `http://localhost:${LEVEL_PORT}` },
    },
  ],
  webServer: [
    {
      command: `pnpm --dir ../apps/pixel-editor exec vp dev --port ${PIXEL_PORT} --strictPort`,
      url: `http://localhost:${PIXEL_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --dir ../apps/level-designer exec vp dev --port ${LEVEL_PORT} --strictPort`,
      url: `http://localhost:${LEVEL_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
