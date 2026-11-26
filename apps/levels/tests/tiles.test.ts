import { describe, it, expect } from "vite-plus/test";
import { HistoryManager, StampTool, ToolManager, type ToolContext } from "@gs2d/core";
import {
  TILE_FLIP_X,
  TILE_FLIP_Y,
  decodeTile,
  encodeTile,
  selectionToPattern,
  tileSourceRect,
  tilesetGrid,
} from "../src/model/tiles";
import type { TilesetDef } from "../src/model/types";
import { layerIdFor } from "../src/model/LevelProject";
import { createProjectFromPreset } from "../src/model/presets";
import { deserializeProject, ProjectFormatError, serializeProject } from "../src/io/projectFile";
import { toGameFormat } from "../src/io/gameFormat";

const sheet = (overrides: Partial<TilesetDef> = {}): TilesetDef => ({
  uid: 99,
  identifier: "sheet",
  tileSize: 8,
  spacing: 0,
  padding: 0,
  image: { dataUrl: "data:image/png;base64,AAAA", width: 32, height: 16 },
  ...overrides,
});

describe("tile encoding", () => {
  it("round-trips ids and flips, keeping 0 as empty and the sign bit clear", () => {
    expect(decodeTile(0)).toBeNull();
    const value = encodeTile(5, true, true);
    expect(value & TILE_FLIP_X).toBeTruthy();
    expect(value & TILE_FLIP_Y).toBeTruthy();
    expect(value).toBeGreaterThan(0);
    expect(new Int32Array([value])[0]).toBe(value);
    expect(decodeTile(value)).toEqual({ tileId: 5, flipX: true, flipY: true });
    expect(decodeTile(encodeTile(0))).toEqual({ tileId: 0, flipX: false, flipY: false });
  });

  it("slices tilesets with spacing and padding", () => {
    expect(tilesetGrid(sheet())).toEqual({ columns: 4, rows: 2 });
    const spaced = sheet({ spacing: 1, padding: 1, image: { dataUrl: "", width: 28, height: 19 } });
    expect(tilesetGrid(spaced)).toEqual({ columns: 3, rows: 2 });
    expect(tileSourceRect(spaced, 4)).toEqual({ x: 10, y: 10, width: 8, height: 8 });
    expect(tileSourceRect(spaced, 6)).toBeNull();
  });

  it("mirrors multi-tile stamps when flipped", () => {
    const plain = selectionToPattern(sheet(), { x: 1, y: 0, width: 2, height: 1 }, false, false);
    expect(plain.values.map((v) => decodeTile(v)!.tileId)).toEqual([1, 2]);
    const flipped = selectionToPattern(sheet(), { x: 1, y: 0, width: 2, height: 1 }, true, false);
    expect(flipped.values.map((v) => decodeTile(v)!.tileId)).toEqual([2, 1]);
    expect(flipped.values.every((v) => decodeTile(v)!.flipX)).toBe(true);
  });
});

describe("tile layers in projects", () => {
  it("serializes tilesets and Tiles layers, and exports tile metadata", () => {
    const project = createProjectFromPreset("pacman");
    const tileset = project.addTileset({
      identifier: "maze",
      tileSize: 8,
      spacing: 0,
      padding: 0,
      image: { dataUrl: "data:image/png;base64,AAAA", width: 64, height: 32, fileName: "maze.png" },
    });
    const def = project.addTilesLayer("walls_art", tileset.uid);
    const level = project.levels[0];
    level.doc.getLayer(layerIdFor(def.uid))!.set(2, 3, encodeTile(9, true));

    const copy = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    expect(copy.defs.tilesets).toEqual(project.defs.tilesets);
    const copiedDef = copy.getLayerDef(def.uid)!;
    expect(copiedDef).toMatchObject({ type: "Tiles", tilesetUid: tileset.uid });
    const cell = copy.levels[0].doc.getLayer(layerIdFor(def.uid))!.get(2, 3);
    expect(decodeTile(cell)).toEqual({ tileId: 9, flipX: true, flipY: false });

    const game = toGameFormat(copy, copy.levels[0]);
    expect(game.tileLayers).toEqual({
      walls_art: { tileset: "maze", tileSize: 8, columns: 8, image: "maze.png" },
    });
  });

  it("unbinds layers when their tileset is removed", () => {
    const project = createProjectFromPreset("blank");
    const tileset = project.addTileset({
      identifier: "t",
      tileSize: 16,
      spacing: 0,
      padding: 0,
      image: { dataUrl: "data:image/png;base64,AAAA", width: 16, height: 16 },
    });
    const def = project.addTilesLayer("tiles", tileset.uid);
    project.removeTileset(tileset.uid);
    expect(project.getLayerDef(def.uid)?.tilesetUid).toBeNull();
  });

  it("rejects tilesets without an embedded image", () => {
    const file = serializeProject(createProjectFromPreset("blank"));
    file.defs.tilesets.push({
      uid: 50,
      identifier: "bad",
      tileSize: 8,
      spacing: 0,
      padding: 0,
      image: { dataUrl: "https://example.com/x.png", width: 8, height: 8 },
    });
    expect(() => deserializeProject(file)).toThrow(ProjectFormatError);
  });
});

describe("StampTool", () => {
  it("tiles the pattern while dragging and undoes in one step", () => {
    const project = createProjectFromPreset("blank");
    const doc = project.levels[0].doc;
    const layer = doc.layers[0];
    const history = new HistoryManager();
    const pattern = { width: 2, height: 1, values: [7, 8] };
    const tools = new ToolManager<Int32Array>({ registerDefaults: false });
    tools.registerTool(new StampTool<Int32Array>(() => pattern));
    const ctx: ToolContext<Int32Array> = {
      doc,
      layer,
      history,
      value: 0,
      size: 1,
      isDrawing: true,
    };
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx);
    tools.executePointerAction("move", { x: 1, y: 0 }, ctx); // same slot, ignored
    tools.executePointerAction("move", { x: 3, y: 0 }, ctx); // next slot at x = 2
    tools.executePointerAction("up", { x: 3, y: 0 }, ctx);
    expect([0, 1, 2, 3, 4].map((x) => layer.get(x, 0))).toEqual([7, 8, 7, 8, 0]);
    // A single jump far away still fills every slot in between.
    tools.executePointerAction("down", { x: 0, y: 2 }, ctx);
    tools.executePointerAction("move", { x: 9, y: 2 }, ctx);
    tools.executePointerAction("up", { x: 9, y: 2 }, ctx);
    expect(Array.from({ length: 10 }, (_, x) => layer.get(x, 2))).toEqual([
      7, 8, 7, 8, 7, 8, 7, 8, 7, 8,
    ]);
    history.undo();
    history.undo();
    expect(layer.isEmpty()).toBe(true);
  });
});
