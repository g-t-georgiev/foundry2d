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
      name: "Foundry2D Pixel Editor",
      shortName: "Pixel Editor",
      description: "Pixel art and sprite animation editor",
      themeColor: "#1b1d22",
      backgroundColor: "#121316",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1d22"/><g fill="#ffee00"><rect x="16" y="12" width="8" height="8"/><rect x="24" y="12" width="8" height="8"/><rect x="32" y="12" width="8" height="8"/></g><g fill="#3b82f6"><rect x="12" y="20" width="8" height="8"/><rect x="40" y="20" width="8" height="8"/><rect x="12" y="28" width="8" height="8"/><rect x="40" y="28" width="8" height="8"/></g><g fill="#ef4444"><rect x="20" y="36" width="8" height="8"/><rect x="28" y="36" width="8" height="8"/><rect x="36" y="44" width="8" height="8"/><rect x="44" y="44" width="8" height="8"/></g></svg>`,
      fileTypes: { "application/vnd.foundry2d.sprite+json": [".f2dsprite"] },
    }),
  ],
  resolve: {
    alias: {
      "@foundry2d/core": path.resolve(__dirname, "../../packages/core/src"),
      "@foundry2d/render": path.resolve(__dirname, "../../packages/render/src"),
      "@foundry2d/workspace": path.resolve(__dirname, "../../packages/workspace/src"),
      "@foundry2d/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@foundry2d/store": path.resolve(__dirname, "../../packages/store/src"),
    },
  },
  server: {
    port: 3000,
  },
});
