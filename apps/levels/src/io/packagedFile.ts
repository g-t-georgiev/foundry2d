import { bytesToDataUrl, createZip, dataUrlToBytes, isZip, readZip } from "@gs2d/core";
import { ProjectFormatError } from "./projectFile";

/**
 * Packaged work files (roadmap item 6): a `.gs2dlevel` can be a ZIP holding
 * `project.json` (the same JSON as a plain file) plus the tileset images as
 * separate files under `images/`. Big tilesets then stay out of the JSON,
 * which keeps it readable and small in version control, and the images can
 * be opened with other tools. The extension and file association are the
 * same; reading tells the two apart by their first bytes.
 *
 * A project is saved packaged when its `packaged` setting is on (Project
 * settings, Tilesets); opening a packaged file turns it on.
 */

const PROJECT_ENTRY = "project.json";

interface TilesetJson {
  identifier?: unknown;
  image?: { dataUrl?: unknown; fileName?: unknown };
}

const tilesetsOf = (json: unknown): TilesetJson[] => {
  const defs = (json as { defs?: { tilesets?: unknown } } | null)?.defs;
  return Array.isArray(defs?.tilesets) ? (defs.tilesets as TilesetJson[]) : [];
};

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};
const TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([t, e]) => [e, t]));

/** A ZIP with `project.json` and the tileset images (from a serialized project). */
export function encodePackaged(json: unknown): Uint8Array {
  const copy = structuredClone(json);
  const images: { name: string; data: Uint8Array }[] = [];
  const used = new Set<string>();
  for (const tileset of tilesetsOf(copy)) {
    const url = tileset.image?.dataUrl;
    if (typeof url !== "string" || !url.startsWith("data:")) continue;
    const { type, bytes } = dataUrlToBytes(url);
    const base =
      (typeof tileset.identifier === "string" ? tileset.identifier : "tileset").replace(
        /[^A-Za-z0-9_-]+/g,
        "_"
      ) || "tileset";
    let name = `images/${base}.${EXTENSIONS[type] ?? "bin"}`;
    for (let n = 2; used.has(name); n++) name = `images/${base}_${n}.${EXTENSIONS[type] ?? "bin"}`;
    used.add(name);
    images.push({ name, data: bytes });
    tileset.image!.dataUrl = name;
  }
  const text = new TextEncoder().encode(JSON.stringify(copy, null, 2));
  return createZip([{ name: PROJECT_ENTRY, data: text }, ...images]);
}

/** Reads a packaged file back into the plain JSON form (images as data URLs). */
export async function decodePackaged(bytes: Uint8Array): Promise<unknown> {
  let entries;
  try {
    entries = await readZip(bytes);
  } catch (error) {
    throw new ProjectFormatError(`The packaged file can't be read: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const files = new Map(entries.map((e) => [e.name, e.data]));
  const project = files.get(PROJECT_ENTRY);
  if (!project) throw new ProjectFormatError(`The packaged file has no ${PROJECT_ENTRY}.`);
  const json = JSON.parse(new TextDecoder().decode(project)) as Record<string, unknown>;
  for (const tileset of tilesetsOf(json)) {
    const ref = tileset.image?.dataUrl;
    if (typeof ref !== "string" || ref.startsWith("data:")) continue;
    const data = files.get(ref);
    if (!data) throw new ProjectFormatError(`The packaged file is missing ${ref}.`);
    const type = TYPES[ref.split(".").pop() ?? ""] ?? "application/octet-stream";
    tileset.image!.dataUrl = bytesToDataUrl(data, type);
  }
  json.packaged = true;
  return json;
}

/** A work file's content: a packaged ZIP when the project asks for it, else JSON text. */
export function encodeWorkFile(json: unknown): Blob | string {
  if ((json as { packaged?: unknown } | null)?.packaged === true) {
    return new Blob([encodePackaged(json) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  }
  return JSON.stringify(json);
}

/** Reads a work file, packaged or plain. */
export async function decodeWorkFile(file: File): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZip(bytes)) return decodePackaged(bytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
