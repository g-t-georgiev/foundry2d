import type { RgbaImage } from "@foundry2d/atlas";
import { bytesToDataUrl, dataUrlToBytes } from "@foundry2d/core";
import type { SpriteImage } from "../model/PackProject";

/** Image types browsers decode and the packer accepts, by extension. */
const TYPES: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
};
export const IMAGE_ACCEPT = Object.keys(TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/** A file to import and the path it was picked under (with folders, when known). */
export interface ImportFile {
  file: File;
  path: string;
}

const extensionOf = (path: string) => /\.([^./\\]+)$/.exec(path)?.[1].toLowerCase() ?? "";

export const isImagePath = (path: string) => extensionOf(path) in TYPES;

/** Frame name for a path: without the image extension. */
export const spriteName = (path: string) =>
  isImagePath(path) ? path.replace(/\.[^./\\]+$/, "") : path;

/** Decodes an image to straight RGBA pixels. */
export async function decodeImage(bytes: Uint8Array, type: string): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), {
    colorSpaceConversion: "none",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is not available.");
    ctx.drawImage(bitmap, 0, 0);
    const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}

/** Decoded pixels by data URL, so packing again only decodes new images. */
export class ImageStore {
  private readonly images = new Map<string, RgbaImage>();

  /** Pixels for a sprite's data URL. Throws when the image can't be decoded. */
  async get(dataUrl: string): Promise<RgbaImage> {
    const cached = this.images.get(dataUrl);
    if (cached) return cached;
    const { type, bytes } = dataUrlToBytes(dataUrl);
    const image = await decodeImage(bytes, type);
    this.images.set(dataUrl, image);
    return image;
  }

  /** Forgets images that aren't in use (undo decodes them again). */
  keepOnly(dataUrls: Iterable<string>): void {
    const keep = new Set(dataUrls);
    for (const url of this.images.keys()) if (!keep.has(url)) this.images.delete(url);
  }

  /** Reads and decodes files; those that aren't readable images come back in `failed`. */
  async read(files: readonly ImportFile[]): Promise<{ images: SpriteImage[]; failed: string[] }> {
    const images: SpriteImage[] = [];
    const failed: string[] = [];
    for (const { file, path } of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const dataUrl = bytesToDataUrl(bytes, TYPES[extensionOf(path)]);
        const { width, height } = await this.get(dataUrl);
        images.push({ name: spriteName(path), dataUrl, width, height });
      } catch {
        failed.push(path);
      }
    }
    return { images, failed };
  }
}

/** Files from an `<input>`; folder pickers give paths, other inputs just names. */
export const filesFromInput = (list: FileList): ImportFile[] =>
  [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

const entryFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function entriesOf(folder: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = folder.createReader();
  const all: FileSystemEntry[] = [];
  // Folders come in batches; an empty batch is the end.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(entry: FileSystemEntry, out: ImportFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    out.push({ file, path: entry.fullPath.replace(/^\//, "") });
    return;
  }
  for (const child of await entriesOf(entry as FileSystemDirectoryEntry)) await walk(child, out);
}

/** Files and folders dropped on the page. Call synchronously in the drop handler. */
export function filesFromDrop(data: DataTransfer): Promise<ImportFile[]> {
  // Entries have to be taken before the event ends; reading them can wait.
  const dropped = [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }));
  return (async () => {
    const out: ImportFile[] = [];
    for (const { entry, file } of dropped) {
      if (entry) await walk(entry, out);
      else if (file) out.push({ file, path: file.name });
    }
    return out;
  })();
}
