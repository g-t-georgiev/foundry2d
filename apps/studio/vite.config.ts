import { defineConfig } from "vite-plus";
import path from "path";
import url from "url";
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
  plugins: [siteRedirects()],
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
