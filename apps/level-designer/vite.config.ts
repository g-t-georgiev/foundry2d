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
      name: "Foundry2D Level Designer",
      shortName: "Level Designer",
      description: "Tile and entity level designer",
      themeColor: "#1b1d22",
      backgroundColor: "#121316",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1d22"/><rect x="10" y="40" width="44" height="14" fill="#8b5a2b"/><rect x="10" y="36" width="44" height="6" fill="#4caf50"/><rect x="34" y="22" width="14" height="6" fill="#e0b070"/><rect x="16" y="24" width="8" height="12" fill="#3b82f6"/><path d="M10 10h44v44H10z" fill="none" stroke="#3a3f47" stroke-width="2"/></svg>`,
      fileTypes: { "application/vnd.foundry2d.level+json": [".f2dlevel"] },
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
    port: 3001,
  },
});
