import { LayerBitmapCache } from "@foundry2d/render";
import type { LevelProject } from "../model/LevelProject";
import { tileLayerRendererFor } from "../render/tileLayerRenderer";

/**
 * Small PNG preview of the whole world (all levels) for the project
 * library. Tile layers only appear once their tileset image has loaded.
 */
export function renderProjectThumbnail(project: LevelProject, maxSize = 160): string | undefined {
  const bounds = project.getWorldBounds();
  if (!bounds || typeof document === "undefined") return undefined;
  const scale = Math.min(maxSize / bounds.width, maxSize / bounds.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.width * scale));
  canvas.height = Math.max(1, Math.round(bounds.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  const tiles = tileLayerRendererFor(project);
  const cache = new LayerBitmapCache();
  for (const level of project.levels) {
    const rect = level.worldRect(project.gridSize);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#18181c";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    for (const layer of level.doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      const custom = tiles(layer);
      if (custom) {
        custom(ctx, layer, rect, rect);
        continue;
      }
      ctx.drawImage(
        cache.get(layer, project.colorizerFor(layer.id), project.paletteVersion),
        rect.x,
        rect.y,
        rect.width,
        rect.height
      );
    }
    cache.clear();
  }
  return canvas.toDataURL("image/png");
}
