/**
 * Software raster helpers on straight-alpha RGBA images: the pieces the
 * packer and the exporters share (crop, copy, scale, rotate, extrude, trim
 * bounds, hashing).
 */

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

/** The image turned 90° clockwise (width and height swap). */
export function rotateImageCW(image: RgbaImage): RgbaImage {
  const out = createImage(image.height, image.width);
  const src = new Uint32Array(image.data.buffer, image.data.byteOffset, image.width * image.height);
  const dst = new Uint32Array(out.data.buffer);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      dst[x * out.width + (out.width - 1 - y)] = src[y * image.width + x];
    }
  }
  return out;
}

/** The image turned 90° counter-clockwise (undoes `rotateImageCW`). */
export function rotateImageCCW(image: RgbaImage): RgbaImage {
  return rotateImageCW(rotateImageCW(rotateImageCW(image)));
}

/** The image with its colours multiplied by alpha, for engines that blend premultiplied. */
export function premultiply(image: RgbaImage): RgbaImage {
  const out = createImage(image.width, image.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3];
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.round((image.data[i + c] * a) / 255);
    out.data[i + 3] = a;
  }
  return out;
}

/** Repeats the outermost pixels of the rect `r` of `sheet` outward by `e` pixels (against texture bleeding). */
export function extrudeEdges(sheet: RgbaImage, r: Rect, e: number): void {
  if (e <= 0) return;
  const px = (x: number, y: number) => (y * sheet.width + x) * 4;
  const copy = (fx: number, fy: number, tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= sheet.width || ty >= sheet.height) return;
    sheet.data.copyWithin(px(tx, ty), px(fx, fy), px(fx, fy) + 4);
  };
  for (let i = 1; i <= e; i++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      copy(x, r.y, x, r.y - i);
      copy(x, r.y + r.height - 1, x, r.y + r.height - 1 + i);
    }
  }
  for (let i = 1; i <= e; i++) {
    for (let y = r.y - e; y < r.y + r.height + e; y++) {
      copy(r.x, y, r.x - i, y);
      copy(r.x + r.width - 1, y, r.x + r.width - 1 + i, y);
    }
  }
}

/** A fast content hash (FNV-1a over size and pixels), for spotting identical images. */
export function imageHash(image: RgbaImage): string {
  let h = 0x811c9dc5 ^ image.width ^ (image.height << 16);
  const words = new Uint32Array(
    image.data.buffer,
    image.data.byteOffset,
    image.width * image.height
  );
  for (let i = 0; i < words.length; i++) {
    h ^= words[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${image.width}x${image.height}:${(h >>> 0).toString(36)}`;
}

/** Whether two images have the same size and pixels. */
export function sameImage(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
