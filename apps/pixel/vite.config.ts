import { defineConfig } from "vite-plus";
import path from "path";
import url from "url";
import { foundryPwa } from "../../packages/workspace/vite/pwa";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // Installable app: manifest, icon, offline service worker and file handlers (build only).
  plugins: [
    foundryPwa({
      name: "Game Studio 2D Pixel",
      shortName: "Pixel",
      description: "Pixel art and sprite animation editor",
      themeColor: "#1b1d22",
      backgroundColor: "#121316",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1d22"/><g fill="#ffee00"><rect x="16" y="12" width="8" height="8"/><rect x="24" y="12" width="8" height="8"/><rect x="32" y="12" width="8" height="8"/></g><g fill="#3b82f6"><rect x="12" y="20" width="8" height="8"/><rect x="40" y="20" width="8" height="8"/><rect x="12" y="28" width="8" height="8"/><rect x="40" y="28" width="8" height="8"/></g><g fill="#ef4444"><rect x="20" y="36" width="8" height="8"/><rect x="28" y="36" width="8" height="8"/><rect x="36" y="44" width="8" height="8"/><rect x="44" y="44" width="8" height="8"/></g></svg>`,
      // The old names from before Game Studio 2D still open.
      fileTypes: {
        "application/vnd.gs2d.sprite+json": [".gs2dsprite"],
        "application/vnd.foundry2d.sprite+json": [".f2dsprite"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@gs2d/core": path.resolve(__dirname, "../../packages/core/src"),
      "@gs2d/render": path.resolve(__dirname, "../../packages/render/src"),
      "@gs2d/workspace": path.resolve(__dirname, "../../packages/workspace/src"),
      "@gs2d/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@gs2d/store": path.resolve(__dirname, "../../packages/store/src"),
    },
  },
  server: {
    port: 3000,
  },
});
