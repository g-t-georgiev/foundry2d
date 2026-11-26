import type { CellBuffer, GridLayer } from "@gs2d/core";
import { createSurface, type Surface } from "./canvas";

/**
 * Maps a cell value to a packed 0xAABBGGRR color. Used for id-based layers
 * (IntGrid, collision maps). Omit it for layers that already hold RGBA.
 */
export type CellColorizer = (value: number) => number;

interface Entry {
  layer: GridLayer<CellBuffer>;
  surface: Surface;
  width: number;
  height: number;
  version: number;
  paletteVersion: number;
  pixels: Uint32Array;
  image: ImageData;
}

/**
 * Keeps one 1-cell-per-pixel bitmap per layer and refreshes it only when the
 * layer's `version` (or the palette) changes. Drawing a layer is then a single
 * scaled `drawImage`, instead of one `fillRect` per cell.
 */
export class LayerBitmapCache {
  private entries = new Map<string, Entry>();

  /** Returns an up-to-date bitmap for the layer. */
  get(
    layer: GridLayer<CellBuffer>,
    colorize?: CellColorizer,
    paletteVersion = 0
  ): Surface["canvas"] {
    let entry = this.entries.get(layer.id);
    const { width, height } = layer;

    if (!entry || entry.layer !== layer || entry.width !== width || entry.height !== height) {
      const surface = createSurface(width, height);
      const pixels = new Uint32Array(width * height);
      const image = new ImageData(new Uint8ClampedArray(pixels.buffer), width, height);
      entry = { layer, surface, width, height, version: -1, paletteVersion: -1, pixels, image };
      this.entries.set(layer.id, entry);
    }

    if (entry.version !== layer.version || entry.paletteVersion !== paletteVersion) {
      if (colorize) {
        const src = layer.data;
        const dst = entry.pixels;
        for (let i = 0; i < src.length; i++) dst[i] = colorize(src[i]);
      } else {
        // RGBA layers: 0xAABBGGRR words are already RGBA bytes on little-endian hosts.
        entry.pixels.set(layer.data);
      }
      entry.surface.ctx.putImageData(entry.image, 0, 0);
      entry.version = layer.version;
      entry.paletteVersion = paletteVersion;
    }

    return entry.surface.canvas;
  }

  /** Drops cached bitmaps of layers not in `keepIds`. */
  prune(keepIds: Iterable<string>): void {
    const keep = new Set(keepIds);
    for (const id of this.entries.keys()) {
      if (!keep.has(id)) this.entries.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
