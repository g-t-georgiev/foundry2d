import { defineConfig } from "vite-plus";
import path from "path";
import url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // Relative URLs, so the built site works from any folder.
  base: "./",
  resolve: {
    alias: {
      "@foundry2d/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  server: {
    port: 3003,
    // The manual lives in docs/ at the repository root.
    fs: { allow: [path.resolve(__dirname, "../..")] },
  },
});
