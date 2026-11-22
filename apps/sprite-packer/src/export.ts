import { sheetData, type AtlasSheet, type RgbaImage } from "@foundry2d/atlas";
import { createZip, type ZipEntry } from "@foundry2d/core";
import { sheetFormat } from "@foundry2d/formats";
import { downloadBlob } from "@foundry2d/workspace";
import type { DataFormat } from "./model/settings";

/** One sheet's files: the image and, unless the format is "none", its data. */
export interface SheetFiles {
  sheet: AtlasSheet;
  imageName: string;
  data: { name: string; text: string; mime: string } | null;
}

/** A file name without characters file systems or engines trip over. */
export const safeName = (name: string) => name.trim().replace(/[^A-Za-z0-9_-]+/g, "_") || "sprites";

/** File names and data for every sheet: `name.png`, or `name-0.png`, `name-1.png`… for several. */
export function sheetFiles(
  name: string,
  sheets: readonly AtlasSheet[],
  dataFormat: DataFormat
): SheetFiles[] {
  const format = dataFormat === "none" ? null : sheetFormat(dataFormat);
  return sheets.map((sheet, i) => {
    const base = sheets.length > 1 ? `${safeName(name)}-${i}` : safeName(name);
    const imageName = `${base}.png`;
    return {
      sheet,
      imageName,
      data: format && {
        name: `${base}${format.extension}`,
        text: format.write(sheetData(sheet), { image: imageName, scale: 1 }),
        mime: format.mime,
      },
    };
  });
}

/** An RGBA image on a canvas (for drawing and PNG encoding). */
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

const encodePng = (image: RgbaImage) =>
  new Promise<Blob>((resolve, reject) =>
    toCanvas(image).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the PNG."))),
      "image/png"
    )
  );

/** Downloads the sheets and their data as one ZIP or file by file. Returns a summary. */
export async function exportSheets(
  name: string,
  files: readonly SheetFiles[],
  output: "zip" | "files"
): Promise<string> {
  const pngs = await Promise.all(files.map((f) => encodePng(f.sheet.image)));
  if (output === "files") {
    files.forEach((f, i) => {
      downloadBlob(pngs[i], f.imageName);
      if (f.data) downloadBlob(new Blob([f.data.text], { type: f.data.mime }), f.data.name);
    });
    return files.flatMap((f) => [f.imageName, ...(f.data ? [f.data.name] : [])]).join(", ");
  }
  const entries: ZipEntry[] = [];
  for (const [i, f] of files.entries()) {
    entries.push({ name: f.imageName, data: new Uint8Array(await pngs[i].arrayBuffer()) });
    if (f.data) entries.push({ name: f.data.name, data: new TextEncoder().encode(f.data.text) });
  }
  const zipName = `${safeName(name)}.zip`;
  const zip = createZip(entries) as Uint8Array<ArrayBuffer>;
  downloadBlob(new Blob([zip], { type: "application/zip" }), zipName);
  return zipName;
}
