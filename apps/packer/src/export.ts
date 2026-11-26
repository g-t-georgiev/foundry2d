import {
  encodePng,
  premultiply,
  scaleSheet,
  sheetData,
  type AtlasSheet,
  type RgbaImage,
} from "@gs2d/atlas";
import { createZip } from "@gs2d/core";
import { sheetFormat } from "@gs2d/formats";
import { frameTags, type Animation } from "./model/animations";
import { MAX_SHEET_SIDE, type PackSettings } from "./model/settings";

/** The frame key of a sprite in the data files, and back. */
export const frameName = (sprite: string) => `${sprite}.png`;
export const spriteOfFrame = (frame: string) => frame.replace(/\.png$/, "");

/** One sheet's files: the image and, unless the format is "none", its data. */
export interface SheetFiles {
  image: RgbaImage;
  imageName: string;
  data: { name: string; text: string; mime: string } | null;
}

/** A file name without characters file systems or engines trip over. */
export const safeName = (name: string) => name.trim().replace(/[^A-Za-z0-9_-]+/g, "_") || "sprites";

/**
 * File names and data for every sheet and scale: `name.png`, `name-0.png`…
 * for several sheets, and `name@2x.png` next to `name.png` for several scales.
 * One at a time, as big scales take a lot of memory.
 */
export function* sheetFiles(
  name: string,
  sheets: readonly AtlasSheet[],
  settings: PackSettings,
  animations: readonly Animation[] = []
): Generator<SheetFiles> {
  const format = settings.dataFormat === "none" ? null : sheetFormat(settings.dataFormat);
  for (const scale of settings.scales) {
    for (const [i, original] of sheets.entries()) {
      const { width, height } = original.image;
      if (Math.max(width, height) * scale > MAX_SHEET_SIDE * 2) {
        throw new Error(`The ${scale}× sheet would be too big; use a smaller maximum size.`);
      }
      const sheet = scaleSheet(original, scale);
      const number = sheets.length > 1 ? `-${i}` : "";
      const suffix = settings.scales.length > 1 && scale > 1 ? `@${scale}x` : "";
      const base = `${safeName(name)}${number}${suffix}`;
      const imageName = `${base}.${settings.imageFormat}`;
      const tags = frameTags(
        sheet.frames.map((f) => spriteOfFrame(f.filename)),
        animations
      );
      yield {
        image: sheet.image,
        imageName,
        data: format && {
          name: `${base}${format.extension}`,
          text: format.write(sheetData(sheet), { image: imageName, scale, frameTags: tags }),
          mime: format.mime,
        },
      };
    }
  }
}

/** One file to download. */
export interface ExportFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** What an export needs; plain data, so it can be sent to a worker. */
export interface ExportRequest {
  name: string;
  sheets: readonly AtlasSheet[];
  settings: PackSettings;
  animations: readonly Animation[];
  output: "zip" | "files";
}

/** The format stores sizes in 14 bits. */
const MAX_WEBP_SIDE = 16383;
const NO_WEBP = "This browser can't write WebP; use PNG.";

/**
 * Lossless WebP from the browser's encoder. The pixels go in as a bitmap that
 * was never premultiplied, so nearly transparent ones keep their colours;
 * drawing them on a 2D canvas would round those.
 */
async function encodeWebp({ width, height, data }: RgbaImage): Promise<Uint8Array> {
  if (Math.max(width, height) > MAX_WEBP_SIDE) {
    throw new Error(
      `WebP images end at ${MAX_WEBP_SIDE} pixels a side; use PNG or a smaller scale.`
    );
  }
  if (!("OffscreenCanvas" in globalThis)) throw new Error(NO_WEBP);
  const pixels = new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
  const bitmap = await createImageBitmap(pixels, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("bitmaprenderer");
  if (!context) throw new Error(NO_WEBP);
  context.transferFromImageBitmap(bitmap);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 1 });
  // Browsers without a WebP encoder quietly give a PNG.
  if (blob.type !== "image/webp") throw new Error(NO_WEBP);
  return new Uint8Array(await blob.arrayBuffer());
}

/** The files of an export: one ZIP, or every sheet and its data. */
export async function exportFiles(request: ExportRequest): Promise<ExportFile[]> {
  const { name, settings } = request;
  const files: ExportFile[] = [];
  for (const f of sheetFiles(name, request.sheets, settings, request.animations)) {
    const image = settings.premultiply ? premultiply(f.image) : f.image;
    const bytes = await (settings.imageFormat === "png" ? encodePng(image) : encodeWebp(image));
    files.push({ name: f.imageName, mime: `image/${settings.imageFormat}`, bytes });
    if (f.data) {
      const { name, mime, text } = f.data;
      files.push({ name, mime, bytes: new TextEncoder().encode(text) });
    }
  }
  if (request.output === "files") return files;
  const entries = files.map((f) => ({ name: f.name, data: f.bytes }));
  return [{ name: `${safeName(name)}.zip`, mime: "application/zip", bytes: createZip(entries) }];
}
