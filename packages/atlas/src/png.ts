import { crc32 } from "@foundry2d/core";
import type { RgbaImage } from "./raster";

/**
 * PNG encoder (8-bit RGBA). Canvas encoders go through premultiplied alpha,
 * which loses colour precision in nearly transparent pixels; this one keeps
 * every byte. Compression is the platform's `CompressionStream`.
 */

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Rows with their filter byte; each row takes whichever of none, sub and up looks smallest. */
function filterRows({ width, height, data }: RgbaImage): Uint8Array {
  const stride = width * 4;
  const out = new Uint8Array((stride + 1) * height);
  const sub = new Uint8Array(stride);
  const up = new Uint8Array(stride);
  /** Distance from zero of a byte seen as signed (the usual PNG heuristic). */
  const size = (b: number) => (b < 128 ? b : 256 - b);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let noneSum = 0;
    let subSum = 0;
    let upSum = 0;
    for (let i = 0; i < stride; i++) {
      const value = data[row + i];
      sub[i] = value - (i >= 4 ? data[row + i - 4] : 0);
      up[i] = value - (y > 0 ? data[row - stride + i] : 0);
      noneSum += size(value);
      subSum += size(sub[i]);
      upSum += size(up[i]);
    }
    const at = y * (stride + 1);
    if (subSum < noneSum && subSum <= upSum) {
      out[at] = 1;
      out.set(sub, at + 1);
    } else if (upSum < noneSum) {
      out[at] = 2;
      out.set(up, at + 1);
    } else {
      out.set(data.subarray(row, row + stride), at + 1);
    }
  }
  return out;
}

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA, no interlacing
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", await deflate(filterRows(image))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
