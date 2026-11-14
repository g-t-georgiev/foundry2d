import type { GridLayer } from "@foundry2d/core";
import type { Frame } from "../model/Sprite";

/** Straight (non-premultiplied) RGBA pixels, row-major; the same shape as `ImageData`. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Bytes of a pixel layer (0xAABBGGRR words are RGBA bytes on little-endian hosts). */
function layerBytes(layer: GridLayer<Uint32Array>): Uint8Array {
  return new Uint8Array(layer.data.buffer, layer.data.byteOffset, layer.data.byteLength);
}

/**
 * Composites a frame in software ("source over", honouring visibility and
 * layer opacity). Doing it here rather than on a canvas keeps exports exact
 * (no colour management or premultiplication rounding) and testable.
 * With `layerId`, only that layer is exported, at full opacity.
 */
export function compositeFrame(frame: Frame, layerId?: string): RgbaImage {
  const { width, height, layers } = frame.doc;
  const out = createImage(width, height);
  const dst = out.data;
  const sources = layerId
    ? layers.filter((l) => l.id === layerId).map((l) => ({ layer: l, opacity: 1 }))
    : layers
        .filter((l) => l.visible && l.opacity > 0)
        .map((l) => ({ layer: l, opacity: l.opacity }));

  for (const { layer, opacity } of sources) {
    const src = layerBytes(layer);
    for (let i = 0; i < src.length; i += 4) {
      const sa = (src[i + 3] / 255) * opacity;
      if (sa <= 0) continue;
      const da = dst[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst[i + c] = Math.round((src[i + c] * sa + dst[i + c] * da * (1 - sa)) / oa);
      }
      dst[i + 3] = Math.round(oa * 255);
    }
  }
  return out;
}

/** Nearest-neighbour upscale by an integer factor. */
export function scaleImage(image: RgbaImage, scale: number): RgbaImage {
  const s = Math.max(1, Math.floor(scale));
  if (s === 1) return image;
  const out = createImage(image.width * s, image.height * s);
  const src = new Uint32Array(image.data.buffer, image.data.byteOffset, image.width * image.height);
  const dst = new Uint32Array(out.data.buffer);
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / s) * image.width;
    for (let x = 0; x < out.width; x++) dst[y * out.width + x] = src[sy + Math.floor(x / s)];
  }
  return out;
}

/** Smallest rectangle holding every non-transparent pixel, or `null` if all are transparent. */
export function opaqueBounds(image: RgbaImage): Rect | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function cropImage(image: RgbaImage, rect: Rect): RgbaImage {
  const out = createImage(rect.width, rect.height);
  for (let y = 0; y < rect.height; y++) {
    const start = ((rect.y + y) * image.width + rect.x) * 4;
    out.data.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
  }
  return out;
}

/** Copies `src` into `dst` at (x, y) (no blending). */
export function blit(dst: RgbaImage, src: RgbaImage, x: number, y: number): void {
  for (let row = 0; row < src.height; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= dst.height) continue;
    const from = row * src.width * 4;
    const to = (ty * dst.width + x) * 4;
    dst.data.set(src.data.subarray(from, from + src.width * 4), to);
  }
}

/** Flattens transparency onto a solid colour (for formats without alpha). */
export function flattenOnto(
  image: RgbaImage,
  background: { r: number; g: number; b: number }
): RgbaImage {
  const out = createImage(image.width, image.height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out.data[i] = Math.round(data[i] * a + background.r * (1 - a));
    out.data[i + 1] = Math.round(data[i + 1] * a + background.g * (1 - a));
    out.data[i + 2] = Math.round(data[i + 2] * a + background.b * (1 - a));
    out.data[i + 3] = 255;
  }
  return out;
}

export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.replace(/./g, "$&$&") : clean;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}
