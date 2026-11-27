import { Agent } from "node:http";
import process from "node:process";

/**
 * The Game Studio 2D site: every app under a path of one origin, so they
 * share browser storage (roadmap 11.2). The studio (the hub, at "/") serves
 * the others in development by forwarding their paths to their own servers;
 * a build puts them in folders of one output (`vp run build:site`).
 *
 * Ports start at `GS2D_PORT_BASE` (3000 by default; the end-to-end tests
 * use 4170): the studio on the base, the apps on the next ones.
 */

export const SITE_APPS = {
  studio: { path: "/", offset: 0 },
  pixel: { path: "/pixel/", offset: 1 },
  levels: { path: "/levels/", offset: 2 },
  packer: { path: "/packer/", offset: 3 },
  docs: { path: "/docs/", offset: 4 },
} as const;

export type SiteApp = keyof typeof SITE_APPS;

/** The first port: the studio's. */
export function portBase(): number {
  const value = Number(process.env.GS2D_PORT_BASE);
  return Number.isInteger(value) && value > 0 ? value : 3000;
}

/** The port of an app's own dev server. */
export const appPort = (app: SiteApp) => portBase() + SITE_APPS[app].offset;

/**
 * The app's base URL: its path in development (so the studio can forward to
 * it), relative in a build (so the site works from any folder).
 */
export const siteBase = (app: SiteApp, command: "serve" | "build") =>
  command === "build" ? "./" : SITE_APPS[app].path;

/** Dev-server settings for an app of the site. */
export const siteServer = (app: SiteApp) => ({ port: appPort(app), strictPort: true });

/**
 * The studio's forwarding of every app's path to its own dev server (with
 * hot reload). Connections are kept open and reused: a page loads hundreds
 * of modules in development, and a new connection for each ran Windows out
 * of local ports during the end-to-end tests (EADDRINUSE).
 */
export function siteProxy(): Record<string, { target: string; ws: boolean; agent: Agent }> {
  const agent = new Agent({ keepAlive: true });
  return Object.fromEntries(
    (Object.keys(SITE_APPS) as SiteApp[])
      .filter((app) => app !== "studio")
      .map((app) => [
        `^${SITE_APPS[app].path}`,
        { target: `http://localhost:${appPort(app)}`, ws: true, agent },
      ])
  );
}

interface Middlewares {
  use(
    handler: (
      req: { url?: string },
      res: { statusCode: number; setHeader(name: string, value: string): void; end(): void },
      next: () => void
    ) => void
  ): void;
}

/** "/pixel" → "/pixel/" (the apps only answer under their path with the slash). */
export function siteRedirects() {
  const paths: string[] = Object.values(SITE_APPS)
    .map((a) => a.path)
    .filter((p) => p !== "/");
  return {
    name: "gs2d-site-redirects",
    configureServer(server: { middlewares: Middlewares }) {
      server.middlewares.use((req, res, next) => {
        const [path, query] = (req.url ?? "").split(/(?=\?)/);
        if (!paths.includes(`${path}/`)) return next();
        res.statusCode = 301;
        res.setHeader("Location", `${path}/${query ?? ""}`);
        res.end();
      });
    },
  };
}
