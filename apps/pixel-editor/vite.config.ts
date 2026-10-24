import { defineConfig } from "vite";
import path from "path";
import url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@foundry2d/core": path.resolve(__dirname, "../../packages/core/src"),
      "@foundry2d/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@foundry2d/store": path.resolve(__dirname, "../../packages/store/src"),
    },
  },
  server: {
    port: 3000,
  },
});
