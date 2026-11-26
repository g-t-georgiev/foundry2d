import { LayerBitmapCache } from "@gs2d/render";
import type { Frame } from "../model/Sprite";

/**
 * Per-frame bitmap caches, so thumbnails and the animation preview only
 * re-upload layers whose pixels changed (the cache checks layer versions).
 */
export class FrameCompositor {
  private caches = new Map<string, LayerBitmapCache>();

  /** Draws the frame's visible layers (at their opacity) scaled into the rect. */
  draw(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    let cache = this.caches.get(frame.id);
    if (!cache) {
      cache = new LayerBitmapCache();
      this.caches.set(frame.id, cache);
    }
    ctx.imageSmoothingEnabled = false;
    for (const layer of frame.doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(cache.get(layer), x, y, width, height);
    }
    ctx.globalAlpha = 1;
  }

  /** Drops caches of frames that no longer exist. */
  prune(frames: readonly Frame[]): void {
    const live = new Set(frames.map((f) => f.id));
    for (const id of this.caches.keys()) {
      if (!live.has(id)) this.caches.delete(id);
    }
  }
}

/** Largest integer scale (min 1) or fractional fit for big sprites. */
export function fitScale(spriteW: number, spriteH: number, boxW: number, boxH: number): number {
  const fit = Math.min(boxW / spriteW, boxH / spriteH);
  return fit >= 1 ? Math.floor(fit) : fit;
}
