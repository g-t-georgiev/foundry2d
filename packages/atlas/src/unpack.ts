import type { SheetFrame, Turn } from "@gs2d/formats";
import {
  blit,
  createImage,
  cropImage,
  rotateImageCCW,
  rotateImageCW,
  type RgbaImage,
} from "./raster";

/** Sprites bigger than this can't come from a real sheet; their data is damaged. */
const MAX_SIDE = 16384;

/**
 * Cuts one sprite back out of a sheet: the reverse of `buildAtlas`. Rotated
 * frames are turned upright (`turn` is how they were stored) and trimmed ones get their transparent border
 * back. Throws when the frame doesn't fit the sheet.
 */
export function unpackFrame(sheet: RgbaImage, f: SheetFrame, turn: Turn = "cw"): RgbaImage {
  const { x, y } = f.frame;
  const width = f.rotated ? f.frame.h : f.frame.w;
  const height = f.rotated ? f.frame.w : f.frame.h;
  if (x < 0 || y < 0 || x + width > sheet.width || y + height > sheet.height) {
    throw new Error(`"${f.filename}" lies outside its sheet.`);
  }
  const stored = cropImage(sheet, { x, y, width, height });
  const restore = turn === "cw" ? rotateImageCCW : rotateImageCW;
  const upright = f.rotated ? restore(stored) : stored;
  const { w, h } = f.sourceSize;
  const at = f.spriteSourceSize;
  if (w === upright.width && h === upright.height) return upright;
  const fits = at.x >= 0 && at.y >= 0 && at.x + upright.width <= w && at.y + upright.height <= h;
  if (!fits || w > MAX_SIDE || h > MAX_SIDE) {
    throw new Error(`"${f.filename}" doesn't fit its original size.`);
  }
  const out = createImage(w, h);
  blit(out, upright, at.x, at.y);
  return out;
}
