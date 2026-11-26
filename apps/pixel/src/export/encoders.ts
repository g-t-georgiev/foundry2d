import { medianCut, nearestColor } from "./quantize";
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
  /** True when every colour of the image is in the palette (no reduction). */
  exact: boolean;
}

/**
 * Builds one palette for all frames. Pixel art rarely exceeds 255 colours,
 * in which case colours are exact; otherwise a pixel-weighted median cut
 * picks 255 colours spanning the image's colour range, and other colours
 * map to their nearest palette entry.
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
  const exact = counts.size <= 255;
  const kept = medianCut(counts, 255);
  const nearest = nearestColor(kept);
  // Palette slot 0 is transparency, so colour i sits at index i + 1.
  return { colors: [0, ...kept], indexOf: (rgb) => nearest(rgb) + 1, exact };
}

/**
 * Maps a frame to palette indices. With `dither` (and a reduced palette),
 * Floyd–Steinberg error diffusion spreads each pixel's rounding error to
 * its right and lower neighbours, which smooths gradients. Transparent
 * pixels neither receive nor pass on error.
 */
function indexFrame(frame: RgbaImage, palette: Palette, dither: boolean): Uint8Array {
  const { width, height, data } = frame;
  const indices = new Uint8Array(width * height);
  if (!dither || palette.exact) {
    for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
      indices[p] =
        data[i + 3] < ALPHA_THRESHOLD
          ? TRANSPARENT_INDEX
          : palette.indexOf((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return indices;
  }
  // Working copy of RGB with accumulated error (floats).
  const work = new Float32Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    work[p * 3] = data[p * 4];
    work[p * 3 + 1] = data[p * 4 + 1];
    work[p * 3 + 2] = data[p * 4 + 2];
  }
  const opaque = (p: number) => data[p * 4 + 3] >= ALPHA_THRESHOLD;
  const spread = (x: number, y: number, er: number, eg: number, eb: number, f: number) => {
    if (x < 0 || x >= width || y >= height) return;
    const q = y * width + x;
    if (!opaque(q)) return;
    work[q * 3] += er * f;
    work[q * 3 + 1] += eg * f;
    work[q * 3 + 2] += eb * f;
  };
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!opaque(p)) {
        indices[p] = TRANSPARENT_INDEX;
        continue;
      }
      const r = clamp(work[p * 3]);
      const g = clamp(work[p * 3 + 1]);
      const b = clamp(work[p * 3 + 2]);
      const index = palette.indexOf((r << 16) | (g << 8) | b);
      indices[p] = index;
      const c = palette.colors[index];
      const er = r - ((c >> 16) & 255);
      const eg = g - ((c >> 8) & 255);
      const eb = b - (c & 255);
      spread(x + 1, y, er, eg, eb, 7 / 16);
      spread(x - 1, y + 1, er, eg, eb, 3 / 16);
      spread(x, y + 1, er, eg, eb, 5 / 16);
      spread(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return indices;
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
  /**
   * Floyd–Steinberg dithering when the image has more than 255 colours
   * (ignored otherwise: those colours are exact). Off by default; pixel art
   * usually looks better without it.
   */
  dither?: boolean;
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

    lzwEncode(indexFrame(frame, palette, options.dither === true), minCodeSize, out);
  });

  out.byte(0x3b); // trailer
  return out.toUint8Array();
}

// ------------------------------------------------------------------ ZIP

// The ZIP writer moved to core so Levels can use it too.
export { crc32, createZip, type ZipEntry } from "@gs2d/core";
