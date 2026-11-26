import { describe, it, expect } from "vite-plus/test";
import { GridDocument, serializeDocument } from "@gs2d/core";
import { isPixelSpriteFile, spriteToSheet } from "../src/io/spriteImport";
import { ProjectFormatError } from "../src/io/projectFile";

function frame(color: number) {
  const doc = new GridDocument<Uint32Array>({
    width: 2,
    height: 2,
    emptyValue: 0,
    bufferCtor: Uint32Array,
  });
  doc.addLayer("L").set(1, 1, color);
  return serializeDocument(doc);
}

describe("sprite import", () => {
  it("lays v2 frames out side by side as RGBA", () => {
    const file = {
      format: "gs2d.sprite",
      version: 2,
      name: "pellet",
      fps: 8,
      frames: [
        { duration: null, document: frame(0xff0000ff) },
        { duration: 100, document: frame(0xff00ff00) },
      ],
    };
    expect(isPixelSpriteFile(file)).toBe(true);
    const sheet = spriteToSheet(file);
    expect([sheet.width, sheet.height, sheet.frames, sheet.frameWidth]).toEqual([4, 2, 2, 2]);
    const px = (x: number, y: number) =>
      Array.from(sheet.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(3, 1)).toEqual([0, 255, 0, 255]);
    expect(px(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("reads single-image v1 files", () => {
    const sheet = spriteToSheet({
      format: "gs2d.sprite",
      version: 1,
      name: "x",
      document: frame(0xffffffff),
    });
    expect(sheet.frames).toBe(1);
  });

  it("rejects other files", () => {
    expect(isPixelSpriteFile({ format: "gs2d.level" })).toBe(false);
    expect(() =>
      spriteToSheet({ format: "gs2d.sprite", version: 2, frames: [{ document: {} }] })
    ).toThrow(ProjectFormatError);
  });
});
