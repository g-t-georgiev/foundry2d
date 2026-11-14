import { compositeRgba, deserializeDocument, type SerializedDocument } from "@foundry2d/core";
import { ProjectFormatError } from "./projectFile";

/**
 * Reads a Foundry2D pixel-editor sprite (`.f2dsprite`, or older `.f2d.json`; format
 * "foundry2d.pixel", v1 or v2) and lays its frames out side by side, so each
 * frame can become a tile (or a block of tiles) of a tileset.
 *
 * Kept deliberately small: the pixel editor's `io/project.ts` is the source
 * of truth for the format; this only needs the frame documents.
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isPixelSpriteFile(json: unknown): boolean {
  return isRecord(json) && json.format === "foundry2d.pixel";
}

export function spriteToSheet(json: unknown): SpriteSheetImage {
  if (!isPixelSpriteFile(json) || !isRecord(json)) {
    throw new ProjectFormatError("Not a Foundry2D sprite.");
  }
  const rawDocs: unknown[] =
    Array.isArray(json.frames) && json.frames.length > 0
      ? json.frames.map((f) => (isRecord(f) ? f.document : undefined))
      : [json.document];

  const docs = rawDocs.map((raw, i) => {
    if (!isRecord(raw) || typeof raw.width !== "number" || !Array.isArray(raw.layers)) {
      throw new ProjectFormatError(`Sprite frame ${i + 1} is invalid.`);
    }
    try {
      return deserializeDocument(raw as unknown as SerializedDocument, Uint32Array);
    } catch (error) {
      throw new ProjectFormatError(`Sprite frame ${i + 1} is corrupt.`, { cause: error });
    }
  });

  const frameWidth = docs[0].width;
  const frameHeight = docs[0].height;
  const width = frameWidth * docs.length;
  const data = new Uint8ClampedArray(width * frameHeight * 4);
  docs.forEach((doc, f) => {
    if (doc.width !== frameWidth || doc.height !== frameHeight) {
      throw new ProjectFormatError(`Sprite frame ${f + 1} has a different size.`);
    }
    const pixels = compositeRgba(doc);
    for (let y = 0; y < frameHeight; y++) {
      const from = y * frameWidth * 4;
      data.set(pixels.subarray(from, from + frameWidth * 4), (y * width + f * frameWidth) * 4);
    }
  });

  return {
    name: typeof json.name === "string" && json.name ? json.name : "sprite",
    frameWidth,
    frameHeight,
    frames: docs.length,
    width,
    height: frameHeight,
    data,
  };
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
