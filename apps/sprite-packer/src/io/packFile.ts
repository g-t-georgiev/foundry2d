import type { PackProject, SpriteImage } from "../model/PackProject";
import { parseSettings, type PackSettings } from "../model/settings";

export const PACK_FORMAT = "foundry2d.pack";
export const PACK_VERSION = 1;
/** Branded work-file extension; the content is JSON. */
export const PACK_EXTENSION = ".f2dpack";
export const PACK_MIME = "application/vnd.foundry2d.pack+json";

/** A work file can't be read; the message is safe to show. */
export class PackFormatError extends Error {}

export interface PackFile {
  format: typeof PACK_FORMAT;
  version: number;
  name: string;
  settings: PackSettings;
  /** Each image is the original file as a data URL. */
  sprites: { name: string; width: number; height: number; image: string }[];
}

export function toPackFile(project: PackProject): PackFile {
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    name: project.name,
    settings: { ...project.settings },
    sprites: project.sprites.map(({ name, width, height, dataUrl }) => ({
      name,
      width,
      height,
      image: dataUrl,
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
  images: SpriteImage[];
} {
  if (!isRecord(json) || json.format !== PACK_FORMAT) {
    throw new PackFormatError("Not a Foundry2D sprite pack.");
  }
  if (!Number.isInteger(json.version) || (json.version as number) > PACK_VERSION) {
    throw new PackFormatError(`Unsupported pack version: ${String(json.version)}`);
  }
  if (!Array.isArray(json.sprites)) throw new PackFormatError("The pack has no sprite list.");
  const images = json.sprites.map((raw: unknown, i): SpriteImage => {
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
    return { name: raw.name, dataUrl: raw.image, width: raw.width, height: raw.height };
  });
  return {
    name: typeof json.name === "string" ? json.name : "",
    settings: parseSettings(json.settings),
    images,
  };
}
