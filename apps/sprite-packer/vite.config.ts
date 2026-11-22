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
      name: "Foundry2D Sprite Packer",
      shortName: "Sprite Packer",
      description: "Packs images into spritesheets with engine data",
      themeColor: "#1b1d22",
      backgroundColor: "#121316",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1d22"/><g><rect x="10" y="10" width="24" height="20" fill="#3b82f6"/><rect x="36" y="10" width="18" height="28" fill="#facc15"/><rect x="10" y="32" width="14" height="22" fill="#ef4444"/><rect x="26" y="32" width="8" height="10" fill="#22c55e"/><rect x="26" y="44" width="28" height="10" fill="#a855f7"/><rect x="36" y="40" width="18" height="2" fill="#38bdf8"/></g></svg>`,
      fileTypes: { "application/vnd.foundry2d.pack+json": [".f2dpack"] },
    }),
  ],
  resolve: {
    alias: {
      "@foundry2d/atlas": path.resolve(__dirname, "../../packages/atlas/src"),
      "@foundry2d/core": path.resolve(__dirname, "../../packages/core/src"),
      "@foundry2d/formats": path.resolve(__dirname, "../../packages/formats/src"),
      "@foundry2d/render": path.resolve(__dirname, "../../packages/render/src"),
      "@foundry2d/workspace": path.resolve(__dirname, "../../packages/workspace/src"),
      "@foundry2d/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  server: {
    port: 3002,
  },
});
