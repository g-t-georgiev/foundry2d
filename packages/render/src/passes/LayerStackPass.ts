import type { CellBuffer, Dimensions, GridLayer, Position, Rect } from "@foundry2d/core";
import type { RenderContext, RenderPass } from "../types";
import { LayerBitmapCache, type CellColorizer } from "../LayerBitmapCache";

export type LayerStackMode = "composite" | "focus";

/**
 * Draws one layer itself instead of the default "one pixel per cell" bitmap,
 * e.g. tile layers drawn from a tileset image. Called with `globalAlpha`
 * already set. `dest` is the layer rectangle and `visible` the visible area,
 * both in world units, for culling.
 */
export type LayerRenderer = (
  ctx: CanvasRenderingContext2D,
  layer: GridLayer<CellBuffer>,
  dest: Rect,
  visible: Rect
) => void;

export interface LayerStackSource {
  layers: readonly GridLayer<CellBuffer>[];
  activeLayerId: string | null;
}

export interface LayerStackPassOptions {
  getSource: () => LayerStackSource | null;
  /** World size of one cell. */
  cellSize: Dimensions;
  /** World offset of the grid's top-left corner (e.g. a level's position in the world). */
  getOrigin?: () => Position;
  /**
   * `composite`: every visible layer at its opacity (preview/export look).
   * `focus`: non-active layers dimmed so the active one stands out.
   */
  getMode?: () => LayerStackMode;
  /** Alpha multiplier for inactive layers in focus mode. */
  dimming?: number;
  /** Value → color mapping for id layers. Omit for RGBA layers. */
  colorize?: CellColorizer;
  /**
   * Per-layer value → color mapping (e.g. each IntGrid layer has its own
   * palette). Takes precedence over `colorize`.
   */
  getColorizer?: (layer: GridLayer<CellBuffer>) => CellColorizer | undefined;
  /** Overall alpha multiplier for the whole stack (e.g. onion skins). */
  getAlpha?: () => number;
  /** Custom per-layer drawing; takes precedence over the bitmap path. */
  getLayerRenderer?: (layer: GridLayer<CellBuffer>) => LayerRenderer | undefined;
  /** Bump when the colorize mapping changes so cached bitmaps refresh. */
  getPaletteVersion?: () => number;
  /**
   * World rectangle the layers are clipped to. Layers with bigger cells
   * (scale) can stick out of the document when the sizes don't divide.
   */
  getClip?: () => Rect | null;
}

/** Draws a stack of grid layers bottom (index 0) to top. */
export class LayerStackPass implements RenderPass {
  readonly id: string;
  readonly space = "world";
  enabled = true;
  readonly cache = new LayerBitmapCache();

  constructor(
    private readonly options: LayerStackPassOptions,
    id = "layers"
  ) {
    this.id = id;
  }

  render(rc: RenderContext): void {
    const source = this.options.getSource();
    if (!source) return;

    const { ctx } = rc;
    const { cellSize, colorize } = this.options;
    const mode = this.options.getMode?.() ?? "composite";
    const dimming = this.options.dimming ?? 0.25;
    const paletteVersion = this.options.getPaletteVersion?.() ?? 0;
    const origin = this.options.getOrigin?.() ?? { x: 0, y: 0 };
    const stackAlpha = this.options.getAlpha?.() ?? 1;
    if (stackAlpha <= 0) return;

    ctx.imageSmoothingEnabled = false;
    const clip = this.options.getClip?.();
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
    }

    for (const layer of source.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const isActive = layer.id === source.activeLayerId;
      const alpha =
        stackAlpha * (mode === "focus" && !isActive ? layer.opacity * dimming : layer.opacity);

      // Layers with their own grid (scale) have bigger or smaller cells.
      const dest = {
        x: origin.x,
        y: origin.y,
        width: layer.width * cellSize.width * layer.scale,
        height: layer.height * cellSize.height * layer.scale,
      };
      const custom = this.options.getLayerRenderer?.(layer);
      if (custom) {
        ctx.globalAlpha = alpha;
        custom(ctx, layer, dest, rc.camera.getVisibleWorldRect(rc.viewWidth, rc.viewHeight));
        continue;
      }
      const colorizer = this.options.getColorizer?.(layer) ?? colorize;
      const bitmap = this.cache.get(layer, colorizer, paletteVersion);
      ctx.globalAlpha = alpha;
      ctx.drawImage(bitmap, dest.x, dest.y, dest.width, dest.height);
    }
    ctx.globalAlpha = 1;
    if (clip) ctx.restore();

    this.cache.prune(source.layers.map((l) => l.id));
  }

  dispose(): void {
    this.cache.clear();
  }
}
