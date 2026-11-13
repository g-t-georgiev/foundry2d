import {
  deserializeDocument,
  serializeDocument,
  type GridDocument,
  type SerializedDocument,
} from "@foundry2d/core";

export const PROJECT_FORMAT = "foundry2d.pixel";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".f2d.json";

export interface PixelProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  document: SerializedDocument;
}

export function toProjectFile(doc: GridDocument<Uint32Array>, name: string): PixelProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    document: serializeDocument(doc),
  };
}

export class ProjectFormatError extends Error {
  override name = "ProjectFormatError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validates and decodes a project file. Throws `ProjectFormatError` on bad input. */
export function fromProjectFile(json: unknown): {
  name: string;
  doc: GridDocument<Uint32Array>;
} {
  if (!isRecord(json) || json.format !== PROJECT_FORMAT) {
    throw new ProjectFormatError("Not a Foundry2D pixel project.");
  }
  if (typeof json.version !== "number" || json.version > PROJECT_VERSION) {
    throw new ProjectFormatError(`Unsupported project version: ${String(json.version)}`);
  }
  const document = json.document;
  if (
    !isRecord(document) ||
    typeof document.width !== "number" ||
    typeof document.height !== "number" ||
    !Array.isArray(document.layers) ||
    document.layers.length === 0
  ) {
    throw new ProjectFormatError("Project has no valid document.");
  }
  try {
    const doc = deserializeDocument(document as unknown as SerializedDocument, Uint32Array);
    return { name: typeof json.name === "string" ? json.name : "sprite", doc };
  } catch (error) {
    throw new ProjectFormatError(`Project data is corrupt: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/** Triggers a browser download of `blob`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function saveProjectFile(doc: GridDocument<Uint32Array>, name: string): void {
  const json = JSON.stringify(toProjectFile(doc, name));
  downloadBlob(new Blob([json], { type: "application/json" }), `${name}${PROJECT_EXTENSION}`);
}

export async function readProjectFile(file: File) {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch (error) {
    throw new ProjectFormatError("File is not valid JSON.", { cause: error });
  }
  const name = file.name.replace(/\.f2d\.json$|\.json$/i, "");
  const result = fromProjectFile(json);
  return { ...result, name: result.name || name };
}
