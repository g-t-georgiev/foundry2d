import { describe, it, expect } from "vite-plus/test";
import { Sprite } from "../src/model/Sprite";
import {
  compositeFrame,
  createImage,
  cropImage,
  opaqueBounds,
  scaleImage,
  type RgbaImage,
} from "../src/export/raster";
import { crc32, createZip, encodeBmp, encodeGif } from "../src/export/encoders";
import { texturePackerJson } from "@foundry2d/formats";
import { buildSpritesheet, sheetData } from "../src/export/spritesheet";
import { applyPattern } from "../src/export/ExportController";

const rgba = (r: number, g: number, b: number, a = 255) =>
  (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
const px = (img: RgbaImage, x: number, y: number) =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

function solid(width: number, height: number, color: [number, number, number, number]): RgbaImage {
  const img = createImage(width, height);
  for (let i = 0; i < img.data.length; i += 4) img.data.set(color, i);
  return img;
}

describe("compositing", () => {
  it("blends visible layers with their opacity and skips hidden ones", () => {
    const sprite = Sprite.create(2, 1);
    const doc = sprite.doc;
    doc.layers[0].set(0, 0, rgba(255, 0, 0));
    const top = doc.addLayer({ name: "top", opacity: 0.5 });
    top.set(0, 0, rgba(0, 0, 255));
    top.set(1, 0, rgba(0, 255, 0));
    const hidden = doc.addLayer({ name: "hidden", visible: false });
    hidden.set(1, 0, rgba(9, 9, 9));

    const out = compositeFrame(sprite.current);
    expect(px(out, 0, 0)).toEqual([128, 0, 128, 255]);
    expect(px(out, 1, 0)).toEqual([0, 255, 0, 128]);
    // Single layer export ignores opacity and visibility.
    expect(px(compositeFrame(sprite.current, hidden.id), 1, 0)).toEqual([9, 9, 9, 255]);
  });

  it("trims, crops and scales", () => {
    const img = createImage(4, 4);
    img.data.set([1, 2, 3, 255], (1 * 4 + 2) * 4);
    expect(opaqueBounds(img)).toEqual({ x: 2, y: 1, width: 1, height: 1 });
    expect(opaqueBounds(createImage(2, 2))).toBeNull();
    const cropped = cropImage(img, { x: 2, y: 1, width: 1, height: 1 });
    const big = scaleImage(cropped, 3);
    expect([big.width, big.height]).toEqual([3, 3]);
    expect(px(big, 2, 2)).toEqual([1, 2, 3, 255]);
  });
});

describe("encoders", () => {
  it("writes a 32-bit BMP with alpha, bottom-up", () => {
    const img = createImage(2, 2);
    img.data.set([10, 20, 30, 40], 0); // top-left
    const bmp = encodeBmp(img);
    const view = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
    expect(view.getUint32(2, true)).toBe(bmp.length);
    expect(view.getUint16(28, true)).toBe(32);
    const offset = view.getUint32(10, true);
    // Top-left pixel is in the last row of the file, stored as BGRA.
    const topLeft = offset + 1 * 2 * 4;
    expect(Array.from(bmp.subarray(topLeft, topLeft + 4))).toEqual([30, 20, 10, 40]);
  });

  it("computes standard CRC-32 and writes a valid stored ZIP", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zip = createZip([
      { name: "a.txt", data: new TextEncoder().encode("hello") },
      { name: "b/c.json", data: new TextEncoder().encode("{}") },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("hello");
    expect(text).toContain("b/c.json");
  });

  it("encodes GIF frames that decode back to the same pixels", () => {
    const a = createImage(5, 3);
    const b = createImage(5, 3);
    for (let i = 0; i < 15; i++) {
      a.data.set(i % 2 ? [255, 0, 0, 255] : [0, 0, 0, 0], i * 4);
      b.data.set(i % 3 ? [0, 255, 0, 255] : [0, 0, 255, 255], i * 4);
    }
    const gif = encodeGif([a, b], [100, 250], { loop: 0 });
    const decoded = decodeGif(gif);
    expect(decoded.delays).toEqual([10, 25]);
    for (const [img, frame] of [
      [a, decoded.frames[0]],
      [b, decoded.frames[1]],
    ] as const) {
      for (let i = 0; i < 15; i++) {
        const alpha = img.data[i * 4 + 3];
        if (alpha === 0) expect(frame[i]).toBe(decoded.transparent);
        else
          expect(decoded.palette[frame[i]]).toEqual(
            Array.from(img.data.subarray(i * 4, i * 4 + 3))
          );
      }
    }
  });

  it("encodes long, varied GIF data across LZW code-size changes", () => {
    const img = createImage(64, 64);
    // 250 distinct colours: within the GIF palette, so decoding must be exact.
    for (let i = 0; i < 64 * 64; i++) {
      img.data.set([((i * 37) % 50) * 5, ((i >> 3) % 5) * 60, 0, 255], i * 4);
    }
    const decoded = decodeGif(encodeGif([img], [100], { loop: null }));
    expect(decoded.frames[0]).toHaveLength(64 * 64);
    for (let i = 0; i < 64 * 64; i += 97) {
      expect(decoded.palette[decoded.frames[0][i]]).toEqual(
        Array.from(img.data.subarray(i * 4, i * 4 + 3))
      );
    }
  });
});

describe("spritesheets", () => {
  const frames = [
    { name: "f_0.png", image: solid(2, 2, [255, 0, 0, 255]), duration: 100 },
    { name: "f_1.png", image: solid(2, 2, [0, 255, 0, 255]), duration: 200 },
    { name: "f_2.png", image: solid(2, 2, [0, 0, 255, 255]), duration: 100 },
  ];

  it("lays out grids with padding", () => {
    const sheet = buildSpritesheet(frames, {
      layout: "grid",
      columns: 2,
      padding: 1,
      extrude: 0,
      trim: false,
    });
    expect([sheet.image.width, sheet.image.height]).toEqual([7, 7]);
    expect(sheet.frames.map((f) => [f.frame.x, f.frame.y])).toEqual([
      [1, 1],
      [4, 1],
      [1, 4],
    ]);
    expect(px(sheet.image, 4, 1)).toEqual([0, 255, 0, 255]);
    expect(px(sheet.image, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("trims frames and records source offsets like TexturePacker", () => {
    const img = createImage(4, 4);
    img.data.set([9, 9, 9, 255], (2 * 4 + 3) * 4);
    const sheet = buildSpritesheet([{ name: "x.png", image: img, duration: 50 }], {
      layout: "horizontal",
      padding: 0,
      extrude: 0,
      trim: true,
    });
    expect(sheet.frames[0]).toMatchObject({
      trimmed: true,
      frame: { x: 0, y: 0, w: 1, h: 1 },
      spriteSourceSize: { x: 3, y: 2, w: 1, h: 1 },
      sourceSize: { w: 4, h: 4 },
      duration: 50,
    });
  });

  it("extrudes edge pixels without moving the frame rectangle", () => {
    const sheet = buildSpritesheet([frames[0]], {
      layout: "horizontal",
      padding: 0,
      extrude: 1,
      trim: false,
    });
    expect([sheet.image.width, sheet.image.height]).toEqual([4, 4]);
    expect(sheet.frames[0].frame).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(px(sheet.image, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("packs differently sized frames without overlap", () => {
    const sizes = [
      [5, 3],
      [2, 2],
      [4, 6],
      [1, 1],
      [3, 3],
    ];
    const sheet = buildSpritesheet(
      sizes.map(([w, h], i) => ({ name: `${i}`, image: solid(w, h, [1, 1, 1, 255]), duration: 1 })),
      { layout: "packed", padding: 1, extrude: 0, trim: false }
    );
    const rects = sheet.frames.map((f) => f.frame);
    for (const [i, a] of rects.entries()) {
      expect(a.x + a.w).toBeLessThanOrEqual(sheet.image.width);
      expect(a.y + a.h).toBeLessThanOrEqual(sheet.image.height);
      for (const b of rects.slice(i + 1)) {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it("writes JSON Hash and JSON Array data", () => {
    const sheet = buildSpritesheet(frames, {
      layout: "horizontal",
      padding: 0,
      extrude: 0,
      trim: false,
    });
    const hash = texturePackerJson(sheetData(sheet), {
      format: "json-hash",
      image: "f.png",
      scale: 2,
    }) as {
      frames: Record<string, { frame: { x: number }; duration: number }>;
      meta: { image: string; size: { w: number; h: number }; scale: string };
    };
    expect(Object.keys(hash.frames)).toEqual(["f_0.png", "f_1.png", "f_2.png"]);
    expect(hash.frames["f_1.png"]).toMatchObject({ frame: { x: 2 }, duration: 200 });
    expect(hash.meta).toMatchObject({ image: "f.png", size: { w: 6, h: 2 }, scale: "2" });
    const array = texturePackerJson(sheetData(sheet), {
      format: "json-array",
      image: "f.png",
      scale: 1,
    }) as {
      frames: { filename: string }[];
    };
    expect(array.frames.map((f) => f.filename)).toEqual(["f_0.png", "f_1.png", "f_2.png"]);
  });

  it("fills file name patterns safely", () => {
    expect(applyPattern("{name}-{frame}-{w}x{h}", { name: "walk", frame: 3, w: 16, h: 8 })).toBe(
      "walk-3-16x8"
    );
    expect(applyPattern("a/b:{name}", { name: "x", frame: 0, w: 1, h: 1 })).toBe("a_b_x");
  });
});

/** Minimal GIF decoder (global palette, no interlace) to verify the encoder. */
function decodeGif(bytes: Uint8Array) {
  let p = 6;
  const u16 = () => bytes[p++] | (bytes[p++] << 8);
  const width = u16();
  const height = u16();
  const flags = bytes[p++];
  p += 2;
  const size = 1 << ((flags & 7) + 1);
  const palette: number[][] = [];
  for (let i = 0; i < size; i++) palette.push([bytes[p++], bytes[p++], bytes[p++]]);
  const frames: number[][] = [];
  const delays: number[] = [];
  let transparent = -1;
  const skipBlocks = () => {
    while (bytes[p] !== 0) p += bytes[p] + 1;
    p++;
  };
  while (p < bytes.length) {
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        p++; // size
        const packed = bytes[p++];
        delays.push(u16());
        const t = bytes[p++];
        if (packed & 1) transparent = t;
        p++;
      } else {
        skipBlocks();
      }
      continue;
    }
    // Image descriptor.
    p += 9;
    const minCode = bytes[p++];
    const data: number[] = [];
    while (bytes[p] !== 0) {
      const len = bytes[p++];
      for (let i = 0; i < len; i++) data.push(bytes[p++]);
    }
    p++;
    const clear = 1 << minCode;
    const end = clear + 1;
    let codeSize = minCode + 1;
    let dict: number[][] = [];
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict[i] = [i];
      dict[clear] = [];
      dict[end] = [];
      codeSize = minCode + 1;
    };
    reset();
    const out: number[] = [];
    let bit = 0;
    let prev: number[] | null = null;
    const read = () => {
      let code = 0;
      for (let i = 0; i < codeSize; i++, bit++) {
        if (data[bit >> 3] & (1 << (bit & 7))) code |= 1 << i;
      }
      return code;
    };
    while (true) {
      const code = read();
      if (code === clear) {
        reset();
        prev = null;
        continue;
      }
      if (code === end) break;
      let entry: number[];
      if (code < dict.length) entry = dict[code];
      else entry = [...prev!, prev![0]];
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    frames.push(out.slice(0, width * height));
  }
  return { width, height, palette, frames, delays, transparent };
}

describe("GIF colour reduction", () => {
  /** A 64×64 smooth RGB gradient: 4096 distinct colours. */
  const gradient = () => {
    const img = createImage(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        img.data.set([x * 4, y * 4, ((x + y) * 2) & 255, 255], (y * 64 + x) * 4);
      }
    }
    return img;
  };
  /** Mean absolute error per channel between an image and its decoded GIF. */
  const meanError = (img: ReturnType<typeof createImage>, dither = false) => {
    const decoded = decodeGif(encodeGif([img], [100], { loop: null, dither }));
    let sum = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const rgb = decoded.palette[decoded.frames[0][i]];
      for (let c = 0; c < 3; c++) sum += Math.abs(rgb[c] - img.data[i * 4 + c]);
    }
    return sum / (64 * 64 * 3);
  };

  it("keeps up to 255 colours exact and reduces more with median cut", async () => {
    const { medianCut } = await import("../src/export/quantize");
    const few = new Map([
      [0xff0000, 3],
      [0x00ff00, 1],
    ]);
    expect(medianCut(few, 255).sort((a, b) => a - b)).toEqual([0x00ff00, 0xff0000]);

    const counts = new Map<number, number>();
    const img = gradient();
    for (let i = 0; i < 64 * 64; i++) {
      const [r, g, b] = img.data.subarray(i * 4, i * 4 + 3);
      counts.set((r << 16) | (g << 8) | b, 1);
    }
    expect(counts.size).toBe(4096);
    expect(new Set(medianCut(counts, 255)).size).toBe(255);
  });

  it("covers the whole gradient instead of only its most frequent colours", () => {
    // Every colour appears once, so "most frequent" would keep an arbitrary
    // 255 of them; median cut spreads the palette over the range.
    expect(meanError(gradient())).toBeLessThan(6);
  });

  it("dithers only reduced palettes and leaves transparency alone", () => {
    const img = gradient();
    img.data[3] = 0; // top-left pixel transparent
    const plain = decodeGif(encodeGif([img], [100], { loop: null }));
    const dithered = decodeGif(encodeGif([img], [100], { loop: null, dither: true }));
    expect(dithered.frames[0]).not.toEqual(plain.frames[0]);
    expect(dithered.frames[0][0]).toBe(dithered.transparent);
    // Dithering trades per-pixel accuracy for smoother areas, so stay in bounds.
    expect(meanError(img, true)).toBeLessThan(12);

    // With few colours the palette is exact and dithering changes nothing.
    const small = createImage(4, 4);
    for (let i = 0; i < 16; i++) small.data.set([i * 10, 0, 0, 255], i * 4);
    expect(encodeGif([small], [100], { loop: null, dither: true })).toEqual(
      encodeGif([small], [100], { loop: null })
    );
  });
});
