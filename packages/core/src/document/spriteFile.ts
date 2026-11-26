import { compositeRgba } from "./composite";
import { deserializeDocument, type SerializedDocument } from "./serialization";

/**
 * Reads the frames of a Pixel sprite (`.gs2dsprite`; format
 * "gs2d.sprite", v1 or v2) for the other apps. Pixel's
 * `io/project.ts` is the source of truth for the format; this only needs
 * the frame documents.
 */
export interface SpriteFrameImage {
  width: number;
  height: number;
  /** Straight RGBA bytes, row-major. */
  data: Uint8ClampedArray;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isPixelSpriteFile(json: unknown): json is Record<string, unknown> {
  // "foundry2d.pixel" is the id from before Game Studio 2D.
  return isRecord(json) && (json.format === "gs2d.sprite" || json.format === "foundry2d.pixel");
}

/** Every frame, composited. Throws an `Error` with a readable message on bad files. */
export function readSpriteFrames(json: unknown): { name: string; frames: SpriteFrameImage[] } {
  if (!isPixelSpriteFile(json)) throw new Error("Not a Game Studio 2D sprite.");
  const documents: unknown[] =
    Array.isArray(json.frames) && json.frames.length > 0
      ? json.frames.map((f: unknown) => (isRecord(f) ? f.document : undefined))
      : [json.document];
  const frames = documents.map((raw, i) => {
    if (!isRecord(raw) || typeof raw.width !== "number" || !Array.isArray(raw.layers)) {
      throw new Error(`Sprite frame ${i + 1} is invalid.`);
    }
    try {
      const doc = deserializeDocument(raw as unknown as SerializedDocument, Uint32Array);
      return { width: doc.width, height: doc.height, data: compositeRgba(doc) };
    } catch (error) {
      throw new Error(`Sprite frame ${i + 1} is corrupt.`, { cause: error });
    }
  });
  return { name: typeof json.name === "string" && json.name ? json.name : "sprite", frames };
}
