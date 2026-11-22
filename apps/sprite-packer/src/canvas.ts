import type { RgbaImage } from "@foundry2d/atlas";

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
