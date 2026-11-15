import type { CellBuffer, GridLayer, Rect } from "@foundry2d/core";
import type { LayerRenderer } from "@foundry2d/render";
import type { Level, LevelProject } from "../model/LevelProject";
import type { AutoStack } from "../model/autoRules";
import { decodeTile, tileSourceRect, tilesetGrid } from "../model/tiles";
import type { TilesetDef } from "../model/types";

/**
 * Below this many screen pixels per cell, a Tiles layer is drawn from a
 * one-pixel-per-cell overview (each tile's average colour) instead of tile
 * by tile. Zoomed out on a 256×256 level that is one image copy instead of
 * tens of thousands, and at that size the two look the same.
 */
const OVERVIEW_BELOW_PX = 3;

/** Average colour (packed RGBA, little-endian) of every tile of a tileset image. */
const tileColorCache = new WeakMap<HTMLImageElement, { key: string; colors: Uint32Array }>();

function tileColors(tileset: TilesetDef, image: HTMLImageElement): Uint32Array | null {
  const key = `${tileset.tileSize}:${tileset.spacing}:${tileset.padding}`;
  const cached = tileColorCache.get(image);
  if (cached?.key === key) return cached.colors;
  const { columns, rows } = tilesetGrid(tileset);
  if (columns === 0 || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const colors = new Uint32Array(columns * rows);
  for (let id = 0; id < colors.length; id++) {
    const src = tileSourceRect(tileset, id)!;
    // Alpha-weighted average, so transparent pixels don't darken the colour.
    let r = 0,
      g = 0,
      b = 0,
      a = 0,
      n = 0;
    for (let y = src.y; y < src.y + src.height; y++) {
      for (let x = src.x; x < src.x + src.width; x++) {
        const i = (y * width + x) * 4;
        const alpha = data[i + 3];
        r += data[i] * alpha;
        g += data[i + 1] * alpha;
        b += data[i + 2] * alpha;
        a += alpha;
        n++;
      }
    }
    if (a === 0) continue;
    colors[id] =
      ((Math.round(a / n) << 24) |
        (Math.round(b / a) << 16) |
        (Math.round(g / a) << 8) |
        Math.round(r / a)) >>>
      0;
  }
  tileColorCache.set(image, { key, colors });
  return colors;
}

/** One-pixel-per-cell overview of a Tiles layer, rebuilt when the layer changes. */
const overviewCache = new WeakMap<
  GridLayer<CellBuffer>,
  { version: number; colors: Uint32Array; canvas: HTMLCanvasElement }
>();

function overview(layer: GridLayer<CellBuffer>, colors: Uint32Array): HTMLCanvasElement | null {
  const cached = overviewCache.get(layer);
  if (cached && cached.version === layer.version && cached.colors === colors) return cached.canvas;
  const canvas = cached?.canvas ?? document.createElement("canvas");
  canvas.width = layer.width;
  canvas.height = layer.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const pixels = new Uint32Array(layer.width * layer.height);
  for (let i = 0; i < pixels.length; i++) {
    const tile = decodeTile(layer.data[i]);
    if (tile) pixels[i] = colors[tile.tileId] ?? 0xff_ff_00_ff; // unknown id: magenta
  }
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.buffer), layer.width, layer.height),
    0,
    0
  );
  overviewCache.set(layer, { version: layer.version, colors, canvas });
  return canvas;
}

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
      // Zoomed far out: draw the one-pixel-per-cell overview.
      const screenCell = (dest.width / target.width) * Math.abs(ctx.getTransform().a);
      const colors =
        tileset && image && screenCell < OVERVIEW_BELOW_PX ? tileColors(tileset, image) : null;
      const bitmap = colors ? overview(target, colors) : null;
      if (bitmap) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, dest.x, dest.y, dest.width, dest.height);
        return;
      }
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
