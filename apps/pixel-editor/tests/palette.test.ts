import { describe, it, expect } from "vite-plus/test";
import {
  PaletteFormatError,
  parseGplPalette,
  parseHexPalette,
  parsePaletteFile,
  toGplPalette,
  toHexPalette,
} from "../src/io/palette";
import { Sprite } from "../src/model/Sprite";
import { fromProjectFile, toProjectFile } from "../src/io/project";

describe("palette files", () => {
  it("parses Lospec .hex files", () => {
    expect(parseHexPalette("FFEE00\n#2121ff\r\n\n; comment\n000000\n")).toEqual([
      "#ffee00",
      "#2121ff",
      "#000000",
    ]);
    expect(() => parseHexPalette("nope")).toThrow(PaletteFormatError);
  });

  it("parses GIMP .gpl files", () => {
    const gpl = "GIMP Palette\nName: test\nColumns: 4\n#\n255 238   0\tYellow\n  0   0   0\n";
    expect(parseGplPalette(gpl)).toEqual(["#ffee00", "#000000"]);
    expect(() => parseGplPalette("255 0 0")).toThrow(/header/);
  });

  it("round-trips both formats and drops duplicates", () => {
    const colors = ["#ffee00", "#2121ff", "#ffffff"];
    expect(parsePaletteFile("a.hex", toHexPalette(colors))).toEqual(colors);
    expect(parsePaletteFile("a.gpl", toGplPalette(colors, "arcade"))).toEqual(colors);
    expect(parsePaletteFile("a.txt", "ffffff\nFFFFFF\n")).toEqual(["#ffffff"]);
    expect(() => parsePaletteFile("a.hex", "\n")).toThrow(/empty/);
  });
});

describe("palette in projects", () => {
  it("is saved with the sprite and restored", () => {
    const sprite = Sprite.create(2, 2);
    sprite.setPalette(["#123456", "#ABCDEF"]);
    const copy = fromProjectFile(JSON.parse(JSON.stringify(toProjectFile(sprite, "s")))).sprite;
    expect(copy.palette).toEqual(["#123456", "#abcdef"]);
  });

  it("keeps the default palette for files without one", () => {
    const file = toProjectFile(Sprite.create(2, 2), "s");
    delete file.palette;
    expect(fromProjectFile(file).sprite.palette.length).toBeGreaterThan(0);
  });
});
