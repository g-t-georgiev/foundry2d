import { describe, expect, it } from "vite-plus/test";
import {
  cellName,
  frameMs,
  validateAnimation,
  validateAsset,
  validateLevel,
  validateSpriteSheet,
  type AnimationAsset,
  type LevelAsset,
  type SpriteSheetAsset,
} from "../src";

const sheet: SpriteSheetAsset = {
  version: 1,
  kind: "spritesheet",
  id: "pacman-sprites",
  name: "Pac-Man sprites",
  image: "pacman-sprites.png",
  width: 64,
  height: 32,
  frames: {
    "pacman/open": { x: 0, y: 0, w: 16, h: 16, pivot: { x: 0.5, y: 0.5 } },
    "pacman/closed": { x: 16, y: 0, w: 13, h: 16, source: { x: 1, y: 0, w: 16, h: 16 } },
    "ghost/blinky": { x: 32, y: 0, w: 14, h: 16, rotated: true },
  },
};

const animation: AnimationAsset = {
  version: 1,
  kind: "animation",
  id: "pacman-anims",
  name: "Pac-Man animations",
  sheet: "pacman-sprites",
  timing: { fpsBasis: 60.606 },
  clips: {
    chomp: {
      playback: "pingpong",
      frames: [
        { sprite: "pacman/open", frames: 4 },
        { sprite: "pacman/closed", frames: 4 },
      ],
    },
    blink: { frames: [{ sprite: "ghost/blinky", ms: 200 }] },
  },
};

const level: LevelAsset = {
  version: 1,
  kind: "level",
  id: "maze-1",
  name: "Maze 1",
  tileSize: 8,
  columns: 3,
  rows: 2,
  background: "#000000",
  grids: {
    collision: { values: { wall: 1, gate: 2 }, cells: [1, 1, 1, 1, 0, 2] },
  },
  entities: [
    { type: "PacMan", id: "p1", layer: "entities", x: 12, y: 4, width: 16, height: 16 },
    {
      type: "Ghost",
      id: "g1",
      layer: "entities",
      x: 4,
      y: 12,
      width: 16,
      height: 16,
      fields: { kind: "blinky", scatterTarget: { x: 25, y: 0 } },
    },
  ],
};

describe("asset contracts", () => {
  it("accept well-formed sprite sheets, animations and levels", () => {
    expect(validateSpriteSheet(sheet)).toEqual({ valid: true, errors: [] });
    expect(validateAnimation(animation, Object.keys(sheet.frames)).errors).toEqual([]);
    expect(validateLevel(level).errors).toEqual([]);
    for (const asset of [sheet, animation, level]) expect(validateAsset(asset).valid).toBe(true);
  });

  it("list every problem in a sprite sheet", () => {
    const bad = {
      ...sheet,
      version: 2,
      width: 20,
      frames: {
        a: { x: 0, y: 0, w: 0, h: 4 },
        b: { x: 10, y: 0, w: 16, h: 4 },
        c: { x: 0, y: 0, w: 8, h: 8, source: { x: 4, y: 0, w: 8, h: 8 } },
        d: { x: 0, y: 0, w: 8, h: 8, pivot: { x: "middle" } },
      },
    };
    expect(validateSpriteSheet(bad).errors).toEqual([
      "version must be 1.",
      'frames["a"] needs whole-number x, y, w and h (w and h at least 1).',
      'frames["b"] lies outside the image.',
      'frames["c"].source must be the untrimmed size holding the sprite.',
      'frames["d"].pivot must be { x, y } numbers.',
    ]);
  });

  it("check animation frames against their sheet and timing", () => {
    const bad = {
      ...animation,
      timing: undefined,
      clips: {
        chomp: { frames: [{ sprite: "pacman/gone", frames: 2 }], playback: "bounce" },
        none: { frames: [] },
        both: { frames: [{ sprite: "pacman/open", ms: 10, frames: 1 }] },
      },
    };
    expect(validateAnimation(bad, Object.keys(sheet.frames)).errors).toEqual([
      'clips["chomp"].playback must be one of: loop, once, pingpong.',
      'clips["chomp"].frames[0].sprite "pacman/gone" isn\'t on the sheet.',
      'clips["chomp"].frames[0].frames needs timing.fpsBasis.',
      'clips["none"] needs at least one frame.',
      'clips["both"].frames[0] needs either ms or frames.',
    ]);
    expect(frameMs({ sprite: "x", frames: 6 }, { fpsBasis: 60 })).toBe(100);
    expect(frameMs({ sprite: "x", ms: 40 })).toBe(40);
  });

  it("check level grids by name, sizes and entity ids", () => {
    const bad = {
      ...level,
      grids: {
        collision: { values: { wall: 1, gate: 1 }, cells: [1, 1, 1] },
        pellets: { values: { pellet: 1 }, cells: [0, 0, 0, 0, 0, 7] },
      },
      entities: [level.entities![0], { ...level.entities![0] }, { type: "Ghost" }],
    };
    expect(validateLevel(bad).errors).toEqual([
      'grids["collision"].values must give every name its own number.',
      'grids["collision"].cells must hold 6 cells.',
      'grids["pellets"].cells use values without a name: 7.',
      'entities[1].id "p1" is used twice.',
      "entities[2] needs type, id, layer, x, y, width and height.",
    ]);
    expect(cellName(level.grids.collision, 2, 1, level.columns)).toBe("gate");
    expect(cellName(level.grids.collision, 1, 1, level.columns)).toBeNull();
  });

  it("name the kinds they know", () => {
    expect(validateAsset({ kind: "sound" }).errors[0]).toMatch(/kind must be one of/);
    expect(validateAsset(null).valid).toBe(false);
  });
});
