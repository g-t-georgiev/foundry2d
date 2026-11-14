import type { Region } from "@foundry2d/core";

/**
 * Bridges pixel regions and the system clipboard (PNG images), so pixels
 * can be copied to and pasted from other apps.
 *
 * Region values are packed `0xAABBGGRR` words (RGBA bytes on little-endian
 * hosts, see `assertPixelByteOrder`), so conversion is a byte view, not a
 * per-channel loop.
 */

/** RGBA bytes of a region (transparent where the cell is empty). */
export function regionToRgba(region: Region): Uint8ClampedArray<ArrayBuffer> {
  const words = Uint32Array.from(region.values);
  return new Uint8ClampedArray(words.buffer);
}

/**
 * A region from RGBA bytes. Fully transparent pixels become empty cells (0),
 * whatever their colour channels say, so they never paint over anything.
 */
export function rgbaToRegion(data: Uint8ClampedArray, width: number, height: number): Region {
  const words = new Uint32Array(data.buffer, data.byteOffset, width * height);
  const values = Array.from(words, (word, i) => (data[i * 4 + 3] === 0 ? 0 : word));
  return { width, height, values };
}

/** Encodes a region as a PNG. */
export async function regionToPng(region: Region): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = region.width;
  canvas.height = region.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  ctx.putImageData(new ImageData(regionToRgba(region), region.width, region.height), 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))))
  );
}

/** Decodes an image (PNG, JPEG, …) into a region at its natural size. */
export async function imageToRegion(image: Blob): Promise<Region> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is not available.");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return rgbaToRegion(data, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Puts a PNG on the system clipboard. Returns `false` when the browser
 * refuses (no permission, unfocused page, unsupported API).
 */
export async function writeImageToClipboard(png: Blob): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}

/** The first image file in a paste event, if any. */
export function imageFromPasteEvent(ev: ClipboardEvent): File | null {
  const items = ev.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}
