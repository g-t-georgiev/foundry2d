import type { CellBuffer, GridLayer, Rect } from "@foundry2d/core";
import type { LayerRenderer } from "@foundry2d/render";
import type { Level, LevelProject } from "../model/LevelProject";
import type { AutoStack } from "../model/autoRules";
import { decodeTile, tileSourceRect } from "../model/tiles";

/**
 * Returns a renderer for Tiles layers (and `undefined` for other layers, which
 * keep the default bitmap path). Tiles are drawn straight from the tileset
 * image; only cells inside the visible area are touched.
 */
export function tileLayerRendererFor(
  project: LevelProject
): (layer: GridLayer<CellBuffer>, level?: Level) => LayerRenderer | undefined {
  return (layer, level) => {
    const def = project.getLayerDefForLayer(layer.id);
    if (def?.type !== "Tiles") return undefined;
    return (ctx, target, dest, visible) => {
      const tileset = project.getTileset(def.tilesetUid);
      const image = tileset ? project.getTilesetImage(tileset) : undefined;
      // Auto-layer cells with stacked or offset tiles.
      const stack = level?.autoStacks.get(layer.id);
      drawTiles(ctx, target, dest, visible, stack, (value, dx, dy, w, h) => {
        const decoded = decodeTile(value);
        const src = decoded && tileset ? tileSourceRect(tileset, decoded.tileId) : null;
        if (!decoded || !src || !image) {
          // No tileset (yet): show placeholders so painted cells stay visible.
          ctx.fillStyle = "rgba(255, 0, 255, 0.45)";
          ctx.fillRect(dx, dy, w, h);
          return;
        }
        if (!decoded.flipX && !decoded.flipY) {
          ctx.drawImage(image, src.x, src.y, src.width, src.height, dx, dy, w, h);
          return;
        }
        ctx.save();
        ctx.translate(dx + (decoded.flipX ? w : 0), dy + (decoded.flipY ? h : 0));
        ctx.scale(decoded.flipX ? -1 : 1, decoded.flipY ? -1 : 1);
        ctx.drawImage(image, src.x, src.y, src.width, src.height, 0, 0, w, h);
        ctx.restore();
      });
    };
  };
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  layer: GridLayer<CellBuffer>,
  dest: Rect,
  visible: Rect,
  stack: AutoStack | undefined,
  draw: (value: number, x: number, y: number, w: number, h: number) => void
): void {
  const cellW = dest.width / layer.width;
  const cellH = dest.height / layer.height;
  const x0 = Math.max(0, Math.floor((visible.x - dest.x) / cellW));
  const y0 = Math.max(0, Math.floor((visible.y - dest.y) / cellH));
  const x1 = Math.min(layer.width - 1, Math.ceil((visible.x + visible.width - dest.x) / cellW));
  const y1 = Math.min(layer.height - 1, Math.ceil((visible.y + visible.height - dest.y) / cellH));
  ctx.imageSmoothingEnabled = false;
  for (let y = y0; y <= y1; y++) {
    const row = y * layer.width;
    for (let x = x0; x <= x1; x++) {
      const value = layer.data[row + x];
      if (value === 0) continue;
      const placements = stack?.get(row + x);
      if (!placements) {
        draw(value, dest.x + x * cellW, dest.y + y * cellH, cellW, cellH);
        continue;
      }
      // Lowest priority first, so the first rule's tile ends up on top.
      for (let i = placements.length - 1; i >= 0; i--) {
        const p = placements[i];
        draw(p.tile, dest.x + x * cellW + p.dx, dest.y + y * cellH + p.dy, cellW, cellH);
      }
    }
  }
}
