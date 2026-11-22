import { encodePng, unpackFrame, type RgbaImage } from "@foundry2d/atlas";
import {
  bytesToDataUrl,
  dataUrlToBytes,
  isPixelSpriteFile,
  readSpriteFrames,
} from "@foundry2d/core";
import { readSheetData, type SheetPage } from "@foundry2d/formats";
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
const SPRITE = /\.(f2dsprite|f2d\.json)$/i;
/** Spritesheet data to unpack, next to its image. */
const DATA = /\.(json|xml|atlas)$/i;

export const IMPORT_ACCEPT = [
  ...Object.keys(TYPES).map((ext) => `.${ext}`),
  ".f2dsprite",
  ".json",
  ".xml",
  ".atlas",
].join(",");

/** A file to import and the path it was picked under (with folders, when known). */
export interface ImportFile {
  file: File;
  path: string;
}

export interface ImportResult {
  images: SpriteImage[];
  /** What couldn't be used, as text for a message. */
  failed: string[];
  /** Sprite names each file gave. */
  names: Map<string, string[]>;
}

const extensionOf = (path: string) => /\.([^./\\]+)$/.exec(path)?.[1].toLowerCase() ?? "";

export const isImagePath = (path: string) => extensionOf(path) in TYPES;
export const isSpritePath = (path: string) => SPRITE.test(path);
export const isImportPath = (path: string) =>
  isImagePath(path) || isSpritePath(path) || DATA.test(path);

/** Frame name for a path: without the image or sprite extension. */
export const spriteName = (path: string) =>
  isSpritePath(path)
    ? path.replace(SPRITE, "")
    : isImagePath(path)
      ? path.replace(/\.[^./\\]+$/, "")
      : path;

// ------------------------------------------------------------------ decoding

/** The parts of WebCodecs' `ImageDecoder` used (not in lib.dom yet). */
interface ImageDecoderLike {
  new (init: {
    data: Uint8Array;
    type: string;
    premultiplyAlpha: "none";
    colorSpaceConversion: "none";
  }): { decode(): Promise<{ image: VideoFrame }>; close(): void };
}

/**
 * Decodes without going through premultiplied alpha, so nearly transparent
 * pixels keep their exact colour. `null` where the browser can't.
 */
async function decodeExact(bytes: Uint8Array, type: string): Promise<RgbaImage | null> {
  const Decoder = (globalThis as { ImageDecoder?: ImageDecoderLike }).ImageDecoder;
  if (!Decoder) return null;
  const decoder = new Decoder({
    data: bytes,
    type,
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const { image } = await decoder.decode();
    try {
      const format = image.format ?? "";
      if (!/^(RGB|BGR)[AX]$/.test(format)) return null;
      const { displayWidth: width, displayHeight: height } = image;
      const data = new Uint8ClampedArray(width * height * 4);
      await image.copyTo(data, { layout: [{ offset: 0, stride: width * 4 }] });
      for (let i = 0; i < data.length; i += 4) {
        if (format.startsWith("B")) [data[i], data[i + 2]] = [data[i + 2], data[i]];
        if (format.endsWith("X")) data[i + 3] = 255;
      }
      return { width, height, data };
    } finally {
      image.close();
    }
  } catch {
    return null; // the canvas below decides whether it is readable at all
  } finally {
    decoder.close();
  }
}

/** Decodes an image to straight RGBA pixels. Throws when it isn't readable. */
export async function decodeImage(bytes: Uint8Array, type: string): Promise<RgbaImage> {
  if (type === "image/png" || type === "image/webp") {
    const exact = await decodeExact(bytes, type);
    if (exact) return exact;
  }
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

  /**
   * Reads files into sprites: images as they are, pixel-editor sprites frame
   * by frame, and sheets with their data file unpacked into single sprites.
   */
  async read(files: readonly ImportFile[]): Promise<ImportResult> {
    const result: ImportResult = { images: [], failed: [], names: new Map() };
    const add = (path: string, image: SpriteImage) => {
      result.images.push(image);
      result.names.set(path, [...(result.names.get(path) ?? []), image.name]);
    };
    const images = new Map(
      files.filter((f) => isImagePath(f.path)).map((f) => [f.path.toLowerCase(), f])
    );
    /** Images that belong to a data file, so they aren't added whole. */
    const sheets = new Set<string>();
    /** Data files of some other kind; only worth mentioning when nothing else was found. */
    const unknown: string[] = [];

    for (const { file, path } of files) {
      if (isImagePath(path)) continue;
      try {
        const text = await file.text();
        const sprite = path.toLowerCase().endsWith(".xml") ? null : parseJson(text);
        if (isPixelSpriteFile(sprite)) {
          const { frames } = readSpriteFrames(sprite);
          const base = spriteName(path.replace(/\.json$/i, "").replace(/\.f2d$/i, ""));
          for (const [i, frame] of frames.entries()) {
            add(path, await this.encode(frames.length > 1 ? `${base}_${i}` : base, frame));
          }
          continue;
        }
        const pages = readSheetData(text);
        if (!pages) {
          unknown.push(`${path} (not a sprite or sheet data)`);
          continue;
        }
        for (const page of pages) {
          const image = findImage(images, path, page);
          if (!image) {
            result.failed.push(`${path} (add ${page.image || "its image"} with it)`);
            continue;
          }
          sheets.add(image.path.toLowerCase());
          const sheet = await this.get(await fileUrl(image));
          const unpacked = page.frames.map((f) => [f.filename, unpackFrame(sheet, f)] as const);
          for (const [name, pixels] of unpacked)
            add(path, await this.encode(spriteName(name), pixels));
        }
      } catch (error) {
        result.failed.push(`${path} (${(error as Error).message.replace(/\.$/, "")})`);
      }
    }

    for (const [key, entry] of images) {
      if (sheets.has(key)) continue;
      try {
        const dataUrl = await fileUrl(entry);
        const { width, height } = await this.get(dataUrl);
        add(entry.path, { name: spriteName(entry.path), dataUrl, width, height });
      } catch {
        result.failed.push(entry.path);
      }
    }
    if (result.images.length === 0 && result.failed.length === 0) result.failed.push(...unknown);
    return result;
  }

  /** A sprite from pixels (stored as PNG). */
  private async encode(name: string, image: RgbaImage): Promise<SpriteImage> {
    const dataUrl = bytesToDataUrl(await encodePng(image), "image/png");
    this.images.set(dataUrl, image);
    return { name, dataUrl, width: image.width, height: image.height };
  }
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const fileUrl = async ({ file, path }: ImportFile) =>
  bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), TYPES[extensionOf(path)]);

/** The image a data file describes: the one it names next to it, else one with its own name. */
export function findImage(
  images: ReadonlyMap<string, ImportFile>,
  dataPath: string,
  page: Pick<SheetPage, "image">
): ImportFile | undefined {
  const folder = dataPath.replace(/[^/]*$/, "");
  const named = page.image && images.get((folder + page.image).toLowerCase());
  if (named) return named;
  const stem = dataPath.replace(/\.[^./]+$/, "");
  return Object.keys(TYPES)
    .map((ext) => images.get(`${stem}.${ext}`.toLowerCase()))
    .find((f) => f !== undefined);
}

// ------------------------------------------------------------------ picking and dropping

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
