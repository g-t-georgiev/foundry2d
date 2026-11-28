import { cellName, validateAsset, validateLevel, validateSpriteSheet } from "@gs2d/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  contractJson,
  levelTilesets,
  tilesetSheet,
  toLevelContract,
} from "../src/io/contractFormat";
import { layerIdFor } from "../src/model/LevelProject";
import { createProjectFromPreset } from "../src/model/presets";
import { encodeTile } from "../src/model/tiles";

function setup() {
  const project = createProjectFromPreset("pacman");
  const level = project.levels[0];
  const collision = project.defs.layers.find((l) => l.identifier === "collision")!;
  const entities = project.defs.layers.find((l) => l.type === "Entities")!;
  const grid = level.doc.getLayer(layerIdFor(collision.uid))!;
  grid.set(0, 0, 1);
  grid.set(1, 0, 4);
  grid.set(2, 0, 9); // a value without a name
  const tileset = project.addTileset({
    identifier: "maze",
    tileSize: 8,
    spacing: 0,
    padding: 0,
    image: { dataUrl: "data:image/png;base64,AAAA", width: 32, height: 16, fileName: "maze.png" },
  });
  const art = project.addTilesLayer("walls_art", tileset.uid);
  level.doc.getLayer(layerIdFor(art.uid))!.set(2, 3, encodeTile(5, true));
  const ghost = project.defs.entities.find((e) => e.identifier === "Ghost")!;
  project.insertEntity(level, {
    iid: "extra-ghost",
    defUid: ghost.uid,
    layerUid: entities.uid,
    x: 108,
    y: 116,
    fields: {},
  });
  project.addLevelField("Int", "time");
  return { project, level, tileset };
}

describe("the Game Studio 2D level export", () => {
  it("writes a valid level contract with named values, tiles and entities", () => {
    const { project, level } = setup();
    const asset = toLevelContract(project, level);
    expect(validateLevel(asset).errors).toEqual([]);
    expect(validateAsset(asset).valid).toBe(true);
    const collision = asset.grids.collision;
    expect(collision.values).toMatchObject({ wall: 1, ghost_house_door: 4 });
    expect(cellName(collision, 0, 0, asset.columns)).toBe("wall");
    expect(cellName(collision, 1, 0, asset.columns)).toBe("ghost_house_door");
    expect(cellName(collision, 2, 0, asset.columns)).toBeNull();
    expect(asset.tiles!.walls_art).toMatchObject({ sheet: "maze" });
    expect(asset.tiles!.walls_art.cells[3 * asset.columns + 2]).toBe(encodeTile(5, true));
    expect(asset.entities).toContainEqual(
      expect.objectContaining({
        type: "Ghost",
        id: "extra-ghost",
        layer: "entities",
        x: 108,
        y: 116,
        pivot: { x: 0.5, y: 0.5 },
      })
    );
    expect(asset.fields).toEqual({ time: expect.any(Number) as number });
    expect(asset.background).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("writes every tileset it uses as a sprite sheet holding its tile names", () => {
    const { project, level, tileset } = setup();
    expect(levelTilesets(project)).toEqual([tileset]);
    const sheet = tilesetSheet(tileset);
    expect(validateSpriteSheet(sheet).errors).toEqual([]);
    expect(sheet).toMatchObject({ id: "maze", image: "maze.png", width: 32, height: 16 });
    expect(sheet.frames.tile_5).toEqual({ x: 8, y: 8, w: 8, h: 8 });
    const names = toLevelContract(project, level).tiles!.walls_art.tileNames;
    expect(names).toEqual(Object.keys(sheet.frames));
  });

  it("writes number lists on one line, and the JSON reads back the same", () => {
    const { project, level } = setup();
    const asset = toLevelContract(project, level);
    const text = contractJson(asset);
    expect(JSON.parse(text)).toEqual(asset);
    expect(text).toMatch(/"cells": \[1, 4, 0, 0, /);
    expect(text.split("\n").length).toBeLessThan(400);
  });
});
