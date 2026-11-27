import process from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { appPort, SITE_APPS, type SiteApp } from "../packages/workspace/vite/site";

/**
 * Browser end-to-end tests for the apps (`vp run test:e2e`).
 * Paths are relative to this file (`e2e/`); web servers start from here too.
 *
 * The tests use the site as it is developed (roadmap 11.2): every app on
 * one origin under its path, the studio forwarding to the apps' own dev
 * servers. They run on ports 4170–4174 (`GS2D_PORT_BASE`), never the ones
 * you develop on. Locally an already running test server is reused (e.g.
 * one kept alive by the VS Code Playwright extension); on CI fresh ones are
 * always started. Every test gets a fresh browser context, which also means
 * empty IndexedDB storage.
 */
const PORT_BASE = "4170";
process.env.GS2D_PORT_BASE = PORT_BASE;
const SITE = `http://localhost:${appPort("studio")}`;

/** A project whose tests open one app, at its path on the site. */
const project = (app: SiteApp, spec: string) => ({
  name: app,
  testMatch: spec,
  use: { baseURL: `${SITE}${SITE_APPS[app].path}` },
});

/** Every app's dev server, and the studio in front of them. */
const server = (app: SiteApp) => ({
  command: "vp dev",
  cwd: `../apps/${app}`,
  url: `http://localhost:${appPort(app)}${SITE_APPS[app].path}`,
  env: { GS2D_PORT_BASE: PORT_BASE },
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
});

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
    project("pixel", "pixel.spec.ts"),
    project("levels", "levels.spec.ts"),
    project("packer", "packer.spec.ts"),
    project("docs", "docs.spec.ts"),
    project("studio", "site.spec.ts"),
  ],
  webServer: (Object.keys(SITE_APPS) as SiteApp[]).map(server),
});
