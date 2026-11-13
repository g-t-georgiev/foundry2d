import type { CellBuffer, Dimensions, GridLayer, Position } from "@foundry2d/core";
import type { RenderContext, RenderPass } from "../types";
import { LayerBitmapCache, type CellColorizer } from "../LayerBitmapCache";

export type LayerStackMode = "composite" | "focus";

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
  /** Bump when the colorize mapping changes so cached bitmaps refresh. */
  getPaletteVersion?: () => number;
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

    ctx.imageSmoothingEnabled = false;

    for (const layer of source.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const isActive = layer.id === source.activeLayerId;
      const alpha = mode === "focus" && !isActive ? layer.opacity * dimming : layer.opacity;

      const colorizer = this.options.getColorizer?.(layer) ?? colorize;
      const bitmap = this.cache.get(layer, colorizer, paletteVersion);
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        bitmap,
        origin.x,
        origin.y,
        layer.width * cellSize.width,
        layer.height * cellSize.height
      );
    }
    ctx.globalAlpha = 1;

    this.cache.prune(source.layers.map((l) => l.id));
  }

  dispose(): void {
    this.cache.clear();
  }
}
