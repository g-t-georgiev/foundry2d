import { isPixelSpriteFile, readSpriteFrames } from "@gs2d/core";
import { ProjectFormatError } from "./projectFile";

export { isPixelSpriteFile };

/**
 * A Pixel sprite's frames laid out side by side, so each frame can
 * become a tile (or a block of tiles) of a tileset.
 */
export interface SpriteSheetImage {
  name: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  width: number;
  height: number;
  /** Straight RGBA bytes, row-major. */
  data: Uint8ClampedArray;
}

export function spriteToSheet(json: unknown): SpriteSheetImage {
  let sprite: ReturnType<typeof readSpriteFrames>;
  try {
    sprite = readSpriteFrames(json);
  } catch (error) {
    throw new ProjectFormatError((error as Error).message, { cause: error });
  }
  const { name, frames } = sprite;
  const { width: frameWidth, height: frameHeight } = frames[0];
  const width = frameWidth * frames.length;
  const data = new Uint8ClampedArray(width * frameHeight * 4);
  frames.forEach((frame, f) => {
    if (frame.width !== frameWidth || frame.height !== frameHeight) {
      throw new ProjectFormatError(`Sprite frame ${f + 1} has a different size.`);
    }
    for (let y = 0; y < frameHeight; y++) {
      const from = y * frameWidth * 4;
      data.set(frame.data.subarray(from, from + frameWidth * 4), (y * width + f * frameWidth) * 4);
    }
  });
  return { name, frameWidth, frameHeight, frames: frames.length, width, height: frameHeight, data };
}

/** Encodes the sheet as a PNG data URL (browser only). */
export function sheetToDataUrl(sheet: SpriteSheetImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available");
  ctx.putImageData(
    new ImageData(sheet.data as Uint8ClampedArray<ArrayBuffer>, sheet.width, sheet.height),
    0,
    0
  );
  return canvas.toDataURL("image/png");
}
