import {
  encodePng,
  premultiply,
  scaleSheet,
  sheetData,
  type AtlasSheet,
  type RgbaImage,
} from "@foundry2d/atlas";
import { createZip, type ZipEntry } from "@foundry2d/core";
import { sheetFormat } from "@foundry2d/formats";
import { downloadBlob } from "@foundry2d/workspace";
import { frameTags, type Animation } from "./model/animations";
import { MAX_SHEET_SIDE, type ImageFormat, type PackSettings } from "./model/settings";

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
 */
export function sheetFiles(
  name: string,
  sheets: readonly AtlasSheet[],
  settings: PackSettings,
  animations: readonly Animation[] = []
): SheetFiles[] {
  const format = settings.dataFormat === "none" ? null : sheetFormat(settings.dataFormat);
  return settings.scales.flatMap((scale) =>
    sheets.map((original, i) => {
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
      return {
        image: sheet.image,
        imageName,
        data: format && {
          name: `${base}${format.extension}`,
          text: format.write(sheetData(sheet), { image: imageName, scale, frameTags: tags }),
          mime: format.mime,
        },
      };
    })
  );
}

/** An RGBA image on a canvas, for drawing. */
export function toCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  ctx.putImageData(
    new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
    0,
    0
  );
  return canvas;
}

/** PNG byte for byte; WebP (lossless) through the browser's encoder. */
async function encode(image: RgbaImage, format: ImageFormat): Promise<Blob> {
  if (format === "png") {
    const bytes = (await encodePng(image)) as Uint8Array<ArrayBuffer>;
    return new Blob([bytes], { type: "image/png" });
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    toCanvas(image).toBlob(resolve, "image/webp", 1)
  );
  // Browsers without a WebP encoder quietly give a PNG.
  if (blob?.type !== "image/webp") throw new Error("This browser can't write WebP; use PNG.");
  return blob;
}

/** Downloads the sheets and their data as one ZIP or file by file. Returns a summary. */
export async function exportSheets(
  name: string,
  files: readonly SheetFiles[],
  settings: Pick<PackSettings, "imageFormat" | "premultiply">,
  output: "zip" | "files"
): Promise<string> {
  const images: Blob[] = [];
  for (const f of files) {
    const image = settings.premultiply ? premultiply(f.image) : f.image;
    images.push(await encode(image, settings.imageFormat));
  }
  if (output === "files") {
    files.forEach((f, i) => {
      downloadBlob(images[i], f.imageName);
      if (f.data) downloadBlob(new Blob([f.data.text], { type: f.data.mime }), f.data.name);
    });
    return files.flatMap((f) => [f.imageName, ...(f.data ? [f.data.name] : [])]).join(", ");
  }
  const entries: ZipEntry[] = [];
  for (const [i, f] of files.entries()) {
    entries.push({ name: f.imageName, data: new Uint8Array(await images[i].arrayBuffer()) });
    if (f.data) entries.push({ name: f.data.name, data: new TextEncoder().encode(f.data.text) });
  }
  const zipName = `${safeName(name)}.zip`;
  const zip = createZip(entries) as Uint8Array<ArrayBuffer>;
  downloadBlob(new Blob([zip], { type: "application/zip" }), zipName);
  return zipName;
}
