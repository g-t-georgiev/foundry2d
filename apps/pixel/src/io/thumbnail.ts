import type { GridDocument } from "@gs2d/core";
import { LayerBitmapCache } from "@gs2d/render";

/** Small composite preview (data URL) for the project library. */
export function renderThumbnail(doc: GridDocument<Uint32Array>, maxSize = 128): string {
  const scale = Math.max(1, Math.floor(maxSize / Math.max(doc.width, doc.height)));
  const canvas = document.createElement("canvas");
  canvas.width = doc.width * scale;
  canvas.height = doc.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  const cache = new LayerBitmapCache();
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(cache.get(layer), 0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/png");
}
