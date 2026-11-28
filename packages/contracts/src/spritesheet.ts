import {
  checkBase,
  checkPivot,
  isFinitePositive,
  isInt,
  isRecord,
  isText,
  result,
  type AssetBase,
  type ValidationResult,
} from "./common";

/**
 * A sprite sheet: one image and the named sprites on it. Written by Pixel
 * and Packer; a game draws a sprite by its name without knowing how the
 * sheet was packed.
 */
export interface SpriteSheetAsset extends AssetBase<"spritesheet"> {
  /** The image file, relative to this file. */
  image: string;
  /** The image's size in pixels. */
  width: number;
  height: number;
  /** Pixels of the sheet per pixel of the art (2 for an @2x sheet). Default 1. */
  scale?: number;
  frames: Record<string, SpriteFrame>;
}

export interface SpriteFrame {
  /** The sprite's rectangle on the sheet, with its upright width and height. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Stored turned 90° clockwise (then it covers h × w on the sheet). Draw
   * it turned back counter-clockwise.
   */
  rotated?: boolean;
  /**
   * Set when transparent edges were trimmed: the untrimmed size and where
   * the stored rectangle sits in it. Draw at (x, y) inside a (w, h) box.
   */
  source?: { x: number; y: number; w: number; h: number };
  /** The point placed at the sprite's position, 0..1 of the untrimmed size. */
  pivot?: { x: number; y: number };
}

export function validateSpriteSheet(raw: unknown): ValidationResult {
  if (!isRecord(raw)) return result(["A sprite sheet must be a JSON object."]);
  const errors: string[] = [];
  checkBase(raw, "spritesheet", errors);
  if (!isText(raw.image)) errors.push("image must be the image file's name.");
  if (!isInt(raw.width, 1) || !isInt(raw.height, 1)) {
    errors.push("width and height must be positive whole numbers.");
  }
  if (raw.scale !== undefined && !isFinitePositive(raw.scale)) {
    errors.push("scale must be a positive number.");
  }
  if (!isRecord(raw.frames)) {
    errors.push("frames must be an object of named sprites.");
    return result(errors);
  }
  const width = isInt(raw.width, 1) ? raw.width : Infinity;
  const height = isInt(raw.height, 1) ? raw.height : Infinity;
  for (const [name, frame] of Object.entries(raw.frames)) {
    const where = `frames["${name}"]`;
    if (!isRecord(frame)) {
      errors.push(`${where} must be an object.`);
      continue;
    }
    const { x, y, w, h } = frame;
    if (!isInt(x) || !isInt(y) || !isInt(w, 1) || !isInt(h, 1)) {
      errors.push(`${where} needs whole-number x, y, w and h (w and h at least 1).`);
      continue;
    }
    const rotated = frame.rotated === true;
    if (frame.rotated !== undefined && typeof frame.rotated !== "boolean") {
      errors.push(`${where}.rotated must be true or false.`);
    }
    if (x + (rotated ? h : w) > width || y + (rotated ? w : h) > height) {
      errors.push(`${where} lies outside the image.`);
    }
    if (frame.source !== undefined) {
      const s = frame.source;
      const ok =
        isRecord(s) &&
        isInt(s.x) &&
        isInt(s.y) &&
        isInt(s.w, 1) &&
        isInt(s.h, 1) &&
        s.x + w <= s.w &&
        s.y + h <= s.h;
      if (!ok) errors.push(`${where}.source must be the untrimmed size holding the sprite.`);
    }
    checkPivot(frame.pivot, where, errors);
  }
  return result(errors);
}
