import { defineConfig } from "vite-plus";
import path from "path";
import url from "url";
import { offlineWorker } from "../../packages/workspace/vite/pwa";
import { siteBase, siteServer } from "../../packages/workspace/vite/site";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ command }) => ({
  // Served under /docs/ of the studio's site (see vite/site.ts).
  base: siteBase("docs", command),
  // Works offline inside the installed studio (the hub registers it; so does a visit).
  plugins: [offlineWorker()],
  resolve: {
    alias: {
      "@gs2d/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  server: {
    ...siteServer("docs"),
    // The manual lives in docs/ at the repository root.
    fs: { allow: [path.resolve(__dirname, "../..")] },
  },
}));
