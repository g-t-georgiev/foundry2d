import { defineConfig } from "vite-plus";
import path from "path";
import url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
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
