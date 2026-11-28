import { describe, it, expect } from "vite-plus/test";
import { readSheetData, SHEET_FORMATS } from "@gs2d/formats";
import {
  buildAtlas,
  createImage,
  encodePng,
  pack,
  premultiply,
  rotateImageCCW,
  rotateImageCW,
  scaleSheet,
  sheetData,
  unpackFrame,
  type PackOptions,
  type PackSize,
  type RgbaImage,
} from "../src";

/** Deterministic pseudo-random sizes. */
function sizes(n: number, seed = 1): PackSize[] {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: n }, () => ({
    w: 4 + Math.floor(rand() * 60),
    h: 4 + Math.floor(rand() * 60),
  }));
}

/** Checks every placement is inside its sheet (border included) and none overlap (padding included). */
function checkLayout(input: PackSize[], options: PackOptions) {
  const result = pack(input, options);
  const pad = options.padding ?? 0;
  const border = options.border ?? 0;
  expect(result.placements).toHaveLength(input.length);
  const rects = result.placements.map((p) => {
    const s = input[p.index];
    const w = p.rotated ? s.h : s.w;
    const h = p.rotated ? s.w : s.h;
    const bin = result.bins[p.bin];
    expect(p.x).toBeGreaterThanOrEqual(border);
    expect(p.y).toBeGreaterThanOrEqual(border);
    expect(p.x + w).toBeLessThanOrEqual(bin.width - border);
    expect(p.y + h).toBeLessThanOrEqual(bin.height - border);
    return { bin: p.bin, x: p.x, y: p.y, w, h };
  });
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.bin !== b.bin) continue;
      const apart =
        a.x + a.w + pad <= b.x ||
        b.x + b.w + pad <= a.x ||
        a.y + a.h + pad <= b.y ||
        b.y + b.h + pad <= a.y;
      expect(apart).toBe(true);
    }
  }
  for (const bin of result.bins) {
    expect(bin.width).toBeLessThanOrEqual(options.maxWidth ?? 4096);
    expect(bin.height).toBeLessThanOrEqual(options.maxHeight ?? 4096);
  }
  return result;
}

const image = (w: number, h: number, fill: (x: number, y: number) => number[]): RgbaImage => {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(fill(x, y), (y * w + x) * 4);
  return img;
};
const px = (img: RgbaImage, x: number, y: number) => [
  ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];

describe("pack", () => {
  it("MaxRects places everything without overlaps, for each heuristic, with and without rotation", () => {
    const input = sizes(80);
    for (const heuristic of ["short-side", "long-side", "area", "bottom-left"] as const) {
      for (const allowRotation of [false, true]) {
        checkLayout(input, {
          algorithm: "maxrects",
          heuristic,
          allowRotation,
          padding: 2,
          border: 1,
        });
      }
    }
  });

  it("MaxRects packs tightly: over 80% fill on random sprites", () => {
    const input = sizes(120, 7);
    const result = checkLayout(input, { algorithm: "maxrects", allowRotation: true });
    const used = input.reduce((sum, s) => sum + s.w * s.h, 0);
    const total = result.bins.reduce((sum, b) => sum + b.width * b.height, 0);
    expect(result.bins).toHaveLength(1);
    expect(used / total).toBeGreaterThan(0.8);
  });

  it("overflows into more sheets at the maximum size", () => {
    const input = Array.from({ length: 10 }, () => ({ w: 30, h: 30 }));
    const result = checkLayout(input, { algorithm: "maxrects", maxWidth: 64, maxHeight: 64 });
    expect(result.bins.length).toBe(3); // 4 + 4 + 2
    expect(() =>
      pack([{ w: 100, h: 10 }], { algorithm: "maxrects", maxWidth: 64, maxHeight: 64 })
    ).toThrow(/bigger than the maximum/);
  });

  it("rounds sheets to powers of two and squares", () => {
    const result = checkLayout(sizes(20, 3), {
      algorithm: "maxrects",
      powerOfTwo: true,
      square: true,
    });
    for (const b of result.bins) {
      expect(Math.log2(b.width) % 1).toBe(0);
      expect(b.width).toBe(b.height);
    }
  });

  it("shelf, grid and strips keep input order in uniform cells", () => {
    checkLayout(sizes(30, 5), { algorithm: "shelf", padding: 1 });
    const cells = [
      { w: 10, h: 8 },
      { w: 6, h: 12 },
      { w: 10, h: 10 },
    ];
    const row = pack(cells, { algorithm: "horizontal", padding: 2 });
    expect(row.placements.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [12, 0],
      [24, 0],
    ]);
    expect(row.bins[0]).toEqual({ width: 34, height: 12 });
    const column = pack(cells, { algorithm: "vertical" });
    expect(column.placements.map((p) => p.y)).toEqual([0, 12, 24]);
    const grid = pack(cells, { algorithm: "grid", columns: 2 });
    expect(grid.placements.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [0, 12],
    ]);
  });
});

describe("sheet limits", () => {
  const algorithms = ["maxrects", "shelf", "grid", "horizontal", "vertical"] as const;
  const boxes = (n: number, w: number, h: number) => Array.from({ length: n }, () => ({ w, h }));

  it("finishes and stays inside limits that are wider or taller than square", () => {
    for (const algorithm of algorithms) {
      for (const [maxWidth, maxHeight] of [
        [128, 1024],
        [1024, 128],
        [100, 333],
      ]) {
        checkLayout(sizes(60, 11), { algorithm, maxWidth, maxHeight, padding: 1, border: 2 });
      }
    }
  });

  it("square and power-of-two sheets never go past the maximum", () => {
    for (const algorithm of algorithms) {
      for (const [maxWidth, maxHeight] of [
        [512, 128],
        [128, 512],
        [1000, 1000],
      ]) {
        for (const powerOfTwo of [false, true]) {
          for (const square of [false, true]) {
            const { bins } = checkLayout(boxes(30, 30, 30), {
              algorithm,
              maxWidth,
              maxHeight,
              powerOfTwo,
              square,
              border: 1,
              padding: 1,
            });
            for (const b of bins) {
              if (square) expect(b.width).toBe(b.height);
              if (powerOfTwo) expect(Number.isInteger(Math.log2(b.width))).toBe(true);
            }
          }
        }
      }
    }
  });

  it("turns a sprite only where that fits", () => {
    const upright = checkLayout([{ w: 20, h: 100 }], {
      algorithm: "shelf",
      allowRotation: true,
      maxWidth: 64,
      maxHeight: 128,
    });
    expect(upright.placements[0].rotated).toBe(false);
    for (const algorithm of ["maxrects", "shelf"] as const) {
      const turned = checkLayout([{ w: 100, h: 20 }], {
        algorithm,
        allowRotation: true,
        maxWidth: 64,
        maxHeight: 128,
      });
      expect(turned.placements[0].rotated).toBe(true);
    }
  });

  it("uses a power-of-two sheet fully, border included", () => {
    // 4 × 4 sprites of 14 px with 2 px gaps and a 1 px border fill 64 px exactly.
    const { bins } = checkLayout(boxes(16, 14, 14), {
      algorithm: "maxrects",
      powerOfTwo: true,
      padding: 2,
      border: 1,
    });
    expect(bins).toEqual([{ width: 64, height: 64 }]);
  });

  it("packs 800 sprites in reasonable time", () => {
    const started = performance.now();
    checkLayout(sizes(800, 3), { algorithm: "maxrects", allowRotation: true, padding: 2 });
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe("buildAtlas", () => {
  const red = [255, 0, 0, 255];
  const clear = [0, 0, 0, 0];

  it("trims transparent borders and keeps the offset", () => {
    const sprite = image(8, 8, (x, y) => (x >= 2 && x < 5 && y >= 3 && y < 7 ? red : clear));
    const atlas = buildAtlas([{ name: "a.png", image: sprite }], {
      algorithm: "maxrects",
      trim: true,
    });
    const [frame] = atlas.sheets[0].frames;
    expect(frame.trimmed).toBe(true);
    expect(frame.frame).toMatchObject({ w: 3, h: 4 });
    expect(frame.spriteSourceSize).toEqual({ x: 2, y: 3, w: 3, h: 4 });
    expect(frame.sourceSize).toEqual({ w: 8, h: 8 });
  });

  it("stores identical sprites once", () => {
    const a = image(4, 4, () => red);
    const b = image(4, 4, () => red);
    const c = image(4, 4, (x) => (x ? red : clear));
    const atlas = buildAtlas(
      [
        { name: "a", image: a },
        { name: "b", image: b },
        { name: "c", image: c },
      ],
      { algorithm: "maxrects", alias: true }
    );
    expect(atlas.aliased).toBe(1);
    const [fa, fb, fc] = atlas.sheets[0].frames;
    expect(fb.frame).toEqual(fa.frame);
    expect(fc.frame).not.toEqual(fa.frame);
  });

  it("extrudes edges into the padding", () => {
    const sprite = image(2, 2, () => red);
    const atlas = buildAtlas([{ name: "a", image: sprite }], { algorithm: "maxrects", extrude: 1 });
    const sheet = atlas.sheets[0].image;
    expect([sheet.width, sheet.height]).toEqual([4, 4]);
    expect(atlas.sheets[0].frames[0].frame).toMatchObject({ x: 1, y: 1 });
    expect(px(sheet, 0, 0)).toEqual(red); // corner filled by extrusion
  });

  it("draws rotated sprites turned 90° clockwise and reports their unrotated size", () => {
    const sprite = image(3, 1, (x) => [x * 100, 0, 0, 255]);
    const turned = rotateImageCW(sprite);
    expect([turned.width, turned.height]).toEqual([1, 3]);
    expect(px(turned, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(turned, 0, 2)).toEqual([200, 0, 0, 255]);

    // A tall slot: three 1×3 sprites and one 3×1, which fits best turned.
    const tall = image(1, 3, () => red);
    const atlas = buildAtlas(
      [
        { name: "t1", image: tall },
        { name: "t2", image: tall },
        { name: "t3", image: tall },
        { name: "w", image: sprite },
      ],
      { algorithm: "maxrects", allowRotation: true, maxWidth: 4, maxHeight: 3 }
    );
    const w = atlas.sheets[0].frames.find((f) => f.filename === "w")!;
    expect(w.rotated).toBe(true);
    expect(w.frame).toMatchObject({ w: 3, h: 1 });
    expect(px(atlas.sheets[0].image, w.frame.x, w.frame.y + 2)).toEqual([200, 0, 0, 255]);
  });
});

describe("pivots, scales and unpacking", () => {
  /** Sprites with a transparent margin and a different pixel everywhere. */
  const sprite = (w: number, h: number, seed: number) =>
    image(w, h, (x, y) =>
      x < 2 || y < 1 || x >= w - 1
        ? [0, 0, 0, 0]
        : [(x * 31 + seed) & 255, (y * 17) & 255, seed, 255]
    );
  const inputs = Array.from({ length: 12 }, (_, i) => ({
    name: `s${i}.png`,
    image: sprite(8 + i * 3, 30 - i * 2, i * 20),
  }));

  it("unpacking a trimmed, rotated, extruded atlas gives the original sprites back", () => {
    const atlas = buildAtlas(inputs, {
      algorithm: "maxrects",
      allowRotation: true,
      trim: true,
      alias: true,
      padding: 1,
      border: 2,
      extrude: 1,
      maxWidth: 80,
      maxHeight: 64,
    });
    expect(atlas.sheets.length).toBeGreaterThan(1);
    const frames = atlas.sheets.flatMap((s) => s.frames.map((f) => ({ sheet: s.image, f })));
    expect(frames.some(({ f }) => f.rotated)).toBe(true);
    for (const { sheet, f } of frames) {
      const original = inputs.find((i) => i.name === f.filename)!.image;
      expect(unpackFrame(sheet, f)).toEqual(original);
    }
  });

  it("every format with rotation survives writing, reading and unpacking", () => {
    const rotating = SHEET_FORMATS.filter((f) => f.rotation);
    expect(rotating.map((f) => f.id)).toEqual([
      "gs2d",
      "json-hash",
      "json-array",
      "starling-xml",
      "libgdx-atlas",
    ]);
    for (const format of rotating) {
      const atlas = buildAtlas(inputs, {
        algorithm: "maxrects",
        allowRotation: true,
        trim: true,
        turn: format.rotation!,
        maxWidth: 80,
        maxHeight: 64,
      });
      let turned = 0;
      for (const sheet of atlas.sheets) {
        const text = format.write(sheetData(sheet), { image: "a.png", scale: 1 });
        const [page] = readSheetData(text)!;
        expect(page.frames).toHaveLength(sheet.frames.length);
        for (const f of page.frames) {
          if (f.rotated) turned++;
          const name = `${f.filename.replace(/\.png$/, "")}.png`;
          const original = inputs.find((i) => i.name === name)!.image;
          expect(unpackFrame(sheet.image, f, page.turn)).toEqual(original);
        }
      }
      expect(turned).toBeGreaterThan(0);
    }
  });

  it("refuses frames outside the sheet or their original size", () => {
    const atlas = buildAtlas([inputs[0]], { algorithm: "maxrects", trim: true });
    const [f] = atlas.sheets[0].frames;
    const sheet = atlas.sheets[0].image;
    expect(() => unpackFrame(sheet, { ...f, frame: { ...f.frame, x: 5 } })).toThrow(/outside/);
    expect(() => unpackFrame(sheet, { ...f, sourceSize: { w: 1, h: 1 } })).toThrow(/original size/);
  });

  it("carries pivots and scales sheets with their frames", () => {
    const atlas = buildAtlas([{ ...inputs[0], pivot: { x: 0.5, y: 1 } }, inputs[1]], {
      algorithm: "horizontal",
      trim: true,
    });
    const [a, b] = atlas.sheets[0].frames;
    expect(a.pivot).toEqual({ x: 0.5, y: 1 });
    expect("pivot" in b).toBe(false);
    const doubled = scaleSheet(atlas.sheets[0], 2);
    expect(doubled.image.width).toBe(atlas.sheets[0].image.width * 2);
    for (const [i, f] of doubled.frames.entries()) {
      const small = unpackFrame(atlas.sheets[0].image, atlas.sheets[0].frames[i]);
      const big = unpackFrame(doubled.image, f);
      expect([big.width, big.height]).toEqual([small.width * 2, small.height * 2]);
      expect(px(big, 9, 7)).toEqual(px(small, 4, 3));
    }
  });

  it("turns images back and premultiplies", () => {
    const img = sprite(5, 3, 9);
    expect(rotateImageCCW(rotateImageCW(img))).toEqual(img);
    expect(rotateImageCCW(img)).toEqual(rotateImageCW(rotateImageCW(rotateImageCW(img))));
    const half = image(1, 1, () => [200, 100, 3, 128]);
    expect(px(premultiply(half), 0, 0)).toEqual([100, 50, 2, 128]);
  });
});

describe("encodePng", () => {
  it("keeps every byte, nearly transparent pixels included", async () => {
    const img = image(7, 5, (x, y) => [x * 40, y * 50, (x * y * 13) & 255, (x * 7 + y) & 255]);
    const png = await encodePng(img);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([7, 5]);
    // Undo it by hand: inflate the one IDAT chunk and reverse the row filters.
    const idat = new TextDecoder("latin1").decode(png).indexOf("IDAT");
    const data = png.slice(idat + 4, idat + 4 + view.getUint32(idat - 4));
    const raw = new Uint8Array(
      await new Response(
        new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"))
      ).arrayBuffer()
    );
    const stride = 7 * 4;
    const out = new Uint8ClampedArray(stride * 5);
    for (let y = 0; y < 5; y++) {
      const filter = raw[y * (stride + 1)];
      for (let i = 0; i < stride; i++) {
        const left = i >= 4 ? out[y * stride + i - 4] : 0;
        const above = y > 0 ? out[(y - 1) * stride + i] : 0;
        const base = filter === 1 ? left : filter === 2 ? above : 0;
        out[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + base) & 255;
      }
    }
    expect(out).toEqual(img.data);
  });
});
