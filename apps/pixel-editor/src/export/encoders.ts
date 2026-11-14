import type { RgbaImage } from "./raster";

// ------------------------------------------------------------------ BMP

/**
 * 32-bit BMP with a BITMAPV4HEADER and explicit RGBA masks, so editors that
 * understand alpha keep it and others still read the colours. Bottom-up rows.
 */
export function encodeBmp(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const headerSize = 14 + 108;
  const pixelBytes = width * height * 4;
  const out = new Uint8Array(headerSize + pixelBytes);
  const view = new DataView(out.buffer);

  // BITMAPFILEHEADER
  out[0] = 0x42; // B
  out[1] = 0x4d; // M
  view.setUint32(2, out.length, true);
  view.setUint32(10, headerSize, true);

  // BITMAPV4HEADER
  view.setUint32(14, 108, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive = bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 32, true); // bits per pixel
  view.setUint32(30, 3, true); // BI_BITFIELDS
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true); // 72 DPI
  view.setInt32(42, 2835, true);
  view.setUint32(54, 0x00ff0000, true); // red mask
  view.setUint32(58, 0x0000ff00, true); // green mask
  view.setUint32(62, 0x000000ff, true); // blue mask
  view.setUint32(66, 0xff000000, true); // alpha mask
  view.setUint32(70, 0x73524742, true); // "sRGB"

  let o = headerSize;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[o++] = data[i + 2]; // B
      out[o++] = data[i + 1]; // G
      out[o++] = data[i]; // R
      out[o++] = data[i + 3]; // A
    }
  }
  return out;
}

// ------------------------------------------------------------------ GIF

/** Alpha below this becomes fully transparent (GIF has 1-bit transparency). */
const ALPHA_THRESHOLD = 128;
const TRANSPARENT_INDEX = 0;

interface Palette {
  /** RGB triples; index 0 is reserved for transparency. */
  colors: number[];
  indexOf: (rgb: number) => number;
}

/**
 * Builds one palette for all frames. Pixel art rarely exceeds 255 colours,
 * in which case colours are exact; otherwise the 255 most frequent colours
 * are kept and the rest map to their nearest neighbour.
 */
function buildPalette(frames: RgbaImage[]): Palette {
  const counts = new Map<number, number>();
  for (const frame of frames) {
    const d = frame.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < ALPHA_THRESHOLD) continue;
      const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([rgb]) => rgb);
  const kept = sorted.slice(0, 255);
  const exact = new Map(kept.map((rgb, i) => [rgb, i + 1]));
  const nearest = new Map<number, number>();
  const indexOf = (rgb: number) => {
    const hit = exact.get(rgb) ?? nearest.get(rgb);
    if (hit !== undefined) return hit;
    let best = 1;
    let bestDist = Infinity;
    for (let i = 0; i < kept.length; i++) {
      const c = kept[i];
      const dr = ((c >> 16) & 255) - ((rgb >> 16) & 255);
      const dg = ((c >> 8) & 255) - ((rgb >> 8) & 255);
      const db = (c & 255) - (rgb & 255);
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i + 1;
      }
    }
    nearest.set(rgb, best);
    return best;
  };
  return { colors: [0, ...kept], indexOf };
}

class ByteWriter {
  private chunks: number[] = [];
  byte(b: number): void {
    this.chunks.push(b & 0xff);
  }
  u16(v: number): void {
    this.byte(v);
    this.byte(v >> 8);
  }
  bytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.byte(values[i]);
  }
  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i));
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** GIF variable-length LZW compression of palette indices, as data sub-blocks. */
function lzwEncode(indices: Uint8Array, minCodeSize: number, out: ByteWriter): void {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map<number, number>();

  const block: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const flushBlock = () => {
    if (block.length === 0) return;
    out.byte(block.length);
    out.bytes(block);
    block.length = 0;
  };
  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block.push(bitBuffer & 0xff);
      if (block.length === 255) flushBlock();
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  out.byte(minCodeSize);
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const existing = dict.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }
    emit(prefix);
    if (nextCode < 4096) {
      dict.set(key, nextCode++);
      if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      dict = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(endCode);
  if (bitCount > 0) block.push(bitBuffer & 0xff);
  flushBlock();
  out.byte(0); // block terminator
}

export interface GifOptions {
  /** 0 = loop forever; otherwise the number of repeats. `null` = play once. */
  loop: number | null;
}

/** Animated GIF89a with one global palette and 1-bit transparency. */
export function encodeGif(
  frames: RgbaImage[],
  delaysMs: number[],
  options: GifOptions = { loop: 0 }
): Uint8Array {
  if (frames.length === 0) throw new Error("No frames to encode");
  const { width, height } = frames[0];
  const palette = buildPalette(frames);
  const bits = Math.max(1, Math.ceil(Math.log2(palette.colors.length)));
  const tableSize = 1 << bits;
  const out = new ByteWriter();

  out.ascii("GIF89a");
  out.u16(width);
  out.u16(height);
  out.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); // global table, colour resolution, size
  out.byte(TRANSPARENT_INDEX); // background colour index
  out.byte(0); // pixel aspect ratio
  for (let i = 0; i < tableSize; i++) {
    const rgb = palette.colors[i] ?? 0;
    out.byte(rgb >> 16);
    out.byte(rgb >> 8);
    out.byte(rgb);
  }

  if (options.loop !== null && frames.length > 1) {
    out.bytes([0x21, 0xff, 0x0b]);
    out.ascii("NETSCAPE2.0");
    out.bytes([0x03, 0x01]);
    out.u16(options.loop);
    out.byte(0);
  }

  const minCodeSize = Math.max(2, bits);
  frames.forEach((frame, f) => {
    // Graphics Control Extension: restore to background (2) so transparent
    // pixels don't show the previous frame, transparent index set.
    out.bytes([0x21, 0xf9, 0x04, (2 << 2) | 0x01]);
    out.u16(Math.max(2, Math.round((delaysMs[f] ?? 100) / 10)));
    out.byte(TRANSPARENT_INDEX);
    out.byte(0);

    out.byte(0x2c); // image descriptor
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    out.byte(0); // no local table, not interlaced

    const indices = new Uint8Array(width * height);
    const d = frame.data;
    for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
      indices[p] =
        d[i + 3] < ALPHA_THRESHOLD
          ? TRANSPARENT_INDEX
          : palette.indexOf((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    lzwEncode(indices, minCodeSize, out);
  });

  out.byte(0x3b); // trailer
  return out.toUint8Array();
}

// ------------------------------------------------------------------ ZIP

// The ZIP writer moved to core so the level designer can use it too.
export { crc32, createZip, type ZipEntry } from "@foundry2d/core";
