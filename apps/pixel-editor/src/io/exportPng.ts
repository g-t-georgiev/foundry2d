import type { GridDocument } from "@foundry2d/core";
import { LayerBitmapCache } from "@foundry2d/render";
import { downloadBlob } from "./project";

/** Composites all visible layers (honouring opacity) into a PNG blob. */
export async function renderPng(doc: GridDocument<Uint32Array>, scale = 1): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = doc.width * scale;
  canvas.height = doc.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available");
  ctx.imageSmoothingEnabled = false;

  const cache = new LayerBitmapCache();
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(cache.get(layer), 0, 0, canvas.width, canvas.height);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))));
  });
}

export async function exportPng(
  doc: GridDocument<Uint32Array>,
  name: string,
  scale = 1
): Promise<void> {
  const blob = await renderPng(doc, scale);
  const suffix = scale === 1 ? "" : `@${scale}x`;
  downloadBlob(blob, `${name}-${doc.width}x${doc.height}${suffix}.png`);
}
