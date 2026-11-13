import { describe, it, expect } from "vite-plus/test";
import { HistoryManager } from "@foundry2d/core";
import { createProjectFromPreset } from "../src/model/presets";
import {
  AddLevelCommand,
  MoveLevelCommand,
  RemoveLevelCommand,
  RenameLevelCommand,
  ReorderLevelCommand,
} from "../src/model/commands";
import { deserializeProject, serializeProject } from "../src/io/projectFile";

const pacman = () => createProjectFromPreset("pacman");

describe("world model", () => {
  it("computes level rects, world bounds and hit tests in pixels", () => {
    const project = pacman();
    const first = project.levels[0];
    expect(first.worldRect(project.gridSize)).toEqual({ x: 0, y: 0, width: 224, height: 288 });
    const second = project.createLevel("level_0", 10, 10, { worldX: 300, worldY: -40 });
    expect(second.identifier).toBe("level_1");
    expect(project.getWorldBounds()).toEqual({ x: 0, y: -40, width: 380, height: 328 });
    expect(project.levelAt(310, 0)?.uid).toBe(second.uid);
    expect(project.levelAt(250, 0)).toBeUndefined();
  });

  it("snaps to the level grid in free layout and the world grid in gridvania", () => {
    const project = pacman();
    expect(project.snapPosition(13, 21)).toEqual({ x: 16, y: 24 });
    project.setWorldLayout("gridvania");
    expect(project.snapPosition(130, 150)).toEqual({ x: 224, y: 288 });
    expect(project.canDragLevels).toBe(true);
  });

  it("arranges linear layouts from list order", () => {
    const project = pacman();
    project.createLevel("small", 4, 4, { worldX: 999, worldY: 999 });
    project.setWorldLayout("linearH");
    expect(project.canDragLevels).toBe(false);
    const [a, b] = project.levels;
    expect([a.worldX, a.worldY]).toEqual([0, 0]);
    expect([b.worldX, b.worldY]).toEqual([224 + 16, 0]);
    project.reorderLevel(1, 0);
    expect(project.levels[0].uid).toBe(b.uid);
    expect(a.worldX).toBe(32 + 16);
  });

  it("clones levels with independent data", () => {
    const project = pacman();
    const source = project.levels[0];
    source.doc.layers[0].set(1, 1, 1);
    const copy = project.cloneLevel(source.uid, 300, 0)!;
    expect(copy.identifier).toBe("level_0_copy");
    expect(copy.doc.layers[0].get(1, 1)).toBe(1);
    copy.doc.layers[0].set(1, 1, 0);
    expect(source.doc.layers[0].get(1, 1)).toBe(1);
    expect(copy.doc.layers.map((l) => l.id)).toEqual(source.doc.layers.map((l) => l.id));
  });
});

describe("world commands", () => {
  it("undo/redo add, move, rename, reorder and remove", () => {
    const project = pacman();
    const history = new HistoryManager();
    const first = project.levels[0];

    const copy = project.cloneLevel(first.uid, 300, 0)!;
    history.execute(new AddLevelCommand(project, copy, 1));
    history.execute(new MoveLevelCommand(project, copy.uid, { x: 300, y: 0 }, { x: 400, y: 50 }));
    history.execute(new RenameLevelCommand(project, copy, "bonus"));
    history.execute(new ReorderLevelCommand(project, 1, 0));
    expect(project.levels.map((l) => l.identifier)).toEqual(["bonus", "level_0"]);
    expect([copy.worldX, copy.worldY]).toEqual([400, 50]);

    const remove = new RemoveLevelCommand(project, first);
    remove.execute();
    expect(remove.succeeded).toBe(true);
    history.record(remove);
    expect(project.levels).toHaveLength(1);

    // Removing the last level is refused.
    const refused = new RemoveLevelCommand(project, copy);
    refused.execute();
    expect(refused.succeeded).toBe(false);

    for (let i = 0; i < 5; i++) history.undo();
    expect(project.levels.map((l) => l.identifier)).toEqual(["level_0"]);
    for (let i = 0; i < 5; i++) history.redo();
    expect(project.levels.map((l) => l.identifier)).toEqual(["bonus"]);
    history.undo();
    expect(project.levels.map((l) => l.identifier)).toEqual(["bonus", "level_0"]);
  });

  it("persists world layout, grid and positions", () => {
    const project = pacman();
    project.setWorldLayout("gridvania");
    project.setWorldGrid(112, 144);
    project.createLevel("east", 28, 36, { worldX: 224, worldY: 0 });
    const copy = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    expect(copy.worldLayout).toBe("gridvania");
    expect(copy.worldGrid).toEqual({ width: 112, height: 144 });
    expect(copy.levels.map((l) => [l.identifier, l.worldX, l.worldY])).toEqual([
      ["level_0", 0, 0],
      ["east", 224, 0],
    ]);
  });
});
