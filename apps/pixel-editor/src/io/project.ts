import { deserializeDocument, serializeDocument, type SerializedDocument } from "@foundry2d/core";
import { DEFAULT_FPS, Sprite, type PixelDocument } from "../model/Sprite";

export const PROJECT_FORMAT = "foundry2d.pixel";
/**
 * v1: `document` (a single image)
 * v2: `frames[]` with per-frame `duration` and `document`, plus `fps`
 */
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = ".f2d.json";

export interface PixelProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  fps: number;
  frames: { duration: number | null; document: SerializedDocument }[];
}

export function toProjectFile(sprite: Sprite, name: string): PixelProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    fps: sprite.fps,
    frames: sprite.frames.map((frame) => ({
      duration: frame.duration,
      document: serializeDocument(frame.doc),
    })),
  };
}

export class ProjectFormatError extends Error {
  override name = "ProjectFormatError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDocument(raw: unknown, where: string): PixelDocument {
  if (
    !isRecord(raw) ||
    typeof raw.width !== "number" ||
    typeof raw.height !== "number" ||
    !Array.isArray(raw.layers) ||
    raw.layers.length === 0
  ) {
    throw new ProjectFormatError(`${where} has no valid document.`);
  }
  try {
    return deserializeDocument(raw as unknown as SerializedDocument, Uint32Array);
  } catch (error) {
    throw new ProjectFormatError(`${where} is corrupt: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/** Validates and decodes a project file (v1 or v2). Throws `ProjectFormatError` on bad input. */
export function fromProjectFile(json: unknown): { name: string; sprite: Sprite } {
  if (!isRecord(json) || json.format !== PROJECT_FORMAT) {
    throw new ProjectFormatError("Not a Foundry2D pixel project.");
  }
  if (typeof json.version !== "number" || json.version > PROJECT_VERSION) {
    throw new ProjectFormatError(`Unsupported project version: ${String(json.version)}`);
  }
  const name = typeof json.name === "string" && json.name ? json.name : "sprite";

  if (json.version < 2) {
    return {
      name,
      sprite: Sprite.fromFrames([{ doc: parseDocument(json.document, "Project"), duration: null }]),
    };
  }

  if (!Array.isArray(json.frames) || json.frames.length === 0) {
    throw new ProjectFormatError("Project has no frames.");
  }
  const frames = json.frames.map((raw: unknown, i: number) => {
    if (!isRecord(raw)) throw new ProjectFormatError(`Frame ${i + 1} is invalid.`);
    const duration =
      typeof raw.duration === "number" && raw.duration > 0 ? Math.round(raw.duration) : null;
    return { doc: parseDocument(raw.document, `Frame ${i + 1}`), duration };
  });

  // All frames must share size and layer structure.
  const [first] = frames;
  const ids = first.doc.layers.map((l) => l.id).join("|");
  for (const [i, frame] of frames.entries()) {
    if (frame.doc.width !== first.doc.width || frame.doc.height !== first.doc.height) {
      throw new ProjectFormatError(`Frame ${i + 1} has a different size.`);
    }
    if (frame.doc.layers.map((l) => l.id).join("|") !== ids) {
      throw new ProjectFormatError(`Frame ${i + 1} has different layers.`);
    }
  }
  const fps =
    typeof json.fps === "number" && json.fps >= 1 && json.fps <= 60
      ? Math.round(json.fps)
      : DEFAULT_FPS;
  return { name, sprite: Sprite.fromFrames(frames, fps) };
}
