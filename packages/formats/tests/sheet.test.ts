import { describe, it, expect } from "vite-plus/test";
import { SHEET_FORMATS, sheetFormat, texturePackerJson, type SheetData } from "../src";

/** Two 16×16 frames: the first untrimmed, the second trimmed to 10×12 at (3, 2). */
const sheet: SheetData = {
  width: 34,
  height: 16,
  frames: [
    {
      filename: "walk_0.png",
      frame: { x: 0, y: 0, w: 16, h: 16 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 16, h: 16 },
      sourceSize: { w: 16, h: 16 },
      duration: 100,
    },
    {
      filename: "walk_1.png",
      frame: { x: 18, y: 0, w: 10, h: 12 },
      rotated: false,
      trimmed: true,
      spriteSourceSize: { x: 3, y: 2, w: 10, h: 12 },
      sourceSize: { w: 16, h: 16 },
      duration: 200,
    },
  ],
};
const options = {
  image: "walk.png",
  scale: 1,
  frameTags: [{ name: "walk", from: 0, to: 1, direction: "forward" as const }],
};
const write = (id: Parameters<typeof sheetFormat>[0]) => sheetFormat(id).write(sheet, options);

describe("spritesheet data formats", () => {
  it("every format has a unique id and an extension", () => {
    const ids = SHEET_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of SHEET_FORMATS) expect(f.extension).toMatch(/^\.[a-z]+$/);
  });

  it("TexturePacker JSON keys frames by name (hash) or lists them (array)", () => {
    const hash = texturePackerJson(sheet, { ...options, format: "json-hash" }) as {
      frames: Record<string, { frame: unknown }>;
      meta: { image: string; size: unknown; frameTags: unknown[] };
    };
    expect(Object.keys(hash.frames)).toEqual(["walk_0.png", "walk_1.png"]);
    expect(hash.frames["walk_1.png"].frame).toEqual({ x: 18, y: 0, w: 10, h: 12 });
    expect(hash.meta).toMatchObject({ image: "walk.png", size: { w: 34, h: 16 } });
    expect(hash.meta.frameTags).toHaveLength(1);
    const array = JSON.parse(write("json-array")) as { frames: { filename: string }[] };
    expect(array.frames.map((f) => f.filename)).toEqual(["walk_0.png", "walk_1.png"]);
  });

  it("Starling XML: trimmed frames carry negative frame offsets", () => {
    expect(write("starling-xml").split("\n")).toEqual([
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<TextureAtlas imagePath="walk.png">`,
      `  <SubTexture name="walk_0" x="0" y="0" width="16" height="16"/>`,
      `  <SubTexture name="walk_1" x="18" y="0" width="10" height="12" frameX="-3" frameY="-2" frameWidth="16" frameHeight="16"/>`,
      `</TextureAtlas>`,
      ``,
    ]);
  });

  it("Godot SpriteFrames: atlas regions, trim margins and relative durations", () => {
    const tres = write("godot-tres");
    expect(tres).toContain(`[gd_resource type="SpriteFrames" load_steps=4 format=3]`);
    expect(tres).toContain(`[ext_resource type="Texture2D" path="res://walk.png" id="1_sheet"]`);
    expect(tres).toContain(`region = Rect2(18, 0, 10, 12)\nmargin = Rect2(3, 2, 6, 4)`);
    // 100 ms is the base frame (speed 10 fps); the 200 ms frame lasts twice as long.
    expect(tres).toContain(`"duration": 1.0,\n"texture": SubResource("AtlasTexture_0")`);
    expect(tres).toContain(`"duration": 2.0,\n"texture": SubResource("AtlasTexture_1")`);
    expect(tres).toContain(`"name": &"walk",\n"speed": 10.0`);
  });

  it("Godot pingpong tags play back without repeating the ends", () => {
    const three = {
      ...sheet,
      frames: [...sheet.frames, { ...sheet.frames[0], filename: "c.png" }],
    };
    const tres = sheetFormat("godot-tres").write(three, {
      ...options,
      frameTags: [{ name: "bounce", from: 0, to: 2, direction: "pingpong" }],
    });
    const order = [...tres.matchAll(/AtlasTexture_(\d)"\)\n\}/g)].map((m) => m[1]);
    expect(order).toEqual(["0", "1", "2", "1"]);
  });

  it("LibGDX atlas: offsets from the bottom-left of the original", () => {
    const atlas = write("libgdx-atlas").split("\n");
    expect(atlas.slice(0, 6)).toEqual([
      "",
      "walk.png",
      "size: 34, 16",
      "format: RGBA8888",
      "filter: Nearest, Nearest",
      "repeat: none",
    ]);
    const second = atlas.indexOf("walk_1");
    expect(atlas.slice(second, second + 7)).toEqual([
      "walk_1",
      "  rotate: false",
      "  xy: 18, 0",
      "  size: 10, 12",
      "  orig: 16, 16",
      "  offset: 3, 2", // 16 - 12 - 2 from the bottom
      "  index: -1",
    ]);
  });

  it("CSS sprites keep trimmed frames at their original size", () => {
    const css = write("css");
    expect(css).toContain(`background-image: url("walk.png");`);
    expect(css).toContain(
      ".walk.walk_1 {\n  width: 16px;\n  height: 16px;\n  background-position: -15px 2px;\n}"
    );
  });
});

describe("rotated sprites", () => {
  const rotated: SheetData = { ...sheet, frames: [{ ...sheet.frames[0], rotated: true }] };

  it("TexturePacker JSON passes the flag through; formats without rotation refuse", () => {
    const json = JSON.parse(sheetFormat("json-array").write(rotated, options)) as {
      frames: { rotated: boolean }[];
    };
    expect(json.frames[0].rotated).toBe(true);
    for (const f of SHEET_FORMATS.filter((f) => !f.supportsRotation)) {
      expect(() => f.write(rotated, options)).toThrow(/rotated/);
    }
  });
});
