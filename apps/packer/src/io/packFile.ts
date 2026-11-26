import type { PackProject, Pivot, SpriteImage } from "../model/PackProject";
import { parseSettings, type PackSettings } from "../model/settings";

export const PACK_FORMAT = "gs2d.pack";
export const PACK_VERSION = 1;
/** Branded work-file extension; the content is JSON. */
export const PACK_EXTENSION = ".gs2dpack";
export const PACK_MIME = "application/vnd.gs2d.pack+json";

/** A work file can't be read; the message is safe to show. */
export class PackFormatError extends Error {}

export interface PackFile {
  format: typeof PACK_FORMAT;
  version: number;
  name: string;
  settings: PackSettings;
  /** Each image is the original file as a data URL. */
  sprites: { name: string; width: number; height: number; image: string; pivot?: Pivot }[];
}

export function toPackFile(project: PackProject): PackFile {
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    name: project.name,
    settings: { ...project.settings },
    sprites: project.sprites.map(({ name, width, height, dataUrl, pivot }) => ({
      name,
      width,
      height,
      image: dataUrl,
      ...(pivot ? { pivot } : {}),
    })),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isSide = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const IMAGE_URL = /^data:image\/(png|webp|jpeg|gif|bmp);base64,/;

/** Validates a work file. Unknown settings fall back to defaults; broken sprites are an error. */
export function fromPackFile(json: unknown): {
  name: string;
  settings: PackSettings;
  images: (SpriteImage & { pivot?: Pivot })[];
} {
  // "foundry2d.pack" is the id from before Game Studio 2D.
  if (!isRecord(json) || (json.format !== PACK_FORMAT && json.format !== "foundry2d.pack")) {
    throw new PackFormatError("Not a Game Studio 2D sprite pack.");
  }
  if (!Number.isInteger(json.version) || (json.version as number) > PACK_VERSION) {
    throw new PackFormatError(`Unsupported pack version: ${String(json.version)}`);
  }
  if (!Array.isArray(json.sprites)) throw new PackFormatError("The pack has no sprite list.");
  const images = json.sprites.map((raw: unknown, i): SpriteImage & { pivot?: Pivot } => {
    if (
      !isRecord(raw) ||
      typeof raw.name !== "string" ||
      typeof raw.image !== "string" ||
      !IMAGE_URL.test(raw.image) ||
      !isSide(raw.width) ||
      !isSide(raw.height)
    ) {
      throw new PackFormatError(`Sprite #${i + 1} in the pack is invalid.`);
    }
    const { name, image, width, height, pivot } = raw;
    const valid = isRecord(pivot) && Number.isFinite(pivot.x) && Number.isFinite(pivot.y);
    return {
      name,
      dataUrl: image,
      width,
      height,
      ...(valid ? { pivot: { x: Number(pivot.x), y: Number(pivot.y) } } : {}),
    };
  });
  return {
    name: typeof json.name === "string" ? json.name : "",
    settings: parseSettings(json.settings),
    images,
  };
}
