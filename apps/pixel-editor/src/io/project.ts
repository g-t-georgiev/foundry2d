import { deserializeDocument, serializeDocument, type SerializedDocument } from "@foundry2d/core";
import { DEFAULT_FPS, Sprite, type PixelDocument } from "../model/Sprite";
import { normalizeColor } from "./palette";

export const PROJECT_FORMAT = "foundry2d.pixel";
/**
 * v1: `document` (a single image)
 * v2: `frames[]` with per-frame `duration` and `document`, plus `fps`
 */
export const PROJECT_VERSION = 2;
/** Branded work-file extension; the content is JSON. */
export const PROJECT_EXTENSION = ".f2dsprite";
/** Earlier extensions that still open. */
export const LEGACY_EXTENSIONS = [".f2d.json"];
/** Vendor MIME type for the save picker and downloads. */
export const PROJECT_MIME = "application/vnd.foundry2d.sprite+json";

export interface PixelProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  fps: number;
  /** Optional in v2 files; `#rrggbb` strings. */
  palette?: string[];
  frames: { duration: number | null; document: SerializedDocument }[];
}

export function toProjectFile(sprite: Sprite, name: string): PixelProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    fps: sprite.fps,
    palette: [...sprite.palette],
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
  const name = typeof json.name === "string" && json.name ? json.name : "untitled";

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
  const sprite = Sprite.fromFrames(frames, fps);
  if (Array.isArray(json.palette)) {
    const colors = json.palette
      .map((c) => (typeof c === "string" ? normalizeColor(c) : null))
      .filter((c): c is string => c !== null);
    if (colors.length > 0) sprite.palette = colors;
  }
  return { name, sprite };
}
