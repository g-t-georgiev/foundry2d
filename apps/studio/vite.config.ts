import { defineConfig } from "vite-plus";
import path from "path";
import url from "url";
import { foundryPwa } from "../../packages/workspace/vite/pwa";
import { siteBase, siteProxy, siteRedirects, siteServer } from "../../packages/workspace/vite/site";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The studio: the site's root. In development it forwards /pixel/,
 * /levels/, /packer/ and /docs/ to the apps' own dev servers, so every app
 * runs on one origin and they share browser storage (`pnpm dev` starts them
 * all).
 */
export default defineConfig(({ command }) => ({
  base: siteBase("studio", command),
  plugins: [
    siteRedirects(),
    // The one installable app: it opens every tool's work files (roadmap 11.4).
    foundryPwa({
      name: "Game Studio 2D",
      shortName: "Studio",
      description: "Tools for 2D games: sprites, levels and spritesheets",
      themeColor: "#1b1d22",
      backgroundColor: "#121316",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1d22"/><rect x="10" y="10" width="20" height="20" rx="3" fill="#f59e0b"/><rect x="34" y="10" width="20" height="20" rx="3" fill="#22c55e"/><rect x="10" y="34" width="20" height="20" rx="3" fill="#3b82f6"/><rect x="34" y="34" width="20" height="20" rx="3" fill="#a855f7"/></svg>`,
      // Each type opens in its tool; the old names from before Game Studio 2D too.
      fileTypes: {
        "application/vnd.gs2d.sprite+json": [".gs2dsprite"],
        "application/vnd.gs2d.level+json": [".gs2dlevel"],
        "application/vnd.gs2d.pack+json": [".gs2dpack"],
        "application/vnd.foundry2d.sprite+json": [".f2dsprite"],
        "application/vnd.foundry2d.level+json": [".f2dlevel"],
        "application/vnd.foundry2d.pack+json": [".f2dpack"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@gs2d/core": path.resolve(__dirname, "../../packages/core/src"),
      "@gs2d/render": path.resolve(__dirname, "../../packages/render/src"),
      "@gs2d/workspace": path.resolve(__dirname, "../../packages/workspace/src"),
      "@gs2d/store": path.resolve(__dirname, "../../packages/store/src"),
      "@gs2d/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  server: { ...siteServer("studio"), proxy: siteProxy() },
  // A built site has every app in its folders: nothing to forward (preview would inherit it).
  preview: { port: 4180, proxy: {} },
}));
