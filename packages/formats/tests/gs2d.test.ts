import { validateAnimation, validateAsset, validateSpriteSheet } from "@gs2d/contracts";
import { describe, expect, it } from "vite-plus/test";
import { readSheetData, sheetDataFiles, sheetFormat, type SheetData } from "../src";

/** Three frames: plain, trimmed with a pivot, and rotated. */
const sheet: SheetData = {
  width: 48,
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
      pivot: { x: 0.5, y: 1 },
    },
    {
      filename: "jump.png",
      frame: { x: 30, y: 0, w: 16, h: 14 },
      rotated: true,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 16, h: 14 },
      sourceSize: { w: 16, h: 14 },
      duration: 80,
    },
  ],
};
const format = sheetFormat("gs2d");
const options = {
  image: "hero.png",
  scale: 1,
  frameTags: [
    { name: "walk", from: 0, to: 1, direction: "pingpong" as const },
    { name: "back", from: 0, to: 1, direction: "reverse" as const },
    { name: "jump", from: 2, to: 2, direction: "forward" as const },
  ],
};

describe("the Game Studio 2D format", () => {
  const files = sheetDataFiles(format, "hero", sheet, options);
  const [sheetFile, animationFile] = files.map((f) => JSON.parse(f.text) as unknown);

  it("writes a sheet and its animations, both valid contracts", () => {
    expect(files.map((f) => f.name)).toEqual(["hero.sheet.json", "hero.animation.json"]);
    expect(validateSpriteSheet(sheetFile).errors).toEqual([]);
    const sprites = Object.keys((sheetFile as { frames: object }).frames);
    expect(sprites).toEqual(["walk_0", "walk_1", "jump"]);
    expect(validateAnimation(animationFile, sprites).errors).toEqual([]);
    for (const f of [sheetFile, animationFile]) expect(validateAsset(f).valid).toBe(true);
  });

  it("keeps trim, pivots, rotation and timing", () => {
    expect(sheetFile).toMatchObject({
      id: "hero",
      image: "hero.png",
      frames: {
        walk_0: { x: 0, y: 0, w: 16, h: 16 },
        walk_1: {
          x: 18,
          y: 0,
          w: 10,
          h: 12,
          source: { x: 3, y: 2, w: 16, h: 16 },
          pivot: { x: 0.5, y: 1 },
        },
        jump: { x: 30, y: 0, w: 16, h: 14, rotated: true },
      },
    });
    expect(sheetFile).not.toHaveProperty("scale");
    expect(animationFile).toEqual({
      version: 1,
      kind: "animation",
      id: "hero-animation",
      name: "hero",
      sheet: "hero",
      clips: {
        walk: {
          playback: "pingpong",
          frames: [
            { sprite: "walk_0", ms: 100 },
            { sprite: "walk_1", ms: 200 },
          ],
        },
        back: {
          frames: [
            { sprite: "walk_1", ms: 200 },
            { sprite: "walk_0", ms: 100 },
          ],
        },
        jump: { frames: [{ sprite: "jump", ms: 80 }] },
      },
    });
  });

  it("writes the scale of an @2x sheet, and no animation file without animations", () => {
    const files2x = sheetDataFiles(format, "hero@2x", sheet, { image: "hero@2x.png", scale: 2 });
    expect(files2x.map((f) => f.name)).toEqual(["hero@2x.sheet.json"]);
    expect(JSON.parse(files2x[0].text)).toMatchObject({ id: "hero@2x", scale: 2 });
  });

  it("reads back as the sheet it was written from", () => {
    const [page] = readSheetData(files[0].text)!;
    expect(page.image).toBe("hero.png");
    expect(page.frames.map(({ duration: _, ...f }) => f)).toEqual(
      sheet.frames.map(({ duration: _, ...f }) => f)
    );
    expect(() => readSheetData('{"version":1,"kind":"spritesheet"}')).toThrow(/id/);
  });
});
